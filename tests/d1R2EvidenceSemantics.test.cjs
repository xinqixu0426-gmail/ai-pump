'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createFactLedger } = require('../api/services/ai-assistant/factLedger.cjs');
const { validateAnswer } = require('../api/services/ai-assistant/answerValidator.cjs');
const { renderClaimableFactsForModel } = require('../scripts/ai-experiments/api-native-agent/apiNativeAgentCandidate.cjs');

function boundRecipe() { return new Map([['recipe:1', { verified: true, canonicalName: 'V750-通用款' }]]); }
function append(ledger, toolName, args, data) {
    return ledger.appendToolResult({ toolName, args, entityBindings: boundRecipe(), result: { success: true, verified: true, data } });
}
function envelope(answer, factIds, status = 'COMPLETED') {
    return JSON.stringify({ answer, claims: factIds.length ? [{ text: answer, factIds }] : [], goals: [{ questionIndex: 0, status, factIds }] });
}
function validate(answer, facts, factIds) {
    return validateAnswer(envelope(answer, factIds), { ledger: { facts }, judge: { questions: ['owner'] } });
}

test('R2-FAIL-01 and R2-14..17: formal costDiff becomes directional recipe-difference evidence without arithmetic', () => {
    const ledger = createFactLedger({ includeRecipeComparisonFacts: true });
    append(ledger, 'compare_recipes', {}, {
        recipe1: { name: 'V750-通用款', cost: 224 }, recipe2: { name: 'V110-通用款', cost: 234 },
        costDiff: '10.00', costBasis: 'currentFullCost', currency: 'CNY',
    });
    const fact = ledger.facts().find(item => item.predicate === 'recipe_cost_difference');
    assert.ok(fact);
    assert.equal(fact.value, 10);
    assert.equal(fact.qualifiers.moneyRole, 'RECIPE_DIFFERENCE');
    assert.deepEqual(fact.qualifiers.participants, { left: { canonicalName: 'V750-通用款' }, right: { canonicalName: 'V110-通用款' } });
    assert.equal(fact.qualifiers.direction, 'RIGHT_MINUS_LEFT');
    assert.equal(fact.value, 10, 'the value is copied from costDiff, not recomputed from 224 and 234');
});

test('R2-01..10: money roles enforce current, scenario, delta, entity, and comparison-pair bindings', () => {
    const facts = [
        { factId: 'F-1', verified: true, entity: { type: 'recipe', canonicalName: 'V750-通用款' }, predicate: 'current_cost', value: 224, unit: 'CNY', qualifiers: { moneyRole: 'CURRENT_FORMAL' } },
        { factId: 'F-2', verified: true, entity: { type: 'recipe', canonicalName: 'V750-通用款' }, predicate: 'scenario_cost', value: 224, unit: 'CNY', qualifiers: { moneyRole: 'CURRENT_BASE', scenarioKey: 'base', role: 'BASE' } },
        { factId: 'F-3', verified: true, entity: { type: 'recipe', canonicalName: 'V750-通用款' }, predicate: 'scenario_cost', value: 242, unit: 'CNY', qualifiers: { moneyRole: 'SCENARIO_CANDIDATE', scenarioKey: 'float', role: 'CANDIDATE', label: '加浮球' } },
        { factId: 'F-4', verified: true, entity: { type: 'recipe', canonicalName: 'V750-通用款' }, predicate: 'scenario_cost_difference', value: 18, unit: 'CNY', qualifiers: { moneyRole: 'SCENARIO_DIFFERENCE', baseScenarioKey: 'base', candidateScenarioKey: 'float', status: 'COMPARABLE' } },
        { factId: 'F-5', verified: true, entity: null, predicate: 'recipe_cost_difference', value: 10, unit: 'CNY', qualifiers: { moneyRole: 'RECIPE_DIFFERENCE', participants: { left: { canonicalName: 'V750-通用款' }, right: { canonicalName: 'V110-通用款' } }, direction: 'RIGHT_MINUS_LEFT' } },
        { factId: 'F-6', verified: true, entity: { type: 'recipe', canonicalName: 'V120-通用款' }, predicate: 'current_cost', value: 10, unit: 'CNY', qualifiers: { moneyRole: 'CURRENT_FORMAL' } },
    ];
    assert.equal(validate('V750-通用款当前成本为224元。', facts, ['F-1']).valid, true);
    assert.equal(validate('V750-通用款当前成本为224元。', facts, ['F-2']).valid, true);
    assert.equal(validate('V750-通用款当前正式配置的临时试算成本为224元。', facts, ['F-2']).valid, true);
    assert.equal(validate('V750-通用款加浮球后成本为242元。', facts, ['F-3']).valid, true);
    assert.equal(validate('V750-通用款当前成本为242元。', facts, ['F-3']).code, 'MONEY_CLAIM_BINDING_MISMATCH');
    assert.equal(validate('V750-通用款加浮球后成本为224元。', facts, ['F-1']).code, 'MONEY_CLAIM_BINDING_MISMATCH');
    assert.equal(validate('V750-通用款加浮球后增加18元。', facts, ['F-4']).valid, true);
    assert.equal(validate('V750-通用款当前成本由224元变为242元，增加18元。', facts, ['F-2', 'F-3', 'F-4']).valid, true);
    assert.equal(validate('V750-通用款加浮球后成本比当前配置高18元。', facts, ['F-4']).valid, true);
    assert.equal(validate('V750-通用款加浮球后增加18元。', facts, ['F-1', 'F-3']).code, 'MONEY_CLAIM_BINDING_MISMATCH');
    assert.equal(validate('V110-通用款比V750-通用款贵10元。', facts, ['F-5']).valid, true);
    const wrongPair = validate('V120-通用款比V750-通用款贵10元。', facts, ['F-5']);
    assert.equal(wrongPair.code, 'MONEY_CLAIM_BINDING_MISMATCH');
    assert.equal(wrongPair.detail.reason, 'WRONG_COMPARISON_PARTICIPANTS');
    assert.equal(validate('V120-通用款当前成本为224元。', facts, ['F-1']).code, 'MONEY_CLAIM_BINDING_MISMATCH');
});

