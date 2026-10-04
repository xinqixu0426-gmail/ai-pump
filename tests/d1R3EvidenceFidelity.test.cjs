'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createFactLedger, modelProjection } = require('../api/services/ai-assistant/factLedger.cjs');
const { runApiNativeAgentCandidate, renderClaimableFactsForModel } = require('../scripts/ai-experiments/api-native-agent/apiNativeAgentCandidate.cjs');
const { validateAnswer } = require('../api/services/ai-assistant/answerValidator.cjs');

function toolCall(id, name, args) { return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } }; }
function scripted(responses) {
    let index = 0;
    return async () => {
        const response = responses[index++];
        if (!response) throw new Error('UNEXPECTED_MODEL_CALL');
        return response;
    };
}
function input(overrides = {}) {
    return { rawOwnerInput: '请查正式数据', businessMemo: 'business', policyMemo: 'policy', ...overrides };
}

test('R3-A: a formal search_coils directory cost remains per-record claimable evidence without promoting pricing parameters', () => {
    const ledger = createFactLedger({ includeCoilDirectoryCostFacts: true });
    ledger.appendToolResult({ toolName: 'search_coils', args: { spec: '12', sheets: 120 }, result: { success: true, verified: true, data: {
        data: [
            { id: 1, schemeCode: '12-120-A', schemeName: '12-120-A', pricingMode: 'kit', cost: 66, unitPrice: 0, kitPrice: 66 },
            { id: 2, schemeCode: '12-120-B', schemeName: '12-120-B', pricingMode: 'kit', cost: 66, unitPrice: 0, kitPrice: 66 },
            { id: 3, schemeCode: '12-120-C', pricingMode: 'kit', cost: null, unitPrice: 70 },
        ],
    } } });
    const costFacts = ledger.facts().filter(fact => fact.predicate === 'coil_directory_cost');
    assert.deepEqual(costFacts.map(fact => [fact.entity.canonicalName, fact.value, fact.basis, fact.qualifiers.pricingMode]), [
        ['12-120-A', 66, 'FORMAL_COIL_DIRECTORY_COST', 'kit'],
        ['12-120-B', 66, 'FORMAL_COIL_DIRECTORY_COST', 'kit'],
    ]);
    assert.equal(costFacts.every(fact => fact.qualifiers.moneyRole === 'CURRENT_FORMAL'), true);
    assert.equal(ledger.facts().some(fact => fact.predicate === 'coil_directory_cost' && fact.value === 70), false);
    const catalog = renderClaimableFactsForModel(ledger.snapshot());
    assert.equal(catalog.filter(item => item.predicate === 'coil_directory_cost').length, 2);
    assert.equal(JSON.stringify(catalog).includes('"id":1'), false);
    assert.equal(JSON.stringify(catalog).includes('unitPrice'), false);
});

test('R3-A: projection keeps formal completeness separate from an intentionally shortened model view', () => {
    const projected = modelProjection({ success: true, verified: true, data: { count: 2, queryReceipt: { totalCount: 2, returnedCount: 2, truncated: false }, data: Array.from({ length: 101 }, (_, id) => ({ id, schemeCode: `C-${id}` })) } }, ['F-001']);
    assert.equal(projected.data.queryReceipt.totalCount, 2);
    assert.equal(projected.projection.truncated, true);
    assert.equal(projected.projection.collections.some(item => item.totalCount === 101 && item.complete === false), true);
});

test('R3-A: an authoritative calculate_coil_cost total is claimable, while an arbitrary totalCost remains untyped', () => {
    const calculation = createFactLedger();
    calculation.appendToolResult({ toolName: 'calculate_coil_cost', args: {}, result: { success: true, verified: true, data: { totalCost: 76, pricingMode: 'kit' } } });
    const cost = calculation.facts().find(fact => fact.predicate === 'total_cost');
    assert.equal(cost.qualifiers.moneyRole, 'CURRENT_FORMAL');
    assert.equal(cost.basis, 'FORMAL_COIL_COST_CALCULATION');
    const unrelated = createFactLedger();
    unrelated.appendToolResult({ toolName: 'get_recipe_detail', args: {}, result: { success: true, verified: true, data: { totalCost: 76 } } });
    assert.equal(unrelated.facts().find(fact => fact.predicate === 'total_cost').qualifiers, undefined);
});

