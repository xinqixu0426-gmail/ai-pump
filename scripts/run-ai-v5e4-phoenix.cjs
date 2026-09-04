'use strict';

require('dotenv').config({ quiet: true });
process.env.AI_OBSERVABILITY_ENABLED = 'true';
process.env.AI_OBSERVABILITY_PROJECT = 'pump-ai-v5e4-independent-shadow';
process.env.AI_TRACE_CONTENT = 'metadata';
process.env.PHOENIX_COLLECTOR_ENDPOINT = process.env.PHOENIX_COLLECTOR_ENDPOINT || 'http://127.0.0.1:6006';

const { setTimeout: wait } = require('node:timers/promises');
const observability = require('../api/services/observability.cjs');
const { captureSafeV4ShadowFacts } = require('../api/services/ai-v5/shadowProjection.cjs');
const { createV5ShadowMirror } = require('../api/services/ai-v5/shadowMirror.cjs');
const dataset = require('../docs/ai-governance/data/v5-e4-independent-shadow-evaluation.json');

const SENTINELS = Object.freeze({
    secret: 'P15_SECRET_API_KEY_SENTINEL',
    pii: 'P15_PII_EMAIL_SENTINEL',
    business: 'P15_BUSINESS_VALUE_SENTINEL',
    toolValue: 'P15_TOOL_VALUE_SENTINEL',
    rawEntity: 'P15_RAW_ENTITY_SENTINEL',
    candidateText: 'P15_CANDIDATE_TEXT_SENTINEL',
    prompt: 'P15_PROMPT_SENTINEL',
    response: 'P15_RESPONSE_SENTINEL',
});

async function fetchProjectSpans() {
    const spans = [];
    let cursor = null;
    do {
        const url = new URL('/v1/projects/pump-ai-v5e4-independent-shadow/spans', process.env.PHOENIX_COLLECTOR_ENDPOINT);
        url.searchParams.set('limit', '100');
        if (cursor) url.searchParams.set('cursor', cursor);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Phoenix returned ${response.status}`);
        const page = await response.json();
        spans.push(...(page.data || []));
        cursor = page.next_cursor || null;
    } while (cursor);
    return spans;
}

function traceId(span) { return span?.context?.trace_id || span?.trace_id || null; }
function spanId(span) { return span?.context?.span_id || span?.span_id || null; }

function validateRealCorrelation(spans) {
    let missing = 0;
    let orphan = 0;
    let invalidParent = 0;
    let contamination = 0;
    for (const item of dataset.paths) {
        const root = spans.find(span => span.name === 'pump.ai.v5.shadow'
            && span.attributes?.['pump.ai.v5.shadow_task_id'] === item.shadowTaskId);
        if (!root) { missing += 1; continue; }
        if (root.parent_id) invalidParent += 1;
        const children = spans.filter(span => traceId(span) === traceId(root) && span !== root);
        for (const child of children) {
            if (!child.parent_id) orphan += 1;
            if (child.parent_id !== spanId(root)) invalidParent += 1;
            const taskId = child.attributes?.['pump.ai.v5.shadow_task_id'];
            if (taskId && taskId !== item.shadowTaskId) contamination += 1;
        }
    }
    return { missing, orphan, invalidParent, contamination };
}

(async () => {
    observability.initializeObservability();
    const requestId = `p15-sentinel-${process.pid}`;
    const facts = captureSafeV4ShadowFacts({ requestId }, {
        intent: { mode: 'query' },
        telemetry: { outcome: 'completed', toolSteps: [{ capabilityName: 'search_parts', success: true }] },
        content: SENTINELS.response,
    }, { traceId: 'dddddddddddddddddddddddddddddddd' }, {
        shadowTaskId: `v5-shadow-${requestId}`,
        structural: {
            expectedSuccess: true, intendedCapabilityId: 'inventory.read',
            validatedArgumentsReady: true, stateValid: true,
            entityStatus: 'RESOLVED', verificationStatus: 'VERIFIED',
        },
    });
    const modelRequest = async () => ({
        content: JSON.stringify({
            version: 1, domain: 'catalog', operation: 'read_inventory',
            entityCandidates: [{ entityType: 'part', candidateText: SENTINELS.candidateText }],
            needsClarification: false, reasonCodes: ['INTERPRETATION_COMPLETE'],
            ignoredSecret: SENTINELS.secret,
        }),
        provider: 'test-provider', model: 'test-interpreter', usage: null,
    });
    const mirror = createV5ShadowMirror({
        env: { AI_V5_SHADOW_ENABLED: 'true', AI_V5_SHADOW_SAMPLE_RATE: '1' },
        random: () => 0,
    });
    await mirror.mirror(facts, {
        sourceRequest: `${SENTINELS.prompt} ${SENTINELS.candidateText}`,
        interpreterModelRequest: modelRequest,
    }).completion;
    await observability.safeForceFlush();
    let spans = [];
    let sentinelRoot;
    for (let attempt = 0; attempt < 30 && !sentinelRoot; attempt += 1) {
        spans = await fetchProjectSpans();
        sentinelRoot = spans.find(span => span.name === 'pump.ai.v5.shadow'
            && span.attributes?.['pump.request.id'] === requestId);
        if (!sentinelRoot) await wait(100);
    }
    if (!sentinelRoot) throw new Error('P15 sentinel trace not found');
    const correlation = validateRealCorrelation(spans);
    const serialized = JSON.stringify(spans);
    const leakage = Object.fromEntries(Object.entries(SENTINELS).map(([key, value]) => [
        key, serialized.split(value).length - 1,
    ]));
    const realShadowTaskIds = new Set(dataset.paths.map(item => item.shadowTaskId));
    const interpreterSpans = spans.filter(span => String(span.name || '').startsWith('chat ')
        && realShadowTaskIds.has(span.attributes?.['pump.ai.v5.shadow_task_id']));
    const output = {
        project: 'pump-ai-v5e4-independent-shadow',
        evaluatedTraces: dataset.paths.length,
        correlation,
        interpreterSpanCount: interpreterSpans.length,
        leakage,
        totalLeakage: Object.values(leakage).reduce((sum, value) => sum + value, 0),
        sentinelTraceId: traceId(sentinelRoot),
        sentinelRootSpanId: spanId(sentinelRoot),
    };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    await observability.safeShutdown();
    if (Object.values(correlation).some(value => value !== 0)
        || output.totalLeakage !== 0
        || interpreterSpans.length !== dataset.paths.length) process.exitCode = 1;
})().catch(async error => {
    await observability.safeShutdown();
    process.stderr.write(`${JSON.stringify({ status: 'FAILED', errorType: error?.name || 'Error' })}\n`);
    process.exitCode = 1;
});
