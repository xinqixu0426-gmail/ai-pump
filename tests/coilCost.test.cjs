const test = require('node:test');
const assert = require('node:assert/strict');
const {
    calculateCoilCost,
    getMaterialPriceMap,
    getMaterialUnitPrice,
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

test('线圈成本服务支持材质单价回退', () => {
    const result = calculateCoilCost(coils, { spec: '750', sheets: 24, material: '冷轧800' }, {
        materialPrices: { '冷轧800': 0.25 },
    });

    assert.equal(result.success, true);
    assert.equal(result.data.material, '冷轧800');
    assert.equal(result.data.unitPrice, 0.25);
    assert.equal(result.data.totalCost, 27);
});

test('线圈材质单价读取兼容默认值和坏 JSON', () => {
    const values = getMaterialPriceMap(() => '{bad json');

    assert.equal(values['钢带'], 0.21);
    assert.equal(values['冷轧800'], 0.22);
});

test('线圈定子单价按规格和材质取默认值', () => {
    assert.equal(getMaterialUnitPrice('9', '钢带'), 0.18);
    assert.equal(getMaterialUnitPrice('9', '冷轧800'), 0.2);
    assert.equal(getMaterialUnitPrice('12.8', '钢带'), 0.234);
    assert.equal(getMaterialUnitPrice('12.8', '冷轧800'), 0.244);
});

test('线圈成本材质回退使用规格材质单价', () => {
    const specCoils = [
        {
            spec: '12.8',
            material: '钢带',
            sheets: 10,
            unitPrice: 0.1,
            wireWeight: 0,
            copperBase: 0,
            coilFee: 0,
            rotorFee: 0,
        },
    ];
    const result = calculateCoilCost(specCoils, { spec: '12.8', sheets: 10, material: '冷轧800' });

    assert.equal(result.success, true);
    assert.equal(result.data.unitPrice, 0.244);
    assert.equal(result.data.totalCost, 2.44);
});

test('线圈服务按材质解析默认线径', () => {
    assert.equal(resolveWireFromCoils(coils, '750', 24, '钢带'), '0.55');
});
