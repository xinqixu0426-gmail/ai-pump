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
    deriveProcurementStatus,
    normalizePurchaseItem,
} = require('./orderWorkflow.cjs');
const {
    assertPreviewHash,
    normalizePreviewHash,
} = require('./previewIntegrity.cjs');
const {
    assertExpectedUpdatedAt,
    normalizeExpectedUpdatedAt,
} = require('./resourceVersion.cjs');

const CAPABILITY_ID = requireBusinessCapability(
    'purchasing.task.batch_order'
).capabilityId;

function batchError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function normalizeTaskInput(input = {}) {
    const identityKey = String(input.identityKey || '').trim();
    const model = String(input.model || '').trim();
    if (!model) throw batchError('purchase_model_required', '采购型号不能为空', 400);
    return {
        identityKey,
        model,
        supplier: String(input.supplier || ''),
        purchased: Boolean(input.purchased),
    };
}

function itemMatches(item, input) {
    if (input.identityKey) {
        return String(item.identityKey || '') === input.identityKey;
    }
    return String(item.model || '') === input.model
        && String(item.supplier || '') === input.supplier;
}

function buildBatchState(dependencies, taskInput) {
    const {
        db,
        dbGetAllCoils,
        dbGetAllParts,
    } = dependencies;
    const { records, plans } = buildCurrentBalancedPurchasePlans({
        db,
        dbAccessors: { db, dbGetAllCoils, dbGetAllParts },
        parts: dbGetAllParts(),
        coils: dbGetAllCoils(),
    });
    const orderStates = records.map(record => {
        const purchaseList = (
            plans.get(Number(record.id))?.purchaseList || []
        ).map(normalizePurchaseItem);
        let matched = false;
        const nextPurchaseList = purchaseList.map(item => {
            if (
                ['待确认', '采购完成'].includes(record.status)
                || !itemMatches(item, taskInput)
                || Number(item.plannedQty || 0) <= 0
            ) {
                return item;
            }
            if (
                !taskInput.purchased
                && (Number(item.receivedQty || 0) > 0 || Number(item.stockedQty || 0) > 0)
            ) {
                throw batchError(
                    'purchase_order_cannot_cancel',
                    `采购项「${taskInput.model}」已有到货或入库记录，不能取消下单`,
                    409
                );
            }
            matched = true;
            return normalizePurchaseItem({
                ...item,
                orderedQty: taskInput.purchased ? item.plannedQty : 0,
                orderedAt: taskInput.purchased ? item.orderedAt : null,
            });
        });
        return {
            record,
            purchaseList,
            nextPurchaseList,
            matched,
        };
    });
    const affected = orderStates.filter(state => state.matched);
    return {
        records,
        plans,
        orderStates,
        affected,
        balanceContext: orderStates.map(state => ({
            orderId: Number(state.record.id),
            updatedAt: String(state.record.updated_at || ''),
            purchaseList: state.purchaseList,
        })),
    };
}

function batchPreviewHash(taskInput, state) {
    return requestHash({
        capabilityId: CAPABILITY_ID,
        taskInput,
        balanceContext: state.balanceContext,
        affected: state.affected.map(entry => ({
            orderId: Number(entry.record.id),
            before: entry.purchaseList,
            after: entry.nextPurchaseList,
        })),
    });
}

function buildPurchaseBatchDraft(dependencies, input = {}) {
    const taskInput = normalizeTaskInput(input);
    const state = buildBatchState(dependencies, taskInput);
    return {
        capabilityId: CAPABILITY_ID,
        suggestedIdempotencyKey: `purchase-batch:${crypto.randomUUID()}`,
        requiresConfirmation: true,
        previewHash: batchPreviewHash(taskInput, state),
        expectedVersions: state.affected.map(entry => ({
            orderId: Number(entry.record.id),
            expectedUpdatedAt: String(entry.record.updated_at || ''),
        })),
        task: taskInput,
        affectedOrders: state.affected.map(entry => {
            const before = entry.purchaseList.find(item => itemMatches(item, taskInput));
            const after = entry.nextPurchaseList.find(item => itemMatches(item, taskInput));
            return {
                orderId: Number(entry.record.id),
                customerName: String(entry.record.customer_name || ''),
                contractNo: String(entry.record.contract_no || ''),
                plannedQty: Number(after?.plannedQty || before?.plannedQty || 0),
                beforeOrderedQty: Number(before?.orderedQty || 0),
                afterOrderedQty: Number(after?.orderedQty || 0),
                purchaseUnit: String(after?.purchaseUnit || before?.purchaseUnit || ''),
            };
        }),
    };
}

function normalizeExpectedVersions(value) {
    if (value === undefined || value === null) return null;
    if (!Array.isArray(value)) {
        throw batchError('resource_versions_invalid', 'expectedVersions 必须是数组', 400);
    }
    const versions = value.map((item, index) => {
        const orderId = Number(item?.orderId);
        if (!Number.isInteger(orderId) || orderId <= 0) {
            throw batchError(
                'resource_versions_invalid',
                `expectedVersions[${index}].orderId 必须是正整数`,
                400
            );
        }
        return {
            orderId,
            expectedUpdatedAt: normalizeExpectedUpdatedAt(
                item?.expectedUpdatedAt,
                `expectedVersions[${index}].expectedUpdatedAt`
            ),
        };
    });
    if (new Set(versions.map(item => item.orderId)).size !== versions.length) {
        throw batchError('resource_versions_invalid', 'expectedVersions 不能重复订单', 400);
    }
    return versions;
}

