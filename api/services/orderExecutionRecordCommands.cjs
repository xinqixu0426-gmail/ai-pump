const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
} = require('./commandExecution.cjs');
const { standardBusinessChange } = require('./businessChanges.cjs');
const {
    confirmOrderExecutionRecord,
    createOrderExecutionDraft,
    deleteOrderExecutionDraft,
    revokeOrderExecutionConfirmation,
    updateOrderExecutionDraft,
} = require('./orderExecutionRecords.cjs');
const {
    assertExpectedUpdatedAt,
    normalizeExpectedUpdatedAt,
} = require('./resourceVersion.cjs');
const { parsePositiveId } = require('./validation.cjs');

const CREATE_CAPABILITY_ID =
    requireBusinessCapability('orders.execution_records.create_draft').capabilityId;
const UPDATE_CAPABILITY_ID =
    requireBusinessCapability('orders.execution_records.update_draft').capabilityId;
const CONFIRM_CAPABILITY_ID =
    requireBusinessCapability('orders.execution_records.confirm').capabilityId;
const REVOKE_CAPABILITY_ID =
    requireBusinessCapability('orders.execution_records.revoke').capabilityId;
const DELETE_CAPABILITY_ID =
    requireBusinessCapability('orders.execution_records.delete').capabilityId;

const DRAFT_FIELDS = Object.freeze([
    'phase',
    'recordType',
    'title',
    'summaryText',
    'occurredAt',
    'sourceFileIds',
]);

function commandError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function positiveId(value, label) {
    const id = parsePositiveId(value);
    if (!id) throw commandError(`${label}_invalid`, `${label === 'order_id' ? '订单' : '执行档案'}ID无效`, 400);
    return id;
}

function draftInput(input = {}) {
    return Object.fromEntries(DRAFT_FIELDS
        .filter(field => input[field] !== undefined)
        .map(field => [field, input[field]]));
}

function getRecord(db, orderId, recordId) {
    const row = db.prepare(`
        SELECT *
        FROM order_execution_records
        WHERE id = ? AND order_id = ? AND deleted_at IS NULL
    `).get(recordId, orderId);
    if (!row) throw commandError('execution_record_not_found', '执行档案不存在', 404);
    return row;
}

function versionWarnings(recordId, expectedUpdatedAt) {
    return expectedUpdatedAt ? [] : [{
        code: 'expected_updated_at_missing_compatibility',
        message: `执行档案 #${recordId} 未提供 expectedUpdatedAt，并发覆盖保护未启用`,
        resourceId: recordId,
    }];
}

function receiptOutcome(result, before, writes) {
    const auditIds = writes
        .map(write => Number(write?.auditId))
        .filter(id => Number.isInteger(id) && id > 0);
    const recordId = Number(result.id);
    const beforeKnowledgeStatus = !before
        ? null
        : before.confirmed_text
            ? (before.status === 'draft' ? 'confirmed_with_draft' : 'confirmed')
            : 'not_confirmed';
    return {
        data: result,
        resource: {
            type: 'orderExecutionRecord',
            ids: Number.isInteger(recordId) && recordId > 0 ? [recordId] : [],
        },
        changes: [{
            resourceType: 'orderExecutionRecord',
            resourceId: recordId,
            field: 'knowledgeStatus',
            from: beforeKnowledgeStatus,
            to: result.knowledgeStatus || (result.deleted ? 'deleted' : null),
        }],
        auditIds,
        requiredAuditCount: writes.length,
    };
}

function executeCreateExecutionDraft(
    dependencies,
    orderIdValue,
    input = {},
    commandContext = {}
) {
    const orderId = positiveId(orderIdValue, 'order_id');
    const normalizedDraft = draftInput(input);
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: CREATE_CAPABILITY_ID,
        businessChange: standardBusinessChange({
            domain: 'order',
            eventType: 'updated',
            entityRefs: () => [{ entityType: 'order', entityId: orderId, role: 'primary' }],
        }),
        input: { orderId, ...normalizedDraft },
        execute: ({ auditContext }) => {
            const writes = [];
            const result = createOrderExecutionDraft(orderId, normalizedDraft, {
                dbAccessors: dependencies,
                auditContext,
                onWrite: write => writes.push(write),
            });
            return receiptOutcome(result, null, writes);
        },
    });
}

