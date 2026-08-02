function parseStockChange(value) {
    const changeQty = Number(value);
    if (!Number.isInteger(changeQty) || changeQty === 0) {
        throw new Error('线圈库存变动数量必须是非零整数');
    }
    return changeQty;
}

function coilStockMovementRow(row) {
    if (!row) return row;
    return {
        id: row.id,
        coilId: row.coil_id,
        changeQty: row.change_qty,
        balanceAfter: row.balance_after,
        movementType: row.movement_type,
        referenceType: row.reference_type || '',
        referenceId: row.reference_id || '',
        note: row.note || '',
        createdAt: row.created_at,
    };
}

function assertCoilCanBeDeleted(db, coilIdValue) {
    const coilId = Number(coilIdValue);
    if (!Number.isInteger(coilId) || coilId <= 0) {
        const error = new Error('非法线圈ID');
        error.statusCode = 400;
        throw error;
    }
    const coil = db.prepare('SELECT id, stock FROM coils WHERE id = ?').get(coilId);
    if (!coil) {
        const error = new Error('线圈记录不存在');
        error.statusCode = 404;
        throw error;
    }
    const movementCount = Number(db.prepare(
        'SELECT COUNT(*) AS count FROM coil_stock_movements WHERE coil_id = ?'
    ).get(coilId).count || 0);
    if (Number(coil.stock || 0) !== 0 || movementCount > 0) {
        const error = new Error('该线圈已有库存或库存流水，不能删除；请保留记录并改为测试方案');
        error.statusCode = 409;
        throw error;
    }
    return true;
}

function assertCoilIdentityEditable(db, coilIdValue, changedFields = []) {
    const coilId = Number(coilIdValue);
    if (!Number.isInteger(coilId) || coilId <= 0) {
        const error = new Error('非法线圈ID');
        error.statusCode = 400;
        throw error;
    }
    if (!Array.isArray(changedFields) || changedFields.length === 0) return true;

    const coil = db.prepare('SELECT id, stock FROM coils WHERE id = ?').get(coilId);
    if (!coil) {
        const error = new Error('线圈记录不存在');
        error.statusCode = 404;
        throw error;
    }
    const movementCount = Number(db.prepare(
        'SELECT COUNT(*) AS count FROM coil_stock_movements WHERE coil_id = ?'
    ).get(coilId).count || 0);
    if (Number(coil.stock || 0) > 0 || movementCount > 0) {
        const error = new Error(
            `该线圈已有库存或库存流水，不能修改身份字段：${changedFields.join('、')}；请新建线圈方案并保留原记录用于追溯`
        );
        error.statusCode = 409;
        throw error;
    }
    return true;
}

function adjustCoilStock(dependencies, input = {}) {
    const { db, safeUpdate, safeInsert } = dependencies;
    const coilId = Number(input.coilId);
    if (!Number.isInteger(coilId) || coilId <= 0) throw new Error('非法线圈ID');
    const changeQty = parseStockChange(input.changeQty);
    const coil = db.prepare('SELECT id, spec, sheets, stock FROM coils WHERE id = ?').get(coilId);
    if (!coil) throw new Error('线圈记录不存在');

    const balanceAfter = Number(coil.stock || 0) + changeQty;
    if (balanceAfter < 0) {
        throw new Error(`线圈库存不足，当前库存 ${Number(coil.stock || 0)} 套`);
    }

    const now = input.createdAt || new Date().toISOString();
    safeUpdate('coils', coilId, { stock: balanceAfter });
    const movement = safeInsert('coil_stock_movements', {
        coil_id: coilId,
        change_qty: changeQty,
        balance_after: balanceAfter,
        movement_type: String(input.movementType || 'manual_adjustment').trim() || 'manual_adjustment',
        reference_type: String(input.referenceType || '').trim(),
        reference_id: String(input.referenceId || '').trim(),
        note: String(input.note || '').trim(),
        created_at: now,
    });
    return {
        coilId,
        changeQty,
        balanceAfter,
        movementId: Number(movement.lastInsertRowid),
    };
}

module.exports = {
    adjustCoilStock,
    assertCoilCanBeDeleted,
    assertCoilIdentityEditable,
    coilStockMovementRow,
    parseStockChange,
};
