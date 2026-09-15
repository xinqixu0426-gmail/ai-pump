const { hydrateCatalogRow } = require('./catalogLiveReferences.cjs');
const crypto = require('node:crypto');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
    requestHash,
} = require('./commandExecution.cjs');
const { standardBusinessChange } = require('./businessChanges.cjs');
const {
    buildCurrentBalancedPurchasePlans,
} = require('./orderPurchasePlanning.cjs');
const {
    normalizePurchaseItem,
} = require('./orderWorkflow.cjs');
const {
    applyPurchaseInventory,
    inspectPurchaseInventory,
} = require('./purchaseInventory.cjs');
const {
    assertPreviewHash,
    normalizePreviewHash,
} = require('./previewIntegrity.cjs');
const {
    assertExpectedUpdatedAt,
    normalizeExpectedUpdatedAt,
} = require('./resourceVersion.cjs');
const {
    parseJsonArray,
    parsePositiveId,
} = require('./validation.cjs');

const CAPABILITY_ID = requireBusinessCapability(
    'purchasing.order.complete_inbound'
).capabilityId;

function inboundError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function getOrderRecord(db, orderId) {
    const record = db.prepare(
        'SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL'
    ).get(orderId);
    if (!record) throw inboundError('order_not_found', '订单不存在', 404);
    return hydrateCatalogRow(db, 'order', record);
}

function assertInboundStatus(record) {
    if (record.purchase_completed_at || record.status === '采购完成' || record.status === '已关闭') {
        throw inboundError(
            'purchase_already_completed',
            '该订单采购已经入库，不能重复执行',
            409
        );
    }
    if (record.status === '待确认' || record.status === '已取消') {
        throw inboundError(
            'purchase_status_conflict',
            '当前订单状态不允许采购入库',
            409
        );
    }
}

function buildInboundState(dependencies, orderId, options = {}) {
    const {
        db,
        dbGetAllCoils,
        dbGetAllParts,
    } = dependencies;
    const record = options.record || getOrderRecord(db, orderId);
    assertInboundStatus(record);
    const { records, plans } = buildCurrentBalancedPurchasePlans({
        db,
        dbAccessors: { db, dbGetAllCoils, dbGetAllParts },
        parts: dbGetAllParts(),
        coils: dbGetAllCoils(),
    });
    const purchaseList = (
        plans.get(orderId)?.purchaseList
        || parseJsonArray(record.purchase_list_json)
    ).map(normalizePurchaseItem);
    const inboundItems = purchaseList
        .map(item => ({
            item,
            targetQty: Math.max(Number(item.plannedQty || 0), Number(item.orderedQty || 0)),
        }))
        .filter(entry => entry.targetQty > Number(entry.item.stockedQty || 0))
        .map(entry => ({
            ...entry,
            addQty: entry.targetQty - Number(entry.item.stockedQty || 0),
        }));

    const inspectedInboundItems = inboundItems.map(entry => {
        const { item, addQty } = entry;
        if (!Number.isFinite(addQty) || addQty <= 0) {
            throw inboundError(
                'purchase_inbound_quantity_invalid',
                `采购项「${item.model}」入库数量无效`,
                400
            );
        }
        try {
            return {
                ...entry,
                inventory: inspectPurchaseInventory({ db }, item, addQty),
            };
        } catch (error) {
            throw inboundError(
                'purchase_inventory_mapping_invalid',
                error.message,
                400
            );
        }
    });
    return {
        record,
        records,
        plans,
        purchaseList,
        inboundItems: inspectedInboundItems,
    };
}

function inboundAdditionPreview(entry) {
    const { item, addQty, inventory } = entry;
    const {
        inventoryType,
        inventoryAddQty,
        resourceId,
        currentStock,
        stockAfter,
    } = inventory;
    return {
        identityKey: String(item.identityKey || ''),
        model: String(item.model || ''),
        name: String(item.name || ''),
        supplier: String(item.supplier || ''),
        inventoryType,
        resourceId,
        partId: inventoryType === 'part' ? resourceId : null,
        coilId: inventoryType === 'coil' ? resourceId : null,
        addQty,
        inventoryAddQty,
        purchaseUnit: String(item.purchaseUnit || ''),
        currentStock,
        stockAfter,
    };
}

