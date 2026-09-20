'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BusinessSemanticFrameV1 } = require('../api/business-semantics/contract.cjs');
const { buildBusinessSemanticFrame } = require('../api/business-semantics/frameBuilder.cjs');
const { validateBusinessSemanticFrame } = require('../api/business-semantics/validator.cjs');
const { projectCriticalFailure } = require('../api/business-semantics/answerProjection.cjs');
const { observeBusinessSemanticShadow, clearRecentBusinessSemanticFrames, recentBusinessSemanticFrames } = require('../api/business-semantics/shadowObserver.cjs');
const oracle = require('./fixtures/business-semantic-frame-oracle-v1.json');
const { semanticCaseFixtures, result } = require('./helpers/businessSemanticFrameFixture.cjs');

function at(value, path) { return path.split('.').reduce((current, key) => current?.[key], value); }
function assertOracle(frame, expected) {
    for (const [path, value] of Object.entries(expected.equals || {})) assert.deepEqual(at(frame, path), value, path);
    for (const [path, values] of Object.entries(expected.includes || {})) for (const value of values) assert.ok(at(frame, path).includes(value), `${path} lacks ${value}`);
}

test('BusinessSemanticFrameV1 contract is versioned, bounded, and deeply immutable', () => {
    assert.equal(BusinessSemanticFrameV1.version, 1);
    assert.equal(BusinessSemanticFrameV1.shadowFlag, 'AI_BUSINESS_SEMANTIC_SHADOW_ENABLED');
    assert.equal(Object.isFrozen(BusinessSemanticFrameV1), true);
    assert.equal(Object.isFrozen(BusinessSemanticFrameV1.limits), true);
    assert.ok(BusinessSemanticFrameV1.limits.maxPayloadBytes <= 32 * 1024);
});

test('10/10 BUS-P0 core cases align with the separate BusinessSemanticFrameOracleV1', () => {
    assert.equal(oracle.version, 'BusinessSemanticFrameOracleV1');
    const fixtures = semanticCaseFixtures();
    assert.deepEqual(Object.keys(fixtures), Object.keys(oracle.cases));
    for (const [caseKey, input] of Object.entries(fixtures)) {
        const frame = buildBusinessSemanticFrame({ ...input, stage: 'POST_EVIDENCE' });
        assert.equal(validateBusinessSemanticFrame(frame), true, caseKey);
        assert.equal(Object.isFrozen(frame), true, caseKey);
        assertOracle(frame, oracle.cases[caseKey]);
    }
});

test('pre-evidence frame derives requirements but never fabricates verified facts', () => {
    for (const input of Object.values(semanticCaseFixtures())) {
        const frame = buildBusinessSemanticFrame({ userText: input.userText, stage: 'PRE_EVIDENCE' });
        assert.equal(validateBusinessSemanticFrame(frame), true);
        assert.deepEqual(frame.evidence.verifiedFacts, []);
        assert.equal(frame.subject.canonicalId, null);
    }
});

test('equivalent verified evidence yields an identical frame regardless of tool-result order', () => {
    const input = semanticCaseFixtures()['BU-04'];
    const first = buildBusinessSemanticFrame({ ...input, stage: 'POST_EVIDENCE' });
    const second = buildBusinessSemanticFrame({ ...input, toolResults: input.toolResults.toReversed(), stage: 'POST_EVIDENCE' });
    assert.deepEqual(second, first);
});

test('mutation 1: missing returned official variant cannot preserve complete candidate-set claim', () => {
    const input = structuredClone(semanticCaseFixtures()['BU-02']);
    input.toolResults[0].result.data.pop();
    const frame = buildBusinessSemanticFrame({ ...input, stage: 'POST_EVIDENCE' });
    assert.notEqual(frame.completeness.status, 'COMPLETE');
    assert.notEqual(frame.evidence.facts.find(item => item.factType === 'COIL_OFFICIAL_VARIANT_SET').state, 'VERIFIED');
});

test('mutation 2: coil-cost evidence cannot complete a machine-cost request', () => {
    const input = structuredClone(semanticCaseFixtures()['BU-01']);
    input.toolResults = [result('calculate_coil_cost', { coilId: 2, totalCost: 88 }, '/api/coils/calculate')];
    const frame = buildBusinessSemanticFrame({ ...input, stage: 'POST_EVIDENCE' });
    assert.notEqual(frame.completeness.status, 'COMPLETE');
    assert.ok(frame.evidence.missingFacts.includes('RECIPE_CURRENT_FULL_COST'));
});

test('mutation 3: removing copper evidence keeps hypothetical disclosure and changes evidence', () => {
    const input = structuredClone(semanticCaseFixtures()['BU-04']);
    input.toolResults = input.toolResults.filter(item => item.name !== 'get_copper_price');
    const frame = buildBusinessSemanticFrame({ ...input, stage: 'POST_EVIDENCE' });
    assert.ok(frame.evidence.missingFacts.includes('CURRENT_COPPER_PRICE_BASIS'));
    assert.ok(frame.obligations.requiredDisclosures.includes('DISCLOSE_UNSUPPORTED_HYPOTHETICAL'));
});

