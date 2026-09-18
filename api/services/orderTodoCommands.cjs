const { hydrateCatalogRow } = require('./catalogLiveReferences.cjs');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
} = require('./commandExecution.cjs');
const { standardBusinessChange } = require('./businessChanges.cjs');
const {
    assertExpectedUpdatedAt,
    normalizeExpectedUpdatedAt,
} = require('./resourceVersion.cjs');
const { parseJsonArray, parsePositiveId } = require('./validation.cjs');

const CAPABILITY_ID = requireBusinessCapability('orders.todos.toggle').capabilityId;

function todoCommandError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function getOrderRecord(db, orderId) {
    const record = db.prepare(
        'SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL'
    ).get(orderId);
    if (!record) throw todoCommandError('order_not_found', '订单不存在', 404);
    return hydrateCatalogRow(db, 'order', record);
}

function executeOrderTodoToggle(
    dependencies,
    orderIdValue,
    input = {},
    commandContext = {}
) {
    const orderId = parsePositiveId(orderIdValue);
    if (!orderId) throw todoCommandError('order_id_invalid', '非法订单ID', 400);
    const todoId = String(input.todoId || '').trim();
    if (!todoId) throw todoCommandError('todo_id_required', '待办 ID 不能为空', 400);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const compatibilityWarnings = !expectedUpdatedAt ? [{
        code: 'expected_updated_at_missing_compatibility',
        message: `订单 #${orderId} 未提供 expectedUpdatedAt，并发覆盖保护未启用`,
        resourceId: orderId,
    }] : [];

    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: CAPABILITY_ID,
        businessChange: standardBusinessChange({
            domain: 'order',
            eventType: 'updated',
            entityRefs: () => [{ entityType: 'order', entityId: orderId, role: 'primary' }],
        }),
        input: {
            orderId,
            todoId,
            ...(input.done === undefined ? {} : { done: Boolean(input.done) }),
            expectedUpdatedAt,
        },
        warnings: [
            ...(commandContext.warnings || []),
            ...compatibilityWarnings,
        ],
        execute: ({ auditContext }) => {
            const record = getOrderRecord(dependencies.db, orderId);
            assertExpectedUpdatedAt(record, expectedUpdatedAt, `订单 #${orderId}`);
            const todos = parseJsonArray(record.todos_json);
            const todoIndex = todos.findIndex(item => String(item.id) === todoId);
            if (todoIndex < 0) {
                return {
                    data: { order: dependencies.orderRow(record) },
                    resource: { type: 'order', ids: [orderId] },
                    changes: [],
                    auditIds: [],
                    requiredAuditCount: 0,
                    warnings: [{
                        code: 'todo_not_found_noop',
                        message: `订单 #${orderId} 中不存在待办 ${todoId}，未执行写入`,
                    }],
                };
            }
            const currentDone = Boolean(todos[todoIndex].done);
            const nextDone = input.done === undefined
                ? !currentDone
                : Boolean(input.done);
            if (nextDone === currentDone) {
                return {
                    data: { order: dependencies.orderRow(record) },
                    resource: { type: 'order', ids: [orderId] },
                    changes: [],
                    auditIds: [],
                    requiredAuditCount: 0,
                    warnings: [{
                        code: 'todo_state_unchanged',
                        message: `待办 ${todoId} 已是目标状态，未重复写入`,
                    }],
                };
            }
            todos[todoIndex] = {
                ...todos[todoIndex],
                done: nextDone,
            };
            const write = dependencies.safeUpdate(
                'orders',
                orderId,
                { todos_json: JSON.stringify(todos) },
                auditContext
            );
            const order = dependencies.orderRow(
                dependencies.db.prepare(
                    'SELECT * FROM orders WHERE id = ?'
                ).get(orderId)
            );
            return {
                data: { order },
                resource: { type: 'order', ids: [orderId] },
                changes: [{
                    resourceType: 'orderTodo',
                    resourceId: todoId,
                    field: 'done',
                    from: currentDone,
                    to: nextDone,
                }],
                auditIds: write.auditId ? [write.auditId] : [],
                requiredAuditCount: 1,
            };
        },
    });
}

module.exports = {
    CAPABILITY_ID,
    executeOrderTodoToggle,
};
