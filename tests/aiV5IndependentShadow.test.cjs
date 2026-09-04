'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
    evaluateIndependentShadow,
    extractSourceUserRequest,
    runV5IndependentShadow,
} = require('../api/services/ai-v5/independentShadow.cjs');
const { createV5ShadowMirror } = require('../api/services/ai-v5/shadowMirror.cjs');
const { captureSafeV4ShadowFacts } = require('../api/services/ai-v5/shadowProjection.cjs');
const { V5_TASK_CLASS_CATALOG } = require('../api/services/ai-v5/taskClassCatalog.cjs');
const { createV5SourceSpanCatalog } = require('../api/services/ai-v5/sourceSpanCatalog.cjs');

function response(value) {
    return async () => ({
        content: JSON.stringify(value), provider: 'test-provider', model: 'test-interpreter', usage: null,
    });
}

function protocolFor(source, candidateText = '800平刀', route = {}) {
    const taskClass = V5_TASK_CLASS_CATALOG.find(item => item.domain === (route.domain || 'catalog')
        && item.operation === (route.operation || 'read_inventory')
        && item.entityTypes.includes(route.entityType || 'part'));
    const span = createV5SourceSpanCatalog(source).spans.find(item => item.text === candidateText);
    return { protocolVersion: 2, taskClassRef: taskClass.classRef,
        entitySelections: [{ slotRef: taskClass.entitySlots[0].slotRef, spanRef: span?.spanRef || 'sp_DOES_NOT_EXIST' }],
        needsClarification: false };
}

function mirrorFacts(index = 1) {
    return captureSafeV4ShadowFacts({ requestId: `p15-request-${index}` }, {
        intent: { mode: 'query' },
        telemetry: {
            outcome: 'completed', requestId: `p15-request-${index}`,
            toolSteps: [{ capabilityName: 'search_parts', success: true }],
        },
    }, { traceId: String(index).padStart(32, '0') }, {
        shadowTaskId: `v5-shadow-p15-${index}`,
        createdAt: '2026-09-04T00:00:00.000Z',
        structural: {
            expectedSuccess: true, intendedCapabilityId: 'inventory.read',
            validatedArgumentsReady: true, stateValid: true,
            entityStatus: 'RESOLVED', verificationStatus: 'VERIFIED',
        },
    });
}

test('last raw user request is selected without coercing non-string content', () => {
    assert.equal(extractSourceUserRequest([
        { role: 'user', content: 'first' }, { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'second' },
    ]), 'second');
    assert.equal(extractSourceUserRequest([{ role: 'user', content: 800 }]), null);
});

test('valid interpretation independently selects capability and bounded exposure without execution', async () => {
    const outcome = await runV5IndependentShadow({
        sourceRequest: '请查询800平刀当前库存', shadowTaskId: 'v5-shadow-p15-valid',
    }, {
        selected: { provider: 'test-provider', model: 'test-interpreter' },
        modelRequest: response(protocolFor('请查询800平刀当前库存')),
        now: '2026-09-04T00:00:00.000Z',
    });
    assert.equal(outcome.interpreterStatus, 'VALID');
    assert.equal(outcome.capabilityOutcome, 'SELECTED');
    assert.equal(outcome.capabilityId, 'inventory.read');
    assert.deepEqual(outcome.allowedToolNames, ['search_parts']);
    assert.equal(outcome.executionAllowed, false);
    assert.equal(outcome.v5ToolCalls, 0);
    assert.equal(JSON.stringify(outcome).includes('800平刀'), false);
});

test('altered entity output fails before routing and exposes no tools', async () => {
    const outcome = await runV5IndependentShadow({
        sourceRequest: '查询v750-tokoy-成本', shadowTaskId: 'v5-shadow-p15-altered',
    }, {
        selected: { provider: 'test-provider', model: 'test-interpreter' },
        modelRequest: response({ ...protocolFor('查询v750-tokoy-成本', 'v750-tokoy-', {
            domain: 'recipe', operation: 'preview_cost', entityType: 'recipe',
        }), entitySelections: [{ slotRef: 'slot_01', spanRef: 'sp_DOES_NOT_EXIST' }] }),
    });
    assert.equal(outcome.interpreterStatus, 'INVALID');
    assert.equal(outcome.interpreterReasonCode, 'INVALID_SPAN_REF');
    assert.equal(outcome.capabilityOutcome, 'NOT_RUN');
    assert.deepEqual(outcome.allowedToolNames, []);
});

