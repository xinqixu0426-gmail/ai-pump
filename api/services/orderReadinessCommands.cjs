const crypto = require('node:crypto');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
    requestHash,
} = require('./commandExecution.cjs');
const { buildOrderReadinessContext } = require('./activeOrderReadiness.cjs');
const { buildOrderReadinessPlan } = require('./orderReadinessPlan.cjs');
const { applyOrderStatusChange } = require('./orderCommands.cjs');
const {
    assertPreviewHash,
    normalizePreviewHash,
} = require('./previewIntegrity.cjs');
const {
    assertExpectedUpdatedAt,
    normalizeExpectedUpdatedAt,
} = require('./resourceVersion.cjs');
const { parseJsonArray, parsePositiveId } = require('./validation.cjs');

const CAPABILITY_ID = requireBusinessCapability(
    'orders.execute_readiness_action'
).capabilityId;
const SUPPORTED_ACTION_IDS = new Set([
    'confirm_order',
    'generate_purchase_plan',
]);

function readinessCommandError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function normalizeActionId(value) {
    const actionId = String(value || '').trim();
    if (!SUPPORTED_ACTION_IDS.has(actionId)) {
        throw readinessCommandError(
            'order_readiness_action_unsupported',
            '不支持的处理步骤',
            400
        );
    }
    return actionId;
}

function getOrderRecord(db, orderId) {
    const record = db.prepare(
        'SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL'
    ).get(orderId);
    if (!record) {
        throw readinessCommandError('order_not_found', '订单不存在', 404);
    }
    return record;
}

function buildReadinessState(dependencies, orderId, options = {}) {
    const record = options.record || getOrderRecord(dependencies.db, orderId);
    const context = buildOrderReadinessContext(record, {
        dbAccessors: dependencies,
        db: dependencies.db,
    });
    const actionPlan = buildOrderReadinessPlan(context.readiness, options);
    return {
        record,
        context,
        actionPlan,
    };
}

function actionSnapshot(orderId, actionId, state) {
    const action = state.actionPlan.steps.find(item => item.id === actionId) || null;
    const stableReadiness = { ...state.context.readiness };
    delete stableReadiness.generatedAt;
    const stableTodos = (state.context.plan.todos || []).map(todo => ({
        supplier: String(todo.supplier || ''),
        description: String(todo.description || ''),
        done: Boolean(todo.done),
    }));
    return {
        capabilityId: CAPABILITY_ID,
        orderId,
        actionId,
        orderUpdatedAt: String(state.record.updated_at || ''),
        orderStatus: String(state.record.status || ''),
        action,
        readiness: stableReadiness,
        purchaseList: state.context.plan.purchaseList || [],
        todos: stableTodos,
    };
}

function readinessActionPreviewHash(orderId, actionId, state) {
    return requestHash(actionSnapshot(orderId, actionId, state));
}

function actionProtocol(orderId, actionId, state) {
    return {
        capabilityId: CAPABILITY_ID,
        expectedUpdatedAt: String(state.record.updated_at || ''),
        previewHash: readinessActionPreviewHash(orderId, actionId, state),
        suggestedIdempotencyKey: `order-readiness:${orderId}:${actionId}:${crypto.randomUUID()}`,
    };
}

function buildOrderReadinessActionDraft(dependencies, orderIdValue, options = {}) {
    const orderId = parsePositiveId(orderIdValue);
    if (!orderId) {
        throw readinessCommandError('order_id_invalid', '非法订单ID', 400);
    }
    const state = buildReadinessState(dependencies, orderId, options);
    const actions = {};
    const steps = state.actionPlan.steps.map((step) => {
        if (!SUPPORTED_ACTION_IDS.has(step.id)) return step;
        const protocol = actionProtocol(orderId, step.id, state);
        actions[step.id] = protocol;
        return {
            ...step,
            command: protocol,
        };
    });
    return {
        ...state.actionPlan,
        readiness: state.context.readiness,
        capabilityId: CAPABILITY_ID,
        expectedUpdatedAt: String(state.record.updated_at || ''),
        steps,
        actions,
    };
}

