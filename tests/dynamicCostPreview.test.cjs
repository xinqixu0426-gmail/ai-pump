const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateRecipeCostPreview } = require('../api/services/dynamicCostPreview.cjs');

const screwCatalog = [
    {
        model: 'φ6 不锈钢长螺丝',
        category: '螺丝',
        supplier: '',
        price: 0.3,
        notes: JSON.stringify({
            screwPricing: {
                enabled: true,
                diameter: 6,
                baseLength: 170,
                stepLength: 5,
                stepPrice: 0.01,
            },
        }),
    },
];

function calculateRecipeCost(parts, partsCache, partsByModel) {
    const totalCost = parts.reduce((sum, part) => {
        const price = part.snapshotPrice !== undefined
            ? Number(part.snapshotPrice || 0)
            : Number(partsByModel[part.model]?.[0]?.price || partsCache[part.model]?.price || 0);
        return sum + price * Number(part.qty || 1);
    }, 0);
    return { totalCost };
}

test('报价覆盖 customBarrelLength 后重算长螺丝长度和参数化单价', () => {
    const row = {
        id: 1,
        name: '测试配方',
        parts_json: JSON.stringify([
            {
                name: '不锈钢长螺丝',
                model: '6*195',
                supplier: '',
                qty: 4,
                snapshotPrice: 0.35,
                dynamicRule: 'longScrewByBarrelLength',
                barrelLength: 170,
                longScrewExtraLength: 25,
            },
        ]),
        saved_total_cost: 1.4,
        custom_barrel_length: 170,
        coil_material: '钢带',
        has_float: 0,
        has_cable: 0,
    };

    const result = calculateRecipeCostPreview(row, { customBarrelLength: 172 }, {
        partsCache: {},
        partsByModel: { 'φ6 不锈钢长螺丝': screwCatalog },
        partsCatalog: screwCatalog,
        calculateRecipeCost,
        getSetting: () => undefined,
        getCoils: () => [],
    });

    assert.equal(result.unitCost, 1.44);
    assert.equal(result.parts[0].model, '6*200');
    assert.equal(result.parts[0].snapshotPrice, 0.36);
    assert.equal(result.parts[0].costSource, 'screw_pricing');
});

test('报价覆盖线圈片数后复用线圈插值规则', () => {
    const row = {
        id: 2,
        name: '线圈覆盖配方',
        parts_json: JSON.stringify([
            { name: '线圈转子', model: 'Y90-10', qty: 1, snapshotPrice: 26 },
        ]),
        saved_total_cost: 26,
        coil_spec: 'Y90',
        coil_sheets: 10,
        coil_material: '钢带',
        has_float: 0,
        has_cable: 0,
    };
    const coils = [
        { spec: 'Y90', material: '钢带', sheets: 10, unitPrice: 0.2, wireWeight: 0.2, copperBase: 70, coilFee: 2, rotorFee: 3 },
        { spec: 'Y90', material: '钢带', sheets: 20, unitPrice: 0.2, wireWeight: 0.4, copperBase: 70, coilFee: 4, rotorFee: 5 },
    ];

    const result = calculateRecipeCostPreview(row, { coilSheets: 15 }, {
        partsCache: {},
        partsByModel: {},
        calculateRecipeCost,
        getSetting: () => undefined,
        getCoils: () => coils,
    });

    assert.equal(result.unitCost, 31);
});
