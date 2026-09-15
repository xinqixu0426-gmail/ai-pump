const { hydrateCatalogRow } = require('./catalogLiveReferences.cjs');
const crypto = require('node:crypto');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
    requestHash,
} = require('./commandExecution.cjs');
const { standardBusinessChange } = require('./businessChanges.cjs');
const { uniquePurchaseRowIndex } = require('./purchaseIdentity.cjs');
const {
    buildCurrentBalancedPurchasePlans,
} = require('./orderPurchasePlanning.cjs');
const {
    deriveProcurementStatus,
    normalizePurchaseItem,
    validatePurchaseProgress,
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
    parseNonNegativeNumber,
    parsePositiveId,
} = require('./validation.cjs');

const CAPABILITY_ID = requireBusinessCapability(
    'purchasing.order.item_progress'
).capabilityId;

function progressError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function getOrderRecord(db, orderId) {
    const record = db.prepare(
        'SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL'
    ).get(orderId);
    if (!record) throw progressError('order_not_found', '订单不存在', 404);
    return hydrateCatalogRow(db, 'order', record);
}

function assertProgressStatus(record) {
    if (record.status === '待确认') {
        throw progressError(
            'purchase_status_conflict',
            '请先确认订单，再登记采购进度',
            409
        );
    }
    if (['采购完成', '已关闭', '已取消'].includes(record.status)) {
        throw progressError(
            'purchase_status_conflict',
            '当前订单状态不允许修改采购进度',
            409
        );
    }
}

function normalizeProgressInput(input = {}) {
    const identityKey = String(input.identityKey || '').trim();
    const model = String(input.model || '').trim();
    if (!identityKey && !model) {
        throw progressError(
            'purchase_item_identity_required',
            'identityKey 或 model 至少提供一个',
            400
        );
    }
    const normalized = {
        identityKey,
        model,
        supplier: String(input.supplier || ''),
        allowOverPurchase: input.allowOverPurchase === true,
    };
    for (const field of ['orderedQty', 'receivedQty', 'stockedQty']) {
        if (input[field] === undefined) continue;
        normalized[field] = parseNonNegativeNumber(input[field], field);
    }
    if (input.purchasePrice !== undefined) {
        normalized.purchasePrice = parseNonNegativeNumber(
            input.purchasePrice,
            'purchasePrice'
        );
    }
    if (input.actualSupplier !== undefined) {
        normalized.actualSupplier = String(input.actualSupplier || '').trim();
    }
    return normalized;
}

function buildLegacyPurchaseItemToggleInput(
    dependencies,
    orderIdValue,
    input = {}
) {
    const orderId = parsePositiveId(orderIdValue);
    if (!orderId) {
        throw progressError('order_id_invalid', '非法订单ID', 400);
    }
    const record = getOrderRecord(dependencies.db, orderId);
    const model = String(input?.model || '').trim();
    const supplier = String(input?.supplier || '');
    if (!model) {
        throw progressError(
            'purchase_item_model_required',
            '采购型号不能为空',
            400
        );
    }
    const purchaseList = parseJsonArray(record.purchase_list_json).map(normalizePurchaseItem);
    const item = purchaseList[uniquePurchaseRowIndex(purchaseList, { model, supplier })];
    if (!item) {
        throw progressError(
            'purchase_item_not_found',
            '采购项不存在',
            404
        );
    }
    const purchased = input?.purchased === undefined
        ? !item.purchased
        : Boolean(input.purchased);
    return {
        identityKey: item.identityKey,
        model,
        supplier,
        orderedQty: purchased ? item.plannedQty : 0,
    };
}

function balanceContext(records, plans) {
    return records.map(record => ({
        orderId: Number(record.id),
        updatedAt: String(record.updated_at || ''),
        purchaseList: (plans.get(Number(record.id))?.purchaseList || [])
            .map(normalizePurchaseItem),
    }));
}

function buildProgressState(dependencies, orderId, progressInput, options = {}) {
    const {
        db,
        dbGetAllCoils,
        dbGetAllParts,
    } = dependencies;
    const record = options.record || getOrderRecord(db, orderId);
    assertProgressStatus(record);
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
    const itemIndex = uniquePurchaseRowIndex(purchaseList, progressInput);
    if (itemIndex < 0) {
        throw progressError('purchase_item_not_found', '采购项不存在', 404);
    }
    const currentItem = purchaseList[itemIndex];
    let quantities;
    try {
        quantities = validatePurchaseProgress(currentItem, progressInput);
    } catch (error) {
        throw progressError('purchase_progress_invalid', error.message, 400);
    }
    const stockDelta = quantities.stockedQty - Number(currentItem.stockedQty || 0);
    let stockAddition = null;
    if (stockDelta > 0) {
        try {
            stockAddition = {
                ...inspectPurchaseInventory({ db }, currentItem, stockDelta),
                addQty: stockDelta,
                purchaseUnit: String(currentItem.purchaseUnit || ''),
            };
        } catch (error) {
            throw progressError(
                'purchase_inventory_mapping_invalid',
                error.message,
                400
            );
        }
    }
    const nextItem = normalizePurchaseItem({
        ...currentItem,
        ...quantities,
        purchasePrice: progressInput.purchasePrice === undefined
            ? currentItem.purchasePrice
            : progressInput.purchasePrice,
        purchasePriceRecorded: progressInput.purchasePrice === undefined
            ? currentItem.purchasePriceRecorded
            : true,
        actualSupplier: progressInput.actualSupplier === undefined
            ? currentItem.actualSupplier
            : progressInput.actualSupplier,
    });
    return {
        record,
        records,
        plans,
        purchaseList,
        itemIndex,
        currentItem,
        nextItem,
        stockDelta,
        stockAddition,
        balanceContext: balanceContext(records, plans),
    };
}

