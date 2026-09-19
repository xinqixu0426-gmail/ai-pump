const test = require('node:test');
const assert = require('node:assert/strict');
const {
    enforceBusinessRules,
    copperBaseFromResults,
} = require('../api/services/aiBusinessRulebook.cjs');

const coilSearchResult = {
    name: 'search_coils',
    result: {
        success: true,
        data: [{ id: 2, spec: '12', sheets: 140, material: '钢带', slotType: '小眼', schemeCode: 'COIL-0002', copperBase: 110.18, cost: 116.99 }],
    },
};
const machinePreviewResult = {
    name: 'build_recipe_bom_draft',
    result: {
        success: true,
        data: { parts: [{ model: 'V750' }], costPreview: { currentTotalCost: 285.8, partsCost: 264.8, laborCost: 21 } },
    },
};

test('规矩册：问整机成本但本轮只有线圈金额时必须说明口径', () => {
    const outcome = enforceBusinessRules({
        answer: '12-140 钢带小眼的当前成本是 116.99 元。',
        userText: 'V550 配方的成本是多少',
        toolResults: [coilSearchResult],
    });
    assert.deepEqual(outcome.applied, ['BR-COST-BASIS']);
    assert.match(outcome.answer, /116\.99 元。/);
    assert.match(outcome.answer, /口径说明：上面的金额是\*\*线圈方案成本\*\*/);
    assert.match(outcome.answer, /整机（成品）成本要按在售配方为基准重新核算/);
});

test('规矩册：已经有整机级正式金额、或回答已标明线圈口径时不补', () => {
    assert.deepEqual(enforceBusinessRules({
        answer: '整机当前总成本 285.80 元。',
        userText: 'V550 配方换成 12-140 的成本',
        toolResults: [machinePreviewResult],
    }).applied, []);
    assert.deepEqual(enforceBusinessRules({
        answer: '这是线圈方案成本：12-140 钢带小眼 116.99 元；整机成本需要按配方重算。',
        userText: 'V550 配方的成本是多少',
        toolResults: [coilSearchResult],
    }).applied, []);
    // 本来就不是整机问题（单纯问线圈规格）时不补。
    assert.deepEqual(enforceBusinessRules({
        answer: '12-140 的当前成本是 116.99 元。',
        userText: '12-140 的成本',
        toolResults: [coilSearchResult],
    }).applied, []);
});

test('规矩册：假设铜价必须说明口径，并带出本轮正式铜基价', () => {
    const outcome = enforceBusinessRules({
        answer: 'V550 的当前完整成本是 268.00 元。',
        userText: '如果按照铜价95算，V550的成本是多少',
        toolResults: [coilSearchResult, {
            name: 'preview_recipe_cost',
            result: { success: true, data: { recipeId: 12, currentTotalCost: 268, partsCost: 247, laborCost: 21 } },
        }],
    });
    assert.deepEqual(outcome.applied, ['BR-HYPOTHETICAL-PRICE']);
    assert.match(outcome.answer, /按系统当前正式铜基价 110\.18 元\/千克核算/);
    assert.match(outcome.answer, /\*\*不是\*\*按你假设的价格算出来的/);
    assert.match(outcome.answer, /整机级成本也不支持假设铜价/);
});

test('规矩册：回答已说明铜价口径、或没有金额、或问题不含假设价格时不补', () => {
    const answerWithBasis = '按当日铜基价 110.18 元/千克核算，V550 成本 268.00 元。';
    assert.deepEqual(enforceBusinessRules({
        answer: answerWithBasis,
        userText: '如果按照铜价95算，V550的成本是多少',
        toolResults: [coilSearchResult],
    }).applied, []);
    assert.deepEqual(enforceBusinessRules({
        answer: '我需要先确认你要算哪一个配方。',
        userText: '如果按照铜价95算，V550的成本是多少',
        toolResults: [],
    }).applied, []);
    assert.deepEqual(enforceBusinessRules({
        answer: 'V550 当前成本 268.00 元。',
        userText: 'V550 的成本是多少',
        toolResults: [coilSearchResult],
    }).applied, []);
});

test('规矩册：铜基价取自本轮正式结果，缺失时不编造', () => {
    assert.equal(copperBaseFromResults([coilSearchResult]), 110.18);
    assert.equal(copperBaseFromResults([{ name: 'search_coils', result: { success: true, data: [{ id: 1 }] } }]), null);
    const outcome = enforceBusinessRules({
        answer: '成本 268.00 元。',
        userText: '按铜价 95 算 V550 成本',
        toolResults: [{ name: 'preview_recipe_cost', result: { success: true, data: { currentTotalCost: 268 } } }],
    });
    assert.match(outcome.answer, /按系统当前的正式铜基价核算/);
    assert.doesNotMatch(outcome.answer, /\d+\.\d+ 元\/千克/);
});

test('规矩册：空回答不产生任何补充', () => {
    assert.deepEqual(enforceBusinessRules({ answer: '', userText: 'V550 配方的成本', toolResults: [coilSearchResult] }).applied, []);
});
