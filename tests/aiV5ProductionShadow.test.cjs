'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runAiDispatcherV3 } = require('../api/services/aiDispatcherV3.cjs');
const { handleAiChat } = require('../api/routes/ai/chat.cjs');
const {
    captureSafeV4ShadowFacts,
    projectSafeV4Facts,
} = require('../api/services/ai-v5/shadowProjection.cjs');
const {
    compareV4ActualToV5Shadow,
    evaluateP06ProductionShadowControls,
} = require('../api/services/ai-v5/shadowComparison.cjs');
const {
    classifyEligibility,
    createV5ShadowMirror,
    readV5ShadowConfig,
} = require('../api/services/ai-v5/shadowMirror.cjs');

const TRACE_ID = '0123456789abcdef0123456789abcdef';
const AT = '2026-09-04T00:00:00.000Z';
const p06Cases = require('../docs/ai-observability/data/p06-failure-cases.json');

function v4Result(overrides = {}) {
    return {
        finalContent: 'P13_SECRET_RESPONSE_SENTINEL',
        toolResults: [{ args: { secret: 'P13_TOOL_ARG_SENTINEL' }, result: 'P13_TOOL_RESULT_SENTINEL' }],
        intent: { mode: 'query', raw: 'P13_SECRET_PROMPT_SENTINEL' },
        telemetry: {
            outcome: 'completed',
            requestId: 'p13-request-001',
            toolSteps: [{ capabilityName: 'search_parts', success: true, errorCode: '' }],
        },
        ...overrides,
    };
}

function facts(overrides = {}, structural = {}) {
    const result = v4Result(overrides.result);
    if (overrides.toolSteps) result.telemetry.toolSteps = overrides.toolSteps;
    if (overrides.outcome) result.telemetry.outcome = overrides.outcome;
    if (overrides.mode) result.intent.mode = overrides.mode;
    return captureSafeV4ShadowFacts({
        requestId: overrides.requestId || 'p13-request-001',
        allowWrite: overrides.allowWrite === true,
    }, result, { traceId: overrides.traceId || TRACE_ID }, {
        createdAt: AT,
        shadowTaskId: overrides.shadowTaskId || 'v5-shadow-p13-001',
        structural: {
            failureClass: 'NONE',
            expectedSuccess: false,
            intendedCapabilityId: 'inventory.read',
            validatedArgumentsReady: true,
            stateValid: true,
            entityStatus: 'RESOLVED',
            verificationStatus: 'VERIFIED',
            ...structural,
        },
    });
}

function enabledMirror(options = {}) {
    return createV5ShadowMirror({
        env: { AI_V5_SHADOW_ENABLED: 'true', AI_V5_SHADOW_SAMPLE_RATE: '1' },
        random: () => 0,
        ...options,
    });
}

async function complete(mirror, source) {
    const scheduled = mirror.mirror(source);
    assert.equal(scheduled.shadowStatus, 'SCHEDULED');
    return scheduled.completion;
}

function fakeReq() {
    const listeners = new Map();
    return {
        body: { messages: [{ role: 'user', content: 'fixture' }] },
        requestId: 'p13-request-sse',
        once(name, fn) { listeners.set(name, fn); },
        removeListener(name) { listeners.delete(name); },
    };
}

function fakeRes() {
    const listeners = new Map();
    return {
        output: '', writableEnded: false, destroyed: false,
        setHeader() {}, flushHeaders() {}, flush() {},
        write(chunk) { this.output += String(chunk); return true; },
        end() { this.writableEnded = true; },
        once(name, fn) { listeners.set(name, fn); },
        removeListener(name) { listeners.delete(name); },
    };
}

test('shadow flags default disabled/rate zero and accept only exact true plus bounded rate', () => {
    assert.deepEqual(readV5ShadowConfig({}), {
        enabled: false, sampleRate: 0, maxConcurrency: 4, timeoutMs: 100,
        project: 'pump-ai-v5e2-shadow',
    });
    assert.equal(readV5ShadowConfig({ AI_V5_SHADOW_ENABLED: '1', AI_V5_SHADOW_SAMPLE_RATE: '1.1' }).enabled, false);
    assert.equal(readV5ShadowConfig({ AI_V5_SHADOW_ENABLED: 'true', AI_V5_SHADOW_SAMPLE_RATE: 'banana' }).sampleRate, 0);
    assert.equal(readV5ShadowConfig({ AI_V5_SHADOW_ENABLED: 'true', AI_V5_SHADOW_SAMPLE_RATE: '0.25' }).sampleRate, 0.25);
});

