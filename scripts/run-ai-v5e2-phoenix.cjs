'use strict';

require('dotenv').config({ quiet: true });

process.env.AI_OBSERVABILITY_ENABLED = 'true';
process.env.AI_OBSERVABILITY_PROJECT = 'pump-ai-v5e2-shadow';
process.env.AI_TRACE_CONTENT = 'metadata';
process.env.PHOENIX_COLLECTOR_ENDPOINT = process.env.PHOENIX_COLLECTOR_ENDPOINT || 'http://127.0.0.1:6006';

const observability = require('../api/services/observability.cjs');
const { captureSafeV4ShadowFacts } = require('../api/services/ai-v5/shadowProjection.cjs');
const { createV5ShadowMirror } = require('../api/services/ai-v5/shadowMirror.cjs');
const { setTimeout: wait } = require('node:timers/promises');

const SENTINELS = Object.freeze({
    secret: 'P13_SECRET_API_KEY_SENTINEL',
    pii: 'P13_PII_EMAIL_SENTINEL',
    business: 'P13_BUSINESS_VALUE_SENTINEL',
    toolArg: 'P13_TOOL_ARG_SENTINEL',
    toolResult: 'P13_TOOL_RESULT_SENTINEL',
    rawEntity: 'P13_RAW_ENTITY_SENTINEL',
    prompt: 'P13_SECRET_PROMPT_SENTINEL',
    response: 'P13_SECRET_RESPONSE_SENTINEL',
});

async function fetchProjectSpans() {
    const spans = [];
    let cursor = null;
    do {
        const url = new URL('/v1/projects/pump-ai-v5e2-shadow/spans', process.env.PHOENIX_COLLECTOR_ENDPOINT);
        url.searchParams.set('limit', '100');
        if (cursor) url.searchParams.set('cursor', cursor);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Phoenix returned ${response.status}`);
        const page = await response.json();
        spans.push(...(Array.isArray(page.data) ? page.data : []));
        cursor = page.next_cursor || null;
    } while (cursor);
    return spans;
}

(async () => {
    observability.initializeObservability();
    const facts = captureSafeV4ShadowFacts({ requestId: 'p13-phoenix-sentinel' }, {
        finalContent: SENTINELS.response,
        intent: { mode: 'query', prompt: SENTINELS.prompt },
        entity: { rawMention: SENTINELS.rawEntity },
        customer: { email: SENTINELS.pii },
        credentials: { apiKey: SENTINELS.secret },
        business: { value: SENTINELS.business },
        toolResults: [{ args: { value: SENTINELS.toolArg }, result: SENTINELS.toolResult }],
        telemetry: {
            outcome: 'completed',
            toolSteps: [{ capabilityName: 'search_parts', success: true }],
        },
    }, { traceId: '11111111111111111111111111111111' }, {
        shadowTaskId: 'v5-shadow-p13-phoenix-sentinel',
        createdAt: '2026-09-04T00:00:00.000Z',
    });
    const mirror = createV5ShadowMirror({
        env: { AI_V5_SHADOW_ENABLED: 'true', AI_V5_SHADOW_SAMPLE_RATE: '1' },
        random: () => 0,
    });
    const scheduled = mirror.mirror(facts);
    const outcome = await scheduled.completion;
    await observability.safeForceFlush();
    let spans = [];
    let roots = [];
    for (let attempt = 0; attempt < 20 && roots.length === 0; attempt += 1) {
        spans = await fetchProjectSpans();
        roots = spans.filter(span => span.name === 'pump.ai.v5.shadow'
            && span.attributes?.['pump.request.id'] === 'p13-phoenix-sentinel');
        if (roots.length === 0) await wait(100);
    }
    const root = roots.at(-1);
    const traceId = root?.context?.trace_id || null;
    const scoped = spans.filter(span => span?.context?.trace_id === traceId);
    const serialized = JSON.stringify(scoped);
    const leakage = Object.fromEntries(Object.entries(SENTINELS).map(([key, value]) => [
        key,
        serialized.split(value).length - 1,
    ]));
    const rootSpanId = root?.context?.span_id || null;
    const children = scoped.filter(span => span.parent_id === rootSpanId);
    process.stdout.write(`${JSON.stringify({
        project: 'pump-ai-v5e2-shadow',
        comparisonStatus: outcome.comparisonStatus,
        traceId,
        rootSpanId,
        rootParentId: root?.parent_id ?? null,
        childNames: children.map(span => span.name).sort(),
        childCount: children.length,
        sentinelLeakage: leakage,
        totalSentinelLeakage: Object.values(leakage).reduce((sum, value) => sum + value, 0),
    }, null, 2)}\n`);
    await observability.safeShutdown();
})().catch(async error => {
    await observability.safeShutdown();
    process.stderr.write(`${JSON.stringify({ status: 'FAILED', errorType: error?.name || 'Error' })}\n`);
    process.exitCode = 1;
});
