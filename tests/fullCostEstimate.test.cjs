const test = require('node:test');
const assert = require('node:assert/strict');
const {
    parseStatorInput,
    resolveWireFromCoils,
    calculateFullEstimateCoilCost,
    buildFullEstimateResult,
} = require('../api/services/fullCostEstimate.cjs');

const coils = [
    {
        spec: '750',
        material: '钢带',
        sheets: 24,
        unitPrice: 0.2,
        wireWeight: 0.3,
        copperBase: 60,
        coilFee: 2,
        rotorFee: 1,
        cost: 25.8,
        defaultWireGauge: '0.55',
    },
    {
        spec: '750',
        material: '钢带',
        sheets: 30,
        unitPrice: 0.2,
        wireWeight: 0.3,
        copperBase: 60,
        coilFee: 2,
        rotorFee: 1,
        cost: 27,
        defaultWireGauge: '0.6',
    },
];

test('full-estimate 线圈服务解析 stator 字符串', () => {
    assert.deepEqual(parseStatorInput('750-24'), { statorSpec: '750', statorSheets: '24' });
    assert.deepEqual(parseStatorInput(''), { statorSpec: null, statorSheets: null });
});

test('full-estimate 线圈服务优先精确匹配', () => {
    const result = calculateFullEstimateCoilCost(coils, '750', 24, '钢带');

    assert.equal(result.cost, '25.80');
    assert.equal(result.source, '精确匹配');
    assert.equal(result.wireGauge, '0.55');
});

test('full-estimate 线圈服务未精确匹配时复用线圈插值规则', () => {
    const result = calculateFullEstimateCoilCost(coils, '750', 26, '钢带');

    assert.equal(result.cost, '26.20');
    assert.equal(result.source, '插值(24片↔30片, ratio=0.333)');
    assert.equal(result.formula, '0.2×26 + 0.3×60 + 2.00 + 1.00');
});

test('full-estimate 精确套件价保留正式库存身份且不展开计算', () => {
    const result = calculateFullEstimateCoilCost([{
        id: 71,
        spec: '750',
        material: '钢带',
        slotType: '小眼',
        sheets: 36,
        schemeStatus: 'official',
        pricingMode: 'kit',
        kitPrice: 58.5,
        wireWeight: 0.72,
        copperBase: 78.4,
    }], '750', 36, '钢带', '小眼');

    assert.equal(result.cost, '58.50');
    assert.equal(result.coilId, 71);
    assert.equal(result.inventoryType, 'coil');
    assert.equal(result.pricingMode, 'kit');
    assert.equal(result.kitPrice, 58.5);
    assert.equal(result.wireWeight, 0.72);
    assert.equal(result.copperBase, 78.4);
    assert.equal(result.formula, '供应商套件价');
});

test('full-estimate 线圈服务可解析默认线径', () => {
    assert.equal(resolveWireFromCoils(coils, '750', 24, '钢带'), '0.55');
});

test('full-estimate 结果组装保持 breakdown 字段', () => {
    const result = buildFullEstimateResult({
        recipeCost: { totalCost: '10.00' },
        statorCost: { cost: '25.80' },
        dynamicCost: { totalCost: '3.30' },
    });

    assert.equal(result.totalCost, '39.10');
    assert.equal(result.sourceOfTruth, 'costEngine');
    assert.equal(result.costBasis, 'composedEstimate');
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.breakdown, {
        recipeCost: '10.00',
        statorCost: '25.80',
        dynamicCost: '3.30',
    });
});
