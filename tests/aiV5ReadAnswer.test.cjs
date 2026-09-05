'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { validateReadAnswer } = require('../api/services/ai-v5/readAnswerValidator.cjs');
const { renderFact } = require('../api/services/ai-v5/readAnswerContract.cjs');
const { composeReadAnswer, answerShadowEnabled } = require('../api/services/ai-v5/readAnswerComposer.cjs');
const { createV5Task, createV5EntityReference } = require('../api/services/ai-v5/contracts.cjs');
const { runReadExecutionShadow } = require('../api/services/ai-v5/readExecutionShadow.cjs');
const env = { AI_V5_SHADOW_ENABLED: 'true', AI_V5_EXECUTION_SHADOW_ENABLED: 'true', AI_V5_ANSWER_SHADOW_ENABLED: 'true' };
function view(key = 'inventory.quantity') { return { taskId: 'fake-task', entityRef: 'e1', entityLabel: 'alpha-/test', forbiddenValues: ['private-binding', 'private-id'],
    facts: [{ factKey: key, value: 19.375, taskId: 'fake-task', entityRef: 'e1', evidenceRef: 'ev1', valid: true, verified: true }] }; }
function draft(v) { const f = v.facts[0]; return { version: 1, answerStatus: 'ANSWERED', answerText: renderFact(v.entityLabel, f.factKey, f.value),
    claims: [{ claimId: 'c1', claimType: 'FACT', factKey: f.factKey, evidenceRefs: [f.evidenceRef], entityRef: v.entityRef, numericValue: f.value }] }; }
