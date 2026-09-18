const { adjustCoilStock } = require('./coilInventory.cjs');
const { purchaseToInventoryQty } = require('./orderWorkflow.cjs');
const { assertPurchasePartSupplier, catalogId, positiveFactor, purchaseStockIdentity, purchaseIdentityError } = require('./purchaseIdentity.cjs');

function purchaseInventoryType(item) {
    if (item?.inventoryType === 'none') return 'none';
    purchaseStockIdentity(item);
    if (item?.inventoryType === 'coil' || catalogId(item?.coilId)) return 'coil';
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
    if (!['number', 'string'].includes(typeof purchaseQty) || String(purchaseQty).trim() === ''
        || !Number.isFinite(Number(purchaseQty)) || Number(purchaseQty) < 0) {
        throw purchaseIdentityError('PURCHASE_QUANTITY_INVALID', '采购入库数量必须是非负数');
    }
    if (inventoryType === 'coil') {
        const coilId = catalogId(item.coilId);
        if (!coilId) throw new Error(`采购项「${item.model}」没有对应正式线圈方案，无法入库`);
        const coil = db.prepare('SELECT * FROM coils WHERE id = ?').get(coilId);
        if (!coil || (coil.scheme_status != null && coil.scheme_status !== 'official')) {
            throw purchaseIdentityError('PURCHASE_COIL_UNAVAILABLE', `采购项「${item.model}」对应正式线圈方案不存在或已停用`);
        }
        if (!Number.isSafeInteger(Number(purchaseQty))) throw purchaseIdentityError('PURCHASE_QUANTITY_INVALID', '线圈入库数量必须为整数');
        const inventoryAddQty = Number(purchaseQty);
        return {
            inventoryType,
            inventoryAddQty,
            resourceId: coilId,
            currentStock: Number(coil.stock || 0),
            stockAfter: Number(coil.stock || 0) + inventoryAddQty,
        };
    }

    const partId = catalogId(item.partId);
    if (!partId) throw new Error(`采购项「${item.model}」没有对应零件，无法入库`);
    const part = db.prepare(
        'SELECT id, model, supplier, stock FROM parts WHERE id = ? AND deleted_at IS NULL'
    ).get(partId);
    if (!part || String(part.model || '') !== String(item.model || '')) {
        throw purchaseIdentityError('PURCHASE_PART_IDENTITY_CHANGED', `采购项「${item.model}」对应零件不存在或已变化`);
    }
    // supplier identifies the saved catalog reference; actualSupplier is a
    // separate purchasing fact and must not select a different stock record.
    assertPurchasePartSupplier(item, part);
    positiveFactor(item.stockQtyPerUnit);
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
    // Preview and execution share the same target and quantity checks. The
    // caller owns the enclosing command/audit/receipt transaction.
    const inspected = inspectPurchaseInventory(dependencies, item, purchaseQty);
    const { inventoryType } = inspected;
    if (inspected.inventoryAddQty === 0) return { inventoryType, inventoryAddQty: 0,
        resourceId: inspected.resourceId, auditIds: [] };
    if (inventoryType === 'none') {
        return {
            inventoryType,
            inventoryAddQty: 0,
            resourceId: null,
            auditIds: [],
        };
    }
    if (inventoryType === 'coil') {
        const coilId = inspected.resourceId;
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

    const partId = inspected.resourceId;
    const inventoryAddQty = inspected.inventoryAddQty;
    const write = safeUpdate(
        'parts',
        partId,
        { stock: inspected.stockAfter },
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
