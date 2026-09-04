'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createV5Task, createV5ToolRequest, createV5ToolResult } = require('../api/services/ai-v5/contracts.cjs');
const { addEvidence, createEvidenceLedger, createV5EvidenceItem } = require('../api/services/ai-v5/evidenceLedger.cjs');
const { V5_POLICY_VERSION, V5_RISK_DEFINITIONS, V5_APPROVAL_STATES, validateRiskConsistency } = require('../api/services/ai-v5/risk.cjs');
const { evaluateV5Policy } = require('../api/services/ai-v5/policy.cjs');
const { runV5ControlledShadowRuntime } = require('../api/services/ai-v5/controlledRuntime.cjs');
const { analyzeP06ControlledRuntime } = require('../api/services/ai-v5/shadowRuntimeEvaluation.cjs');
const p06Cases = require('../docs/ai-observability/data/p06-failure-cases.json');

const AT = '2026-09-04T00:00:00.000Z';

function capability(overrides = {}) {
    return { version: 1, capabilityId: 'synthetic.read', domain: 'synthetic', operation: 'read', descriptionCode: 'SYNTHETIC', readWriteClass: 'READ', riskClass: 'L1', requiredEntityTypes: ['part'], allowedTools: ['search_parts'], futureRequiredEvidenceTypes: [], exposableInV5B: true, ...overrides };
}

function entity(type = 'part', canonicalEntityId = 'synthetic-part') {
    return { version: 1, entityType: type, rawMention: 'synthetic-mention', normalizedMention: null, canonicalEntityId, resolutionReceiptRef: 'synthetic-resolution', aliasSource: null };
}

function task(taskId = 'task-1', overrides = {}) {
    return createV5Task({ version: 1, taskId, state: 'RECEIVED', createdAt: AT, updatedAt: AT, intent: null, entityContext: [entity()], requestedCapability: null, execution: {}, verification: null, failure: null, metadata: {}, stateHistory: [], ...overrides });
}

function request(taskId = 'task-1', overrides = {}) {
    return createV5ToolRequest({ version: 1, taskId, toolName: 'search_parts', capability: 'inventory.read', rawArguments: { synthetic: true }, validatedArguments: { synthetic: true }, entityRefs: [entity()], riskClass: 'L1', validationStatus: 'validated', ...overrides });
}

function policyContext(overrides = {}) {
    return { taskId: 'task-1', taskState: 'ROUTING', capabilityId: 'synthetic.read', readWriteClass: 'READ', riskClass: 'L1', toolName: 'search_parts', entityTypes: ['part'], validatedArgumentsReady: true, approvalState: 'NOT_REQUIRED', ...overrides };
}

function runtimeInput(overrides = {}) {
    return { task: task(), routeInput: { domain: 'catalog', operation: 'read_inventory', entityType: 'part', explicitCapability: 'inventory.read' }, toolRequest: request(), approvalState: 'NOT_REQUIRED', ...overrides };
}

function validLedger() {
    const evidence = createV5EvidenceItem({ version: 1, evidenceId: 'e-1', taskId: 'task-1', evidenceType: 'DIRECT_FACT', status: 'VALID', claimType: 'inventory.quantity', sourceType: 'TOOL', sourceRef: 'synthetic-result', entityRef: { entityType: 'part', canonicalEntityId: 'synthetic-part', resolutionReceiptRef: 'synthetic-resolution' }, toolName: 'search_parts', capabilityId: 'inventory.read', operationRefs: [], freshness: 'CURRENT', derivation: null, createdAt: AT, metadata: {} });
    return addEvidence(createEvidenceLedger('task-1'), evidence);
}

test('Policy V1 risk classes and approval states are versioned and complete', () => {
    assert.equal(V5_POLICY_VERSION, 1);
    assert.deepEqual(Object.values(V5_RISK_DEFINITIONS).map(item => item.name), ['L0_CONVERSATION', 'L1_BUSINESS_READ', 'L2_BUSINESS_ANALYSIS', 'L3_CHANGE_PROPOSAL', 'L4_APPROVED_WRITE', 'L5_CRITICAL_IRREVERSIBLE']);
    assert.deepEqual(V5_APPROVAL_STATES, ['NOT_REQUIRED', 'REQUIRED', 'PENDING', 'APPROVED', 'REJECTED']);
});

test('unknown policy input fails closed', () => {
    const result = evaluateV5Policy(policyContext({ riskClass: 'L9' }), { capability: capability({ riskClass: 'L9' }) });
    assert.equal(result.decision, 'INVALID');
    assert.equal(result.executionAllowed, false);
});