test('R2-11..13 and R2-24..27: negated current wording stays scenario-only and returns safe structured details', () => {
    const facts = [{ factId: 'F-3', verified: true, entity: { type: 'recipe', canonicalName: 'V750-通用款' }, predicate: 'scenario_cost', value: 242, unit: 'CNY', qualifiers: { moneyRole: 'SCENARIO_CANDIDATE', scenarioKey: 'float', role: 'CANDIDATE' } },
        { factId: 'F-4', verified: true, entity: { type: 'recipe', canonicalName: 'V750-通用款' }, predicate: 'scenario_cost_difference', value: 18, unit: 'CNY', qualifiers: { moneyRole: 'SCENARIO_DIFFERENCE', status: 'COMPARABLE' } }];
    assert.equal(validate('V750通用款的242元是临时试算，不是当前正式成本。', facts, ['F-3']).valid, true);
    assert.equal(validate('V750通用款的18元是试算差额，不代表当前正式成本。', facts, ['F-4']).valid, true);
    const invalid = validate('V750通用款的242元是当前正式成本。', facts, ['F-3']);
    assert.equal(invalid.code, 'MONEY_CLAIM_BINDING_MISMATCH');
    assert.equal(invalid.detail.reason, 'WRONG_MONEY_ROLE');
    assert.equal(JSON.stringify(invalid.detail).match(/token|operationId|stack/i), null);
});

test('R2-18..23: Claimable Fact Catalog V2 exposes roles and names but no internal numeric identities', () => {
    const catalog = renderClaimableFactsForModel({ facts: [
        { factId: 'F-1', verified: true, entity: { type: 'recipe', id: 99, canonicalName: 'V750-通用款' }, predicate: 'scenario_cost', value: 242, unit: 'CNY', basis: 'CURRENT_REBUILT_SCENARIO', qualifiers: { moneyRole: 'SCENARIO_CANDIDATE', scenarioKey: 'float', label: '加浮球', role: 'CANDIDATE' }, source: { tool: 'compare_recipe_scenarios' } },
        { factId: 'F-2', verified: true, entity: null, predicate: 'recipe_cost_difference', value: 10, unit: 'CNY', qualifiers: { moneyRole: 'RECIPE_DIFFERENCE', participants: { left: { canonicalName: 'V750-通用款' }, right: { canonicalName: 'V110-通用款' } }, direction: 'RIGHT_MINUS_LEFT' }, source: { tool: 'compare_recipes' } },
        { factId: 'F-3', verified: true, entity: { type: 'recipe', id: 99, canonicalName: 'V750-通用款' }, predicate: 'formal_field:id', value: 99, source: { tool: 'get_recipe_detail' } },
        { factId: 'F-4', verified: true, entity: { type: 'recipe', id: 99, canonicalName: 'V750-通用款' }, predicate: 'formal_field:currentCost.currentTotalCost', value: 242, unit: 'CNY', source: { tool: 'get_recipe_detail' } },
    ] });
    assert.equal(catalog[0].claimType, 'SCENARIO_COST');
    assert.equal(catalog[0].scenario.label, '加浮球');
    assert.deepEqual(catalog[1].participants, { left: { canonicalName: 'V750-通用款' }, right: { canonicalName: 'V110-通用款' } });
    assert.equal(JSON.stringify(catalog).includes('99'), false);
    assert.equal(catalog.some(item => item.factId === 'F-3'), false);
    assert.equal(catalog.some(item => item.factId === 'F-4'), false);
});