test('R3-B: declared-relevant coverage precedes one bounded completion review without duplicating business calls', async () => {
    const model = scripted([
        { content: '', tool_calls: [toolCall('load', 'load_tools', { toolNames: ['get_all_recipes', 'search_coils'] })] },
        { content: '', tool_calls: [toolCall('recipes', 'get_all_recipes', {})] },
        { content: JSON.stringify({ answer: '已确认对象。', claims: [{ text: '已确认对象。', factIds: ['F-001'] }], goals: [{ questionIndex: 0, status: 'COMPLETED', factIds: ['F-001'] }] }) },
        { content: '', tool_calls: [toolCall('coils', 'search_coils', { spec: '12', sheets: 120 })] },
        // The relevant-tool coverage gate consumes the first no-tool response
        // before the historical bounded completion review is reached.
        { content: JSON.stringify({ answer: '已完成正式查询。', claims: [{ text: '已完成正式查询。', factIds: ['F-001'] }], goals: [{ questionIndex: 0, status: 'COMPLETED', factIds: ['F-001'] }] }) },
        { content: JSON.stringify({ answer: '已完成正式查询。', claims: [{ text: '已完成正式查询。', factIds: ['F-001'] }], goals: [{ questionIndex: 0, status: 'COMPLETED', factIds: ['F-001'] }] }) },
        { content: JSON.stringify({ answer: '已完成正式查询。', claims: [{ text: '已完成正式查询。', factIds: ['F-001'] }], goals: [{ questionIndex: 0, status: 'COMPLETED', factIds: ['F-001'] }] }) },
    ]);
    const result = await runApiNativeAgentCandidate(input(), { modelCall: model, executeToolCall: async name => ({ success: true, verified: true, executionEvidence: { verified: true }, data: name === 'search_coils' ? { data: [] } : [] }) });
    assert.equal(result.metrics.completionReviewCalls, 1);
    assert.equal(result.metrics.completionReviewResumed, 0);
    assert.equal(result.metrics.relevantCoverageReviewResumed, 1);
    assert.equal(result.metrics.businessToolCalls, 2);
    assert.equal(result.answerValidation.valid, true);
});

test('R3-B: a completed investigation gets at most one review and does not create an extra business call', async () => {
    const model = scripted([
        { content: JSON.stringify({ answer: '请补充具体对象。', claims: [], goals: [{ questionIndex: 0, status: 'CLARIFICATION', factIds: [] }] }) },
        { content: JSON.stringify({ answer: '请补充具体对象。', claims: [], goals: [{ questionIndex: 0, status: 'CLARIFICATION', factIds: [] }] }) },
        { content: JSON.stringify({ answer: '请补充具体对象。', claims: [], goals: [{ questionIndex: 0, status: 'CLARIFICATION', factIds: [] }] }) },
    ]);
    const result = await runApiNativeAgentCandidate(input(), { modelCall: model });
    assert.equal(result.metrics.completionReviewCalls, 1);
    assert.equal(result.metrics.businessToolCalls, 0);
    assert.equal(result.answerValidation.valid, true);
});

test('R3-C/D: a completed status without both coil costs is not a completed business outcome', () => {
    const facts = [
        { factId: 'F-1', verified: true, entity: { type: 'coil', canonicalName: '12-120-A' }, predicate: 'coil_directory_cost', value: 66, unit: 'CNY', basis: 'FORMAL_COIL_DIRECTORY_COST', qualifiers: { moneyRole: 'CURRENT_FORMAL' } },
    ];
    const answer = { answer: '12-120-A成本为66元。', claims: [{ text: '12-120-A成本为66元。', factIds: ['F-1'] }], goals: [{ questionIndex: 0, status: 'COMPLETED', factIds: ['F-1'] }] };
    const cited = new Set([...answer.claims, ...answer.goals].flatMap(item => item.factIds));
    const expected = new Set(['12-120-A', '12-130-A']);
    const outcome = [...expected].every(name => facts.some(fact => cited.has(fact.factId) && fact.entity?.canonicalName === name));
    assert.equal(outcome, false);
});

test('R3-C: a scenario delta with one entity and two scenario labels does not require recipe comparison participants', () => {
    const raw = JSON.stringify({ answer: '电缆5米+木箱相比当前正式配置，V750-通用款成本增加48元。', claims: [{ text: '电缆5米+木箱相比当前正式配置，V750-通用款成本增加48元。', factIds: ['F-1'] }], goals: [{ questionIndex: 0, status: 'COMPLETED', factIds: ['F-1'] }] });
    const result = validateAnswer(raw, { ledger: { facts: [{ factId: 'F-1', verified: true, entity: { type: 'recipe', canonicalName: 'V750-通用款' }, predicate: 'scenario_cost_difference', value: 48, unit: 'CNY', qualifiers: { moneyRole: 'SCENARIO_DIFFERENCE', baseScenarioKey: 'base', candidateScenarioKey: 'cable5_wooden', status: 'COMPARABLE' } }] }, judge: { questions: ['owner'] } });
    assert.equal(result.valid, true);
});