test('safe projection copies no prompt, response, tool payload, entity or business sentinel', () => {
    const captured = facts();
    const serialized = JSON.stringify(captured);
    for (const sentinel of [
        'P13_SECRET_RESPONSE_SENTINEL', 'P13_TOOL_ARG_SENTINEL', 'P13_TOOL_RESULT_SENTINEL',
        'P13_SECRET_PROMPT_SENTINEL',
    ]) assert.equal(serialized.includes(sentinel), false);
    assert.equal(captured.sourceRequestId, 'p13-request-001');
    assert.equal(captured.sourceTraceId, TRACE_ID);
    assert.notEqual(captured.shadowTaskId, captured.sourceRequestId);
});

test('invalid request correlation is hashed and raw value is omitted', () => {
    const captured = facts({ requestId: 'P13 PII EMAIL SENTINEL@example.com' });
    assert.equal(captured.sourceRequestId, null);
    assert.match(captured.sourceRequestIdHash, /^[a-f0-9]{24}$/);
    assert.equal(JSON.stringify(captured).includes('example.com'), false);
});

test('disabled mode creates zero tasks and sample rate zero mirrors zero requests', () => {
    const disabled = createV5ShadowMirror({ env: {} });
    assert.equal(disabled.mirror(facts()).shadowStatus, 'DISABLED');
    assert.equal(disabled.snapshot().tasksCreated, 0);
    const zero = createV5ShadowMirror({ env: { AI_V5_SHADOW_ENABLED: 'true', AI_V5_SHADOW_SAMPLE_RATE: '0' } });
    assert.equal(zero.mirror(facts()).shadowStatus, 'SKIPPED_SAMPLE');
    assert.equal(zero.snapshot().mirroredRequests, 0);
});

test('disabled production hook is a strict no-op before fact capture', async () => {
    const expected = v4Result();
    const returned = await runAiDispatcherV3({}, {
        env: { AI_V5_SHADOW_ENABLED: 'false', AI_V5_SHADOW_SAMPLE_RATE: '1' },
        runAiAgentRuntimeV3: async () => expected,
        captureSafeV4ShadowFacts() { throw new Error('disabled hook must not capture'); },
        scheduleV5ShadowMirror() { throw new Error('disabled hook must not schedule'); },
    });
    assert.equal(returned, expected);
});

test('sample rate one mirrors every eligible read and never invokes V5 external systems', async () => {
    const mirror = enabledMirror();
    const outcome = await complete(mirror, facts({}, { expectedSuccess: true }));
    assert.equal(outcome.comparisonStatus, 'AGREE');
    assert.deepEqual(mirror.snapshot(), {
        tasksCreated: 1, mirroredRequests: 1, skippedPolicy: 0, skippedSample: 0,
        skippedCapacity: 0, shadowErrors: 0, shadowTimeouts: 0,
        v5ModelCalls: 0, v5ToolCalls: 0, v5BusinessApiCalls: 0, v5Writes: 0, active: 0,
    });
});

test('write, confirmation, critical and unknown-risk requests are skipped by policy', () => {
    const mirror = enabledMirror();
    const scenarios = [
        facts({ allowWrite: true, mode: 'command', toolSteps: [{ capabilityName: 'adjust_part_stock', success: true }] }),
        facts({ outcome: 'confirmation' }),
        facts({ toolSteps: [{ capabilityName: 'unknown_critical_tool', success: false }] }),
    ];
    for (const source of scenarios) assert.equal(mirror.mirror(source).shadowStatus, 'SKIPPED_POLICY');
    assert.equal(mirror.snapshot().tasksCreated, 0);
    assert.equal(mirror.snapshot().skippedPolicy, 3);
});

test('eligibility requires a uniquely mapped L1/L2 read tool', () => {
    assert.equal(classifyEligibility(facts()).eligible, true);
    assert.equal(classifyEligibility(facts({ toolSteps: [] })).reasonCode, 'UNKNOWN_RISK_EXCLUDED');
});

