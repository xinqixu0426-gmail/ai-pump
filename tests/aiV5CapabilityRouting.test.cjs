'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { AI_TOOLS } = require('../api/routes/ai/tools.cjs');
const { createV5Task, createV5ToolRequest } = require('../api/services/ai-v5/contracts.cjs');
const { transitionTask } = require('../api/services/ai-v5/taskState.cjs');
const {
    V5_CAPABILITY_REGISTRY,
    V5_CAPABILITY_REGISTRY_VERSION,
    auditToolInventory,
    buildToolCapabilityReverseIndex,
    getV5Capability,
    listV5Capabilities,
    validateCapability,
    validateCapabilityRegistry,
} = require('../api/services/ai-v5/capabilityRegistry.cjs');
const { routeV5Capability } = require('../api/services/ai-v5/capabilityRouter.cjs');
const { getV5ToolExposure, projectAllowedToolDefinitions } = require('../api/services/ai-v5/toolExposure.cjs');
const { analyzeP06R02Cases, evaluateP06CapabilityRouting } = require('../api/services/ai-v5/capabilityShadowEvaluation.cjs');
const p06Cases = require('../docs/ai-observability/data/p06-failure-cases.json');

const NOW = '2026-01-01T00:00:00.000Z';

function task(state = 'ROUTING', requestedCapability = null) {
    return createV5Task({
        version: 1,
        taskId: 'v5b-test-task',
        state,
        createdAt: NOW,
        updatedAt: NOW,
        intent: null,
        entityContext: [],
        requestedCapability,
        execution: {},
        verification: null,
        failure: null,
        metadata: {},
        stateHistory: [],
    });
}

function sampleCapability(overrides = {}) {
    return {
        version: 1,
        capabilityId: 'test.read',
        domain: 'test',
        operation: 'read',
        descriptionCode: 'TEST_READ',
        readWriteClass: 'READ',
        riskClass: 'L1',
        requiredEntityTypes: ['test_entity'],
        allowedTools: ['search_parts'],
        futureRequiredEvidenceTypes: [],
        exposableInV5B: true,
        ...overrides,
    };
}

test('registry V1 validates against all canonical tools and is immutable', () => {
    assert.equal(V5_CAPABILITY_REGISTRY_VERSION, 1);
    assert.equal(validateCapabilityRegistry(), true);
    assert.equal(Object.isFrozen(V5_CAPABILITY_REGISTRY), true);
    assert.equal(Object.isFrozen(getV5Capability('inventory.read').allowedTools), true);
    assert.throws(() => { V5_CAPABILITY_REGISTRY['bad'] = {}; }, TypeError);
});

test('registry rejects duplicate capability ids', () => {
    const value = sampleCapability();
    assert.throws(() => validateCapabilityRegistry(AI_TOOLS, [value, { ...value }]), /Duplicate capability id/);
});

test('registry rejects missing and duplicate tool references', () => {
    assert.throws(() => validateCapabilityRegistry(AI_TOOLS, [sampleCapability({ allowedTools: ['missing_tool'] })]), /Stale tool reference/);
    assert.throws(() => validateCapability(sampleCapability({ allowedTools: ['search_parts', 'search_parts'] })), /Duplicate allowed tool/);
});

test('capability validation rejects invalid version, access, risk, entity shape and empty tools', () => {
    assert.throws(() => validateCapability(sampleCapability({ version: 2 })), /Unsupported/);
    assert.throws(() => validateCapability(sampleCapability({ readWriteClass: 'MAYBE' })), /readWriteClass/);
    assert.throws(() => validateCapability(sampleCapability({ riskClass: 'L99' })), /riskClass/);
    assert.throws(() => validateCapability(sampleCapability({ requiredEntityTypes: 'part' })), /requiredEntityTypes/);
    assert.throws(() => validateCapability(sampleCapability({ allowedTools: [] })), /Empty allowedTools/);
});

