const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const { executePersistentCommand } = require('./commandExecution.cjs');
const {
    recordFactoryWorkflowRun,
} = require('./factoryWorkflowHistory.cjs');

const RECORD_WORKFLOW_RUN_CAPABILITY_ID = requireBusinessCapability(
    'workbench.execution_runs.record'
).capabilityId;

function executeRecordFactoryWorkflowRun(
    dependencies,
    input = {},
    commandContext = {}
) {
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: RECORD_WORKFLOW_RUN_CAPABILITY_ID,
        input,
        warnings: commandContext.warnings || [],
        execute: ({ auditContext }) => {
            const writeState = {
                auditIds: [],
                writeCount: 0,
            };
            const executionRun = recordFactoryWorkflowRun(input, {
                dbAccessors: dependencies,
                auditContext,
                onWrite(write) {
                    writeState.writeCount += 1;
                    if (write?.auditId) {
                        writeState.auditIds.push(Number(write.auditId));
                    }
                },
            });
            return {
                data: { executionRun },
                resource: {
                    type: 'factoryWorkflowRun',
                    ids: [executionRun.id],
                },
                changes: [{
                    resourceType: 'factoryWorkflowRun',
                    resourceId: executionRun.id,
                    field: 'created',
                    from: null,
                    to: true,
                }],
                auditIds: writeState.auditIds,
                requiredAuditCount: writeState.writeCount,
            };
        },
    });
}

module.exports = {
    RECORD_WORKFLOW_RUN_CAPABILITY_ID,
    executeRecordFactoryWorkflowRun,
};
