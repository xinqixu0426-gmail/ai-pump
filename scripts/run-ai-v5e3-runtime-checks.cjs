'use strict';

process.env.AI_OBSERVABILITY_ENABLED = 'false';
process.env.NODE_ENV = 'test';
process.env.NODE_TEST_CONTEXT = 'p14-shadow-runtime-checks';

const { performance } = require('node:perf_hooks');
const { runAiDispatcherV3 } = require('../api/services/aiDispatcherV3.cjs');
const observability = require('../api/services/observability.cjs');
const { prepareAiToolCalls } = require('../api/services/aiToolProtocol.cjs');

function percentile(values, fraction) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

async function fakeRuntime(input) {
    const until = performance.now() + 20;
    while (performance.now() < until) { /* deterministic V4 workload */ }
    observability.withEntityNormalizationSpan({ entityType: 'part', input: 'fixture-', output: 'fixture' }, () => ['fixture']);
    observability.withRoutingSpan({ availableToolCount: 1, access: 'read' }, () => ({
        status: 'selected', capabilityName: 'search_parts',
    }));
    prepareAiToolCalls([{
        function: { name: 'search_parts', arguments: JSON.stringify({ keyword: 'fixture' }) },
    }], 'model', { allowedToolNames: ['search_parts'], writeTools: new Set() });
    await observability.withToolSpan({ toolName: 'search_parts', access: 'read', args: { keyword: 'fixture' } },
        async () => ({ success: true }));
    observability.withVerificationSpan({
        status: 'verified', requiredCount: 1, observedCount: 1, toolExecutionCount: 1,
    }, () => true);
    return {
        finalContent: 'deterministic-result',
        intent: { mode: 'query' },
        telemetry: {
            requestId: input.requestId, outcome: 'completed',
            toolSteps: [{ capabilityName: 'search_parts', success: true, errorCode: '' }],
        },
    };
}

async function runOne(enabled, index, captured = []) {
    return runAiDispatcherV3({ requestId: `p14-benchmark-${index}` }, {
        env: {
            AI_V5_SHADOW_ENABLED: enabled ? 'true' : 'false',
            AI_V5_SHADOW_SAMPLE_RATE: '1',
        },
        runAiAgentRuntimeV3: fakeRuntime,
        getActiveTraceContext: () => ({ traceId: index.toString(16).padStart(32, '0') }),
        scheduleV5ShadowMirror(facts) {
            captured.push(facts);
            return { shadowStatus: 'SCHEDULED', completion: Promise.resolve(null) };
        },
    });
}

async function benchmark(enabled, runs = 30, warmup = 5) {
    const durations = [];
    for (let index = 0; index < runs + warmup; index += 1) {
        const started = performance.now();
        await runOne(enabled, index);
        const duration = performance.now() - started;
        if (index >= warmup) durations.push(duration);
    }
    return { runs, medianMs: percentile(durations, 0.5), p95Ms: percentile(durations, 0.95) };
}

(async () => {
    const offResult = await runOne(false, 1000);
    const onResult = await runOne(true, 1000);
    const captures = [];
    await Promise.all(Array.from({ length: 10 }, (_, index) => runOne(true, index + 2000, captures)));
    const off = await benchmark(false);
    const on = await benchmark(true);
    const medianOverheadPercent = ((on.medianMs - off.medianMs) / off.medianMs) * 100;
    const p95OverheadPercent = ((on.p95Ms - off.p95Ms) / off.p95Ms) * 100;
    process.stdout.write(`${JSON.stringify({
        responseEquivalent: JSON.stringify(offResult) === JSON.stringify(onResult),
        concurrency: {
            requests: captures.length,
            uniqueShadowTaskIds: new Set(captures.map(item => item.shadowTaskId)).size,
            uniqueRequestIds: new Set(captures.map(item => item.sourceRequestId)).size,
            uniqueTraceIds: new Set(captures.map(item => item.sourceTraceId)).size,
            contamination: captures.filter(item => !item.sourceRequestId?.endsWith(
                String(Number.parseInt(item.sourceTraceId, 16)).padStart(4, '0')
            )).length,
        },
        performance: { off, on, medianOverheadPercent, p95OverheadPercent },
    }, null, 2)}\n`);
})().catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'failed', errorType: error?.name || 'Error' })}\n`);
    process.exitCode = 1;
});
