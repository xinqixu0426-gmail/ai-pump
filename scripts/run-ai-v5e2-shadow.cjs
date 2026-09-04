'use strict';

const { performance } = require('node:perf_hooks');
const { setImmediate: waitImmediate } = require('node:timers/promises');
const { captureSafeV4ShadowFacts, projectSafeV4Facts } = require('../api/services/ai-v5/shadowProjection.cjs');
const { createV5ShadowMirror } = require('../api/services/ai-v5/shadowMirror.cjs');
const { evaluateP06ProductionShadowControls } = require('../api/services/ai-v5/shadowComparison.cjs');
const p06Cases = require('../docs/ai-observability/data/p06-failure-cases.json');

const TRACE_ID = '0123456789abcdef0123456789abcdef';
const AT = '2026-09-04T00:00:00.000Z';

function source(index, overrides = {}, structural = {}) {
    const toolSteps = overrides.toolSteps || [{ capabilityName: 'search_parts', success: true, errorCode: '' }];
    return captureSafeV4ShadowFacts({
        requestId: `p13-request-${String(index).padStart(3, '0')}`,
        allowWrite: overrides.allowWrite === true,
    }, {
        intent: { mode: overrides.mode || 'query' },
        telemetry: { outcome: overrides.outcome || 'completed', toolSteps },
        prompt: 'P13_SECRET_PROMPT_SENTINEL',
        toolResults: [{ value: 'P13_TOOL_RESULT_SENTINEL' }],
    }, { traceId: index.toString(16).padStart(32, '0') || TRACE_ID }, {
        createdAt: AT,
        shadowTaskId: `v5-shadow-p13-${String(index).padStart(3, '0')}`,
        structural: {
            failureClass: 'NONE', expectedSuccess: false, intendedCapabilityId: 'inventory.read',
            validatedArgumentsReady: true, stateValid: true, entityStatus: 'RESOLVED',
            verificationStatus: 'VERIFIED', ...structural,
        },
    });
}

function percentile(values, fraction) {
    const ordered = [...values].sort((a, b) => a - b);
    return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
}

async function deterministicCases() {
    const mirror = createV5ShadowMirror({
        env: { AI_V5_SHADOW_ENABLED: 'true', AI_V5_SHADOW_SAMPLE_RATE: '1' },
        maxConcurrency: 10,
        random: () => 0,
    });
    const cases = [
        ['valid_read_success', source(1, {}, { expectedSuccess: true })],
        ['c02_invalid_state', source(2, {}, { failureClass: 'C02', stateValid: false })],
        ['r02_wrong_tool', source(3, { toolSteps: [{ capabilityName: 'search_coils', success: true }] }, { failureClass: 'R02' })],
        ['a01_invalid_args', source(4, {}, { failureClass: 'A01', validatedArgumentsReady: false })],
        ['write_request', source(5, { allowWrite: true, mode: 'command', toolSteps: [{ capabilityName: 'adjust_part_stock', success: true }] })],
        ['critical_request', source(6, { toolSteps: [{ capabilityName: 'unknown_critical_tool', success: false }] })],
    ];
    const results = [];
    for (const [name, facts] of cases) {
        const scheduled = mirror.mirror(facts);
        results.push({ name, shadowStatus: scheduled.shadowStatus, outcome: scheduled.completion ? await scheduled.completion : null });
    }
    const incomplete = captureSafeV4ShadowFacts({ requestId: 'p13-request-incomplete' }, {
        intent: { mode: 'query' }, telemetry: { outcome: 'completed', toolSteps: [{ capabilityName: 'search_parts', success: true }] },
    }, { traceId: TRACE_ID }, { createdAt: AT, shadowTaskId: 'v5-shadow-incomplete' });
    const scheduledIncomplete = mirror.mirror(incomplete);
    results.push({ name: 'projection_incomplete', shadowStatus: scheduledIncomplete.shadowStatus, outcome: await scheduledIncomplete.completion });
    const errorMirror = createV5ShadowMirror({
        env: { AI_V5_SHADOW_ENABLED: 'true', AI_V5_SHADOW_SAMPLE_RATE: '1' },
        random: () => 0,
        project() { throw new Error('synthetic shadow error'); },
    });
    const error = errorMirror.mirror(source(7));
    results.push({ name: 'shadow_internal_error', shadowStatus: error.shadowStatus, outcome: await error.completion });
    return { results, counters: mirror.snapshot(), errorCounters: errorMirror.snapshot() };
}

