const { parseJsonArray, parsePositiveId } = require('./validation.cjs');

function normalizeRevisionReason(value) {
    const reason = String(value || '').trim();
    if (!reason) {
        const error = new Error('修改订单必须填写修改原因');
        error.code = 'order_edit_reason_required';
        error.statusCode = 422;
        throw error;
    }
    if (reason.length > 500) {
        const error = new Error('修改原因不能超过500字');
        error.code = 'order_edit_reason_too_long';
        error.statusCode = 422;
        throw error;
    }
    return reason;
}

function orderBusinessSnapshot(record = {}) {
    return {
        orderId: Number(record.id),
        customerId: record.customer_id == null ? null : Number(record.customer_id),
        customerName: String(record.customer_name || ''),
        contractNo: String(record.contract_no || ''),
        remark: String(record.remark || ''),
        status: String(record.status || ''),
        items: parseJsonArray(record.items_json),
        purchaseList: parseJsonArray(record.purchase_list_json),
        todos: parseJsonArray(record.todos_json),
        purchaseCompletedAt: record.purchase_completed_at || null,
        purchaseReceiptId: record.purchase_receipt_id || null,
        statusReason: String(record.status_reason || ''),
        statusChangedAt: record.status_changed_at || null,
        closedAt: record.closed_at || null,
        cancelledAt: record.cancelled_at || null,
        inventoryDisposition: record.inventory_disposition || null,
        inventoryDispositionAt: record.inventory_disposition_at || null,
        inventoryDispositionNote: String(record.inventory_disposition_note || ''),
        createdAt: record.created_at || null,
        updatedAt: record.updated_at || null,
        deletedAt: record.deleted_at || null,
    };
}

function comparable(value) {
    return JSON.stringify(value ?? null);
}

function money(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? `¥${parsed.toFixed(2)}` : '¥0.00';
}

function orderItemKey(item = {}, index = 0) {
    return String(item.id || `${item.recipeId || 0}:${index}`);
}

function buildOrderRevisionChanges(before, after) {
    const changes = [];
    const pushField = (field, label, from, to) => {
        if (comparable(from) === comparable(to)) return;
        changes.push({
            type: 'field',
            field,
            label,
            from,
            to,
            description: `${label}：${String(from || '空')} → ${String(to || '空')}`,
        });
    };
    pushField('customerName', '客户', before.customerName, after.customerName);
    pushField('contractNo', '合同号', before.contractNo, after.contractNo);
    if (before.remark !== after.remark) {
        changes.push({
            type: 'field',
            field: 'remark',
            label: '备注',
            from: before.remark,
            to: after.remark,
            description: '订单备注已修改',
        });
    }

    const beforeItems = new Map((before.items || []).map((item, index) => [orderItemKey(item, index), item]));
    const afterItems = new Map((after.items || []).map((item, index) => [orderItemKey(item, index), item]));
    for (const [key, item] of beforeItems) {
        if (afterItems.has(key)) continue;
        changes.push({
            type: 'item_removed',
            itemId: key,
            itemName: item.recipeName || '未命名产品',
            from: item,
            to: null,
            description: `移除产品“${item.recipeName || '未命名产品'}”`,
        });
    }
    for (const [key, item] of afterItems) {
        const previous = beforeItems.get(key);
        const itemName = item.recipeName || previous?.recipeName || '未命名产品';
        if (!previous) {
            changes.push({
                type: 'item_added',
                itemId: key,
                itemName,
                from: null,
                to: item,
                description: `新增产品“${itemName}” ${Number(item.qty || 0)} 台`,
            });
            continue;
        }
        if (Number(previous.qty) !== Number(item.qty)) {
            changes.push({
                type: 'item_quantity',
                itemId: key,
                itemName,
                from: Number(previous.qty || 0),
                to: Number(item.qty || 0),
                description: `“${itemName}”数量：${Number(previous.qty || 0)} → ${Number(item.qty || 0)}`,
            });
        }
        if (Number(previous.unitPrice) !== Number(item.unitPrice)) {
            changes.push({
                type: 'item_unit_price',
                itemId: key,
                itemName,
                from: Number(previous.unitPrice || 0),
                to: Number(item.unitPrice || 0),
                description: `“${itemName}”销售单价：${money(previous.unitPrice)} → ${money(item.unitPrice)}`,
            });
        }
        if (Number(previous.unitCost) !== Number(item.unitCost)) {
            changes.push({
                type: 'item_unit_cost',
                itemId: key,
                itemName,
                from: Number(previous.unitCost || 0),
                to: Number(item.unitCost || 0),
                description: `“${itemName}”单位成本：${money(previous.unitCost)} → ${money(item.unitCost)}`,
            });
        }
        if (comparable(previous.configurationOverrides) !== comparable(item.configurationOverrides)) {
            changes.push({
                type: 'item_configuration',
                itemId: key,
                itemName,
                from: previous.configurationOverrides || {},
                to: item.configurationOverrides || {},
                description: `“${itemName}”客户配置已调整`,
            });
        }
    }

    const purchaseTotal = (items) => (items || []).reduce(
        (sum, item) => sum + Number(item.plannedQty ?? item.needToBuy ?? 0),
        0
    );
    const beforePurchase = before.purchaseList || [];
    const afterPurchase = after.purchaseList || [];
    if (comparable(beforePurchase) !== comparable(afterPurchase)) {
        changes.push({
            type: 'purchase_plan',
            field: 'purchaseList',
            from: { lineCount: beforePurchase.length, plannedQty: purchaseTotal(beforePurchase) },
            to: { lineCount: afterPurchase.length, plannedQty: purchaseTotal(afterPurchase) },
            description: `采购计划：${beforePurchase.length} 项/${purchaseTotal(beforePurchase)} → ${afterPurchase.length} 项/${purchaseTotal(afterPurchase)}`,
        });
    }
    return changes;
}

function orderRevisionRow(row) {
    if (!row) return row;
    return {
        id: Number(row.id),
        orderId: Number(row.order_id),
        revisionNo: Number(row.revision_no),
        reason: String(row.reason || ''),
        beforeSnapshot: JSON.parse(row.before_snapshot_json || '{}'),
        afterSnapshot: JSON.parse(row.after_snapshot_json || '{}'),
        changes: parseJsonArray(row.change_summary_json),
        operationId: String(row.operation_id || ''),
        actor: String(row.actor || '').startsWith('user:admin')
            ? '管理员'
            : String(row.actor || '').startsWith('internal:')
                ? '内部服务'
                : '系统',
        createdAt: row.created_at || null,
    };
}

function listOrderRevisions(db, orderIdValue) {
    const orderId = parsePositiveId(orderIdValue);
    if (!orderId) {
        const error = new Error('非法订单ID');
        error.code = 'order_id_invalid';
        error.statusCode = 400;
        throw error;
    }
    const order = db.prepare('SELECT id FROM orders WHERE id = ? AND deleted_at IS NULL').get(orderId);
    if (!order) {
        const error = new Error('订单不存在');
        error.code = 'order_not_found';
        error.statusCode = 404;
        throw error;
    }
    return db.prepare(`
        SELECT * FROM order_revisions
        WHERE order_id = ?
        ORDER BY revision_no DESC
    `).all(orderId).map(orderRevisionRow);
}

module.exports = {
    buildOrderRevisionChanges,
    listOrderRevisions,
    normalizeRevisionReason,
    orderBusinessSnapshot,
    orderRevisionRow,
};
