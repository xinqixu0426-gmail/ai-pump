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
    coilStockMovementRow,
    parseStockChange,
};