async function concurrentIsolation() {
    const outcomes = [];
    const mirror = createV5ShadowMirror({
        env: { AI_V5_SHADOW_ENABLED: 'true', AI_V5_SHADOW_SAMPLE_RATE: '1' },
        maxConcurrency: 10,
        random: () => 0,
        onOutcome: outcome => outcomes.push(outcome),
    });
    const scheduled = Array.from({ length: 10 }, (_, index) => mirror.mirror(source(index + 20, {}, { expectedSuccess: true })));
    await Promise.all(scheduled.map(item => item.completion));
    return {
        requests: 10,
        shadowTaskIds: new Set(outcomes.map(item => item.shadowTaskId)).size,
        requestIds: new Set(outcomes.map(item => item.sourceRequestId)).size,
        traceIds: new Set(outcomes.map(item => item.sourceTraceId)).size,
    };
}

async function benchmark(enabled, runs = 30, warmup = 5) {
    const mirror = createV5ShadowMirror({
        env: { AI_V5_SHADOW_ENABLED: enabled ? 'true' : 'false', AI_V5_SHADOW_SAMPLE_RATE: '1' },
        random: () => 0,
    });
    const values = [];
    for (let index = 0; index < runs + warmup; index += 1) {
        const started = performance.now();
        const until = performance.now() + 20;
        while (performance.now() < until) { /* stable synthetic V4 work */ }
        const result = {
            intent: { mode: 'query' },
            telemetry: { outcome: 'completed', toolSteps: [{ capabilityName: 'search_parts', success: true }] },
        };
        const captured = captureSafeV4ShadowFacts({ requestId: `p13-benchmark-${index}` }, result, {
            traceId: TRACE_ID,
        });
        mirror.mirror(captured);
        const elapsed = performance.now() - started;
        await waitImmediate();
        if (index >= warmup) values.push(elapsed);
    }
    await mirror.waitForIdle(1000);
    return { runs, medianMs: percentile(values, 0.5), p95Ms: percentile(values, 0.95) };
}

(async () => {
    const cases = await deterministicCases();
    const p06 = evaluateP06ProductionShadowControls(p06Cases, { createdAt: AT });
    const concurrency = await concurrentIsolation();
    const off = await benchmark(false);
    const on = await benchmark(true);
    const statuses = cases.results.map(item => item.outcome?.comparisonStatus).filter(Boolean);
    const privacyText = JSON.stringify(cases);
    const sentinels = [
        'P13_SECRET_PROMPT_SENTINEL', 'P13_TOOL_RESULT_SENTINEL', 'P13_SECRET_API_KEY_SENTINEL',
        'P13_PII_EMAIL_SENTINEL', 'P13_BUSINESS_VALUE_SENTINEL', 'P13_RAW_ENTITY_SENTINEL',
    ];
    const medianOverheadPercent = ((on.medianMs - off.medianMs) / off.medianMs) * 100;
    const p95OverheadPercent = ((on.p95Ms - off.p95Ms) / off.p95Ms) * 100;
    console.log(JSON.stringify({
        deterministicCases: cases.results.length,
        p06Metrics: p06.metrics,
        comparisonCounts: {
            V5_FALSE_BLOCK: statuses.filter(value => value === 'V5_FALSE_BLOCK').length,
            V5_BLOCKS_V4_FAILURE: statuses.filter(value => value === 'V5_BLOCKS_V4_FAILURE').length,
            V5_INSUFFICIENT_DATA: statuses.filter(value => value === 'V5_INSUFFICIENT_DATA').length,
            SHADOW_ERROR: statuses.filter(value => value === 'SHADOW_ERROR').length,
        },
        v5CallCounters: {
            model: cases.counters.v5ModelCalls,
            tool: cases.counters.v5ToolCalls,
            businessApi: cases.counters.v5BusinessApiCalls,
            writes: cases.counters.v5Writes,
        },
        concurrency,
        performance: { off, on, medianOverheadPercent, p95OverheadPercent },
        privacySentinelLeakage: sentinels.filter(value => privacyText.includes(value)).length,
        directProjectionCheck: projectSafeV4Facts(source(99, {}, { expectedSuccess: true })).projectionStatus,
    }, null, 2));
})().catch(error => {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
});
