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

test('报价覆盖 customBarrelLength 后按机筒长度加补偿重算长螺丝', () => {
    const row = {
        id: 1,
        name: '测试配方',
        parts_json: JSON.stringify([
            {
                name: '不锈钢长螺丝',
                model: '6*200',
                supplier: '',
                qty: 4,
                snapshotPrice: 0.65,
                dynamicRule: 'longScrewByBarrelLength',
                barrelLength: 190,
                longScrewExtraLength: 10,
            },
        ]),
        saved_total_cost: 2.6,
        custom_barrel_length: 190,
        coil_material: '钢带',
        has_float: 0,
        has_cable: 0,
    };

    const result = calculateRecipeCostPreview(row, { customBarrelLength: 195 }, {
        partsCache: {},
        partsByModel: { 'φ6 不锈钢长螺丝': screwCatalog },
        partsCatalog: screwCatalog,
        calculateRecipeCost,
        getSetting: () => undefined,
        getCoils: () => [],
    });

    assert.equal(result.unitCost, 2.68);
    assert.equal(result.parts[0].model, '6*205');
    assert.equal(result.parts[0].snapshotPrice, 0.67);
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

test('报价覆盖 customBarrelLength 后重算不锈钢泵壳套件整体价', () => {
    const row = {
        id: 3,
        name: '不锈钢泵壳配方',
        parts_json: JSON.stringify([
            {
                name: '泵壳套件',
                model: 'V750',
                supplier: '',
                qty: 1,
                snapshotPrice: 90,
                baseSnapshotPrice: 90,
                dynamicRule: 'stainlessShellBundleByBarrelLength',
                barrelLength: 150,
            },
        ]),
        saved_total_cost: 90,
        custom_barrel_length: 150,
        coil_material: '钢带',
        has_float: 0,
        has_cable: 0,
    };

    const result = calculateRecipeCostPreview(row, { customBarrelLength: 170 }, {
        partsCache: {},
        partsByModel: {},
        calculateRecipeCost,
        getSetting: () => undefined,
        getCoils: () => [],
    });

    assert.equal(result.unitCost, 92);
    assert.equal(result.parts[0].snapshotPrice, 92);
    assert.equal(result.parts[0].barrelExtraCost, 2);
});
