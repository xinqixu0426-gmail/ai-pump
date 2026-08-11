const test = require('node:test');
const assert = require('node:assert/strict');
const {
    applyLongScrewRule,
    calculateRecipeCost,
    buildRecipeCostDraft,
    calculateScrewUnitPrice,
    findScrewPricingPart,
    getPartPriceFromCatalog,
    longScrewPriceByModel,
    roundLengthToStep,
    stainlessShellBundleExtraCost,
} = require('../api/services/costEngine.cjs');

const screwCatalog = [
    {
        model: 'φ6 不锈钢长螺丝',
        category: '螺丝',
        supplier: '默认供应商',
        price: 0.3,
        notes: JSON.stringify({
            screwPricing: {
                enabled: true,
                diameter: 6,
            },
        }),
    },
];

test('长螺丝长度按机筒长度加补偿长度计算', () => {
    const part = applyLongScrewRule({ model: '6*170', name: '不锈钢长螺丝' }, 190, 10);
    assert.equal(part.model, '6*200');
    assert.equal(part.barrelLength, 190);
    assert.equal(part.longScrewExtraLength, 10);
    assert.equal(part.requestedScrewLength, 200);
    assert.equal(part.screwLength, 200);
    assert.equal(part.dynamicRule, 'longScrewByBarrelLength');
});

test('长螺丝长度不自动按 5mm 取整', () => {
    assert.equal(roundLengthToStep(197), 200);
    const part = applyLongScrewRule({ model: '6*170', name: '不锈钢长螺丝' }, 190, 7);
    assert.equal(part.model, '6*197');
    assert.equal(part.requestedScrewLength, 197);
    assert.equal(part.screwLength, 197);
});

test('没有有效机筒长度时不改长螺丝', () => {
    const original = { model: '6*170', name: '不锈钢长螺丝' };
    const part = applyLongScrewRule(original, null);
    assert.deepEqual(part, original);
});

test('参数化螺丝单价按长度公式计算', () => {
    const price = calculateScrewUnitPrice(195);
    assert.equal(price, 0.63);
});

test('参数化基础螺丝可按直径匹配目标型号', () => {
    const matched = findScrewPricingPart(screwCatalog, '6*195');
    assert.ok(matched);
    assert.equal(matched.part.model, 'φ6 不锈钢长螺丝');
    assert.equal(matched.pricing.diameter, 6);
});

test('长螺丝目标型号可由参数化基础件计算单价', () => {
    const result = longScrewPriceByModel(screwCatalog, '6*195');
    assert.equal(result.unitPrice, 0.63);
    assert.equal(result.pricingPartModel, 'φ6 不锈钢长螺丝');
});

test('catalog 取价优先参数化螺丝、精确供应商，否则取同型号最低价', () => {
    const catalog = [
        ...screwCatalog,
        { model: '轴承', category: '轴承', supplier: 'A', price: 2 },
        { model: '轴承', category: '轴承', supplier: 'B', price: 1.6 },
    ];

    assert.equal(getPartPriceFromCatalog(catalog, '6*195'), 0.63);
    assert.equal(getPartPriceFromCatalog(catalog, '轴承', 'A'), 2);
    assert.equal(getPartPriceFromCatalog(catalog, '轴承'), 1.6);
    assert.equal(getPartPriceFromCatalog(catalog, '不存在'), 0);
});

test('配方成本草稿会应用长螺丝长度和参数化计价', () => {
    const result = buildRecipeCostDraft({
        parts: [{ model: '6*170', name: '不锈钢长螺丝', supplier: '', qty: 4, snapshotPrice: 0 }],
        customBarrelLength: 190,
        longScrewExtraLength: 10,
        assemblyWage: 5,
        packingWage: 2,
        managementFee: 1,
    }, {
        partsCatalog: screwCatalog,
    });

    assert.equal(result.parts[0].model, '6*200');
    assert.equal(result.parts[0].snapshotPrice, 0.65);
    assert.equal(result.parts[0].costSource, 'screw_pricing');
    assert.equal(result.partsCost, 2.6);
    assert.equal(result.laborCost, 8);
    assert.equal(result.savedTotalCost, 10.6);
    assert.match(result.savedCostDetails, /按长度计价: φ6 不锈钢长螺丝/);
});