test('L0 conversation is allowed without execution', () => {
    const result = evaluateV5Policy({ taskId: 'task-1', taskState: 'UNDERSTANDING', capabilityId: null, readWriteClass: 'NONE', riskClass: 'L0', toolName: null, entityTypes: [], validatedArgumentsReady: false, approvalState: 'NOT_REQUIRED' });
    assert.equal(result.decision, 'ALLOW');
    assert.equal(result.executionAllowed, false);
});

test('L1 read and L2 analysis policy allow validated bounded read tools', () => {
    const read = evaluateV5Policy(policyContext(), { capability: capability() });
    const analysisCapability = capability({ capabilityId: 'synthetic.analysis', riskClass: 'L2' });
    const analysis = evaluateV5Policy(policyContext({ capabilityId: 'synthetic.analysis', riskClass: 'L2' }), { capability: analysisCapability });
    assert.equal(read.decision, 'ALLOW');
    assert.equal(analysis.decision, 'ALLOW');
    assert.equal(read.executionAllowed, true);
    assert.equal(analysis.executionAllowed, true);
});

test('L3 change proposal is shadow-only and cannot execute', () => {
    const proposal = capability({ capabilityId: 'synthetic.proposal', readWriteClass: 'WRITE', riskClass: 'L3', allowedTools: ['create_part'] });
    const result = evaluateV5Policy(policyContext({ capabilityId: proposal.capabilityId, readWriteClass: 'WRITE', riskClass: 'L3', toolName: 'create_part', approvalState: 'PENDING' }), { capability: proposal });
    assert.equal(result.decision, 'SHADOW_ONLY');
    assert.equal(result.executionAllowed, false);
    assert.equal(result.approvalRequired, true);
});

test('L4 write requires approval and approved state only projects allow', () => {
    const write = capability({ capabilityId: 'synthetic.write', readWriteClass: 'WRITE', riskClass: 'L4', allowedTools: ['adjust_part_stock'] });
    const base = policyContext({ capabilityId: write.capabilityId, readWriteClass: 'WRITE', riskClass: 'L4', toolName: 'adjust_part_stock' });
    const pending = evaluateV5Policy({ ...base, approvalState: 'PENDING' }, { capability: write });
    const approved = evaluateV5Policy({ ...base, approvalState: 'APPROVED' }, { capability: write });
    assert.equal(pending.decision, 'APPROVAL_REQUIRED');
    assert.equal(pending.executionAllowed, false);
    assert.equal(approved.decision, 'ALLOW');
    assert.equal(approved.executionAllowed, true);
});

test('L5 critical is denied even when approved', () => {
    const critical = capability({ capabilityId: 'synthetic.critical', readWriteClass: 'WRITE', riskClass: 'L5', allowedTools: ['delete_part'] });
    const result = evaluateV5Policy(policyContext({ capabilityId: critical.capabilityId, readWriteClass: 'WRITE', riskClass: 'L5', toolName: 'delete_part', approvalState: 'APPROVED' }), { capability: critical });
    assert.equal(result.decision, 'DENY');
    assert.equal(result.executionAllowed, false);
});

test('tool/capability, risk, task, argument and entity mismatches fail closed', () => {
    const cap = capability();
    const cases = [
        policyContext({ toolName: 'search_coils' }),
        policyContext({ riskClass: 'L2' }),
        policyContext({ taskState: 'RECEIVED' }),
        policyContext({ validatedArgumentsReady: false }),
        policyContext({ entityTypes: [] }),
    ];
    for (const input of cases) {
        const result = evaluateV5Policy(input, { capability: cap });
        assert.equal(result.executionAllowed, false);
        assert.equal(result.decision, 'INVALID');
    }
});

test('policy matrix is deterministic across risk, class, approval, state and tool consistency', () => {
    const risks = ['L1', 'L2', 'L3', 'L4', 'L5', 'UNKNOWN'];
    const classes = ['READ', 'WRITE'];
    const approvals = V5_APPROVAL_STATES;
    const states = ['ROUTING', 'RECEIVED'];
    const tools = [true, false];
    let checked = 0;
    for (const riskClass of risks) for (const readWriteClass of classes) for (const approvalState of approvals) for (const validState of states) for (const toolMatches of tools) {
        const cap = capability({ riskClass, readWriteClass, allowedTools: ['expected_tool'] });
        const result = evaluateV5Policy(policyContext({ riskClass, readWriteClass, approvalState, taskState: validState, toolName: toolMatches ? 'expected_tool' : 'wrong_tool' }), { capability: cap });
        const structurallyValid = ['L1', 'L2', 'L3', 'L4', 'L5'].includes(riskClass) && validateRiskConsistency(riskClass, readWriteClass) && validState === 'ROUTING' && toolMatches;
        const expectedDecision = !structurallyValid ? 'INVALID'
            : ['L1', 'L2'].includes(riskClass) ? 'ALLOW'
                : riskClass === 'L3' ? 'SHADOW_ONLY'
                    : riskClass === 'L4' && approvalState === 'APPROVED' ? 'ALLOW'
                        : riskClass === 'L4' && approvalState === 'REJECTED' ? 'DENY'
                            : riskClass === 'L4' ? 'APPROVAL_REQUIRED' : 'DENY';
        assert.equal(result.decision, expectedDecision);
        assert.equal(result.executionAllowed, expectedDecision === 'ALLOW');
        checked += 1;
    }
    assert.equal(checked, 240);
});

