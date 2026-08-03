const { adjustCoilStock } = require('./coilInventory.cjs');
const { purchaseToInventoryQty } = require('./orderWorkflow.cjs');
const { parsePositiveId } = require('./validation.cjs');

function purchaseInventoryType(item) {
    if (item?.inventoryType === 'none') return 'none';
    if (item?.inventoryType === 'coil' || parsePositiveId(item?.coilId)) return 'coil';
    return 'part';
}

function inspectPurchaseInventory(dependencies, item, purchaseQty) {
    const { db } = dependencies;
    const inventoryType = purchaseInventoryType(item);
    if (inventoryType === 'none') {
        return {
            inventoryType,
            inventoryAddQty: 0,
            resourceId: null,
            currentStock: null,
            stockAfter: null,
        };
    }
    if (inventoryType === 'coil') {
        const coilId = parsePositiveId(item.coilId);
        if (!coilId) throw new Error(`采购项「${item.model}」没有对应正式线圈方案，无法入库`);
        const coil = db.prepare('SELECT id, stock FROM coils WHERE id = ?').get(coilId);
        if (!coil) throw new Error(`采购项「${item.model}」对应正式线圈方案不存在或已变化`);
        const inventoryAddQty = Number(purchaseQty);
        return {
            inventoryType,
            inventoryAddQty,
            resourceId: coilId,
            currentStock: Number(coil.stock || 0),
            stockAfter: Number(coil.stock || 0) + inventoryAddQty,
        };
    }

    const partId = parsePositiveId(item.partId);
    if (!partId) throw new Error(`采购项「${item.model}」没有对应零件，无法入库`);
    const part = db.prepare(
        'SELECT id, model, stock FROM parts WHERE id = ? AND deleted_at IS NULL'
    ).get(partId);
    if (!part || String(part.model || '') !== String(item.model || '')) {
        throw new Error(`采购项「${item.model}」对应零件不存在或已变化`);
    }
    const inventoryAddQty = purchaseToInventoryQty(item, purchaseQty);
    return {
        inventoryType,
        inventoryAddQty,
        resourceId: partId,
        currentStock: Number(part.stock || 0),
        stockAfter: Number(part.stock || 0) + inventoryAddQty,
    };
}

function applyPurchaseInventory(dependencies, item, purchaseQty, context = {}) {
    const {
        db,
        safeInsert,
        safeUpdate,
    } = dependencies;
    const inventoryType = purchaseInventoryType(item);
    if (inventoryType === 'none') {
        return {
            inventoryType,
            inventoryAddQty: 0,
            resourceId: null,
            auditIds: [],
        };
    }
    if (inventoryType === 'coil') {
        const coilId = parsePositiveId(item.coilId);
        if (!coilId) throw new Error(`采购项「${item.model}」没有对应正式线圈方案，无法入库`);
        const result = adjustCoilStock(
            { db, safeUpdate, safeInsert },
            {
                coilId,
                changeQty: purchaseQty,
                movementType: 'purchase_inbound',
                referenceType: 'order',
                referenceId: String(context.orderId),
                note: `订单采购入库：${item.model}`,
                createdAt: context.createdAt,
                auditContext: context.auditContext,
            }
        );
        return {
            inventoryType,
            inventoryAddQty: result.changeQty,
            resourceId: coilId,
            auditIds: result.auditIds || [],
        };
    }

    const partId = parsePositiveId(item.partId);
    if (!partId) throw new Error(`采购项「${item.model}」没有对应零件，无法入库`);
    const part = db.prepare(
        'SELECT model, stock FROM parts WHERE id = ? AND deleted_at IS NULL'
    ).get(partId);
    if (!part || String(part.model || '') !== String(item.model || '')) {
        throw new Error(`采购项「${item.model}」对应零件不存在或已变化`);
    }
    const inventoryAddQty = purchaseToInventoryQty(item, purchaseQty);
    const write = safeUpdate(
        'parts',
        partId,
        { stock: Math.max(0, Number(part.stock || 0) + inventoryAddQty) },
        context.auditContext
    );
    return {
        inventoryType,
        inventoryAddQty,
        resourceId: partId,
        auditIds: [write?.auditId].filter(Boolean),
    };
}

module.exports = {
    applyPurchaseInventory,
    inspectPurchaseInventory,
    purchaseInventoryType,
};
