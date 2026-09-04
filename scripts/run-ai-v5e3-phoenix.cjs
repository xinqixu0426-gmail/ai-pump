'use strict';

require('dotenv').config({ quiet: true });

process.env.AI_OBSERVABILITY_ENABLED = 'true';
process.env.AI_OBSERVABILITY_PROJECT = 'pump-ai-v5e3-shadow';
process.env.AI_TRACE_CONTENT = 'metadata';
process.env.PHOENIX_COLLECTOR_ENDPOINT = process.env.PHOENIX_COLLECTOR_ENDPOINT || 'http://127.0.0.1:6006';

const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const observability = require('../api/services/observability.cjs');
const { captureSafeV4ShadowFacts } = require('../api/services/ai-v5/shadowProjection.cjs');
const { createV5ShadowMirror } = require('../api/services/ai-v5/shadowMirror.cjs');
const { validateTraceIntegrity } = require('./observability-trace-integrity.cjs');

const root = path.resolve(__dirname, '..');
const dataset = require('../docs/ai-governance/data/v5-e3-shadow-evaluation.json');
const SENTINELS = Object.freeze({
    secret: 'P14_SECRET_API_KEY_SENTINEL', pii: 'P14_PII_EMAIL_SENTINEL',
    business: 'P14_BUSINESS_VALUE_SENTINEL', toolArg: 'P14_TOOL_ARG_SENTINEL',
    toolResult: 'P14_TOOL_RESULT_SENTINEL', rawEntity: 'P14_RAW_ENTITY_SENTINEL',
    prompt: 'P14_SECRET_PROMPT_SENTINEL', response: 'P14_SECRET_RESPONSE_SENTINEL',
});

async function fetchProjectSpans() {
    const spans = [];
    let cursor = null;
    do {
        const url = new URL('/v1/projects/pump-ai-v5e3-shadow/spans', process.env.PHOENIX_COLLECTOR_ENDPOINT);
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

function traceId(span) {
    return span?.context?.trace_id || span?.trace_id || null;
}

function spanId(span) {
    return span?.context?.span_id || span?.span_id || null;
}

function validateShadowTraces(spans, sourceTraceIds) {
    let orphan = 0;
    let invalidParent = 0;
    let missing = 0;
    let contamination = 0;
    for (const sourceTraceId of sourceTraceIds) {
        const rootSpan = spans.find(span => span.name === 'pump.ai.v5.shadow'
            && span.attributes?.['pump.ai.v5.source_trace_id'] === sourceTraceId);
        if (!rootSpan) { missing += 1; continue; }
        if (rootSpan.parent_id) invalidParent += 1;
        const scoped = spans.filter(span => traceId(span) === traceId(rootSpan));
        const rootId = spanId(rootSpan);
        const children = scoped.filter(span => span !== rootSpan);
        for (const child of children) {
            if (!child.parent_id) orphan += 1;
            if (child.parent_id !== rootId) invalidParent += 1;
            if (child.attributes?.['pump.ai.v5.source_trace_id'] !== sourceTraceId) contamination += 1;
        }
    }
    return { orphan, invalidParent, missing, contamination };
}

(async () => {
    observability.initializeObservability();
    const sentinelRequestId = `p14-sentinel-${process.pid}`;
    const sentinelFacts = captureSafeV4ShadowFacts({ requestId: sentinelRequestId }, {
        finalContent: SENTINELS.response,
        prompt: SENTINELS.prompt,
        entity: { rawMention: SENTINELS.rawEntity },
        credentials: { apiKey: SENTINELS.secret },
        customer: { email: SENTINELS.pii },
        business: { value: SENTINELS.business },
        toolResults: [{ args: SENTINELS.toolArg, result: SENTINELS.toolResult }],
        intent: { mode: 'query' },
        telemetry: { outcome: 'completed', toolSteps: [{ capabilityName: 'search_parts', success: true }] },
    }, { traceId: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' }, {
        shadowTaskId: `v5-shadow-${sentinelRequestId}`,
        structural: {
            expectedSuccess: true, intendedCapabilityId: 'inventory.read', validatedArgumentsReady: true,
            stateValid: true, entityStatus: 'NOT_APPLICABLE', verificationStatus: 'NOT_APPLICABLE',
        },
    });
    const mirror = createV5ShadowMirror({
        env: { AI_V5_SHADOW_ENABLED: 'true', AI_V5_SHADOW_SAMPLE_RATE: '1' }, random: () => 0,
    });
    await mirror.mirror(sentinelFacts).completion;
    await observability.safeForceFlush();

    let spans = [];
    let sentinelRoot;
    for (let attempt = 0; attempt < 20 && !sentinelRoot; attempt += 1) {
        spans = await fetchProjectSpans();
        sentinelRoot = spans.find(span => span.name === 'pump.ai.v5.shadow'
            && span.attributes?.['pump.request.id'] === sentinelRequestId);
        if (!sentinelRoot) await wait(100);
    }
    const sourceTraceIds = dataset.cases.map(item => item.trace_id).filter(Boolean);
    const sourceSet = new Set(sourceTraceIds);
    const v4Spans = spans.filter(span => sourceSet.has(traceId(span)));
    const v4Integrity = validateTraceIntegrity(v4Spans);
    const shadowIntegrity = validateShadowTraces(spans, sourceTraceIds);
    const sentinelTrace = spans.filter(span => traceId(span) === traceId(sentinelRoot));
    const serialized = JSON.stringify(sentinelTrace);
    const leakage = Object.fromEntries(Object.entries(SENTINELS).map(([key, value]) => [
        key, serialized.split(value).length - 1,
    ]));
    const output = {
        project: 'pump-ai-v5e3-shadow',
        evaluatedTraceCount: sourceTraceIds.length,
        v4Integrity,
        shadowIntegrity,
        sentinelLeakage: leakage,
        totalSentinelLeakage: Object.values(leakage).reduce((sum, value) => sum + value, 0),
        sentinelTraceId: traceId(sentinelRoot),
        sentinelRootSpanId: spanId(sentinelRoot),
        datasetHash: require('node:crypto').createHash('sha256')
            .update(fs.readFileSync(path.join(root, 'docs', 'ai-governance', 'data', 'v5-e3-shadow-evaluation.json')))
            .digest('hex'),
    };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    await observability.safeShutdown();
    if (!v4Integrity.pass || Object.values(shadowIntegrity).some(value => value !== 0)
        || output.totalSentinelLeakage !== 0) process.exitCode = 1;
})().catch(async error => {
    await observability.safeShutdown();
    process.stderr.write(`${JSON.stringify({ status: 'FAILED', errorType: error?.name || 'Error' })}\n`);
    process.exitCode = 1;
});
