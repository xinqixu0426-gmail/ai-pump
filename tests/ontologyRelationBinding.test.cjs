'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bindRelation } = require('../api/ontology/relationBinder.cjs');
const { validateBinding } = require('../api/ontology/bindingContract.cjs');
const { currentFactsForBinding } = require('../api/ontology/bindingCurrentFacts.cjs');
const { rows, toolFor, positives, negatives } = require('./helpers/ontologyBindingCorpus.cjs');
const { observeShadow } = require('../api/ontology/runtimeShadow.cjs');
const { recipeDetail, formal } = require('./helpers/ontologyShadowFixture.cjs');
const bind = (userText, verifiedToolResults = Object.keys(rows).map(t => toolFor(t)), extra = {}) => bindRelation({ ontologyVersion: 1, userText, verifiedToolResults, ...extra });
for (const [relationId, type, ...questions] of positives) for (const question of questions) {
    test(`P4 directional positive ${relationId}: ${question}`, () => {
        const result = bind(question);
        assert.equal(result.status, 'BOUND', JSON.stringify(result));
        assert.equal(result.relationId, relationId);
        assert.deepEqual(result.root, { entityType: type, canonicalId: String(rows[type].id) });
        assert.ok(Object.isFrozen(result)); assert.equal(result.shadowEligible, true);
    });
}
for (const question of negatives) test(`P4 negative must never bind: ${question}`, () => {
    assert.notEqual(bind(question).status, 'BOUND');
});
test('P4 exact canonical receipt/resolver reuse; fuzzy receipt rejected; no discovery calls', () => {
    const r = { version: 3, kind: 'entity_resolution', entityType: 'recipe', status: 'exact',
        originalMention: '配方甲', selected: { id: 301, name: '配方甲', matchKind: 'exact' }, sourceCapability: 'get_all_recipes',
        sourceEvidence: [{ executionEvidence: formal('/api/recipes', {}).executionEvidence }] };
    const q = '配方甲使用哪个线圈？';
    assert.equal(bind(q, [], { canonicalReceipts: [r] }).bindingSource[0], 'canonical_receipt');
    assert.equal(bind(q, [], { resolverReceipts: [r] }).bindingSource[0], 'unique_exact_resolver_receipt');
    assert.notEqual(bind(q, [], { resolverReceipts: [{ ...r, status: 'unique_candidate' }] }).status, 'BOUND');
    assert.notEqual(bind(q, [], { canonicalReceipts: [{ ...r, sourceEvidence: [] }] }).status, 'BOUND');
    assert.notEqual(bind(q, [], { canonicalReceipts: [{ ...r,
        sourceEvidence: [{ executionEvidence: formal('/api/parts', {}).executionEvidence }] }] }).status, 'BOUND');
});
test('P4 contradictory identities, duplicate names and multiple roots reject instead of selecting first', () => {
    const r = toolFor('recipe', [rows.recipe, { ...rows.recipe, id: 302 }]);
    assert.equal(bind('Shadow配方甲使用哪个线圈？', [r]).status, 'AMBIGUOUS_ROOT');
    assert.equal(bind('Shadow配方甲使用哪个模板；Shadow配方甲使用哪个线圈？').status, 'AMBIGUOUS_RELATION');
    assert.equal(bind('配方ID 301使用哪些零件；配方ID 302使用哪些零件？').status, 'AMBIGUOUS_ROOT');
    const stale = toolFor('recipe', [{ ...rows.recipe, deletedAt: '2026-09-18' }]);
    assert.notEqual(bind('Shadow配方甲使用哪个线圈？', [stale]).status, 'BOUND');
    const wrongPath = recipeDetail(); wrongPath.result.executionEvidence.calls[0].path = '/api/recipes/302';
    assert.notEqual(bind('Shadow配方甲用了哪些零件？', [wrongPath]).status, 'BOUND');
});
test('P4 pronouns require same verified session/owner/type/TTL and reject two possible objects', () => {
    const trustedSession = { subject: 'owner', conversationId: 'chat', observedAt: Date.now(), toolResults: [toolFor('part')] };
    const extra = { subject: 'owner', conversationId: 'chat', trustedSession };
    assert.equal(bind('这个零件用在哪些配方？', [], extra).relationId, 'part.contained_in_recipe');
    assert.equal(bind('它用在哪些配方？', [], extra).relationId, 'part.contained_in_recipe');
    assert.notEqual(bind('这个零件用在哪些配方？', [], { ...extra, subject: 'other' }).status, 'BOUND');
    assert.notEqual(bind('这个零件用在哪些配方？', [], { ...extra, trustedSession: { ...trustedSession, observedAt: 0 } }).status, 'BOUND');
    assert.equal(bind('这个零件用在哪些配方？', [], { ...extra, trustedSession: { ...trustedSession,
        toolResults: [toolFor('part', [rows.part, { id: 602, model: '另一个零件' }])] } }).status, 'AMBIGUOUS_ROOT');
    assert.equal(bind('它用在哪些配方？', [], { ...extra, trustedSession: { ...trustedSession,
        toolResults: [toolFor('part'), toolFor('coil')] } }).status, 'AMBIGUOUS_ROOT');
});
test('P4 partial/candidate-only/unverified sources cannot establish a unique named canonical root', () => {
    const partial = toolFor('part'); partial.result.queryReceipt = { truncated: true };
    assert.notEqual(bind('Shadow零件甲用在哪些配方？', [partial]).status, 'BOUND');
    assert.equal(bind('零件ID 601用在哪些配方？', [partial]).status, 'BOUND');
    const unverified = toolFor('part'); unverified.result.executionEvidence.verified = false;
    assert.notEqual(bind('Shadow零件甲用在哪些配方？', [unverified]).status, 'BOUND');
    const candidates = toolFor('part'); candidates.result.success = false; candidates.result.candidates = candidates.result.parts;
    assert.notEqual(bind('Shadow零件甲用在哪些配方？', [candidates]).status, 'BOUND');
    assert.notEqual(bind('Shadow零件甲用在哪些配方？', [toolFor('part', [rows.part, { model: rows.part.model }])]).status, 'BOUND');
});
test('P4 frozen P3 retains all 30 cases and both prior failures/metrics without editing questions', () => {
    const frozen = require('./fixtures/ontology-p3-frozen-v1.json');
    const original = require('./helpers/ontologyShadowFixture.cjs').realCorpus;
    assert.equal(frozen.runs.flatMap(r => r.cases).length, 30);
    assert.equal(frozen.runs.flatMap(r => r.cases).filter(c => c.eligible).length, 14);
    assert.equal(frozen.runs.flatMap(r => r.cases).filter(c => ['MATCH', 'MISMATCH'].includes(c.status)).length, 12);
    for (const run of frozen.runs) for (const c of run.cases) assert.equal(c.question, original.find(p => p[0] === c.caseId)[1]);
    assert.equal(frozen.fullHistoricalToolReceiptsAvailable, false);
});
test('P4 current canonical facts follow bound direction; missing current data is not a verified empty', () => {
    const tools = Object.keys(rows).map(t => toolFor(t));
    const b = bind('Shadow配方甲使用哪个模板？', tools);
    const c = currentFactsForBinding(b, tools);
    assert.equal(c.complete, true); assert.deepEqual(c.canonicalTargetIds, ['401']);
    const unknown = currentFactsForBinding(b, [toolFor('recipe', [{ id: 301, name: 'Shadow配方甲' }])]);
    assert.equal(unknown.complete, false); assert.equal(unknown.canonical, false);
    const inverse = currentFactsForBinding(bind('Shadow模板甲被哪些配方使用？', tools), tools);
    assert.equal(inverse.complete, true); assert.deepEqual(inverse.canonicalTargetIds, ['301']);
});
test('P4 validation rejects forged direction/root/status; metadata never proves an edge', () => {
    const b = structuredClone(bind('Shadow配方甲使用哪个模板？'));
    assert.throws(() => validateBinding({ ...b, root: { entityType: 'part', canonicalId: '601' } }));
    assert.throws(() => validateBinding({ ...b, status: 'NOT_ELIGIBLE' }));
    assert.throws(() => validateBinding({ ...b, probability: 1 }));
    assert.throws(() => validateBinding({ ...b, root: { ...b.root, displayName: 'SECRET' } }));
    assert.equal(bind('配方ID 301使用哪个模板？', []).status, 'INSUFFICIENT_CONTEXT');
});
test('P4 OFF preserves P3; ON adds binding while retaining P3 complete comparison; binder sink fails open', async () => {
    const toolResults = [recipeDetail()], before = JSON.stringify(toolResults);
    const input = { userText: 'Shadow配方甲使用哪个模板？', toolResults };
    let bindingCalls = 0;
    const resolve = async c => ({ success: true, status: 'RESOLVED', relationId: c.relationId, root: c.root,
        resultEntityType: 'part', complete: true, hasMore: false, items: [{ entityType: 'part', canonicalId: '601' }] });
    const off = await observeShadow(input, { resolve, recordBinding: () => { bindingCalls++; } });
    assert.equal(bindingCalls, 0);
    const on = await observeShadow({ ...input, bindingEnabled: true }, { resolve, recordBinding: () => { bindingCalls++; throw Error('sink failed'); } });
    assert.equal(bindingCalls, 1); assert.equal(off.comparison.status, on.comparison.status);
    assert.equal(off.relationId, on.relationId); assert.equal(JSON.stringify(toolResults), before);
});
