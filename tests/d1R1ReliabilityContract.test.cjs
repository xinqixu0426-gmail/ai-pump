'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const test = require('node:test');
const { createFactLedger } = require('../api/services/ai-assistant/factLedger.cjs');
const { validateAnswer } = require('../api/services/ai-assistant/answerValidator.cjs');
const {
    MAX_CURRENT_TOOL_RESULT_CHARS,
    businessEvidenceFingerprint,
    candidateToolProjection,
    callKey,
    renderClaimableFactsForModel,
} = require('../scripts/ai-experiments/api-native-agent/apiNativeAgentCandidate.cjs');

test('R1-01..03: the controlled runner uses the isolated formal HTTP fixture and ordinary executor', () => {
    const fixture = fs.readFileSync(require.resolve('../scripts/ai-experiments/api-native-agent/d1r1ControlledFixture.cjs'), 'utf8');
    const runner = fs.readFileSync(require.resolve('../scripts/ai-experiments/api-native-agent/run-d1-r1-controlled.cjs'), 'utf8');
    assert.match(fixture, /startAiHttpRuntime\(\)/);
    assert.match(fixture, /small, exhaustive\* formal catalog/);
    assert.match(runner, /api\/routes\/ai\/executor\.cjs/);
    assert.match(runner, /mockBusinessResults: false/);
    assert.doesNotMatch(fixture, /pump\.db/);
});

test('R1-04..05: a complete formal count survives candidate projection truncation without becoming incomplete', () => {
    const result = {
        success: true, verified: true, agentToolName: 'search_coils',
        data: { totalCount: 14, returnedCount: 14, complete: true, hasMore: false, details: 'x'.repeat(MAX_CURRENT_TOOL_RESULT_CHARS + 200) },
    };
    const projection = candidateToolProjection(result, ['F-001']);
    assert.equal(projection.data.totalCount, 14);
    assert.equal(projection.data.complete, true);
    assert.equal(projection.data.hasMore, false);
    assert.equal(projection.projection.candidateContextTruncated, true);
});

test('R1-06..08: claimable facts are ledger projections, retain provenance, and reduce duplicates', () => {
    const facts = [
        { factId: 'F-001', verified: true, entity: { type: 'recipe', id: 1, canonicalName: 'V750-通用款' }, predicate: 'current_cost', value: 100, unit: 'CNY', basis: 'CURRENT', qualifiers: { scenarioKey: 'base' }, source: { tool: 'get_recipe_detail' } },
        { factId: 'F-002', verified: true, entity: { type: 'recipe', id: 1, canonicalName: 'V750-通用款' }, predicate: 'current_cost', value: 100, unit: 'CNY', basis: 'CURRENT', qualifiers: { scenarioKey: 'base' }, source: { tool: 'get_recipe_detail' } },
    ];
    const catalog = renderClaimableFactsForModel({ facts });
    assert.equal(catalog.length, 1);
    assert.deepEqual(catalog[0], { factId: 'F-001', entity: { type: 'recipe', canonicalName: 'V750-通用款' }, predicate: 'current_cost', value: 100, unit: 'CNY', basis: 'CURRENT', scenario: { scenarioKey: 'base', label: null, role: null }, sourceTool: 'get_recipe_detail' });
    assert.equal(JSON.stringify(catalog).includes('invented'), false);
});

test('R1-11..14: fingerprints ignore trace noise but preserve different business and scenario evidence', () => {
    assert.equal(
        businessEvidenceFingerprint({ data: { value: 1, fetchedAt: 'a', requestId: 'a' } }),
        businessEvidenceFingerprint({ data: { value: 1, fetchedAt: 'b', requestId: 'b' } }),
    );
    assert.notEqual(businessEvidenceFingerprint({ data: { value: 1 } }), businessEvidenceFingerprint({ data: { value: 2 } }));
    assert.notEqual(
        callKey('compare_recipe_scenarios', { scenarios: [{ overrides: { cableLength: 5 } }] }),
        callKey('compare_recipe_scenarios', { scenarios: [{ overrides: { cableLength: 10 } }] }),
    );
});

test('R1-15..16: answer validation still rejects wrong entity and wrong basis money claims', () => {
    const entityFacts = { facts: [
        { factId: 'F-001', verified: true, entity: { type: 'recipe', canonicalName: 'V750-通用款' }, predicate: 'current_cost', value: 100, unit: 'CNY', basis: 'CURRENT' },
    ] };
    const wrongEntity = validateAnswer(JSON.stringify({ answer: 'V110通用款当前成本为100元。', claims: [{ text: 'V110通用款当前成本为100元。', factIds: ['F-001'] }], goals: [{ questionIndex: 0, status: 'COMPLETED', factIds: ['F-001'] }] }), { ledger: entityFacts, judge: { questions: ['x'] } });
    assert.equal(wrongEntity.code, 'MONEY_CLAIM_BINDING_MISMATCH');
    const basisFacts = { facts: [
        { factId: 'F-001', verified: true, entity: { type: 'recipe', canonicalName: 'V750-通用款' }, predicate: 'current_cost', value: 100, unit: 'CNY', basis: 'CURRENT' },
    ] };
    const wrongBasis = validateAnswer(JSON.stringify({ answer: 'V750通用款场景成本为100元。', claims: [{ text: 'V750通用款场景成本为100元。', factIds: ['F-001'] }], goals: [{ questionIndex: 0, status: 'COMPLETED', factIds: ['F-001'] }] }), { ledger: basisFacts, judge: { questions: ['x'] } });
    assert.equal(wrongBasis.code, 'MONEY_CLAIM_BINDING_MISMATCH');
});

test('R1-17..19: control-plane loads remain fact-free, write exposure is absent, and rotor stays unsupported', () => {
    const ledger = createFactLedger();
    const append = ledger.appendToolResult({ toolName: 'load_tools', args: { toolNames: ['search_coils'] }, result: { success: true, controlPlane: true, data: {} } });
    assert.equal(append.factIds.length, 0);
    const candidate = fs.readFileSync(require.resolve('../scripts/ai-experiments/api-native-agent/apiNativeAgentCandidate.cjs'), 'utf8');
    assert.match(candidate, /Never call a write tool/);
    const fixture = fs.readFileSync(require.resolve('../scripts/ai-experiments/api-native-agent/d1r1ControlledFixture.cjs'), 'utf8');
    assert.doesNotMatch(fixture, /rotorProcess/);
});