test('read/write metadata mismatch is rejected and write capabilities are never exposable', () => {
    assert.throws(() => validateCapabilityRegistry(AI_TOOLS, [sampleCapability({ readWriteClass: 'WRITE', exposableInV5B: false })]), /Read\/write mismatch/);
    assert.throws(() => validateCapability(sampleCapability({ readWriteClass: 'WRITE', exposableInV5B: true })), /cannot be exposable/);
    assert.equal(listV5Capabilities().filter(item => item.readWriteClass === 'WRITE').every(item => item.exposableInV5B === false), true);
});

test('inventory is complete with no stale or unknown references', () => {
    const audit = auditToolInventory();
    assert.equal(audit.total, 77);
    assert.equal(audit.assigned.length, 77);
    assert.deepEqual(audit.shared, []);
    assert.deepEqual(audit.unassigned, []);
    assert.deepEqual(audit.stale, []);
    assert.deepEqual(audit.unknown, []);
});

test('reverse index is deterministic, read-only and audit-only', () => {
    const reverse = buildToolCapabilityReverseIndex();
    assert.deepEqual(reverse.search_parts, ['inventory.read']);
    assert.deepEqual(reverse.search_coils, ['coil.read']);
    assert.deepEqual(reverse.search_templates, ['recipe.template.read']);
    assert.equal(Object.isFrozen(reverse), true);
});

test('unique structured route selects one capability without mutating input', () => {
    const inputTask = task();
    const before = JSON.stringify(inputTask);
    const routed = routeV5Capability(inputTask, { domain: 'catalog', operation: 'read_inventory', entityType: 'part' });
    assert.equal(routed.outcome, 'SELECTED');
    assert.equal(routed.capabilityId, 'inventory.read');
    assert.equal(routed.candidateCount, 1);
    assert.equal(routed.shadowTask.state, 'ROUTING');
    assert.equal(routed.shadowTask.requestedCapability, 'inventory.read');
    assert.equal(JSON.stringify(inputTask), before);
});

test('zero candidates are unresolved and multiple candidates are ambiguous without picking first', () => {
    const unresolved = routeV5Capability(task(), { domain: 'none', operation: 'none', entityType: 'none' });
    assert.equal(unresolved.outcome, 'UNRESOLVED');
    assert.equal(unresolved.capabilityId, null);
    const duplicateMatch = [sampleCapability(), sampleCapability({ capabilityId: 'test.read.second' })];
    const ambiguous = routeV5Capability(task(), { domain: 'test', operation: 'read', entityType: 'test_entity' }, { capabilities: duplicateMatch });
    assert.equal(ambiguous.outcome, 'AMBIGUOUS');
    assert.equal(ambiguous.candidateCount, 2);
    assert.equal(ambiguous.capabilityId, null);
});

test('explicit capability must exist and match every structured field', () => {
    assert.equal(routeV5Capability(task(), { domain: 'catalog', operation: 'read_inventory', entityType: 'part', explicitCapability: 'missing' }).outcome, 'INVALID');
    const incompatible = routeV5Capability(task(), { domain: 'coil', operation: 'read', entityType: 'coil', explicitCapability: 'inventory.read' });
    assert.equal(incompatible.outcome, 'INVALID');
    assert.equal(incompatible.reasonCode, 'EXPLICIT_CAPABILITY_INCOMPATIBLE');
    assert.equal(routeV5Capability(task(), { domain: 'catalog', operation: 'read_inventory', entityType: 'part', explicitCapability: 'inventory.read' }).outcome, 'SELECTED');
});

test('non-ROUTING task and malformed structured input are invalid', () => {
    assert.equal(routeV5Capability(task('UNDERSTANDING'), { domain: 'catalog', operation: 'read_inventory', entityType: 'part' }).reasonCode, 'TASK_NOT_IN_ROUTING_STATE');
    assert.equal(routeV5Capability(task(), { rawPrompt: 'not accepted' }).reasonCode, 'INVALID_STRUCTURED_INPUT');
});