test('deterministic success, C02, R02 and A01 comparisons have stable taxonomy', () => {
    const success = compareV4ActualToV5Shadow(projectSafeV4Facts(facts({}, { expectedSuccess: true })));
    const c02 = compareV4ActualToV5Shadow(projectSafeV4Facts(facts({}, { failureClass: 'C02', stateValid: false })));
    const r02 = compareV4ActualToV5Shadow(projectSafeV4Facts(facts({
        toolSteps: [{ capabilityName: 'search_coils', success: true }],
    }, { failureClass: 'R02', intendedCapabilityId: 'inventory.read' })));
    const a01 = compareV4ActualToV5Shadow(projectSafeV4Facts(facts({}, { failureClass: 'A01', validatedArgumentsReady: false })));
    assert.equal(success.comparisonStatus, 'AGREE');
    assert.equal(c02.comparisonStatus, 'V5_BLOCKS_V4_FAILURE');
    assert.equal(r02.comparisonStatus, 'V5_BLOCKS_V4_FAILURE');
    assert.equal(a01.comparisonStatus, 'V5_BLOCKS_V4_FAILURE');
});

test('P06 production adapter preserves C02/R02/A01 blocks and zero success false blocks', () => {
    const evaluation = evaluateP06ProductionShadowControls(p06Cases, { createdAt: AT });
    assert.deepEqual(evaluation.metrics, {
        c02Analyzed: 3, c02Blocked: 3,
        r02Analyzed: 3, r02Blocked: 3,
        a01Analyzed: 2, a01Blocked: 2,
        successControls: 7, successFalseBlocks: 0,
    });
});

test('incomplete production-safe projection is explicit and never fabricated', () => {
    const incomplete = captureSafeV4ShadowFacts({ requestId: 'p13-request-001' }, v4Result(), { traceId: TRACE_ID }, {
        createdAt: AT, shadowTaskId: 'v5-shadow-incomplete',
    });
    const projection = projectSafeV4Facts(incomplete);
    const comparison = compareV4ActualToV5Shadow(projection);
    assert.equal(projection.status, 'INCOMPLETE');
    assert.equal(comparison.comparisonStatus, 'V5_INSUFFICIENT_DATA');
    assert.equal(projection.entityAssessment.status, 'UNKNOWN');
});

test('successful V4 path explicitly blocked by V5 is counted as V5_FALSE_BLOCK', () => {
    const comparison = compareV4ActualToV5Shadow(projectSafeV4Facts(facts({}, {
        expectedSuccess: true, stateValid: false,
    })));
    assert.equal(comparison.comparisonStatus, 'V5_FALSE_BLOCK');
});

test('projection and comparison errors are contained as SHADOW_ERROR', async () => {
    const mirror = enabledMirror({ project() { throw new Error('P13_SECRET_PASSWORD_SENTINEL'); } });
    const outcome = await complete(mirror, facts());
    assert.equal(outcome.comparisonStatus, 'SHADOW_ERROR');
    assert.equal(JSON.stringify(outcome).includes('P13_SECRET_PASSWORD_SENTINEL'), false);
    assert.equal(mirror.snapshot().shadowErrors, 1);
});

test('shadow timeout is independent and does not reject or hang the caller', async () => {
    const mirror = enabledMirror({ timeoutMs: 10, project: () => new Promise(() => {}) });
    const outcome = await complete(mirror, facts());
    assert.equal(outcome.comparisonStatus, 'SHADOW_ERROR');
    assert.deepEqual(outcome.reasonCodes, ['SHADOW_TIMEOUT']);
    assert.equal(mirror.snapshot().shadowTimeouts, 1);
});

test('capacity is bounded and excess work is skipped without a queue', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const mirror = enabledMirror({ maxConcurrency: 1, timeoutMs: 1000, project: async source => {
        await gate;
        return projectSafeV4Facts(source);
    } });
    const first = mirror.mirror(facts({ shadowTaskId: 'v5-shadow-capacity-1' }));
    assert.equal(first.shadowStatus, 'SCHEDULED');
    assert.equal(mirror.mirror(facts({ shadowTaskId: 'v5-shadow-capacity-2' })).shadowStatus, 'SHADOW_SKIPPED_CAPACITY');
    release();
    await first.completion;
    assert.equal(mirror.snapshot().skippedCapacity, 1);
});

