const test = require('node:test');
const assert = require('node:assert/strict');
const {
    calculateCoilCost,
    buildCoilSpecOptions,
    resolveWireFromCoils,
} = require('../api/services/coilCost.cjs');

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
        defaultWireGauge: '0.55',
    },
    {
        spec: '750',
        material: '钢带',
        sheets: 30,
        unitPrice: 0.2,
        wireWeight: 0.42,
        copperBase: 60,
        coilFee: 3,
        rotorFee: 1.6,
        defaultWireGauge: '0.6',
    },
];

test('线圈成本服务精确匹配保持接口字段', () => {
    const result = calculateCoilCost(coils, { spec: '750', sheets: 24, material: '钢带' });

    assert.equal(result.success, true);
    assert.equal(result.data.totalCost, 25.8);
    assert.equal(result.data.source, '精确匹配');
    assert.equal(result.data.wireGauge, '0.55');
    assert.equal(result.data.formula, '0.2×24 + 0.3×60 + 2.00 + 1.00');
});

test('线圈成本服务非精确片数使用插值', () => {
    const result = calculateCoilCost(coils, { spec: '750', sheets: 27, material: '钢带' });

    assert.equal(result.success, true);
    assert.equal(result.data.wireWeight, 0.36);
    assert.equal(result.data.coilFee, 2.5);
    assert.equal(result.data.rotorFee, 1.3);
    assert.equal(result.data.totalCost, 30.8);
    assert.equal(result.data.source, '插值(24片↔30片, ratio=0.500)');
});

test('线圈成本拒绝非法片数和自定义成本参数', () => {
    for (const sheets of [0, -1, 24.5, 'abc']) {
        const result = calculateCoilCost(coils, { spec: '750', sheets, material: '钢带' });
        assert.equal(result.success, false);
        assert.equal(result.status, 400);
        assert.match(result.error, /片数必须是正整数/);
    }

    const invalidWireWeight = calculateCoilCost(coils, {
        spec: '750',
        sheets: 24,
        material: '钢带',
        wireWeight: 'abc',
    });
    assert.equal(invalidWireWeight.success, false);
    assert.match(invalidWireWeight.error, /自定义线重必须是非负数字/);

    const invalidCopperPrice = calculateCoilCost(coils, {
        spec: '750',
        sheets: 24,
        material: '钢带',
        copperPrice: -1,
    });
    assert.equal(invalidCopperPrice.success, false);
    assert.match(invalidCopperPrice.error, /铜价必须是非负数字/);
});

test('线圈成本指定材质时不得借用其他材质记录或默认单价', () => {
    const result = calculateCoilCost(coils, { spec: '750', sheets: 24, material: '冷轧' });

    assert.equal(result.success, false);
    assert.equal(result.status, 404);
    assert.match(result.error, /冷轧/);
});

test('线圈服务按材质解析默认线径', () => {
    assert.equal(resolveWireFromCoils(coils, '750', 24, '钢带'), '0.55');
});

test('线圈成本严格隔离小眼和国标眼', () => {
    const result = calculateCoilCost(coils, { spec: '750', sheets: 24, material: '钢带', slotType: '国标眼' });

    assert.equal(result.success, false);
    assert.match(result.error, /国标眼/);
});

test('测试方案不参与正式成本，12 与 120 按同一直径匹配', () => {
    const domainCoils = [
        { ...coils[0], spec: '12', diameterMm: 120, schemeStatus: 'testing', wireWeight: 9 },
        { ...coils[0], spec: '12', diameterMm: 120, schemeStatus: 'official', wireWeight: 0.3 },
    ];
    const result = calculateCoilCost(domainCoils, { spec: '120', sheets: 24, material: '钢带', slotType: '小眼' });

    assert.equal(result.success, true);
    assert.equal(result.data.diameterMm, 120);
    assert.equal(result.data.wireWeight, 0.3);
});

test('线圈规格选项保留同规格下钢带小眼和冷轧国标眼两条正式链路', () => {
    const options = buildCoilSpecOptions([
        { ...coils[0], spec: '12', diameterMm: 120, sheets: 120, material: '钢带', slotType: '小眼', schemeStatus: 'official' },
        { ...coils[0], spec: '12', diameterMm: 120, sheets: 220, material: '冷轧', slotType: '国标眼', schemeStatus: 'official' },
        { ...coils[0], spec: '12', diameterMm: 120, sheets: 240, material: '冷轧', slotType: '国标眼', schemeStatus: 'testing' },
    ]);

    assert.equal(options.length, 1);
    assert.equal(options[0].diameterMm, 120);
    assert.deepEqual(options[0].materials, ['钢带', '冷轧']);
    assert.deepEqual(options[0].variants, [
        { material: '钢带', slotType: '小眼', sheets: [120] },
        { material: '冷轧', slotType: '国标眼', sheets: [220] },
    ]);
});
