'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { getV5TaskClass, taskClassModelView } = require('../api/services/ai-v5/taskClassCatalog.cjs');
const { REQUIRED_FACT_SCOPES, deriveRequiredFactKey, assertRequiredFactHeader } = require('../api/services/ai-v5/requiredFactScope.cjs');
const { runCandidateRead } = require('../api/services/ai-v5/candidateRead.cjs');
const env = { PUMP_V5_CANDIDATE_RUNTIME: 'true', AI_V5_READ_CANARY_ENABLED: 'true', AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED: 'true' };
const risk = mode => ({ goal: 'synthetic', mode, domains: ['catalog'], needsBusinessData: true,
    contextMode: 'current_turn', answerShape: 'direct', entityScope: 'single', requiresClarification: false, ambiguities: [], confidence: 'high' });
function interpreted(ref) {
    const scope = REQUIRED_FACT_SCOPES[ref];
    return { status: 'VALID', taskClassRef: ref, resolvedIdentity: { entityType: scope.entityType, canonicalId: 'fixture-id' },
        interpretation: { domain: scope.domain, operation: scope.operation, needsClarification: false,
            entityCandidates: [{ entityType: scope.entityType, candidateText: 'SYNTH-/ENTITY' }] },
        architectureMetadata: { complete: true, finalEntityStatus: 'FINAL_ENTITY_RESOLVED' } };
}
test('four closed semantic mappings require full matching interpretation identity', () => {
    for (const [ref, scope] of Object.entries(REQUIRED_FACT_SCOPES)) {
        const value = interpreted(ref);
        assert.equal(deriveRequiredFactKey(value), scope.factKey);
        for (const mutate of [v => { v.taskClassRef = 'tc_003'; }, v => { v.status = 'INVALID'; },
            v => { v.interpretation.operation = 'maintain'; }, v => { v.resolvedIdentity.entityType = 'global'; }]) {
            const bad = structuredClone(value); mutate(bad); assert.equal(deriveRequiredFactKey(bad), null);
        }
        assert.equal(assertRequiredFactHeader(scope.factKey, undefined), 'ABSENT');
        assert.equal(assertRequiredFactHeader(scope.factKey, scope.factKey), 'MATCH');
        for (const header of ['', null, 'unknown', ...Object.values(REQUIRED_FACT_SCOPES).map(s => s.factKey).filter(f => f !== scope.factKey)])
            assert.equal(assertRequiredFactHeader(scope.factKey, header), 'MISMATCH');
    }
});
test('distinct semantic identities share the frozen routing tuple but not required facts', () => {
    const price = getV5TaskClass('tc_028'), quantity = getV5TaskClass('tc_002');
    assert.equal(price.semanticId, 'part.price.read'); assert.equal(quantity.semanticId, 'part.inventory.read');
    assert.equal(price.semanticOperation, 'read_price'); assert.equal(quantity.semanticOperation, 'read_inventory');
    for (const k of ['domain', 'operation', 'entityTypes', 'entitySlots']) assert.deepEqual(price[k], quantity[k]);
    assert.notEqual(price.primaryMeaning, quantity.primaryMeaning);
    assert.ok(taskClassModelView().find(c => c.classRef === price.classRef).localAlternatives.some(c => c.classRef === quantity.classRef));
});
test('header absence and equality use server scope; mismatch never executes or composes', async () => {
    for (const ref of ['tc_002', 'tc_028']) for (const assertion of [undefined, REQUIRED_FACT_SCOPES[ref].factKey, 'coil.inventory']) {
        let tools = 0, answers = 0;
        const out = await runCandidateRead({ previewOptIn: true, internalAuthorized: true, sourceRequest: 'synthetic',
            factKey: assertion, deliver: () => true }, { env, riskOptions: { request: async () => risk('query') },
            interpret: async () => interpreted(ref), executionOptions: { execute: async () => { tools++;
                return { success: true, truncated: false, count: 1, parts: [{ id: 'fixture-id', stock: 19.375, price: 7.25, updatedAt: '2026-01-01T00:00:00Z' }],
                    executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/parts' }] } };
            }, readPriceReference: async () => [{ id: 'fixture-id', price: 7.25, updatedAt: '2026-01-01T00:00:00Z' }] },
            answerOptions: { modelRequest: async messages => { answers++; const v = JSON.parse(messages[1].content);
                return { content: JSON.stringify({ version: 1, answerStatus: 'ANSWERED', answerText: v.facts.map(f => f.realization).join('\n'),
                    claims: v.facts.map((f, i) => ({ claimId: 'c' + (i + 1), claimType: 'FACT', factKey: f.factKey,
                        numericValue: f.numericValue, evidenceRefs: [f.evidenceRef], entityRef: v.entityRef })) }) }; } } });
        assert.equal(out.derivedFactKey, REQUIRED_FACT_SCOPES[ref].factKey);
        if (assertion === 'coil.inventory') { assert.equal(out.failureClass, 'FACT_ASSERTION_MISMATCH'); assert.equal(tools, 0); assert.equal(answers, 0); }
        else { assert.equal(out.eligible, true); assert.equal(tools, 1); assert.equal(answers, 1); assert.equal(out.validationPass, true); }
    }
});
test('write risk stops before Interpreter, derivation, Tool and Answer without a fact header', async () => {
    const out = await runCandidateRead({ previewOptIn: true, internalAuthorized: true, sourceRequest: 'synthetic', deliver: () => assert.fail() },
        { env, riskOptions: { request: async () => risk('command') }, interpret: () => assert.fail('Interpreter reached'),
            executionOptions: { execute: () => assert.fail('Tool reached') }, answerOptions: { modelRequest: () => assert.fail('Answer reached') } });
    assert.equal(out.factDerivationCalls, 0); assert.equal(out.attempted, false); assert.equal(out.delivered, false);
});
