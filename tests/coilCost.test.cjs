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

test('同组合多套正式方案按默认或明确 ID 选择，不允许无默认时猜测', () => {
    const alternatives = [
        { ...coils[0], id: 101, schemeCode: 'COIL-12-200-CN', schemeName: '通用方案', sheets: 200, wireWeight: 1.1, isDefault: false, ratedVoltageV: 220, ratedFrequencyHz: 50, market: '通用', schemeFamilyCode: '12-CN' },
        { ...coils[0], id: 102, schemeCode: 'COIL-12-200-MY', schemeName: '马来西亚方案', sheets: 200, wireWeight: 1.3, isDefault: false, ratedVoltageV: 240, ratedFrequencyHz: 50, market: '马来西亚', schemeFamilyCode: '12-MY' },
    ];
    const ambiguous = calculateCoilCost(alternatives, { spec: '750', sheets: 200, material: '钢带' });
    assert.equal(ambiguous.success, false);
    assert.equal(ambiguous.status, 409);
    assert.equal(ambiguous.code, 'COIL_SCHEME_AMBIGUOUS');
    assert.equal(ambiguous.details.candidates.length, 2);
    const duplicateDefaults = calculateCoilCost(alternatives.map(coil => ({ ...coil, isDefault: true })), { spec: '750', sheets: 200, material: '钢带' });
    assert.equal(duplicateDefaults.code, 'COIL_SCHEME_AMBIGUOUS');

    const defaulted = calculateCoilCost([{ ...alternatives[0], isDefault: true }, alternatives[1]], {
        spec: '750', sheets: 200, material: '钢带',
    });
    assert.equal(defaulted.success, true);
    assert.equal(defaulted.data.coilId, 101);
    assert.equal(defaulted.data.wireWeight, 1.1);

    const explicit = calculateCoilCost([{ ...alternatives[0], isDefault: true }, alternatives[1]], {
        spec: '750', sheets: 200, material: '钢带', coilId: 102,
    });
    assert.equal(explicit.success, true);
    assert.equal(explicit.data.coilId, 102);
    assert.equal(explicit.data.ratedVoltageV, 240);
    assert.equal(explicit.data.market, '马来西亚');
});

test('多方案族插值必须明确方案族且只在族内计算', () => {
    const familyCoils = [
        { ...coils[0], id: 201, sheets: 180, wireWeight: 0.9, schemeFamilyCode: '12-CN' },
        { ...coils[1], id: 202, sheets: 220, wireWeight: 1.1, schemeFamilyCode: '12-CN' },
        { ...coils[0], id: 203, sheets: 180, wireWeight: 1.2, schemeFamilyCode: '12-MY' },
        { ...coils[1], id: 204, sheets: 220, wireWeight: 1.6, schemeFamilyCode: '12-MY' },
    ];
    const ambiguous = calculateCoilCost(familyCoils, { spec: '750', sheets: 200, material: '钢带' });
    assert.equal(ambiguous.code, 'COIL_SCHEME_FAMILY_REQUIRED');

    const result = calculateCoilCost(familyCoils, {
        spec: '750', sheets: 200, material: '钢带', schemeFamilyCode: '12-MY',
    });
    assert.equal(result.success, true);
    assert.equal(result.data.wireWeight, 1.4);
    assert.match(result.data.source, /180片↔220片/);
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

test('供应商套件价只按精确正式方案计价且忽略计算参数', () => {
    const kitCoil = {
        id: 88,
        spec: '750',
        material: '钢带',
        slotType: '小眼',
        schemeStatus: 'official',
        sheets: 27,
        pricingMode: 'kit',
        kitPrice: 68.5,
        unitPrice: 9,
        wireWeight: 9,
        copperBase: 999,
        coilFee: 99,
        rotorFee: 99,
        defaultWireGauge: '0.75',
    };
    const result = calculateCoilCost([...coils, kitCoil], {
        spec: '750',
        sheets: 27,
        material: '钢带',
        wireWeight: 2.5,
        copperPrice: 120,
    });

    assert.equal(result.success, true);
    assert.equal(result.data.coilId, 88);
    assert.equal(result.data.pricingMode, 'kit');
    assert.equal(result.data.kitPrice, 68.5);
    assert.equal(result.data.wireWeight, 9);
    assert.equal(result.data.copperBase, 999);
    assert.equal(result.data.totalCost, 68.5);
    assert.equal(result.data.formula, '供应商套件价');
    assert.equal(result.data.isCustomWireWeight, false);
});

test('供应商套件价不参与其他片数的插值或外推', () => {
    const kitOnly = [{
        id: 89,
        spec: '900',
        material: '钢带',
        sheets: 20,
        pricingMode: 'kit',
        kitPrice: 80,
        schemeStatus: 'official',
    }];
    const rejected = calculateCoilCost(kitOnly, {
        spec: '900',
        sheets: 21,
        material: '钢带',
    });
    assert.equal(rejected.success, false);
    assert.equal(rejected.status, 404);
    assert.match(rejected.error, /不参与插值或外推/);

    const mixed = calculateCoilCost([
        { ...coils[0], sheets: 20 },
        { ...kitOnly[0], spec: '750', sheets: 30 },
        { ...coils[1], sheets: 40 },
    ], { spec: '750', sheets: 35, material: '钢带' });
    assert.equal(mixed.success, true);
    assert.match(mixed.data.source, /20片↔40片/);
    assert.equal(mixed.data.pricingMode, 'calculated');
});

test('损坏的零价供应商套件方案在成本读取层安全失败', () => {
    const result = calculateCoilCost([{
        id: 91,
        spec: 'Y90',
        material: '钢带',
        slotType: '小眼',
        sheets: 30,
        schemeStatus: 'official',
        pricingMode: 'kit',
        kitPrice: 0,
    }], { spec: 'Y90', sheets: 30, material: '钢带', slotType: '小眼' });

    assert.equal(result.success, false);
    assert.equal(result.status, 422);
    assert.match(result.error, /供应商套件价无效/);
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