function executeExistingRecordCommand({
    dependencies,
    orderIdValue,
    recordIdValue,
    input = {},
    commandContext = {},
    capabilityId,
    action,
}) {
    const orderId = positiveId(orderIdValue, 'order_id');
    const recordId = positiveId(recordIdValue, 'record_id');
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const normalizedDraft = draftInput(input);
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId,
        businessChange: standardBusinessChange({
            domain: 'order',
            eventType: 'updated',
            entityRefs: () => [{ entityType: 'order', entityId: orderId, role: 'primary' }],
        }),
        input: {
            orderId,
            recordId,
            ...normalizedDraft,
            expectedUpdatedAt,
        },
        warnings: [
            ...(commandContext.warnings || []),
            ...versionWarnings(recordId, expectedUpdatedAt),
        ],
        execute: ({ auditContext }) => {
            const before = getRecord(dependencies.db, orderId, recordId);
            assertExpectedUpdatedAt(
                before,
                expectedUpdatedAt,
                `执行档案 #${recordId}`
            );
            const writes = [];
            const result = action({
                orderId,
                recordId,
                normalizedDraft,
                auditContext,
                onWrite: write => writes.push(write),
            });
            return receiptOutcome(result, before, writes);
        },
    });
}

function executeUpdateExecutionDraft(dependencies, orderId, recordId, input, context) {
    return executeExistingRecordCommand({
        dependencies,
        orderIdValue: orderId,
        recordIdValue: recordId,
        input,
        commandContext: context,
        capabilityId: UPDATE_CAPABILITY_ID,
        action: options => updateOrderExecutionDraft(
            options.orderId,
            options.recordId,
            options.normalizedDraft,
            {
                dbAccessors: dependencies,
                auditContext: options.auditContext,
                onWrite: options.onWrite,
            }
        ),
    });
}

function executeConfirmExecutionRecord(dependencies, orderId, recordId, input, context) {
    return executeExistingRecordCommand({
        dependencies,
        orderIdValue: orderId,
        recordIdValue: recordId,
        input,
        commandContext: context,
        capabilityId: CONFIRM_CAPABILITY_ID,
        action: options => confirmOrderExecutionRecord(
            options.orderId,
            options.recordId,
            options.normalizedDraft,
            {
                dbAccessors: dependencies,
                auditContext: options.auditContext,
                onWrite: options.onWrite,
                transaction: false,
            }
        ),
    });
}

function executeRevokeExecutionRecord(dependencies, orderId, recordId, input, context) {
    return executeExistingRecordCommand({
        dependencies,
        orderIdValue: orderId,
        recordIdValue: recordId,
        input,
        commandContext: context,
        capabilityId: REVOKE_CAPABILITY_ID,
        action: options => revokeOrderExecutionConfirmation(
            options.orderId,
            options.recordId,
            {
                dbAccessors: dependencies,
                auditContext: options.auditContext,
                onWrite: options.onWrite,
            }
        ),
    });
}

function executeDeleteExecutionRecord(dependencies, orderId, recordId, input, context) {
    return executeExistingRecordCommand({
        dependencies,
        orderIdValue: orderId,
        recordIdValue: recordId,
        input,
        commandContext: context,
        capabilityId: DELETE_CAPABILITY_ID,
        action: options => deleteOrderExecutionDraft(
            options.orderId,
            options.recordId,
            {
                dbAccessors: dependencies,
                auditContext: options.auditContext,
                onWrite: options.onWrite,
            }
        ),
    });
}

module.exports = {
    CONFIRM_CAPABILITY_ID,
    CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID,
    REVOKE_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID,
    executeConfirmExecutionRecord,
    executeCreateExecutionDraft,
    executeDeleteExecutionRecord,
    executeRevokeExecutionRecord,
    executeUpdateExecutionDraft,
};