function completePurchasePreviewHash(orderId, expectedUpdatedAt, additions) {
    return requestHash({
        capabilityId: CAPABILITY_ID,
        orderId,
        expectedUpdatedAt,
        additions,
    });
}

function buildCompletePurchaseDraft(dependencies, orderIdValue) {
    const orderId = parsePositiveId(orderIdValue);
    if (!orderId) throw inboundError('order_id_invalid', '非法订单ID', 400);
    const state = buildInboundState(dependencies, orderId);
    const additions = state.inboundItems.map(inboundAdditionPreview);
    return {
        capabilityId: CAPABILITY_ID,
        orderId,
        expectedUpdatedAt: state.record.updated_at,
        suggestedIdempotencyKey: `purchase-complete:${orderId}:${crypto.randomUUID()}`,
        requiresConfirmation: true,
        previewHash: completePurchasePreviewHash(
            orderId,
            state.record.updated_at,
            additions
        ),
        additions,
    };
}

function executeCompletePurchase(dependencies, input = {}, commandContext = {}) {
    const {
        db,
        dbGetAllCoils,
        dbGetAllParts,
        invalidatePartsCache,
        orderRow,
        safeInsert,
        safeUpdate,
    } = dependencies;
    const orderId = parsePositiveId(input.orderId);
    if (!orderId) throw inboundError('order_id_invalid', '非法订单ID', 400);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const expectedPreviewHash = normalizePreviewHash(input.previewHash);
    const compatibilityWarnings = [];
    if (!expectedUpdatedAt) {
        compatibilityWarnings.push({
            code: 'expected_updated_at_missing_compatibility',
            message: `订单 #${orderId} 未提供 expectedUpdatedAt，并发覆盖保护未启用`,
            resourceId: orderId,
        });
    }
    if (!expectedPreviewHash) {
        compatibilityWarnings.push({
            code: 'preview_hash_missing_compatibility',
            message: `订单 #${orderId} 未提供 previewHash，执行内容与确认预览未绑定`,
            resourceId: orderId,
        });
    }

    const result = executePersistentCommand({
        db,
        ...commandContext,
        businessChange: standardBusinessChange({ domain: 'purchasing', eventType: 'inventory_changed' }),
        input: { orderId, expectedUpdatedAt, previewHash: expectedPreviewHash },
        warnings: [...(commandContext.warnings || []), ...compatibilityWarnings],
        execute: ({ auditContext }) => {
            const record = getOrderRecord(db, orderId);
            assertExpectedUpdatedAt(record, expectedUpdatedAt, `订单 #${orderId}`);
            const state = buildInboundState(
                { db, dbGetAllCoils, dbGetAllParts },
                orderId,
                { record }
            );
            const previewAdditions = state.inboundItems.map(inboundAdditionPreview);
            const currentPreviewHash = completePurchasePreviewHash(
                orderId,
                record.updated_at,
                previewAdditions
            );
            assertPreviewHash(
                expectedPreviewHash,
                currentPreviewHash,
                '入库预览所依据的采购计划或库存已经变化，请重新预览并确认'
            );
            const auditIds = [];
            const planChanges = [];
            let requiredAuditCount = 0;

            for (const activeRecord of state.records) {
                if (Number(activeRecord.id) === orderId) continue;
                const plan = state.plans.get(Number(activeRecord.id));
                if (!plan) continue;
                const nextJson = JSON.stringify(plan.purchaseList || []);
                if (nextJson === String(activeRecord.purchase_list_json || '[]')) continue;
                const write = safeUpdate(
                    'orders',
                    Number(activeRecord.id),
                    { purchase_list_json: nextJson },
                    auditContext
                );
                requiredAuditCount += 1;
                if (write?.auditId) auditIds.push(write.auditId);
                planChanges.push({
                    resourceType: 'order',
                    resourceId: Number(activeRecord.id),
                    field: 'purchaseList',
                    reason: 'inventory_balance_recalculated',
                });
            }

            const completedAt = new Date().toISOString();
            const receiptId = crypto.randomUUID();
            const additions = [];
            for (const entry of state.inboundItems) {
                const inventory = applyPurchaseInventory(
                    { db, safeInsert, safeUpdate },
                    entry.item,
                    entry.addQty,
                    {
                        orderId,
                        createdAt: completedAt,
                        auditContext,
                    }
                );
                const expectedInventoryAudits = inventory.inventoryType === 'coil'
                    ? 2
                    : (inventory.inventoryType === 'part' ? 1 : 0);
                requiredAuditCount += expectedInventoryAudits;
                auditIds.push(...(inventory.auditIds || []));
                additions.push({
                    inventoryType: inventory.inventoryType,
                    resourceId: inventory.resourceId,
                    partId: inventory.inventoryType === 'part' ? inventory.resourceId : null,
                    coilId: inventory.inventoryType === 'coil' ? inventory.resourceId : null,
                    addQty: entry.addQty,
                    inventoryAddQty: inventory.inventoryAddQty,
                    purchaseUnit: entry.item.purchaseUnit || '',
                });
            }

            const completedPurchaseList = state.purchaseList.map(item => {
                const targetQty = Math.max(
                    Number(item.plannedQty || 0),
                    Number(item.orderedQty || 0)
                );
                if (targetQty <= 0) return item;
                const delta = Math.max(0, targetQty - Number(item.stockedQty || 0));
                return normalizePurchaseItem({
                    ...item,
                    orderedQty: targetQty,
                    receivedQty: Math.max(Number(item.receivedQty || 0), targetQty),
                    stockedQty: Math.max(Number(item.stockedQty || 0), targetQty),
                    orderedAt: item.orderedAt || completedAt,
                    receivedAt: item.receivedAt || completedAt,
                    stockedAt: item.stockedAt || completedAt,
                    stockInHistory: delta > 0
                        ? [...item.stockInHistory, { receiptId, qty: delta, at: completedAt }]
                        : item.stockInHistory,
                });
            });
            const orderWrite = safeUpdate('orders', orderId, {
                status: '采购完成',
                status_changed_at: completedAt,
                purchase_list_json: JSON.stringify(completedPurchaseList),
                purchase_completed_at: completedAt,
                purchase_receipt_id: receiptId,
            }, auditContext);
            requiredAuditCount += 1;
            if (orderWrite?.auditId) auditIds.push(orderWrite.auditId);

            const updatedOrder = orderRow(
                db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)
            );
            return {
                data: {
                    order: updatedOrder,
                    additions,
                    receiptId,
                    completedAt,
                },
                resource: {
                    type: 'purchase_inbound',
                    ids: [
                        orderId,
                        ...additions
                            .map(addition => addition.resourceId)
                            .filter(Boolean),
                    ],
                },
                changes: [
                    ...planChanges,
                    ...additions.map(addition => ({
                        resourceType: addition.inventoryType === 'none'
                            ? 'purchase_item'
                            : addition.inventoryType,
                        resourceId: addition.resourceId,
                        field: 'stock',
                        delta: addition.inventoryAddQty,
                        purchaseQty: addition.addQty,
                    })),
                    {
                        resourceType: 'order',
                        resourceId: orderId,
                        field: 'status',
                        from: record.status,
                        to: '采购完成',
                    },
                ],
                auditIds,
                requiredAuditCount,
            };
        },
    });
    if (result.additions?.some(addition => addition.inventoryType === 'part')) {
        invalidatePartsCache();
    }
    return result;
}

module.exports = {
    CAPABILITY_ID,
    buildCompletePurchaseDraft,
    completePurchasePreviewHash,
    executeCompletePurchase,
};
