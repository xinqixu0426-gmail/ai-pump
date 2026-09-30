'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createFactLedger } = require('../api/services/ai-assistant/factLedger.cjs');
const { SAFE_VALIDATION_ANSWER, validateAnswer } = require('../api/services/ai-assistant/answerValidator.cjs');
const { runAiAssistant } = require('../api/services/ai-assistant/runtime.cjs');

function addProfitFacts() {
    const ledger = createFactLedger();
    const bindings = new Map([['recipe:12', { verified: true, canonicalName: 'V550' }]]);
    const appended = ledger.appendToolResult({
        toolName: 'preview_profitability', args: { recipeId: 12 }, entityBindings: bindings,
        result: { success: true, verified: true, capabilityId: 'cost.recipe.profitability_preview', data: {
            costBasis: 'CURRENT_REBUILT', unitCost: 288.76, unitPrice: 360,
            grossProfitPerUnit: 71.24, grossMarginOnSales: 0.1979,
        } },
    });
    return { ledger: ledger.snapshot(), factIds: appended.factIds };
}

test('Fact Ledger is request-scoped, append-only, and projects verified formal cost facts with provenance', () => {
    const { ledger, factIds } = addProfitFacts();
    assert.ok(factIds.length >= 5);
    const cost = ledger.facts.find(fact => fact.predicate === 'unit_cost');
    assert.deepEqual(cost, {
        factId: cost.factId,
        entity: { type: 'recipe', id: 12, canonicalName: 'V550' },
        predicate: 'unit_cost', value: 288.76, unit: 'CNY', basis: 'CURRENT_REBUILT',
        authority: 'FORMAL_API', capabilityId: 'cost.recipe.profitability_preview', verified: true,
        source: { tool: 'preview_profitability' },
    });
    assert.equal(ledger.observations[0].factIds.includes(cost.factId), true);
});

test('failed tool observations never become formal negative facts, while formal resolver ambiguity and not-found do', () => {
    const ledger = createFactLedger();
    ledger.appendToolResult({ toolName: 'get_order_detail', result: { success: false, verified: false, code: 'FORMAL_TOOL_FAILED' } });
    ledger.appendToolResult({ toolName: 'resolve_entity', result: { success: false, verified: false, data: {
        status: 'AMBIGUOUS', entityType: 'coil', mention: '18-90', candidates: [{ canonicalId: '1' }, { canonicalId: '2' }], source: 'formal',
    } } });
    ledger.appendToolResult({ toolName: 'resolve_entity', result: { success: false, verified: false, data: {
        status: 'NOT_FOUND', entityType: 'part', mention: '不存在零件', candidates: [], source: 'formal',
    } } });
    const snapshot = ledger.snapshot();
    assert.deepEqual(snapshot.facts.map(fact => fact.predicate), ['identity_ambiguous', 'identity_not_found']);
    assert.equal(snapshot.observations[0].technicalFailure, true);
});

test('Answer Validator requires claim references, formal money parity, and one status for every Judge goal', () => {
    const { ledger, factIds } = addProfitFacts();
    const good = validateAnswer(JSON.stringify({
        answer: 'V550 当前正式成本为 ¥288.76；按售价 ¥360，单台毛利为 ¥71.24，毛利率约 19.79%。',
        claims: [{ text: 'V550 当前正式成本为 ¥288.76；按售价 ¥360，单台毛利为 ¥71.24，毛利率约 19.79%。', factIds }],
        goals: [{ questionIndex: 0, status: 'COMPLETED', factIds }],
    }), { ledger, judge: { questions: ['成本和毛利'] }, mode: 'ANALYZE' });
    assert.equal(good.valid, true);

    const wrongMoney = validateAnswer(JSON.stringify({
        answer: 'V550 当前正式成本为 ¥250。', claims: [{ text: 'V550 当前正式成本为 ¥250。', factIds }],
        goals: [{ questionIndex: 0, status: 'COMPLETED', factIds }],
    }), { ledger, judge: { questions: ['成本'] }, mode: 'READ' });
    assert.equal(wrongMoney.valid, false); assert.equal(wrongMoney.code, 'MONEY_CLAIM_UNGROUNDED');

    const missingGoal = validateAnswer(JSON.stringify({
        answer: '已完成。', claims: [{ text: '已完成。', factIds }], goals: [{ questionIndex: 0, status: 'COMPLETED', factIds }],
    }), { ledger, judge: { questions: ['第一项', '第二项'] }, mode: 'READ' });
    assert.equal(missingGoal.code, 'GOAL_STATUS_MISSING');
});