test('ten concurrent requests keep task, request and trace correlation isolated', async () => {
    const outcomes = [];
    const mirror = enabledMirror({ maxConcurrency: 10, onOutcome: outcome => outcomes.push(outcome) });
    const scheduled = Array.from({ length: 10 }, (_, index) => mirror.mirror(facts({
        shadowTaskId: `v5-shadow-concurrent-${index}`,
        requestId: `p13-request-${String(index).padStart(3, '0')}`,
        traceId: index.toString(16).padStart(32, '0'),
    }, { expectedSuccess: true })));
    await Promise.all(scheduled.map(item => item.completion));
    assert.equal(new Set(outcomes.map(item => item.shadowTaskId)).size, 10);
    assert.equal(new Set(outcomes.map(item => item.sourceRequestId)).size, 10);
    assert.equal(new Set(outcomes.map(item => item.sourceTraceId)).size, 10);
    for (const outcome of outcomes) {
        const suffix = outcome.shadowTaskId.split('-').at(-1);
        assert.equal(outcome.sourceRequestId, `p13-request-${String(suffix).padStart(3, '0')}`);
    }
});

test('dispatcher returns the exact V4 object without awaiting shadow completion', async () => {
    const expected = v4Result();
    let release;
    const completion = new Promise(resolve => { release = resolve; });
    let scheduledFacts;
    const returned = await runAiDispatcherV3({ requestId: 'p13-request-001' }, {
        env: { AI_V5_SHADOW_ENABLED: 'true', AI_V5_SHADOW_SAMPLE_RATE: '1' },
        runAiAgentRuntimeV3: async () => expected,
        getActiveTraceContext: () => ({ traceId: TRACE_ID, spanId: '0123456789abcdef' }),
        scheduleV5ShadowMirror(source) {
            scheduledFacts = source;
            return { shadowStatus: 'SCHEDULED', completion };
        },
    });
    assert.equal(returned, expected);
    assert.equal(scheduledFacts.sourceRequestId, 'p13-request-001');
    release();
});

test('synchronous mirror failure cannot change dispatcher result or exception semantics', async () => {
    const expected = v4Result();
    const dependencies = {
        env: { AI_V5_SHADOW_ENABLED: 'true', AI_V5_SHADOW_SAMPLE_RATE: '1' },
        runAiAgentRuntimeV3: async () => expected,
        scheduleV5ShadowMirror() { throw new Error('shadow failed'); },
    };
    assert.equal(await runAiDispatcherV3({}, dependencies), expected);
    const original = new Error('v4 failure');
    await assert.rejects(runAiDispatcherV3({}, {
        ...dependencies,
        runAiAgentRuntimeV3: async () => { throw original; },
    }), error => error === original);
});

test('SSE event count, order, payload and termination are identical OFF and ON', async () => {
    async function run(enabled) {
        const req = fakeReq();
        const res = fakeRes();
        await handleAiChat(req, res, {
            heartbeatMs: 60000,
            timeoutMs: 1000,
            runAiDispatcherV3: input => runAiDispatcherV3(input, {
                env: { AI_V5_SHADOW_ENABLED: enabled ? 'true' : 'false', AI_V5_SHADOW_SAMPLE_RATE: '1' },
                runAiAgentRuntimeV3: async runtimeInput => {
                    runtimeInput.emit('status', { status: 'thinking', message: 'fixture' });
                    runtimeInput.emit('content', { content: 'fixture-result' });
                    runtimeInput.emit('done', {});
                    return v4Result({ finalContent: 'fixture-result' });
                },
            }),
            telemetry: { record() {} },
        });
        return { output: res.output, ended: res.writableEnded };
    }
    assert.deepEqual(await run(false), await run(true));
});

test('mirror outcome and telemetry-safe attributes contain zero privacy sentinels', async () => {
    const mirror = enabledMirror();
    const outcome = await complete(mirror, facts({}, { expectedSuccess: true }));
    const serialized = JSON.stringify(outcome);
    for (const sentinel of [
        'P13_SECRET_API_KEY_SENTINEL', 'P13_SECRET_PASSWORD_SENTINEL',
        'P13_PII_EMAIL_SENTINEL', 'P13_PII_PHONE_SENTINEL', 'P13_BUSINESS_VALUE_SENTINEL',
        'P13_TOOL_ARG_SENTINEL', 'P13_TOOL_RESULT_SENTINEL', 'P13_RAW_ENTITY_SENTINEL',
        'P13_SECRET_PROMPT_SENTINEL', 'P13_SECRET_RESPONSE_SENTINEL',
    ]) assert.equal(serialized.includes(sentinel), false);
});

test('waitForIdle provides bounded diagnostic shutdown without process coupling', async () => {
    const mirror = enabledMirror();
    mirror.mirror(facts());
    assert.equal(await mirror.waitForIdle(1000), true);
    assert.equal(mirror.snapshot().active, 0);
});