test('mutation 4: unverified material and slotType never ground canonical evidence', () => {
    const input = structuredClone(semanticCaseFixtures()['BU-02']);
    input.toolResults = [{ ...input.toolResults[0], result: { ...input.toolResults[0].result,
        executionEvidence: { ...input.toolResults[0].result.executionEvidence, verified: false } } }];
    const frame = buildBusinessSemanticFrame({ ...input, stage: 'POST_EVIDENCE' });
    assert.equal(frame.evidence.verifiedFacts.includes('COIL_OFFICIAL_VARIANT_SET'), false);
    assert.notEqual(frame.completeness.status, 'COMPLETE');
});

test('mutation 5: validator rejects selected identity inside ambiguous override', () => {
    const frame = structuredClone(buildBusinessSemanticFrame({ ...semanticCaseFixtures()['BU-10'], stage: 'POST_EVIDENCE' }));
    frame.override.fields[0].selectedCanonicalId = 4;
    assert.throws(() => validateBusinessSemanticFrame(frame), /AMBIGUOUS_OVERRIDE_SELECTED/);
});

test('mutation 6: validator rejects COMPLETE with missing required evidence', () => {
    const frame = structuredClone(buildBusinessSemanticFrame({ ...semanticCaseFixtures()['BU-01'], stage: 'POST_EVIDENCE' }));
    frame.evidence.facts.find(item => item.factType === 'RECIPE_CURRENT_FULL_COST').state = 'MISSING';
    frame.evidence.verifiedFacts = frame.evidence.verifiedFacts.filter(item => item !== 'RECIPE_CURRENT_FULL_COST');
    frame.evidence.missingFacts = ['RECIPE_CURRENT_FULL_COST'];
    frame.completeness = { status: 'COMPLETE', blockers: [] };
    assert.throws(() => validateBusinessSemanticFrame(frame), /COMPLETE_WITH_MISSING_FACT/);
});

test('the four BUS-P0 critical failure shapes are representable and detectable', () => {
    const fixtures = semanticCaseFixtures();
    const projections = [
        projectCriticalFailure(buildBusinessSemanticFrame({ ...fixtures['BU-07'], toolResults: [], stage: 'POST_EVIDENCE' }), 'False Complete Claim'),
        projectCriticalFailure(buildBusinessSemanticFrame({ ...fixtures['BU-09'], stage: 'POST_EVIDENCE' }), 'Wrong Entity'),
        projectCriticalFailure(buildBusinessSemanticFrame({ ...fixtures['BU-07'], toolResults: [], stage: 'POST_EVIDENCE' }), 'False Complete Claim'),
        projectCriticalFailure(buildBusinessSemanticFrame({ ...fixtures['BU-10'], stage: 'POST_EVIDENCE' }), 'Ungrounded Business Parameter'),
    ];
    assert.equal(projections.filter(item => item.detectedByFrame).length, 4);
});

test('shadow observer performs no provider call or write and records bounded two-stage frames', async () => {
    clearRecentBusinessSemanticFrames();
    let sinkCalls = 0;
    const record = await observeBusinessSemanticShadow({ ...semanticCaseFixtures()['BU-02'], answer: '候选有两套', requestId: 'semantic-test-01' }, {
        observe: value => { sinkCalls += 1; assert.equal(value.semanticProviderCalls, 0); },
    });
    assert.equal(record.exception, null);
    assert.equal(record.semanticProviderCalls, 0);
    assert.equal(record.businessWrites, 0);
    assert.equal(sinkCalls, 1);
    assert.equal(recentBusinessSemanticFrames().length, 1);
    assert.ok(Buffer.byteLength(JSON.stringify(record.postFrame)) <= BusinessSemanticFrameV1.limits.maxPayloadBytes);
});

test('runtime shadow OFF/ON is authoritative-equivalent and adds zero provider calls', async () => {
    const { runAiAssistant } = require('../api/services/aiAssistantRuntime.cjs');
    async function run(flag) {
        let providerCalls = 0;
        const records = [];
        const result = await runAiAssistant({ messages: [{ role: 'user', content: 'V550 的成本' }], requestId: 'semantic-runtime-01',
            env: { AI_BUSINESS_SEMANTIC_SHADOW_ENABLED: flag } }, {
            loadMemory: async () => ({ items: [] }), loadCorrections: () => '',
            fetchAiProvider: async () => { providerCalls += 1; return { json: async () => ({ choices: [{ message: { content: '需要正式成本证据。' } }] }) }; },
            businessSemanticShadow: { record: record => records.push(record) },
        });
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));
        return { result, providerCalls, records };
    }
    const off = await run('false');
    const on = await run('true');
    assert.equal(off.records.length, 0);
    assert.equal(on.records.length, 1);
    assert.equal(off.providerCalls, on.providerCalls);
    assert.equal(on.records[0].semanticProviderCalls, 0);
    assert.equal(on.records[0].businessWrites, 0);
    assert.equal(off.result.finalContent, on.result.finalContent);
    assert.deepEqual(off.result.toolResults, on.result.toolResults);
});