test('multi-goal answer maps each completed investigation to verified formal facts without promoting attachment context', () => {
    const ledger = createFactLedger();
    const cost = ledger.appendToolResult({ toolName: 'preview_recipe_cost', result: { success: true, verified: true, data: { unitCost: 268.49, costBasis: 'CURRENT_REBUILT' } } }).factIds;
    const inventory = ledger.appendToolResult({ toolName: 'search_coils', result: { success: true, verified: true, data: [{ spec: '12', sheets: 120, stock: 42 }] } }).factIds;
    const snapshot = ledger.snapshot();
    const answer = 'V550 当前正式成本为 ¥268.49；12-120 当前正式库存为 42。';
    const result = validateAnswer(JSON.stringify({
        answer,
        claims: [{ text: 'V550 当前正式成本为 ¥268.49', factIds: cost }, { text: '12-120 当前正式库存为 42。', factIds: inventory }],
        goals: [{ questionIndex: 0, status: 'COMPLETED', factIds: cost }, { questionIndex: 1, status: 'COMPLETED', factIds: inventory }],
    }), { ledger: snapshot, judge: { questions: ['V550成本', '12-120库存'] }, mode: 'READ' });
    assert.equal(result.valid, true);
    assert.equal(snapshot.facts.some(fact => fact.source.tool === 'attachment_context'), false);
});

test('runtime fails closed after a formal business failure instead of treating failure as completion', async () => {
    const judge = { mode: 'READ', goal: '查询配方成本', questions: ['V550 成本'], constraints: [], persistentMutation: false, needsClarification: false, clarificationReason: null, appliedPolicyIds: [], domains: ['recipe', 'cost'] };
    let round = 0;
    const result = await runAiAssistant({ userMessage: 'V550成本多少？' }, {
        judgeModelCall: async () => ({ choices: [{ message: { content: JSON.stringify(judge) } }] }),
        mainModelCall: async _messages => {
            round += 1;
            if (round === 1) return { choices: [{ message: { content: null, tool_calls: [{ id: 'r', type: 'function', function: { name: 'resolve_entity', arguments: JSON.stringify({ entityType: 'recipe', mention: 'V550' }) } }] } }] };
            if (round === 2) return { choices: [{ message: { content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'preview_recipe_cost', arguments: JSON.stringify({ recipeId: 12 }) } }] } }] };
            return { choices: [{ message: { content: JSON.stringify({ answer: '成本约 ¥200。', claims: [], goals: [{ questionIndex: 0, status: 'COMPLETED', factIds: [] }] }) } }] };
        },
        resolveAgentEntity: async () => ({ entityType: 'recipe', mention: 'V550', status: 'RESOLVED', canonicalId: '12', canonicalName: 'V550', candidates: [], source: 'formal', verified: true }),
        executeToolCall: async () => ({ success: false, code: 'DOWN' }),
    });
    assert.equal(result.answer, SAFE_VALIDATION_ANSWER);
    assert.equal(result.answerValidation.valid, false);
    assert.equal(result.toolResults.at(-1).success, false);
    assert.deepEqual(result.goalStatuses, [{ questionIndex: 0, status: 'UNAVAILABLE', factIds: [] }]);
});

test('invalid model claim returns only a bounded verified-safe answer and preserves explicit non-write failure', async () => {
    const ledger = createFactLedger();
    const fact = ledger.appendToolResult({ toolName: 'preview_recipe_cost', result: { success: true, verified: true, data: { unitCost: 100 } } }).factIds;
    const result = validateAnswer(JSON.stringify({
        answer: '成本为 ¥999。', claims: [{ text: '成本为 ¥999。', factIds: fact }], goals: [{ questionIndex: 0, status: 'COMPLETED', factIds: fact }],
    }), { ledger: ledger.snapshot(), judge: { questions: ['成本'] }, mode: 'READ' });
    assert.equal(result.answer, SAFE_VALIDATION_ANSWER);
    assert.equal(result.valid, false);
});