function requireAvailableAction(state, actionId) {
    const action = state.actionPlan.steps.find(item => item.id === actionId);
    if (!action) {
        throw readinessCommandError(
            'order_readiness_action_missing',
            `当前处理方案中不存在步骤：${actionId}`,
            409
        );
    }
    if (action.mode !== 'confirmable' || action.status !== 'available') {
        const reason = action.status === 'blocked'
            ? `该步骤仍受前置步骤阻塞：${action.dependsOn.join('、')}`
            : '该步骤不是可由AI确认执行的操作';
        throw readinessCommandError(
            'order_readiness_action_unavailable',
            reason,
            409
        );
    }
    return action;
}

function executeOrderReadinessAction(
    dependencies,
    orderIdValue,
    actionIdValue,
    input = {},
    commandContext = {}
) {
    const orderId = parsePositiveId(orderIdValue);
    if (!orderId) {
        throw readinessCommandError('order_id_invalid', '非法订单ID', 400);
    }
    const actionId = normalizeActionId(actionIdValue);
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
            message: `订单 #${orderId} 的处理步骤未绑定 readiness-plan 预览`,
            resourceId: orderId,
        });
    }

    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: CAPABILITY_ID,
        input: {
            orderId,
            actionId,
            expectedUpdatedAt,
            previewHash: expectedPreviewHash,
        },
        warnings: [
            ...(commandContext.warnings || []),
            ...compatibilityWarnings,
        ],
        execute: ({ auditContext }) => {
            const state = buildReadinessState(dependencies, orderId);
            assertExpectedUpdatedAt(
                state.record,
                expectedUpdatedAt,
                `订单 #${orderId}`
            );
            const currentPreviewHash = readinessActionPreviewHash(
                orderId,
                actionId,
                state
            );
            assertPreviewHash(
                expectedPreviewHash,
                currentPreviewHash,
                '订单处理方案所依据的订单、库存或采购事实已经变化，请重新生成计划'
            );
            const action = requireAvailableAction(state, actionId);
            let order;
            let auditIds = [];
            let changes = [];

            if (actionId === 'confirm_order') {
                const statusResult = applyOrderStatusChange(
                    {
                        db: dependencies.db,
                        orderRow: dependencies.orderRow,
                        safeUpdate: dependencies.safeUpdate,
                    },
                    orderId,
                    { status: '待采购', reason: '' },
                    {
                        record: state.record,
                        purchaseList: state.context.plan.purchaseList,
                        auditContext,
                    }
                );
                order = statusResult.order;
                if (statusResult.write.auditId) {
                    auditIds.push(statusResult.write.auditId);
                }
                changes.push({
                    resourceType: 'order',
                    resourceId: orderId,
                    field: 'status',
                    from: statusResult.previousStatus,
                    to: statusResult.nextStatus,
                    reason: 'readiness_action_confirm_order',
                });
            } else {
                const updates = {
                    purchase_list_json: JSON.stringify(
                        state.context.plan.purchaseList || []
                    ),
                };
                if (parseJsonArray(state.record.todos_json).length === 0) {
                    updates.todos_json = JSON.stringify(
                        state.context.plan.todos || []
                    );
                }
                const write = dependencies.safeUpdate(
                    'orders',
                    orderId,
                    updates,
                    auditContext
                );
                order = dependencies.orderRow(
                    dependencies.db.prepare(
                        'SELECT * FROM orders WHERE id = ?'
                    ).get(orderId)
                );
                if (write.auditId) auditIds.push(write.auditId);
                changes.push({
                    resourceType: 'order',
                    resourceId: orderId,
                    field: 'purchasePlan',
                    from: null,
                    to: {
                        itemCount: (state.context.plan.purchaseList || []).length,
                        todoCount: parseJsonArray(order.todosJson).length,
                    },
                    reason: 'readiness_action_generate_purchase_plan',
                });
            }

            const nextPlan = buildOrderReadinessActionDraft(
                dependencies,
                orderId
            );
            return {
                data: {
                    action: {
                        id: action.id,
                        title: action.title,
                        executedAt: new Date().toISOString(),
                    },
                    order,
                    previousPlanStatus: state.actionPlan.planStatus,
                    nextPlan,
                },
                resource: {
                    type: 'order',
                    ids: [orderId],
                },
                changes,
                auditIds,
                requiredAuditCount: changes.length,
            };
        },
    });
}

module.exports = {
    CAPABILITY_ID,
    SUPPORTED_ACTION_IDS,
    buildOrderReadinessActionDraft,
    executeOrderReadinessAction,
    readinessActionPreviewHash,
};