function executePurchaseBatch(dependencies, input = {}, commandContext = {}) {
    const {
        db,
        dbGetAllCoils,
        dbGetAllParts,
        orderRow,
        safeUpdate,
    } = dependencies;
    const taskInput = normalizeTaskInput(input);
    const expectedVersions = normalizeExpectedVersions(input.expectedVersions);
    const expectedPreviewHash = normalizePreviewHash(input.previewHash);
    const compatibilityWarnings = [];
    if (!expectedVersions) {
        compatibilityWarnings.push({
            code: 'expected_versions_missing_compatibility',
            message: '批量采购未提供 expectedVersions，并发覆盖保护未启用',
        });
    }
    if (!expectedPreviewHash) {
        compatibilityWarnings.push({
            code: 'preview_hash_missing_compatibility',
            message: '批量采购未提供 previewHash，执行内容与确认预览未绑定',
        });
    }

    return executePersistentCommand({
        db,
        ...commandContext,
        businessChange: standardBusinessChange({ domain: 'purchasing', eventType: 'updated' }),
        input: {
            taskInput,
            expectedVersions,
            previewHash: expectedPreviewHash,
        },
        warnings: [...(commandContext.warnings || []), ...compatibilityWarnings],
        execute: ({ auditContext }) => {
            let state;
            try {
                state = buildBatchState(
                    { db, dbGetAllCoils, dbGetAllParts },
                    taskInput
                );
            } catch (error) {
                if (expectedPreviewHash && error.code === 'purchase_order_cannot_cancel') {
                    throw batchError(
                        'preview_changed',
                        '批量采购预览所依据的到货或入库进度已经变化，请重新确认',
                        409
                    );
                }
                throw error;
            }
            if (expectedVersions) {
                const currentById = new Map(
                    state.affected.map(entry => [Number(entry.record.id), entry.record])
                );
                for (const version of expectedVersions) {
                    const record = currentById.get(version.orderId);
                    if (!record) {
                        throw batchError(
                            'preview_changed',
                            '批量采购影响的订单集合已经变化，请重新预览',
                            409
                        );
                    }
                    assertExpectedUpdatedAt(
                        record,
                        version.expectedUpdatedAt,
                        `订单 #${version.orderId}`
                    );
                }
                if (currentById.size !== expectedVersions.length) {
                    throw batchError(
                        'preview_changed',
                        '批量采购影响的订单集合已经变化，请重新预览',
                        409
                    );
                }
            }
            assertPreviewHash(
                expectedPreviewHash,
                batchPreviewHash(taskInput, state),
                '批量采购预览所依据的活动订单或平衡计划已经变化，请重新确认'
            );

            const now = new Date().toISOString();
            const auditIds = [];
            const changes = [];
            const updatedOrders = [];
            let requiredAuditCount = 0;
            for (const orderState of state.orderStates) {
                let purchaseList = orderState.nextPurchaseList;
                if (orderState.matched && taskInput.purchased) {
                    purchaseList = purchaseList.map(item => (
                        itemMatches(item, taskInput)
                            ? normalizePurchaseItem({
                                ...item,
                                orderedAt: item.orderedAt || now,
                            })
                            : item
                    ));
                }
                const nextJson = JSON.stringify(purchaseList);
                const currentJson = String(orderState.record.purchase_list_json || '[]');
                if (!orderState.matched && nextJson === currentJson) continue;
                const nextStatus = orderState.matched
                    ? deriveProcurementStatus(orderState.record.status, purchaseList)
                    : orderState.record.status;
                const updates = {
                    purchase_list_json: nextJson,
                    ...(orderState.matched ? {
                        status: nextStatus,
                        status_changed_at: nextStatus !== orderState.record.status
                            ? now
                            : orderState.record.status_changed_at,
                    } : {}),
                };
                const write = safeUpdate(
                    'orders',
                    Number(orderState.record.id),
                    updates,
                    auditContext
                );
                requiredAuditCount += 1;
                if (write?.auditId) auditIds.push(write.auditId);
                if (orderState.matched) {
                    updatedOrders.push(orderRow(
                        db.prepare('SELECT * FROM orders WHERE id = ?')
                            .get(Number(orderState.record.id))
                    ));
                    const before = orderState.purchaseList.find(item => itemMatches(item, taskInput));
                    const after = purchaseList.find(item => itemMatches(item, taskInput));
                    changes.push({
                        resourceType: 'order',
                        resourceId: Number(orderState.record.id),
                        field: 'orderedQty',
                        identityKey: String(after?.identityKey || ''),
                        from: Number(before?.orderedQty || 0),
                        to: Number(after?.orderedQty || 0),
                    });
                } else {
                    changes.push({
                        resourceType: 'order',
                        resourceId: Number(orderState.record.id),
                        field: 'purchaseList',
                        reason: 'inventory_balance_recalculated',
                    });
                }
            }
            return {
                data: {
                    updatedCount: updatedOrders.length,
                    updatedOrders,
                },
                resource: {
                    type: 'purchase_task',
                    ids: updatedOrders.map(order => Number(order.id)),
                },
                changes,
                auditIds,
                requiredAuditCount,
            };
        },
    });
}

module.exports = {
    CAPABILITY_ID,
    buildPurchaseBatchDraft,
    batchPreviewHash,
    executePurchaseBatch,
};
