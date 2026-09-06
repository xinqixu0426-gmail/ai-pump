'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyCandidateRisk, normalizeCandidateRisk } = require('../api/services/candidateRiskEnvelope.cjs');
const { domainPlannerPrompt } = require('../api/services/aiGoalPlannerV3.cjs');
const read = () => ({ goal: 'synthetic read', mode: 'query', domains: ['catalog'], needsBusinessData: true,
    contextMode: 'current_turn', answerShape: 'direct', entityScope: 'single', requiresClarification: false,
    ambiguities: [], confidence: 'high' });

test('Candidate risk reuses the V4 prompt and admits explicit read modes only', async () => {
    for (const mode of ['query', 'analysis']) assert.equal(normalizeCandidateRisk({ ...read(), mode }).eligible, true);
    for (const patch of [{ mode: 'command' }, { mode: 'conversation' }, { confidence: 'low' },
        { contextMode: 'previous_turn' }, { needsBusinessData: false },
        { requiresClarification: true, ambiguities: ['synthetic ambiguity'] }]) {
        assert.equal((await classifyCandidateRisk('synthetic', { request: async () => ({ ...read(), ...patch }) })).eligible, false);
    }
    const result = await classifyCandidateRisk('synthetic', { request: async messages => {
        assert.equal(messages[0].content, domainPlannerPrompt(null, null, null));
        assert.equal(messages.length, 3);
        return read();
    } });
    assert.equal(result.eligible, true);
    assert.equal(Object.hasOwn(result, 'steps'), false);
    assert.equal(Object.hasOwn(result, 'toolSteps'), false);
    assert.equal(Object.hasOwn(result, 'goal'), false);
});

test('Candidate classifier errors, timeout, invalid and unknown modes stop before all V5 work', async () => {
    const { runCandidateRead } = require('../api/services/ai-v5/candidateRead.cjs');
    const env = { PUMP_V5_CANDIDATE_RUNTIME: 'true', AI_V5_READ_CANARY_ENABLED: 'true', AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED: 'true' };
    for (let repeat = 0; repeat < 3; repeat++) {
    for (const request of [async () => { throw Error('RISK_UNAVAILABLE'); }, async () => { throw Error('synthetic'); }, () => new Promise(() => {}),
        async () => ({}), async () => ({ ...read(), mode: 'unknown' }), async () => ({ ...read(), mode: 'command' }),
        async () => ({ ...read(), toolSteps: [] }), async () => null]) {
        const counts = { interpreter: 0, resolver: 0, tool: 0, answer: 0, body: 0 };
        const result = await runCandidateRead({ previewOptIn: true, internalAuthorized: true,
            sourceRequest: 'synthetic', factKey: 'inventory.quantity', deliver() { counts.body++; } }, {
            env, riskOptions: { request, timeoutMs: 10 },
            interpret() { counts.interpreter++; throw Error('UNREACHABLE'); },
            lookupEntities() { counts.resolver++; throw Error('UNREACHABLE'); },
            executionOptions: { execute() { counts.tool++; throw Error('UNREACHABLE'); } },
            answerOptions: { modelRequest() { counts.answer++; throw Error('UNREACHABLE'); } },
        });
        assert.equal(result.attempted, false);
        assert.equal(result.eligible, false);
        assert.equal(result.delivered, false);
        assert.equal(result.riskOutcomeClass, result.risk.contractValid ? 'RISK_NOT_ELIGIBLE' : 'SAFE_AVAILABILITY_FALLBACK');
        assert.equal(result.safeAvailabilityFallback, !result.risk.contractValid);
        assert.deepEqual(counts, { interpreter: 0, resolver: 0, tool: 0, answer: 0, body: 0 });
    }
    }
});

test('real risk transport exposes no tools and performs one classification call only', async () => {
    const previous = global.fetch;
    let calls = 0;
    global.fetch = async (_url, init) => {
        calls++;
        const payload = JSON.parse(init.body);
        assert.equal(Object.hasOwn(payload, 'tools'), false);
        assert.equal(Object.hasOwn(payload, 'tool_choice'), false);
        assert.equal(Object.hasOwn(payload, 'temperature'), false); // existing V4 provider default
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(read()) } }] }), { status: 200 });
    };
    try {
        const result = await classifyCandidateRisk('synthetic', { env: { AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'synthetic-only' } });
        assert.equal(result.eligible, true);
        assert.equal(calls, 1);
    } finally { global.fetch = previous; }
});