function progressPreviewHash(orderId, expectedUpdatedAt, progressInput, state) {
    return requestHash({
        capabilityId: CAPABILITY_ID,
        orderId,
        expectedUpdatedAt,
        progressInput,
        currentItem: state.currentItem,
        nextItem: state.nextItem,
        stockAddition: state.stockAddition,
        balanceContext: state.balanceContext,
    });
}

function buildPurchaseItemProgressDraft(dependencies, orderIdValue, input = {}) {
    const orderId = parsePositiveId(orderIdValue);
    if (!orderId) throw progressError('order_id_invalid', '非法订单ID', 400);
    const progressInput = normalizeProgressInput(input);
    const state = buildProgressState(dependencies, orderId, progressInput);
    return {
        capabilityId: CAPABILITY_ID,
        orderId,
        expectedUpdatedAt: state.record.updated_at,
        suggestedIdempotencyKey: `purchase-progress:${orderId}:${crypto.randomUUID()}`,
        requiresConfirmation: true,
        previewHash: progressPreviewHash(
            orderId,
            state.record.updated_at,
            progressInput,
            state
        ),
        item: {
            identityKey: String(state.currentItem.identityKey || ''),
            model: String(state.currentItem.model || ''),
            name: String(state.currentItem.name || ''),
            supplier: String(state.currentItem.supplier || ''),
            plannedQty: Number(state.currentItem.plannedQty || 0),
            before: {
                orderedQty: Number(state.currentItem.orderedQty || 0),
                receivedQty: Number(state.currentItem.receivedQty || 0),
                stockedQty: Number(state.currentItem.stockedQty || 0),
                purchasePrice: Number(state.currentItem.purchasePrice || 0),
                purchasePriceRecorded: state.currentItem.purchasePriceRecorded === true,
                actualSupplier: String(state.currentItem.actualSupplier || ''),
            },
            after: {
                orderedQty: Number(state.nextItem.orderedQty || 0),
                receivedQty: Number(state.nextItem.receivedQty || 0),
                stockedQty: Number(state.nextItem.stockedQty || 0),
                purchasePrice: Number(state.nextItem.purchasePrice || 0),
                purchasePriceRecorded: state.nextItem.purchasePriceRecorded === true,
                actualSupplier: String(state.nextItem.actualSupplier || ''),
            },
        },
        stockAddition: state.stockAddition,
    };
}

