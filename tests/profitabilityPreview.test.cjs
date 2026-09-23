'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateProfitability, createProfitabilityPreview, normalizeProfitabilityPreviewRequest } = require('../api/services/profitabilityPreview.cjs');

function scenario(cost = { complete: true, currentTotalCost: 200, costBasis: 'CURRENT_REBUILT_BASE' }) {
    return { version: 1, preview: true, recipe: { entityType: 'recipe', entityId: '12', displayName: 'V550', updatedAt: null, recordHash: 'a'.repeat(64), schemeCode: null }, readSetId: '11111111-1111-4111-8111-111111111111', readSetHash: 'b'.repeat(64), normalizedInput: { version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [{ scenarioKey: 'candidate', label: '候选', overrides: {} }] }, scenarios: [{ scenarioKey: 'base', configurationHash: 'base-hash', role: 'BASE', label: '当前', cost }, { scenarioKey: 'candidate', configurationHash: 'candidate-hash', role: 'CANDIDATE', label: '候选', cost: { ...cost, costBasis: 'CURRENT_REBUILT_SCENARIO' } }] };
}
function request(overrides = {}) { return { version: 1, basisRef: { kind: 'SCENARIO_COMPARISON', recipeId: 12, comparisonInput: { version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [{ scenarioKey: 'candidate', label: '候选', overrides: {} }] }, scenarioKey: 'base' }, unitPrice: 250, quantity: null, currency: 'CNY', ...overrides }; }

test('盈利纯算术遵守毛利率和成本加价率的不同分母', () => {
    assert.deepEqual(calculateProfitability({ unitCost: 200, unitPrice: 250, quantity: 300 }), {
        unitCost: 200, unitPrice: 250, grossProfitPerUnit: 50, grossMarginOnSales: 0.2, markupOnCost: 0.25, quantity: 300, totalCost: 60000, totalRevenue: 75000, totalGrossProfit: 15000, costComplete: true, currency: 'CNY', warnings: ['NET_PROFIT_NOT_CALCULATED'],
    });
    const negative = calculateProfitability({ unitCost: 350, unitPrice: 340, quantity: null });
    assert.equal(negative.grossProfitPerUnit, -10); assert.ok(negative.grossMarginOnSales < 0); assert.ok(negative.markupOnCost < 0);
    const zeroPrice = calculateProfitability({ unitCost: 200, unitPrice: 0, quantity: null });
    assert.equal(zeroPrice.grossMarginOnSales, null); assert.equal(zeroPrice.markupOnCost, -1); assert.ok(zeroPrice.warnings.includes('GROSS_MARGIN_DENOMINATOR_ZERO'));
    const zeroCost = calculateProfitability({ unitCost: 0, unitPrice: 340, quantity: null });
    assert.equal(zeroCost.grossMarginOnSales, 1); assert.equal(zeroCost.markupOnCost, null); assert.ok(zeroCost.warnings.includes('MARKUP_DENOMINATOR_ZERO'));
    const both = calculateProfitability({ unitCost: 0, unitPrice: 0, quantity: null });
    assert.equal(both.grossMarginOnSales, null); assert.equal(both.markupOnCost, null);
});

test('正式盈利 preview 重新运行情景比较，不接收客户端成本或历史 margin', () => {
    let calls = 0; const service = createProfitabilityPreview({ scenarioComparison: { compare(recipeId, input) { calls += 1; assert.equal(recipeId, 12); assert.equal(input.baselinePolicy, 'CURRENT_REBUILT'); return scenario(); } } });
    const result = service.preview(request({ quantity: 300 }));
    assert.equal(calls, 1); assert.equal(result.unitCost, 200); assert.equal(result.grossProfitPerUnit, 50); assert.equal(result.readSetHash, 'b'.repeat(64)); assert.equal(result.totalGrossProfit, 15000); assert.equal(result.costBasis, 'CURRENT_REBUILT_BASE'); assert.equal(result.configurationHash, 'base-hash');
    for (const field of ['unitCost', 'grossProfit', 'margin', 'markup', 'currentTotalCost']) assert.throws(() => service.preview({ ...request(), [field]: 1 }), /未知字段/);
    assert.throws(() => service.preview(request({ currency: 'USD' })), /CNY/);
    assert.throws(() => service.preview(request({ quantity: 0 })), /quantity/);
    assert.throws(() => service.preview(request({ basisRef: { ...request().basisRef, scenarioKey: 'absent' } })), /scenarioKey/);
});

test('成本不完整时盈利字段保持 null，不把 partial cost 当作利润', () => {
    const service = createProfitabilityPreview({ scenarioComparison: { compare() { return scenario({ complete: false, currentTotalCost: null, partialTotalCost: 100, costBasis: 'CURRENT_REBUILT_BASE' }); } } });
    const result = service.preview(request({ quantity: 300 }));
    assert.equal(result.costComplete, false); assert.equal(result.unitCost, null); assert.equal(result.grossProfitPerUnit, null); assert.equal(result.grossMarginOnSales, null); assert.equal(result.markupOnCost, null); assert.equal(result.totalCost, null); assert.equal(result.totalGrossProfit, null); assert.equal(result.totalRevenue, 75000); assert.ok(result.warnings.includes('COST_INCOMPLETE'));
});

test('请求合同严格拒绝非法版本、客户端事实和未知字段', () => {
    assert.deepEqual(normalizeProfitabilityPreviewRequest(request()).currency, 'CNY');
    assert.throws(() => normalizeProfitabilityPreviewRequest({ ...request(), version: 2 }), /version/);
    assert.throws(() => normalizeProfitabilityPreviewRequest({ ...request(), grossMargin: 0.2 }), /未知字段/);
    assert.throws(() => normalizeProfitabilityPreviewRequest({ ...request(), unitPrice: Infinity }), /unitPrice/);
});