for (const k of ['inventory.quantity', 'price.current', 'coil.inventory', 'recipe.cost.preview']) {
    test(`${k}: valid exact grounded fact accepted`, () => { const v = view(k); assert.equal(validateReadAnswer(JSON.stringify(draft(v)), v).status, 'ANSWER_SHADOW_ACCEPTED'); });
}
const mutations = {
    unknownRef: d => { d.claims[0].evidenceRefs = ['other']; }, unknownFact: d => { d.claims[0].factKey = 'unknown'; },
    unrequiredFact: d => { d.claims[0].factKey = 'price.current'; }, wrongNumber: d => { d.claims[0].numericValue = 20; },
    numericString: d => { d.claims[0].numericValue = '19.375'; }, wrongEntity: d => { d.claims[0].entityRef = 'other'; },
    exactPunctuation: d => { d.answerText = d.answerText.replace('alpha-', 'alpha'); },
    canonicalLeak: d => { d.answerText += 'private-id'; }, toolLeak: d => { d.answerText += 'search_parts'; },
    bindingLeak: d => { d.answerText += 'private-binding'; }, extraFact: d => { d.answerText += '已经发货。'; },
    omission: d => { d.answerText = '查询完成。'; }, extraField: d => { d.reasoning = 'hidden'; },
    noFact: d => { d.claims = []; }, duplicateFact: d => { d.claims.push({ ...d.claims[0], claimId: 'c2' }); },
};
for (const [name, mutate] of Object.entries(mutations)) test(`${name} rejected`, () => { const v = view(), d = draft(v); mutate(d); assert.equal(validateReadAnswer(JSON.stringify(d), v).status, 'ANSWER_SHADOW_REJECTED'); });
for (const [name, mutate] of Object.entries({ crossTask: f => { f.taskId = 'other'; }, wrongEntity: f => { f.entityRef = 'other'; }, unverified: f => { f.verified = false; }, invalid: f => { f.valid = false; } })) {
    test(`evidence ${name} rejected`, () => { const v = view(), d = draft(v); mutate(v.facts[0]); assert.equal(validateReadAnswer(JSON.stringify(d), v).status, 'ANSWER_SHADOW_REJECTED'); });
}
test('invalid JSON and final-cost overstatement rejected', () => {
    assert.equal(validateReadAnswer('invalid', view()).contractValid, false);
    const v = view('recipe.cost.preview'), d = draft(v); d.answerText = d.answerText.replace('当前成本预览', '最终结算成本');
    assert.equal(validateReadAnswer(JSON.stringify(d), v).status, 'ANSWER_SHADOW_REJECTED');
});
async function input(id = 'fake-task') {
    const entity = createV5EntityReference({ entityType: 'part', rawMention: 'alpha-/test', canonicalEntityId: '123', resolutionReceiptRef: id + ':entity' });
    const execution = await runReadExecutionShadow({ task: createV5Task({ taskId: id, createdAt: new Date().toISOString(), entityContext: [entity] }),
        capabilityId: 'inventory.read', routeInput: { domain: 'catalog', operation: 'read_inventory', entityType: 'part' } }, { env,
        execute: async () => ({ success: true, truncated: false, count: 1, parts: [{ id: '123', stock: 19.375 }],
            executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/parts' }] } }) });
    return { execution, taskId: id, entity, userRequest: 'synthetic request', requiredFactKeys: ['inventory.quantity'] };
}
function fake(messages) {
    const v = JSON.parse(messages[1].content);
    return { content: JSON.stringify({ version: 1, answerStatus: 'ANSWERED', answerText: v.facts.map(f => f.realization).join('\n'),
        claims: v.facts.map((f, i) => ({ claimId: 'c' + (i + 1), claimType: 'FACT', factKey: f.factKey, numericValue: f.numericValue, evidenceRefs: [f.evidenceRef], entityRef: v.entityRef })) }) };
}
test('default off, every flag required, verification prerequisite prevents calls', async () => {
    assert.equal(answerShadowEnabled({}), false);
    for (const key of Object.keys(env)) { assert.equal(answerShadowEnabled({ ...env, [key]: 'false' }), false); }
    let calls = 0; const i = await input();
    assert.equal((await composeReadAnswer(i, { env: {}, modelRequest: () => { calls++; } })).modelCalls, 0);
    assert.equal((await composeReadAnswer({ ...i, execution: { ...i.execution, verificationStatus: 'FAIL' } }, { env, modelRequest: () => { calls++; } })).modelCalls, 0);
    assert.equal(calls, 0);
});
test('fake model correctness and hallucinations validated once; no returned text/value', async () => {
    const i = await input();
    for (const mode of ['correct', 'numeric', 'extra', 'entity', 'omit']) {
        let count = 0;
        const out = await composeReadAnswer(i, { env, modelRequest: async messages => {
            count++; const r = fake(messages), d = JSON.parse(r.content);
            if (mode === 'numeric') d.claims[0].numericValue++;
            if (mode === 'extra') d.answerText += '另有产品缺货。';
            if (mode === 'entity') d.claims[0].entityRef = 'other';
            if (mode === 'omit') d.answerText = '完成';
            return { content: JSON.stringify(d) };
        } });
        assert.equal(count, 1); assert.equal(out.status, mode === 'correct' ? 'ANSWER_SHADOW_ACCEPTED' : 'ANSWER_SHADOW_REJECTED');
        for (const secret of ['19.375', 'alpha-/test', 'synthetic request']) assert.equal(JSON.stringify(out).includes(secret), false);
    }
});
test('model error and timeout reject without retry or error-content leakage', async () => {
    const i = await input();
    for (const modelRequest of [() => { throw Error('private-value'); }, () => new Promise(() => {})]) {
        const out = await composeReadAnswer(i, { env, timeoutMs: 5, modelRequest });
        assert.equal(out.status, 'ANSWER_SHADOW_REJECTED'); assert.equal(out.modelCalls, 1); assert.equal(JSON.stringify(out).includes('private-value'), false);
    }
});
test('ten concurrent answer tasks reject crossed evidence and preserve request isolation', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, async (_, n) => {
        const i = await input('fake-' + n);
        const ok = await composeReadAnswer(i, { env, modelRequest: async m => fake(m) });
        const bad = await composeReadAnswer({ ...i, taskId: 'other' }, { env, modelRequest: () => { throw Error('must not call'); } });
        assert.equal(bad.modelCalls, 0); return ok;
    }));
    assert.ok(results.every(r => r.status === 'ANSWER_SHADOW_ACCEPTED'));
});
module.exports = { fake };
