const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateRecipeCostPreview, inferPackingRole } = require('../api/services/dynamicCostPreview.cjs');

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

test('历史包材优先按明确型号和供应商识别角色', () => {
    assert.equal(inferPackingRole({ model: '外箱贴纸', packagingMaterial: '纸箱' }), 'fixed');
    assert.equal(inferPackingRole({ model: '说明书', packagingMaterial: '纸箱' }), 'fixed');
    assert.equal(inferPackingRole({ model: '800', supplier: '山市泡沫厂', packagingMaterial: '纸箱' }), 'foam');
    assert.equal(inferPackingRole({ model: '550木箱', packagingMaterial: '纸箱' }), 'container');
});

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
    assert.equal(result.parts[0].inventoryType, 'none');
    assert.equal(result.warnings[0].code, 'coil_inventory_scheme_required');
});

test('报价或订单覆盖到无法计价的线圈配置时明确拒绝', () => {
    const row = {
        id: 20,
        name: '线圈无效覆盖配方',
        parts_json: JSON.stringify([
            { name: '线圈转子', model: 'Y90-10', qty: 1, snapshotPrice: 26 },
        ]),
        saved_total_cost: 26,
        coil_spec: 'Y90',
        coil_sheets: 10,
        coil_material: '钢带',
        coil_slot_type: '小眼',
        has_float: 0,
        has_cable: 0,
    };

    assert.throws(
        () => calculateRecipeCostPreview(row, { coilSpec: '不存在的规格', coilSheets: 15 }, {
            partsCache: {},
            partsByModel: {},
            calculateRecipeCost,
            getSetting: () => undefined,
            getCoils: () => [],
        }),
        error => error.code === 'COIL_CONFIGURATION_UNPRICED' && error.statusCode === 422
    );
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

test('报价包材覆盖按完整组合替换并保留固定包材', () => {
    const row = {
        id: 4,
        name: '组合包材配方',
        parts_json: JSON.stringify([
            { name: '固定配件', model: '固定配件', qty: 1, snapshotPrice: 100 },
            { name: '纸箱', model: '纸箱A', qty: 1, snapshotPrice: 4, packagingMaterial: '纸箱', packingRole: 'container' },
            { name: '泡沫', model: '800', qty: 1, snapshotPrice: 2, packagingMaterial: '泡沫', packingRole: 'foam' },
            { name: '珍珠棉', model: '珍珠棉', qty: 1, snapshotPrice: 1, packagingMaterial: '珍珠棉', packingRole: 'pearlCotton' },
            { name: '说明书', model: '说明书', qty: 1, snapshotPrice: 0.5, packagingMaterial: '说明书', packingRole: 'fixed' },
        ]),
        packing_parts_json: JSON.stringify([
            { model: '纸箱A', qty: 1, packagingMaterial: '纸箱', packingRole: 'container' },
            { model: '800', qty: 1, packagingMaterial: '泡沫', packingRole: 'foam' },
            { model: '珍珠棉', qty: 1, packagingMaterial: '珍珠棉', packingRole: 'pearlCotton' },
            { model: '说明书', qty: 1, packagingMaterial: '说明书', packingRole: 'fixed' },
        ]),
        saved_total_cost: 107.5,
        coil_material: '钢带',
        has_float: 0,
        has_cable: 0,
        surface_treatment_mode: 'none',
        surface_treatment_cost: 0,
    };

    const result = calculateRecipeCostPreview(row, {
        boxType: '木箱A',
        packingPartsJson: JSON.stringify([
            { model: '木箱A', qty: 1, snapshotPrice: 13, packagingMaterial: '木箱', packingRole: 'container' },
            { model: '珍珠棉', qty: 1, snapshotPrice: 1, packagingMaterial: '珍珠棉', packingRole: 'pearlCotton' },
            { model: '说明书', qty: 1, snapshotPrice: 0.5, packagingMaterial: '说明书', packingRole: 'fixed' },
        ]),
    }, {
        partsCache: {},
        partsByModel: {},
        calculateRecipeCost,
        getSetting: () => undefined,
        getCoils: () => [],
    });

    assert.equal(result.unitCost, 114.5);
});

test('报价切换表面处理时替换配方原工艺成本', () => {
    const row = {
        id: 5,
        name: '表面处理配方',
        parts_json: JSON.stringify([
            { name: '固定配件', model: '固定配件', qty: 1, snapshotPrice: 100 },
        ]),
        saved_total_cost: 103,
        coil_material: '钢带',
        has_float: 0,
        has_cable: 0,
        surface_treatment_mode: 'painting',
        surface_treatment_cost: 3,
    };
    const dependencies = {
        partsCache: {},
        partsByModel: {},
        calculateRecipeCost,
        getSetting: () => undefined,
        getCoils: () => [],
    };

    const removed = calculateRecipeCostPreview(row, {
        surfaceTreatmentMode: 'none',
        surfaceTreatmentCost: 0,
    }, dependencies);
    const replaced = calculateRecipeCostPreview(row, {
        surfaceTreatmentMode: 'electrophoresis',
        surfaceTreatmentCost: 5,
    }, dependencies);

    assert.equal(removed.unitCost, 100);
    assert.equal(replaced.unitCost, 105);
});

test('报价电缆覆盖同时生成实际长度 BOM 快照', () => {
    const cable = { id: 8, model: '电缆-线径0.75', supplier: '线缆厂', stock: 100, price: 2 };
    const row = {
        id: 6,
        name: '电缆覆盖配方',
        parts_json: JSON.stringify([
            { name: '固定配件', model: '固定配件', qty: 1, snapshotPrice: 100 },
        ]),
        saved_total_cost: 100,
        coil_material: '钢带',
        has_float: 0,
        has_cable: 0,
        cable_length: 0,
        cable_wire: '0.75',
        cable_accessory_type: 'standard',
    };

    const result = calculateRecipeCostPreview(row, {
        hasCable: true,
        cableLength: 10,
        cableWire: '0.75',
        cableAccessoryType: 'standard',
    }, {
        partsCache: {},
        partsByModel: { '电缆-线径0.75': [cable] },
        partsCatalog: [cable],
        calculateRecipeCost,
        getSetting: key => key === 'cable_accessories' ? JSON.stringify({ standard: { name: '全局防水接头', fee: 3 } }) : undefined,
        getCoils: () => [],
    });

    const cableSnapshot = result.parts.find(part => part.cableAssembly);
    assert.equal(result.unitCost, 123);
    assert.equal(cableSnapshot.inventoryQty, 10);
    assert.equal(cableSnapshot.snapshotPrice, 23);
    assert.equal(cableSnapshot.name, '成品电缆（全局防水接头）');
    assert.equal(cableSnapshot.cableAccessorySource, 'system_settings');
    assert.equal(result.costSnapshot.unitCost, 123);
});