test('Oracle comparison verifies expected exposure and excludes a wrong V4 Tool', async () => {
    const outcome = await runV5IndependentShadow({
        sourceRequest: '请查询800平刀当前库存', shadowTaskId: 'v5-shadow-p15-r02',
    }, {
        selected: { provider: 'test-provider', model: 'test-interpreter' },
        modelRequest: response(protocolFor('请查询800平刀当前库存')),
    });
    const comparison = evaluateIndependentShadow(outcome, {
        primary_tool: 'search_parts', allowed_tools: ['search_parts'],
    }, {
        v4Result: 'FAIL', rootCauseClass: 'R02', toolNames: ['search_templates'],
    });
    assert.equal(comparison.capabilityMatch, true);
    assert.equal(comparison.expectedToolExposed, true);
    assert.equal(comparison.wrongToolExcluded, true);
    assert.equal(comparison.overallComparison, 'V5_BLOCKS_V4_FAILURE');
});

test('mirror uses the existing capacity boundary and records exactly one interpreter call', async () => {
    const mirror = createV5ShadowMirror({
        env: { AI_V5_SHADOW_ENABLED: 'true', AI_V5_SHADOW_SAMPLE_RATE: '1' },
        random: () => 0,
        interpreterTimeoutMs: 1000,
    });
    const scheduled = mirror.mirror(mirrorFacts(), {
        sourceRequest: '请查询800平刀当前库存',
        interpreterModelRequest: response(protocolFor('请查询800平刀当前库存')),
    });
    const outcome = await scheduled.completion;
    assert.equal(outcome.independentShadow.capabilityId, 'inventory.read');
    assert.equal(mirror.snapshot().v5ModelCalls, 1);
    assert.equal(mirror.snapshot().v5ToolCalls, 0);
    assert.equal(mirror.snapshot().v5BusinessApiCalls, 0);
    assert.equal(mirror.snapshot().v5Writes, 0);
});

test('ten concurrent independent requests remain isolated with zero content persistence', async () => {
    const outcomes = [];
    const mirror = createV5ShadowMirror({
        env: { AI_V5_SHADOW_ENABLED: 'true', AI_V5_SHADOW_SAMPLE_RATE: '1' },
        random: () => 0,
        maxConcurrency: 10,
        interpreterTimeoutMs: 1000,
        onOutcome: item => outcomes.push(item),
    });
    const scheduled = Array.from({ length: 10 }, (_, index) => mirror.mirror(mirrorFacts(index + 1), {
        sourceRequest: `请求${index}查询800平刀当前库存`,
        interpreterModelRequest: response(protocolFor(`请求${index}查询800平刀当前库存`)),
    }));
    await Promise.all(scheduled.map(item => item.completion));
    assert.equal(new Set(outcomes.map(item => item.shadowTaskId)).size, 10);
    assert.equal(new Set(outcomes.map(item => item.sourceRequestId)).size, 10);
    assert.equal(new Set(outcomes.map(item => item.sourceTraceId)).size, 10);
    assert.equal(outcomes.some(item => JSON.stringify(item).includes('800平刀')), false);
});

test('independent shadow output contains no prompt, candidate, Tool value or business sentinel', async () => {
    const sentinel = 'P15_CANDIDATE_ENTITY_SENTINEL';
    const outcome = await runV5IndependentShadow({
        sourceRequest: `查${sentinel}库存`, shadowTaskId: 'v5-shadow-p15-privacy',
    }, {
        selected: { provider: 'test-provider', model: 'test-interpreter' },
        modelRequest: response(protocolFor(`查${sentinel}库存`, sentinel)),
    });
    const serialized = JSON.stringify(outcome);
    for (const value of [sentinel, 'P15_SECRET_SENTINEL', 'P15_TOOL_VALUE_SENTINEL']) {
        assert.equal(serialized.includes(value), false);
    }
});
