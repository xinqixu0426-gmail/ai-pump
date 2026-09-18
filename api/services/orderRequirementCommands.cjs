const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
} = require('./commandExecution.cjs');
const { standardBusinessChange } = require('./businessChanges.cjs');
const {
    confirmOrderRequirementSummary,
    getOrderRequirementSummary,
    revokeOrderRequirementConfirmation,
    saveOrderRequirementDraft,
} = require('./orderRequirements.cjs');
const {
    assertExpectedUpdatedAt,
    normalizeExpectedUpdatedAt,
} = require('./resourceVersion.cjs');
const { parsePositiveId } = require('./validation.cjs');

const SAVE_CAPABILITY_ID =
    requireBusinessCapability('orders.requirements.save_draft').capabilityId;
const CONFIRM_CAPABILITY_ID =
    requireBusinessCapability('orders.requirements.confirm').capabilityId;
const REVOKE_CAPABILITY_ID =
    requireBusinessCapability('orders.requirements.revoke').capabilityId;

function commandError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function normalizeOrderId(value) {
    const orderId = parsePositiveId(value);
    if (!orderId) throw commandError('order_id_invalid', '非法订单ID', 400);
    return orderId;
}

function versionWarning(orderId, expectedUpdatedAt) {
    return expectedUpdatedAt ? [] : [{
        code: 'expected_updated_at_missing_compatibility',
        message: `订单 #${orderId} 的客户要求未提供 expectedUpdatedAt，并发覆盖保护未启用`,
        resourceId: orderId,
    }];
}

function executeRequirementCommand({
    dependencies,
    orderIdValue,
    input = {},
    commandContext = {},
    capabilityId,
    action,
}) {
    const orderId = normalizeOrderId(orderIdValue);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
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
            ...(input.summaryText === undefined
                ? {}
                : { summaryText: String(input.summaryText) }),
            ...(input.sourceFileIds === undefined
                ? {}
                : { sourceFileIds: input.sourceFileIds }),
            expectedUpdatedAt,
        },
        warnings: [
            ...(commandContext.warnings || []),
            ...versionWarning(orderId, expectedUpdatedAt),
        ],
        execute: ({ auditContext }) => {
            const before = getOrderRequirementSummary(orderId, {
                dbAccessors: dependencies,
            });
            if (before.hasRecord) {
                assertExpectedUpdatedAt(
                    { updated_at: before.updatedAt },
                    expectedUpdatedAt,
                    `订单 #${orderId} 客户要求`
                );
            } else if (expectedUpdatedAt) {
                throw commandError(
                    'resource_version_conflict',
                    `订单 #${orderId} 客户要求尚不存在，请刷新后重试`,
                    409
                );
            }
            const writes = [];
            const result = action({
                orderId,
                auditContext,
                onWrite: write => writes.push(write),
            });
            const auditIds = writes
                .map(write => Number(write?.auditId))
                .filter(id => Number.isInteger(id) && id > 0);
            return {
                data: result,
                resource: {
                    type: 'orderRequirementSummary',
                    ids: result.id ? [result.id] : [],
                },
                changes: [{
                    resourceType: 'orderRequirementSummary',
                    resourceId: result.id || orderId,
                    field: 'knowledgeStatus',
                    from: before.knowledgeStatus,
                    to: result.knowledgeStatus,
                }],
                auditIds,
                requiredAuditCount: writes.length,
            };
        },
    });
}

function executeSaveRequirementDraft(dependencies, orderId, input, commandContext) {
    return executeRequirementCommand({
        dependencies,
        orderIdValue: orderId,
        input,
        commandContext,
        capabilityId: SAVE_CAPABILITY_ID,
        action: options => saveOrderRequirementDraft(options.orderId, {
            summaryText: input.summaryText,
            sourceFileIds: input.sourceFileIds,
        }, {
            dbAccessors: dependencies,
            auditContext: options.auditContext,
            onWrite: options.onWrite,
        }),
    });
}

function executeConfirmRequirement(dependencies, orderId, input, commandContext) {
    return executeRequirementCommand({
        dependencies,
        orderIdValue: orderId,
        input,
        commandContext,
        capabilityId: CONFIRM_CAPABILITY_ID,
        action: options => confirmOrderRequirementSummary(options.orderId, {
            summaryText: input.summaryText,
            sourceFileIds: input.sourceFileIds,
        }, {
            dbAccessors: dependencies,
            auditContext: options.auditContext,
            onWrite: options.onWrite,
            transaction: false,
        }),
    });
}

function executeRevokeRequirement(dependencies, orderId, input, commandContext) {
    return executeRequirementCommand({
        dependencies,
        orderIdValue: orderId,
        input,
        commandContext,
        capabilityId: REVOKE_CAPABILITY_ID,
        action: options => revokeOrderRequirementConfirmation(options.orderId, {
            dbAccessors: dependencies,
            auditContext: options.auditContext,
            onWrite: options.onWrite,
        }),
    });
}

module.exports = {
    CONFIRM_CAPABILITY_ID,
    REVOKE_CAPABILITY_ID,
    SAVE_CAPABILITY_ID,
    executeConfirmRequirement,
    executeRevokeRequirement,
    executeSaveRequirementDraft,
};
