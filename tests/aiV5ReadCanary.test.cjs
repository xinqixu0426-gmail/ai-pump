'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { runReadCanary, previewAfterLegacy } = require('../api/services/ai-v5/readCanary.cjs');
const { composeReadAnswerForCanary, composeReadAnswer } = require('../api/services/ai-v5/readAnswerComposer.cjs');
const { createV5Task, createV5EntityReference } = require('../api/services/ai-v5/contracts.cjs');
const { runReadExecutionShadow } = require('../api/services/ai-v5/readExecutionShadow.cjs');
const env = { AI_V5_READ_CANARY_ENABLED: 'true', AI_V5_SHADOW_ENABLED: 'true', AI_V5_EXECUTION_SHADOW_ENABLED: 'true', AI_V5_ANSWER_SHADOW_ENABLED: 'true', INTERNAL_SECRET: 'synthetic-only' };
function fake(messages) {
    const v = JSON.parse(messages[1].content);
    return { content: JSON.stringify({ version: 1, answerStatus: 'ANSWERED', answerText: v.facts.map(f => f.realization).join('\n'),
        claims: v.facts.map((f, i) => ({ claimId: 'c' + (i + 1), claimType: 'FACT', factKey: f.factKey, numericValue: f.numericValue, evidenceRefs: [f.evidenceRef], entityRef: v.entityRef })) }) };
}
function result(id = '123') { return { success: true, truncated: false, count: 1, parts: [{ id, stock: 19.375 }],
    executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/parts' }] } }; }
function interpreted() { return { status: 'VALID', interpretation: { domain: 'catalog', operation: 'read_inventory', needsClarification: false,
    entityCandidates: [{ entityType: 'part', candidateText: 'synthetic-/part' }] }, resolvedIdentity: { entityType: 'part', canonicalId: '123' },
    architectureMetadata: { complete: true, finalEntityStatus: 'FINAL_ENTITY_RESOLVED' } }; }
const legacyResult = () => ({ intent: { mode: 'query' }, telemetry: { outcome: 'completed', toolSteps: [{ capabilityName: 'search_parts', success: true }] } });
const legacyFacts = { allowWrite: false, requestMode: 'query', finalV4Status: 'completed', toolSteps: [{ toolName: 'search_parts' }] };
async function input(id = 'synthetic-task') {
    const entity = createV5EntityReference({ entityType: 'part', rawMention: 'synthetic-/part', canonicalEntityId: '123', resolutionReceiptRef: id + ':entity' });
    const execution = await runReadExecutionShadow({ task: createV5Task({ taskId: id, createdAt: new Date().toISOString(), entityContext: [entity] }),
        capabilityId: 'inventory.read', routeInput: { domain: 'catalog', operation: 'read_inventory', entityType: 'part' } }, { env, execute: async () => result() });
    return { execution, taskId: id, entity, userRequest: 'synthetic request', requiredFactKeys: ['inventory.quantity'] };
}
function options(extra = {}) { return { env, interpret: async () => interpreted(), executionOptions: { execute: async (tool, args, ctx) => {
    assert.equal(tool, 'search_parts'); assert.equal(ctx.allowWrite, false); return result(); } }, answerOptions: { modelRequest: async m => fake(m) }, ...extra }; }

test('delivery only after every validator; default return never includes content', async () => {
    const i = await input();
    const mutations = { valid: () => {}, contract: d => { d.extra = true; }, evidence: d => { d.claims[0].evidenceRefs = ['wrong']; },
        missing: d => { d.claims = []; }, numeric: d => { d.claims[0].numericValue++; }, entity: d => { d.claims[0].entityRef = 'wrong'; },
        unsupported: d => { d.answerText += 'invented'; } };
    for (const [name, change] of Object.entries(mutations)) {
        let calls = 0, deliveries = 0;
        const out = await composeReadAnswerForCanary(i, { env, previewOptIn: true, internalAuthorized: true, modelRequest: async m => {
            calls++; const d = JSON.parse(fake(m).content); change(d); return { content: JSON.stringify(d) }; } }, body => {
            deliveries++; assert.equal(typeof body, 'string'); assert.equal(body.includes('claims'), false);
        });
        assert.equal(calls, 1); assert.equal(deliveries, name === 'valid' ? 1 : 0);
        assert.equal(JSON.stringify(out).includes('19.375'), false); assert.equal(Object.hasOwn(out, 'answerText'), false);
    }
    const out = await composeReadAnswer(i, { env, modelRequest: fake });
    assert.equal(out.status, 'ANSWER_SHADOW_ACCEPTED'); assert.equal(JSON.stringify(out).includes('synthetic-/part'), false);
});
test('all delivery gates, missing evidence and cancellation suppress body/model', async () => {
    const i = await input(); const controller = new AbortController(); controller.abort();
    for (const change of [{ env: {} }, { previewOptIn: false }, { internalAuthorized: false }, { signal: controller.signal }]) {
        const out = await composeReadAnswerForCanary(i, { env, previewOptIn: true, internalAuthorized: true, modelRequest: () => assert.fail('model'), ...change }, () => assert.fail('body'));
        assert.equal(out.modelCalls, 0);
    }
    const out = await composeReadAnswerForCanary({ ...i, taskId: 'cross-task' }, { env, previewOptIn: true, internalAuthorized: true, modelRequest: () => assert.fail('model') }, () => assert.fail('body'));
    assert.equal(out.modelCalls, 0);
});
test('double gate combinations never interpret or execute when absent', async () => {
    for (const [global, optIn] of [[false, false], [false, true], [true, false]]) {
        const out = await runReadCanary({ previewOptIn: optIn, internalAuthorized: true }, { env: { AI_V5_READ_CANARY_ENABLED: String(global) }, interpret: () => assert.fail('interpret') });
        assert.equal(out.attempted, false); assert.equal(out.exposed, false);
    }
});
test('write and unknown fact boundaries fail closed without calls', async () => {
    for (const change of [{ legacyFacts: { ...legacyFacts, requestMode: 'command', allowWrite: true } }, { factKey: 'write.stock' }]) {
        const out = await runReadCanary({ previewOptIn: true, internalAuthorized: true, legacyFacts, factKey: 'inventory.quantity', deliver: () => assert.fail('body'), ...change }, options({ interpret: () => assert.fail('interpret') }));
        assert.equal(out.attempted, false); assert.equal(out.exposed, false);
    }
});
test('ten concurrent canaries preserve invocation scope and expose body only in sink', async () => {
    const outputs = await Promise.all(Array.from({ length: 10 }, async (_, n) => {
        let delivered = 0;
        const label = 'synthetic-part-' + n, id = String(200 + n), stock = 10.25 + n;
        const out = await runReadCanary({ previewOptIn: true, internalAuthorized: true, sourceRequest: 'synthetic request', factKey: 'inventory.quantity', legacyFacts,
            deliver: body => { delivered++; assert.equal(body, require('../api/services/ai-v5/readAnswerContract.cjs').renderFact(label, 'inventory.quantity', stock)); return true; } }, options({
            interpret: async () => { const i = interpreted(); i.resolvedIdentity.canonicalId = id; i.interpretation.entityCandidates[0].candidateText = label; return i; },
            executionOptions: { execute: async (_tool, args, ctx) => { assert.equal(args.keyword, label); assert.equal(ctx.allowWrite, false);
                return { ...result(id), parts: [{ id, stock }] }; } },
        }));
        assert.equal(delivered, 1, JSON.stringify(out)); assert.equal(out.exposed, true); assert.equal(out.toolCalls, 1);
        assert.equal(JSON.stringify(out).includes('19.375'), false); return out;
    }));
    assert.equal(outputs.length, 10);
});

async function chat(change = {}, canaryOptions = {}) {
    const { handleAiChat } = require('../api/routes/ai/chat.cjs');
    const req = Object.assign(new EventEmitter(), { headers: { 'x-internal-secret': env.INTERNAL_SECRET, 'x-pump-v5-preview': 'true', 'x-pump-v5-fact': 'inventory.quantity' },
        body: { messages: [{ role: 'user', content: 'synthetic request' }] } }, change);
    const events = [], headers = {}; let outcome = null;
    const res = Object.assign(new EventEmitter(), { setHeader(k,v) { headers[k] = v; }, flushHeaders() {}, write(s) {
        if (s.startsWith('data: ')) events.push(JSON.parse(s.slice(6))); return true; }, end() { this.writableEnded = true; } });
    await handleAiChat(req, res, { env: change.env || env, telemetry: { record() {} }, canaryOptions: options({ ...canaryOptions, onOutcome: o => { outcome = o; } }), runAiDispatcherV3: async ({ emit }) => {
        emit('content', { content: 'legacy synthetic answer' }); emit('done', {}); return legacyResult(); } });
    return { events, headers, outcome };
}
test('actual chat boundary preserves legacy content/done and appends only internal preview', async () => {
    const on = await chat();
    assert.deepEqual(on.events.slice(0, 2), [{ type: 'content', content: 'legacy synthetic answer' }, { type: 'done' }]);
    assert.equal(on.events[2]?.type, 'v5_preview'); assert.equal(on.events[2].authoritative, false); assert.equal(on.headers['Cache-Control'], 'no-store');
    for (const change of [{ env: {} }, { headers: {} }, { headers: { 'x-pump-v5-preview': 'true' } }, { headers: { 'x-internal-secret': env.INTERNAL_SECRET } }]) {
        const off = await chat(change, { interpret: () => assert.fail('interpret') });
        assert.deepEqual(off.events, on.events.slice(0, 2)); assert.equal(off.headers['Cache-Control'], 'no-cache');
    }
});
test('chat model error/timeout, contract, numeric, entity and evidence failures preserve legacy', async () => {
    for (const mode of ['error', 'timeout', 'contract', 'numeric', 'entity', 'evidence']) {
        let calls = 0;
        const opts = { answerOptions: { timeoutMs: 5, modelRequest: async m => {
            calls++; if (mode === 'error') throw Error('private-value'); if (mode === 'timeout') return new Promise(() => {});
            const d = JSON.parse(fake(m).content); if (mode === 'contract') d.extra = 1;
            if (mode === 'numeric') d.claims[0].numericValue++; if (mode === 'entity') d.claims[0].entityRef = 'wrong';
            return { content: JSON.stringify(d) }; } } };
        if (mode === 'evidence') opts.executionOptions = { execute: async () => ({ ...result(), executionEvidence: { verified: false } }) };
        const out = await chat({}, opts);
        assert.deepEqual(out.events, [{ type: 'content', content: 'legacy synthetic answer' }, { type: 'done' }]);
        assert.equal(calls, mode === 'evidence' ? 0 : 1);
        assert.equal(out.outcome.exposed, false); assert.equal(out.outcome.delivered, false);
        assert.notEqual(out.outcome.failureClass, 'NONE');
        for (const forbidden of ['private-value', '19.375', 'answerText', 'synthetic-/part']) assert.equal(JSON.stringify(out.outcome).includes(forbidden), false);
    }
});
module.exports = { fake, interpreted, legacyResult };
test('validation exception and request cancellation never deliver a body', async () => {
    const i = await input(), obs = require('../api/services/observability.cjs'), original = obs.withReadAnswerValidationSpan;
    let calls = 0, deliveries = 0;
    try {
        obs.withReadAnswerValidationSpan = () => { throw Error('private-validation-detail'); };
        const out = await composeReadAnswerForCanary(i, { env, previewOptIn: true, internalAuthorized: true,
            modelRequest: m => { calls++; return fake(m); } }, () => { deliveries++; });
        assert.equal(out.status, 'ANSWER_SHADOW_REJECTED'); assert.equal(JSON.stringify(out).includes('private-validation-detail'), false);
    } finally { obs.withReadAnswerValidationSpan = original; }
    const controller = new AbortController();
    await composeReadAnswerForCanary(i, { env, previewOptIn: true, internalAuthorized: true, signal: controller.signal,
        modelRequest: m => { calls++; controller.abort(); return fake(m); } }, () => { deliveries++; });
    assert.equal(calls, 2); assert.equal(deliveries, 0);
});
test('a finalized mutation route cannot execute even after legacy eligibility', async () => {
    const out = await runReadCanary({ previewOptIn: true, internalAuthorized: true, legacyFacts, factKey: 'inventory.quantity',
        sourceRequest: 'synthetic mutation', deliver: () => assert.fail('body') }, options({ interpret: async () => {
        const i = interpreted(); i.interpretation.operation = 'update'; return i;
    }, executionOptions: { execute: () => assert.fail('write') } }));
    assert.equal(out.exposed, false); assert.equal(out.failureClass, 'READ_SCOPE_EXCLUDED');
});