test('R2-28..32: formal scenario/difference evidence validates the four closure forms and rejects unsupported no-op deltas', () => {
    const recipeFacts = [{ factId: 'F-1', verified: true, entity: null, predicate: 'recipe_cost_difference', value: 10, unit: 'CNY', qualifiers: { moneyRole: 'RECIPE_DIFFERENCE', participants: { left: { canonicalName: 'V750-通用款' }, right: { canonicalName: 'V110-通用款' } } } }];
    assert.equal(validate('V110-通用款比V750-通用款贵10元。', recipeFacts, ['F-1']).valid, true);
    const scenarioFacts = [
        { factId: 'F-2', verified: true, entity: { type: 'recipe', canonicalName: 'V750-通用款' }, predicate: 'scenario_cost', value: 242, unit: 'CNY', qualifiers: { moneyRole: 'SCENARIO_CANDIDATE', scenarioKey: 'float', role: 'CANDIDATE' } },
        { factId: 'F-3', verified: true, entity: { type: 'recipe', canonicalName: 'V750-通用款' }, predicate: 'scenario_cost_difference', value: 18, unit: 'CNY', qualifiers: { moneyRole: 'SCENARIO_DIFFERENCE', status: 'COMPARABLE' } },
    ];
    assert.equal(validate('V750-通用款加浮球后成本为242元。', scenarioFacts, ['F-2']).valid, true);
    assert.equal(validate('V750-通用款加浮球后增加18元。', scenarioFacts, ['F-3']).valid, true);
    const noOp = createFactLedger({ includeScenarioComparisonFacts: true });
    append(noOp, 'compare_recipe_scenarios', { recipeId: 1 }, { scenarios: [
        { scenarioKey: 'base', role: 'BASE', cost: { currentTotalCost: 224, currency: 'CNY' } },
        { scenarioKey: 'rotor', role: 'CANDIDATE', notApplied: [{ code: 'UNSUPPORTED_OVERRIDE' }], cost: { currentTotalCost: 224, currency: 'CNY' } },
    ], comparisons: [{ baseScenarioKey: 'base', candidateScenarioKey: 'rotor', status: 'OVERRIDE_NOT_APPLIED', delta: 0, currency: 'CNY' }] });
    assert.equal(noOp.facts().some(item => item.qualifiers?.moneyRole === 'SCENARIO_DIFFERENCE'), false);
    assert.equal(noOp.facts().some(item => item.qualifiers?.moneyRole === 'SCENARIO_CANDIDATE'), false);
});

test('R2 finalization accepts one whole-message JSON fence without accepting surrounding prose', () => {
    const facts = [{ factId: 'F-1', verified: true, entity: { type: 'recipe', canonicalName: 'V750-通用款' }, predicate: 'scenario_cost', value: 249, unit: 'CNY', qualifiers: { moneyRole: 'SCENARIO_CANDIDATE' } }];
    const raw = `\`\`\`json\n${envelope('V750-通用款做电泳后成本为249元。', ['F-1'])}\n\`\`\``;
    assert.equal(validateAnswer(raw, { ledger: { facts }, judge: { questions: ['owner'] } }).valid, true);
    assert.equal(validateAnswer(`说明：${raw}`, { ledger: { facts }, judge: { questions: ['owner'] } }).code, 'ANSWER_ENVELOPE_INVALID');
});

test('R2 clarification envelopes may omit claims, while uncited claims expose a safe repair reason', () => {
    const clarification = JSON.stringify({ answer: '请补充具体对象或范围。', claims: [], goals: [{ questionIndex: 0, status: 'CLARIFICATION', factIds: [] }] });
    assert.equal(validateAnswer(clarification, { ledger: { facts: [] }, judge: { questions: ['owner'] } }).valid, true);
    const invalid = validateAnswer(JSON.stringify({ answer: '请补充具体对象或范围。', claims: [{ text: '请补充具体对象或范围。', factIds: [] }], goals: [{ questionIndex: 0, status: 'CLARIFICATION', factIds: [] }] }), { ledger: { facts: [] }, judge: { questions: ['owner'] } });
    assert.equal(invalid.code, 'CLAIM_UNGROUNDED');
    assert.deepEqual(invalid.detail, { claimText: '请补充具体对象或范围。', reason: 'EMPTY_FACT_IDS' });
    const mismatch = validateAnswer(JSON.stringify({ answer: 'V750-通用款当前成本为224元。', claims: [{ text: 'V750-通用款的当前成本为224元。', factIds: ['F-1'] }], goals: [{ questionIndex: 0, status: 'COMPLETED', factIds: ['F-1'] }] }), { ledger: { facts: [{ factId: 'F-1', verified: true, entity: { type: 'recipe', canonicalName: 'V750-通用款' }, predicate: 'current_cost', value: 224, unit: 'CNY' }] }, judge: { questions: ['owner'] } });
    assert.equal(mismatch.code, 'CLAIM_UNGROUNDED');
    assert.equal(mismatch.detail.reason, 'CLAIM_TEXT_NOT_IN_ANSWER');
});
