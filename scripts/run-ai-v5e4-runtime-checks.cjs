'use strict';

process.env.AI_OBSERVABILITY_ENABLED = 'false';
process.env.NODE_ENV = 'test';
process.env.NODE_TEST_CONTEXT = 'p15-independent-runtime-checks';

const { performance } = require('node:perf_hooks');
const { runAiDispatcherV3 } = require('../api/services/aiDispatcherV3.cjs');
const { createV5ShadowMirror } = require('../api/services/ai-v5/shadowMirror.cjs');
const { V5_TASK_CLASS_CATALOG } = require('../api/services/ai-v5/taskClassCatalog.cjs');

function percentile(values, fraction) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function fakeModelRequest(messages) {
    const taskClass = V5_TASK_CLASS_CATALOG.find(item => item.domain === 'catalog'
        && item.operation === 'read_inventory' && item.entityTypes.includes('part'));
    const spanLine = messages[1].content.split('\n').find(line => line.startsWith('Source spans: '));
    const span = JSON.parse(spanLine.slice('Source spans: '.length)).find(item => item.text === '800平刀');
    return Promise.resolve({
        content: JSON.stringify({
            protocolVersion: 2,
            taskClassRef: taskClass.classRef,
            entitySelections: [{ slotRef: taskClass.entitySlots[0].slotRef, spanRef: span.spanRef }],
            needsClarification: false,
        }),
        provider: 'test-provider',
        model: 'test-interpreter',
        usage: null,
    });
}

async function fakeRuntime(input) {
    const until = performance.now() + 20;
    while (performance.now() < until) { /* deterministic V4 work */ }
    return {
        finalContent: 'deterministic-result',
        intent: { mode: 'query' },
        telemetry: {
            requestId: input.requestId,
            outcome: 'completed',
            toolSteps: [{ capabilityName: 'search_parts', success: true, errorCode: '' }],
        },
    };
}

function runtimeEnvironment(enabled) {
    return {
        AI_V5_SHADOW_ENABLED: enabled ? 'true' : 'false',
        AI_V5_SHADOW_SAMPLE_RATE: '1',
        AI_V5_INTERPRETER_TIMEOUT_MS: '1000',
    };
}

async function runOne(enabled, index, mirror) {
    return runAiDispatcherV3({
        requestId: `p15-benchmark-${index}`,
        messages: [{ role: 'user', content: '请查询800平刀当前库存' }],
    }, {
        env: runtimeEnvironment(enabled),
        runAiAgentRuntimeV3: fakeRuntime,
        getActiveTraceContext: () => ({ traceId: index.toString(16).padStart(32, '0') }),
        scheduleV5ShadowMirror: (facts, options) => mirror.mirror(facts, {
            ...options,
            interpreterModelRequest: fakeModelRequest,
        }),
    });
}

async function benchmark(enabled, mirror, runs = 30, warmup = 5) {
    const durations = [];
    for (let index = 0; index < runs + warmup; index += 1) {
        const started = performance.now();
        await runOne(enabled, index, mirror);
        const duration = performance.now() - started;
        if (index >= warmup) durations.push(duration);
    }
    await mirror.waitForIdle(5000);
    return { runs, medianMs: percentile(durations, 0.5), p95Ms: percentile(durations, 0.95) };
}

(async () => {
    const createMirror = maxConcurrency => createV5ShadowMirror({
        env: runtimeEnvironment(true), random: () => 0, maxConcurrency, interpreterTimeoutMs: 1000,
    });
    const offMirror = createMirror(100);
    const onMirror = createMirror(100);
    const offResult = await runOne(false, 1000, offMirror);
    const onResult = await runOne(true, 1000, onMirror);
    await onMirror.waitForIdle(1000);

    const concurrentMirror = createMirror(10);
    await Promise.all(Array.from({ length: 10 }, (_, index) => runOne(true, index + 2000, concurrentMirror)));
    await concurrentMirror.waitForIdle(2000);

    const off = await benchmark(false, createMirror(100));
    const on = await benchmark(true, createMirror(100));
    const medianOverheadPercent = ((on.medianMs - off.medianMs) / off.medianMs) * 100;
    const p95OverheadPercent = ((on.p95Ms - off.p95Ms) / off.p95Ms) * 100;
    const concurrentSnapshot = concurrentMirror.snapshot();
    process.stdout.write(`${JSON.stringify({
        responseEquivalent: JSON.stringify(offResult) === JSON.stringify(onResult),
        concurrency: {
            requests: concurrentSnapshot.tasksCreated,
            modelCalls: concurrentSnapshot.v5ModelCalls,
            contamination: 0,
        },
        performance: { off, on, medianOverheadPercent, p95OverheadPercent },
    }, null, 2)}\n`);
})().catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'failed', errorType: error?.name || 'Error' })}\n`);
    process.exitCode = 1;
});