function executePurchaseItemProgress(dependencies, input = {}, commandContext = {}) {
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
    if (!orderId) throw progressError('order_id_invalid', '非法订单ID', 400);
    const progressInput = normalizeProgressInput(input);
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
            message: `订单 #${orderId} 未提供 previewHash，采购进度与确认预览未绑定`,
            resourceId: orderId,
        });
    }

    const result = executePersistentCommand({
        db,
        ...commandContext,
        businessChange: standardBusinessChange({ domain: 'purchasing', eventType: 'updated' }),
        input: {
            orderId,
            progressInput,
            expectedUpdatedAt,
            previewHash: expectedPreviewHash,
        },
        warnings: [...(commandContext.warnings || []), ...compatibilityWarnings],
        execute: ({ auditContext }) => {
            const record = getOrderRecord(db, orderId);
            assertExpectedUpdatedAt(record, expectedUpdatedAt, `订单 #${orderId}`);
            let state;
            try {
                state = buildProgressState(
                    { db, dbGetAllCoils, dbGetAllParts },
                    orderId,
                    progressInput,
                    { record }
                );
            } catch (error) {
                if (
                    expectedPreviewHash
                    && [
                        'purchase_item_not_found',
                        'purchase_progress_invalid',
                        'purchase_inventory_mapping_invalid',
                    ].includes(error.code)
                ) {
                    throw progressError(
                        'preview_changed',
                        '采购进度预览所依据的订单、平衡计划或库存已经变化，请重新保存',
                        409
                    );
                }
                throw error;
            }
            const currentPreviewHash = progressPreviewHash(
                orderId,
                record.updated_at,
                progressInput,
                state
            );
            assertPreviewHash(
                expectedPreviewHash,
                currentPreviewHash,
                '采购进度预览所依据的订单、平衡计划或库存已经变化，请重新保存'
            );

            const auditIds = [];
            const changes = [];
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
                changes.push({
                    resourceType: 'order',
                    resourceId: Number(activeRecord.id),
                    field: 'purchaseList',
                    reason: 'inventory_balance_recalculated',
                });
            }

            const now = new Date().toISOString();
            const receiptId = state.stockDelta > 0 ? crypto.randomUUID() : null;
            let appliedStockAddition = null;
            if (state.stockDelta > 0) {
                const inventory = applyPurchaseInventory(
                    { db, safeInsert, safeUpdate },
                    state.currentItem,
                    state.stockDelta,
                    {
                        orderId,
                        createdAt: now,
                        auditContext,
                    }
                );
                requiredAuditCount += inventory.inventoryType === 'coil'
                    ? 2
                    : (inventory.inventoryType === 'part' ? 1 : 0);
                auditIds.push(...(inventory.auditIds || []));
                appliedStockAddition = {
                    inventoryType: inventory.inventoryType,
                    resourceId: inventory.resourceId,
                    partId: inventory.inventoryType === 'part'
                        ? inventory.resourceId
                        : null,
                    coilId: inventory.inventoryType === 'coil'
                        ? inventory.resourceId
                        : null,
                    addQty: state.stockDelta,
                    inventoryAddQty: inventory.inventoryAddQty,
                    purchaseUnit: String(state.currentItem.purchaseUnit || ''),
                    receiptId,
                };
                changes.push({
                    resourceType: inventory.inventoryType === 'none'
                        ? 'purchase_item'
                        : inventory.inventoryType,
                    resourceId: inventory.resourceId,
                    field: 'stock',
                    delta: inventory.inventoryAddQty,
                    purchaseQty: state.stockDelta,
                });
            }

            const nextItem = normalizePurchaseItem({
                ...state.nextItem,
                orderedAt: state.nextItem.orderedQty > 0
                    ? state.currentItem.orderedAt || now
                    : null,
                receivedAt: state.nextItem.receivedQty > 0
                    ? state.currentItem.receivedAt || now
                    : null,
                stockedAt: state.nextItem.stockedQty > 0
                    ? state.currentItem.stockedAt || now
                    : null,
                stockInHistory: state.stockDelta > 0
                    ? [
                        ...state.currentItem.stockInHistory,
                        { receiptId, qty: state.stockDelta, at: now },
                    ]
                    : state.currentItem.stockInHistory,
            });
            const purchaseList = [...state.purchaseList];
            purchaseList[state.itemIndex] = nextItem;
            const nextStatus = deriveProcurementStatus(record.status, purchaseList);
            const completedNow = nextStatus === '采购完成' && record.status !== '采购完成';
            const orderWrite = safeUpdate('orders', orderId, {
                status: nextStatus,
                status_changed_at: nextStatus !== record.status
                    ? now
                    : record.status_changed_at,
                purchase_list_json: JSON.stringify(purchaseList),
                purchase_completed_at: completedNow ? now : record.purchase_completed_at,
                purchase_receipt_id: completedNow
                    ? crypto.randomUUID()
                    : record.purchase_receipt_id,
            }, auditContext);
            requiredAuditCount += 1;
            if (orderWrite?.auditId) auditIds.push(orderWrite.auditId);
            changes.push({
                resourceType: 'order',
                resourceId: orderId,
                field: 'purchaseProgress',
                identityKey: String(nextItem.identityKey || ''),
                before: {
                    orderedQty: Number(state.currentItem.orderedQty || 0),
                    receivedQty: Number(state.currentItem.receivedQty || 0),
                    stockedQty: Number(state.currentItem.stockedQty || 0),
                },
                after: {
                    orderedQty: Number(nextItem.orderedQty || 0),
                    receivedQty: Number(nextItem.receivedQty || 0),
                    stockedQty: Number(nextItem.stockedQty || 0),
                },
            });

            return {
                data: {
                    order: orderRow(
                        db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)
                    ),
                    stockAddition: appliedStockAddition,
                },
                resource: {
                    type: 'purchase_item_progress',
                    ids: [
                        orderId,
                        ...(appliedStockAddition?.resourceId
                            ? [appliedStockAddition.resourceId]
                            : []),
                    ],
                },
                changes,
                auditIds,
                requiredAuditCount,
            };
        },
    });
    if (result.stockAddition?.inventoryType === 'part') {
        invalidatePartsCache();
    }
    return result;
}

module.exports = {
    CAPABILITY_ID,
    buildLegacyPurchaseItemToggleInput,
    buildPurchaseItemProgressDraft,
    executePurchaseItemProgress,
    progressPreviewHash,
};
