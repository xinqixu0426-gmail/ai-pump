const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildLongScrewInventoryParts,
    buildLongScrewInventoryPartsFromRecipe,
} = require('../api/services/longScrewInventory.cjs');

const pricingCatalog = [
    {
        model: 'φ6 不锈钢长螺丝',
        category: '螺丝',
        supplier: '螺丝供应商',
        price: 0.3,
        notes: JSON.stringify({ screwPricing: { enabled: true, diameter: 6 } }),
    },
];

test('长螺丝来源不猜选其他供应商，规范名称换长度保留材质', () => {
    const catalog = [pricingCatalog[0], { ...pricingCatalog[0], supplier: '另一供应商' }];
    const input = { variant: { barrel_length: 200, long_screw_extra_length: 10 },
        template: { partsJson: JSON.stringify([{ model: '长螺杆螺丝-6*170-201', name: '不锈钢长螺丝', qty: 4 }]) }, partsCatalog: catalog };
    assert.throws(() => buildLongScrewInventoryParts(input), error => error.code === 'SCREW_PRICING_AMBIGUOUS');
    input.template.partsJson = JSON.stringify([{ model: '长螺杆螺丝-6*170-201', name: '不锈钢长螺丝', supplier: '螺丝供应商', qty: 4 }]);
    const parts = buildLongScrewInventoryParts(input);
    assert.equal(parts[0].model, '长螺杆螺丝-6*210-201');
    assert.equal(parts[0].supplier, '螺丝供应商');
    assert.equal(parts[0].price, 0.69);
});

test('型号变体保存可推导需要沉淀到零件库的长螺丝规格', () => {
    const parts = buildLongScrewInventoryParts({
        variant: {
            model_name: 'V750-210',
            barrel_length: 200,
            long_screw_extra_length: 10,
        },
        template: {
            parts_json: JSON.stringify([
                { model: '6*170', name: '不锈钢长螺丝', supplier: '', qty: 4 },
                { model: '6202', name: '轴承', supplier: '', qty: 1 },
            ]),
        },
        partsCatalog: pricingCatalog,
    });

    assert.equal(parts.length, 1);
    assert.equal(parts[0].model, '6*210');
    assert.equal(parts[0].category, '螺丝');
    assert.equal(parts[0].supplier, '螺丝供应商');
    assert.equal(parts[0].price, 0.69);
    assert.equal(parts[0].stock, 0);
    assert.match(parts[0].remark, /modelVariantLongScrew/);
});

test('没有参数化螺丝基础价时也会按型号长度公式生成长螺丝零件', () => {
    const parts = buildLongScrewInventoryParts({
        variant: { model_name: 'V750-210', barrel_length: 200, long_screw_extra_length: 10 },
        template: { parts_json: JSON.stringify([{ model: '6*170', name: '不锈钢长螺丝', qty: 4 }]) },
        partsCatalog: [],
    });

    assert.equal(parts.length, 1);
    assert.equal(parts[0].model, '6*210');
    assert.equal(parts[0].price, 0.69);
});

test('配方保存可用已计算快照价沉淀长螺丝零件', () => {
    const parts = buildLongScrewInventoryPartsFromRecipe({
        recipeName: 'V750 配方',
        parts: [
            {
                model: '6*210',
                name: '不锈钢长螺丝',
                qty: 4,
                snapshotPrice: 0.69,
                screwPricingSupplier: '螺丝供应商',
                screwLength: 210,
            },
        ],
        partsCatalog: [],
    });

    assert.equal(parts.length, 1);
    assert.equal(parts[0].model, '6*210');
    assert.equal(parts[0].category, '螺丝');
    assert.equal(parts[0].price, 0.69);
    assert.equal(parts[0].supplier, '螺丝供应商');
    assert.match(parts[0].remark, /recipeLongScrew/);
});

test('配方保存通过 dynamicRule 识别名称为机筒螺丝的参数化长螺丝', () => {
    const parts = buildLongScrewInventoryPartsFromRecipe({
        recipeName: 'V750 配方',
        parts: [{
            model: '6*200',
            name: '机筒螺丝',
            supplier: '军军',
            qty: 4,
            snapshotPrice: 0.65,
            dynamicRule: 'longScrewByBarrelLength',
            barrelLength: 175,
            longScrewExtraLength: 25,
            screwLength: 200,
        }],
        partsCatalog: [],
    });

    assert.equal(parts.length, 1);
    assert.equal(parts[0].model, '6*200');
    assert.equal(parts[0].price, 0.65);
    assert.equal(parts[0].supplier, '军军');
});