test('valid read full shadow flow reaches COMPLETED only with supplied result and evidence', () => {
    const toolResult = createV5ToolResult({ taskId: 'task-1', toolName: 'search_parts', status: 'success', data: { synthetic: true }, operationRefs: [] });
    const result = runV5ControlledShadowRuntime(runtimeInput({ shadowToolResult: toolResult, evidenceLedger: validLedger() }), { timestamp: AT });
    assert.equal(result.finalState, 'COMPLETED');
    assert.equal(result.verificationOutcome.decision, 'VERIFIED');
    assert.deepEqual(result.stateHistory.map(item => item.to), ['UNDERSTANDING', 'RESOLVING_ENTITY', 'ROUTING', 'EXECUTING', 'COLLECTING_EVIDENCE', 'VERIFYING', 'COMPOSING', 'COMPLETED']);
    assert.equal(result.executionProjection.actualToolExecutions, 0);
    assert.equal(result.executionProjection.actualWrites, 0);
});

test('valid analysis reaches an allow projection without tool execution', () => {
    const cap = capability({ capabilityId: 'synthetic.analysis', domain: 'analysis', operation: 'inspect', riskClass: 'L2' });
    const result = runV5ControlledShadowRuntime(runtimeInput({ routeInput: { domain: 'analysis', operation: 'inspect', entityType: 'part', explicitCapability: cap.capabilityId }, toolRequest: request('task-1', { capability: cap.capabilityId, riskClass: 'L2' }) }), { timestamp: AT, capabilities: [cap] });
    assert.equal(result.policyDecision.decision, 'ALLOW');
    assert.equal(result.executionProjection.status, 'WOULD_EXECUTE');
    assert.equal(result.executionProjection.actualToolExecutions, 0);
});

test('proposal, approved write, unapproved write and critical paths never execute', () => {
    const scenarios = [
        { id: 'catalog.maintain', domain: 'catalog', operation: 'maintain', risk: 'L3', tool: 'create_part', approval: 'PENDING', status: 'WOULD_REQUIRE_APPROVAL' },
        { id: 'inventory.write', domain: 'catalog', operation: 'adjust_inventory', risk: 'L4', tool: 'adjust_part_stock', approval: 'APPROVED', status: 'WOULD_EXECUTE' },
        { id: 'inventory.write', domain: 'catalog', operation: 'adjust_inventory', risk: 'L4', tool: 'adjust_part_stock', approval: 'PENDING', status: 'WOULD_REQUIRE_APPROVAL' },
    ];
    for (const scenario of scenarios) {
        const result = runV5ControlledShadowRuntime(runtimeInput({ routeInput: { domain: scenario.domain, operation: scenario.operation, entityType: 'part', explicitCapability: scenario.id }, toolRequest: request('task-1', { capability: scenario.id, toolName: scenario.tool, riskClass: scenario.risk }), approvalState: scenario.approval }), { timestamp: AT });
        assert.equal(result.executionProjection.status, scenario.status);
        assert.equal(result.executionProjection.actualToolExecutions, 0);
        assert.equal(result.executionProjection.actualWrites, 0);
    }
    const critical = capability({ capabilityId: 'synthetic.critical', domain: 'critical', operation: 'destroy', readWriteClass: 'WRITE', riskClass: 'L5', allowedTools: ['delete_part'] });
    const result = runV5ControlledShadowRuntime(runtimeInput({ routeInput: { domain: 'critical', operation: 'destroy', entityType: 'part', explicitCapability: critical.capabilityId }, toolRequest: request('task-1', { capability: critical.capabilityId, toolName: 'delete_part', riskClass: 'L5' }), approvalState: 'APPROVED' }), { timestamp: AT, capabilities: [critical] });
    assert.equal(result.policyDecision.decision, 'DENY');
    assert.equal(result.executionProjection.status, 'WOULD_DENY');
});

