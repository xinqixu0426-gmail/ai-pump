'use strict';

const { createV5Task, createV5ToolRequest } = require('./contracts.cjs');
const { getV5Capability, buildToolCapabilityReverseIndex } = require('./capabilityRegistry.cjs');
const { getV5ToolExposure } = require('./toolExposure.cjs');
const { evaluateV5Policy } = require('./policy.cjs');
const { projectV4FailureCaseToV5Task } = require('./v4Projection.cjs');
const { runV5ControlledShadowRuntime } = require('./controlledRuntime.cjs');

const AT = '2026-09-04T00:00:00.000Z';

function firstTool(item) {
    return Array.isArray(item?.safe_structural_metadata?.tools) ? item.safe_structural_metadata.tools[0] || null : null;
}

function analyzeP06ControlledRuntime(cases = []) {
    const reverse = buildToolCapabilityReverseIndex();
    const c02 = cases.filter(item => item.failure_class === 'C02').map(item => {
        const projection = projectV4FailureCaseToV5Task(item, { timestamp: AT });
        const runtime = runV5ControlledShadowRuntime({ task: projection.task }, { timestamp: AT });
        return Object.freeze({ caseId: item.case_id, outcome: runtime.reasonCodes.includes('STATE_REJECTED') ? 'BLOCKED_BY_STATE' : 'NOT_BLOCKED' });
    });
    const r02 = cases.filter(item => item.failure_class === 'R02').map(item => {
        const expectedTool = item.expected?.primary_tool || null;
        const expectedCapabilityId = expectedTool && reverse[expectedTool]?.length === 1 ? reverse[expectedTool][0] : null;
        const capability = getV5Capability(expectedCapabilityId);
        const wrongTool = firstTool(item);
        if (!capability || !wrongTool) return Object.freeze({ caseId: item.case_id, exposable: null, policyAllowed: null });
        const exposure = getV5ToolExposure(expectedCapabilityId);
        const policy = evaluateV5Policy({
            taskId: `p06:${item.case_id}`,
            taskState: 'ROUTING',
            capabilityId: capability.capabilityId,
            readWriteClass: capability.readWriteClass,
            riskClass: capability.riskClass,
            toolName: wrongTool,
            entityTypes: capability.requiredEntityTypes,
            validatedArgumentsReady: true,
            approvalState: 'NOT_REQUIRED',
        });
        return Object.freeze({ caseId: item.case_id, exposable: exposure.allowedToolNames.includes(wrongTool), policyAllowed: policy.executionAllowed });
    });
    const a01 = cases.filter(item => item.failure_class === 'A01').map(item => {
        const taskId = `p06:${item.case_id}`;
        const task = createV5Task({ version: 1, taskId, state: 'RECEIVED', createdAt: AT, updatedAt: AT, intent: null, entityContext: [{ version: 1, entityType: 'recipe', rawMention: 'synthetic-identity', normalizedMention: null, canonicalEntityId: 1, resolutionReceiptRef: 'synthetic-receipt', aliasSource: null }], requestedCapability: null, execution: {}, verification: null, failure: null, metadata: {}, stateHistory: [] });
        const rawRequest = createV5ToolRequest({ taskId, toolName: 'preview_recipe_cost', capability: 'recipe.cost.preview', rawArguments: {}, entityRefs: [], riskClass: 'L1' });
        const runtime = runV5ControlledShadowRuntime({ task, routeInput: { domain: 'recipe', operation: 'preview_cost', entityType: 'recipe', explicitCapability: 'recipe.cost.preview' }, toolRequest: rawRequest, approvalState: 'NOT_REQUIRED' }, { timestamp: AT });
        return Object.freeze({ caseId: item.case_id, blocked: runtime.executionProjection.status !== 'WOULD_EXECUTE' });
    });
    return Object.freeze({
        c02: Object.freeze(c02),
        r02: Object.freeze(r02),
        a01: Object.freeze(a01),
        metrics: Object.freeze({
            c02Analyzed: c02.length,
            c02BlockedByState: c02.filter(item => item.outcome === 'BLOCKED_BY_STATE').length,
            c02InsufficientData: c02.filter(item => item.outcome === 'INSUFFICIENT_DATA').length,
            r02Analyzed: r02.length,
            r02WrongToolsExposable: r02.filter(item => item.exposable === true).length,
            r02WrongToolsPolicyAllowed: r02.filter(item => item.policyAllowed === true).length,
            a01Analyzed: a01.length,
            a01Blocked: a01.filter(item => item.blocked === true).length,
            a01Unknown: a01.filter(item => item.blocked === null).length,
        }),
    });
}

module.exports = { analyzeP06ControlledRuntime };