test('配方成本草稿没有参数化基础螺丝时也会按长度公式计价', () => {
    const result = buildRecipeCostDraft({
        parts: [{ model: '6*170', name: '不锈钢长螺丝', supplier: '', qty: 4, snapshotPrice: 0 }],
        customBarrelLength: 155,
        longScrewExtraLength: 25,
        assemblyWage: 0,
        packingWage: 0,
        managementFee: 0,
    }, {
        partsCatalog: [],
    });

    assert.equal(result.parts[0].model, '6*180');
    assert.equal(result.parts[0].snapshotPrice, 0.57);
    assert.equal(result.parts[0].costSource, 'screw_formula');
    assert.equal(result.partsCost, 2.28);
});

test('通用配方成本计算支持浮球新界式加价', () => {
    const result = calculateRecipeCost([
        { name: '浮球', model: '浮球-线径0.55', supplier: '', qty: 1, floatAccessoryType: 'xinjie' },
    ], {}, {
        '浮球-线径0.55': [{ model: '浮球-线径0.55', supplier: 'A', price: 2 }],
    }, {
        getSetting: key => key === 'float_accessory_delta' ? '0.6' : undefined,
    });

    assert.equal(result.totalCost, '2.60');
    assert.equal(result.details[0].source, '型号回退(取最低价)+新界式');
});

test('通用配方成本计算兼容旧电缆两行并合并重算成品电缆', () => {
    const result = calculateRecipeCost([
        { name: '电缆线', model: '电缆-线径0.55', supplier: '', qty: 2 },
        { name: '电缆接头配件', model: '电缆配件费', supplier: '', qty: 1, cableAccessoryType: 'xinjie' },
    ], {}, {
        '电缆-线径0.55': [{ model: '电缆-线径0.55', supplier: 'A', price: 1.2 }],
        '电缆配件费': [{ model: '电缆配件费', supplier: 'A', price: 0.5 }],
    }, {
        getSetting: key => key === 'cable_accessories'
            ? JSON.stringify({ xinjie: { name: '新界式', fee: 0.9 } })
            : undefined,
    });

    assert.equal(result.totalCost, '3.30');
    assert.equal(result.itemCount, 1);
    assert.equal(result.details[0].name, '成品电缆（新界式）');
    assert.equal(result.details[0].price, '3.30');
    assert.equal(result.details[0].qty, 1);
    assert.match(result.details[0].source, /新界式/);
});

test('通用配方成本计算支持参数化长螺丝', () => {
    const result = calculateRecipeCost([
        { name: '不锈钢长螺丝', model: '6*195', supplier: '', qty: 4 },
    ], {}, {
        'φ6 不锈钢长螺丝': screwCatalog,
    });

    assert.equal(result.totalCost, '2.52');
    assert.equal(result.details[0].source, '参数化螺丝(φ6 不锈钢长螺丝)');
});

test('通用配方成本按 dynamicRule 识别名称为机筒螺丝的长螺丝', () => {
    const result = calculateRecipeCost([
        {
            name: '机筒螺丝',
            model: '6*200',
            supplier: '',
            qty: 4,
            dynamicRule: 'longScrewByBarrelLength',
        },
    ], {}, {});

    assert.equal(result.totalCost, '2.60');
    assert.equal(result.details[0].source, '长螺丝公式价');
    assert.deepEqual(result.missingParts, []);
});

test('不锈钢泵壳套件整体价随机筒长度按 150mm 基准加价', () => {
    assert.equal(stainlessShellBundleExtraCost(150), 0);
    assert.equal(stainlessShellBundleExtraCost(170), 2);
    assert.equal(stainlessShellBundleExtraCost(155), 1);

    const result = buildRecipeCostDraft({
        parts: [{
            model: 'V750',
            name: '泵壳套件',
            qty: 1,
            snapshotPrice: 90,
            baseSnapshotPrice: 90,
            dynamicRule: 'stainlessShellBundleByBarrelLength',
        }],
        customBarrelLength: 170,
        assemblyWage: 0,
        packingWage: 0,
        managementFee: 0,
    });

    assert.equal(result.parts[0].snapshotPrice, 92);
    assert.equal(result.parts[0].barrelExtraCost, 2);
    assert.equal(result.parts.length, 1);
    assert.equal(result.partsCost, 92);
    assert.equal(result.savedTotalCost, 92);
    assert.match(result.savedCostDetails, /当前机筒: 170mm/);
});