test('unresolved and ambiguous capabilities stop with zero exposure', () => {
    const unresolved = runV5ControlledShadowRuntime(runtimeInput({ routeInput: { domain: 'missing', operation: 'missing', entityType: 'part' } }), { timestamp: AT });
    assert.equal(unresolved.capabilityOutcome.outcome, 'UNRESOLVED');
    assert.equal(unresolved.executionProjection.status, 'INVALID');
    const a = capability({ capabilityId: 'a', domain: 'same', operation: 'same' });
    const b = capability({ capabilityId: 'b', domain: 'same', operation: 'same' });
    const ambiguous = runV5ControlledShadowRuntime(runtimeInput({ routeInput: { domain: 'same', operation: 'same', entityType: 'part' } }), { timestamp: AT, capabilities: [a, b] });
    assert.equal(ambiguous.capabilityOutcome.outcome, 'AMBIGUOUS');
    assert.equal(ambiguous.toolExposureOutcome, null);
});

test('wrong tool, raw arguments, invalid state and missing entity stop progression', () => {
    const wrongTool = runV5ControlledShadowRuntime(runtimeInput({ toolRequest: request('task-1', { toolName: 'search_coils' }) }), { timestamp: AT });
    assert.equal(wrongTool.executionProjection.status, 'INVALID');
    const raw = createV5ToolRequest({ taskId: 'task-1', toolName: 'search_parts', capability: 'inventory.read', rawArguments: {}, entityRefs: [], riskClass: 'L1' });
    const rawResult = runV5ControlledShadowRuntime(runtimeInput({ toolRequest: raw }), { timestamp: AT });
    assert.equal(rawResult.reasonCodes.includes('VALIDATED_ARGUMENTS_GATE_REJECTED'), true);
    const invalidState = runV5ControlledShadowRuntime(runtimeInput({ task: task('task-1', { state: 'ROUTING' }) }), { timestamp: AT });
    assert.equal(invalidState.reasonCodes.includes('STATE_REJECTED'), true);
    const missingEntity = runV5ControlledShadowRuntime(runtimeInput({ task: task('task-1', { entityContext: [] }) }), { timestamp: AT });
    assert.equal(missingEntity.reasonCodes.includes('ENTITY_GATE_REJECTED'), true);
    const mismatchedEntity = runV5ControlledShadowRuntime(runtimeInput({
        toolRequest: request('task-1', { entityRefs: [entity('part', 'different-part')] }),
    }), { timestamp: AT });
    assert.equal(mismatchedEntity.reasonCodes.includes('VALIDATED_ARGUMENTS_GATE_REJECTED'), true);
});

test('deferred requirement, missing ledger and invalid evidence cannot fabricate VERIFIED', () => {
    const orderTask = task('task-1', { entityContext: [entity('order', 1)] });
    const orderRequest = request('task-1', { capability: 'order.read', toolName: 'get_order_detail', entityRefs: [entity('order', 1)] });
    const orderResult = createV5ToolResult({ taskId: 'task-1', toolName: 'get_order_detail', status: 'success', data: null, operationRefs: [] });
    const deferred = runV5ControlledShadowRuntime({ task: orderTask, routeInput: { domain: 'order', operation: 'read', entityType: 'order', explicitCapability: 'order.read' }, toolRequest: orderRequest, approvalState: 'NOT_REQUIRED', shadowToolResult: orderResult }, { timestamp: AT });
    assert.equal(deferred.verificationOutcome.status, 'DEFERRED_REQUIREMENT');
    const result = createV5ToolResult({ taskId: 'task-1', toolName: 'search_parts', status: 'success', data: null, operationRefs: [] });
    const missing = runV5ControlledShadowRuntime(runtimeInput({ shadowToolResult: result }), { timestamp: AT });
    assert.equal(missing.verificationOutcome.status, 'NOT_RUN_MISSING_EVIDENCE');
    const invalid = runV5ControlledShadowRuntime(runtimeInput({ shadowToolResult: result, evidenceLedger: { version: 1, taskId: 'task-1', items: [{ invalid: true }] } }), { timestamp: AT });
    assert.equal(invalid.verificationOutcome.status, 'NOT_RUN_INVALID_LEDGER');
});

test('P06 C02/R02/A01 assembly outcomes remain bounded', () => {
    const evaluation = analyzeP06ControlledRuntime(p06Cases);
    assert.deepEqual(evaluation.metrics, {
        c02Analyzed: 3,
        c02BlockedByState: 3,
        c02InsufficientData: 0,
        r02Analyzed: 3,
        r02WrongToolsExposable: 0,
        r02WrongToolsPolicyAllowed: 0,
        a01Analyzed: 2,
        a01Blocked: 2,
        a01Unknown: 0,
    });
});