test('selected read capability exposes its exact bounded definitions without schema cloning', () => {
    const capability = getV5Capability('coil.read');
    const before = JSON.stringify(AI_TOOLS);
    const projected = projectAllowedToolDefinitions(capability, AI_TOOLS);
    assert.deepEqual(projected.map(item => item.function.name), capability.allowedTools);
    for (const tool of projected) assert.strictEqual(tool, AI_TOOLS.find(item => item.function.name === tool.function.name));
    assert.equal(JSON.stringify(AI_TOOLS), before);
    const exposure = getV5ToolExposure('coil.read');
    assert.deepEqual(exposure.allowedToolNames, ['get_coil_specs', 'search_coils']);
    assert.equal(exposure.toolCount, 2);
    assert.equal(exposure.executionAllowed, false);
});

test('invalid, ambiguous and unresolved selections expose zero tools', () => {
    for (const selection of [
        'missing.capability',
        { outcome: 'AMBIGUOUS', capabilityId: null },
        { outcome: 'UNRESOLVED', capabilityId: null },
        { outcome: 'INVALID', capabilityId: null },
    ]) {
        const exposure = getV5ToolExposure(selection);
        assert.equal(exposure.toolCount, 0);
        assert.deepEqual(exposure.allowedToolNames, []);
        assert.equal(exposure.executionAllowed, false);
    }
});

test('write capability exposes zero executable tools in V5-B', () => {
    const exposure = getV5ToolExposure('inventory.write');
    assert.equal(exposure.toolCount, 0);
    assert.equal(exposure.executionAllowed, false);
    assert.equal(exposure.reasonCode, 'WRITE_DISABLED_IN_V5B');
});

test('every capability projection equals declared allowlist and has no cross-capability leakage', () => {
    const reverse = buildToolCapabilityReverseIndex();
    for (const capability of listV5Capabilities().filter(item => item.readWriteClass === 'READ')) {
        const names = projectAllowedToolDefinitions(capability).map(item => item.function.name);
        assert.deepEqual(names, capability.allowedTools);
        for (const name of names) assert.equal(reverse[name].includes(capability.capabilityId), true);
    }
});

test('ToolExposure cannot bypass V5-A EXECUTING preconditions', () => {
    const selected = routeV5Capability(task(), { domain: 'catalog', operation: 'read_inventory', entityType: 'part' });
    assert.equal(getV5ToolExposure(selected).toolCount, 1);
    assert.throws(() => transitionTask(selected.shadowTask, 'EXECUTING', { timestamp: NOW }), error => error.code === 'V5_STATE_TRANSITION_REJECTED');
    const toolRequest = createV5ToolRequest({
        version: 1,
        taskId: selected.shadowTask.taskId,
        toolName: 'search_parts',
        capability: 'inventory.read',
        rawArguments: {},
        validatedArguments: {},
        entityRefs: [],
        riskClass: 'L1',
        validationStatus: 'validated',
    });
    const ready = createV5Task({ ...selected.shadowTask, execution: { toolRequest, toolResult: null } });
    assert.equal(transitionTask(ready, 'EXECUTING', { timestamp: NOW }).state, 'EXECUTING');
});

test('P06 R02 reverse-index analysis shows all three wrong tools blocked by sensible boundaries', () => {
    const analysis = analyzeP06R02Cases(p06Cases);
    assert.equal(analysis.length, 3);
    assert.equal(analysis.every(item => item.expectedCapability === 'inventory.read'), true);
    assert.equal(analysis.every(item => item.classification === 'BLOCKED_BY_LIMITED_EXPOSURE'), true);
});

test('P06 corpus routing refuses to infer missing structured metadata', () => {
    const evaluation = evaluateP06CapabilityRouting(p06Cases);
    assert.deepEqual(evaluation.metrics, {
        evaluated: 15,
        routable: 0,
        insufficientData: 15,
        correct: 0,
        incorrect: 0,
        ambiguous: 0,
        accuracy: null,
    });
});
