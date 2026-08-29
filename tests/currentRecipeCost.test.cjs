const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateRecipeCost } = require('../api/services/costEngine.cjs');
const {
    buildCurrentRecipeCostBasis,
    calculateCurrentRecipeCost,
} = require('../api/services/currentRecipeCost.cjs');
const { buildRecipeBomDraft } = require('../api/services/recipeBomEngine.cjs');

test('当日成本按当前零件价和线圈价重算完整配方成本', () => {
    const recipe = {
        id: 12,
        partsJson: JSON.stringify([
            { model: '轴承202', name: '轴承', supplier: 'A', qty: 1, snapshotPrice: 5 },
            { model: '750-24', name: '线圈转子', qty: 1, snapshotPrice: 20 },
        ]),
        savedTotalCost: 30,
        coilSpec: '750',
        coilSheets: 24,
        coilMaterial: '钢带',
        assemblyWage: 3,
        packingWage: 2,
        surfaceTreatmentMode: 'none',
        surfaceTreatmentCost: 0,
        managementFee: 0,
    };
    const coils = [{
        spec: '750',
        material: '钢带',
        sheets: 24,
        unitPrice: 0.2,
        wireWeight: 0.3,
        copperBase: 60,
        coilFee: 2,
        rotorFee: 1,
    }];

    const result = calculateCurrentRecipeCost(recipe, {
        partsByModel: {
            '轴承202': [{ model: '轴承202', supplier: 'A', price: 8 }],
        },
        calculateRecipeCost,
        coils,
        getSetting: () => undefined,
    });

    assert.equal(result.partsCost, 33.8);
    assert.equal(result.laborCost, 5);
    assert.equal(result.currentTotalCost, 38.8);
    assert.equal(result.savedTotalCost, 30);
    assert.equal(result.difference, 8.8);
    assert.equal(result.costComplete, true);
    assert.deepEqual(result.warnings, []);
});

test('没有保存成本时仍返回当日成本但差额为空', () => {
    const result = calculateCurrentRecipeCost({
        id: 13,
        partsJson: '[]',
        assemblyWage: 2,
        managementFee: null,
    }, {
        calculateRecipeCost,
        getSetting: key => key === 'management_fee' ? '3' : undefined,
    });

    assert.equal(result.currentTotalCost, 5);
    assert.equal(result.savedTotalCost, null);
    assert.equal(result.difference, null);
});

test('当日成本精确采用供应商套件价并保留快照语义', () => {
    const recipe = {
        id: 17,
        partsJson: JSON.stringify([{
            model: '750-36',
            name: '线圈转子',
            qty: 1,
            snapshotPrice: 20,
        }]),
        coilSpec: '750',
        coilSheets: 36,
        coilMaterial: '钢带',
        coilSlotType: '小眼',
        coilWireWeight: 99,
    };
    const basis = buildCurrentRecipeCostBasis(recipe, {
        calculateRecipeCost,
        coils: [{
            id: 72,
            spec: '750',
            material: '钢带',
            slotType: '小眼',
            sheets: 36,
            schemeStatus: 'official',
            pricingMode: 'kit',
            kitPrice: 61.25,
        }],
    });

    assert.equal(basis.partialTotalCost, 61.25);
    assert.equal(basis.parts[0].snapshotPrice, 61.25);
    assert.equal(basis.parts[0].pricingMode, 'kit');
    assert.equal(basis.parts[0].kitPrice, 61.25);
    assert.equal(basis.parts[0].formula, '供应商套件价');
});

test('当日成本重算应用全局浮球加价设置', () => {
    const result = calculateCurrentRecipeCost({
        id: 14,
        partsJson: JSON.stringify([
            { model: '浮球-线径0.55', name: '浮球', supplier: 'A', qty: 1, floatAccessoryType: 'xinjie' },
        ]),
    }, {
        partsByModel: {
            '浮球-线径0.55': [{ model: '浮球-线径0.55', supplier: 'A', price: 7 }],
        },
        calculateRecipeCost,
        getSetting: key => key === 'float_accessory_delta' ? '0.6' : undefined,
    });

    assert.equal(result.partsCost, 7.6);
    assert.equal(result.currentTotalCost, 7.6);
});

test('当日成本存在未定价项目时不返回可误用的完整金额', () => {
    const result = calculateCurrentRecipeCost({
        id: 16,
        partsJson: JSON.stringify([
            { model: '缺价格型号', name: '关键零件', qty: 2 },
        ]),
        assemblyWage: 3,
    }, {
        calculateRecipeCost,
    });

    assert.equal(result.costComplete, false);
    assert.equal(result.currentTotalCost, null);
    assert.equal(result.partsCost, null);
    assert.equal(result.difference, null);
    assert.equal(result.partialPartsCost, 0);
    assert.equal(result.partialTotalCost, 3);
    assert.deepEqual(result.missingParts, ['缺价格型号']);
    assert.match(result.warnings[0], /当前成本不完整/);
});

test('当日成本先按当前模板和配方参数重建 BOM', () => {
    const recipe = {
        id: 15,
        templateId: 3,
        customBarrelLength: 175,
        longScrewExtraLength: 25,
        hasFloat: 1,
        floatWire: '0.55',
        floatAccessoryType: 'xinjie',
        extraPartsJson: '[{"model":"出水口","qty":1}]',
        packingPartsJson: '[{"model":"木箱","qty":1}]',
        partsJson: '[{"model":"旧泵壳","snapshotPrice":93,"qty":1}]',
        savedTotalCost: 93,
    };
    let receivedInput = null;
    const result = calculateCurrentRecipeCost(recipe, {
        calculateRecipeCost,
        buildBomDraft: input => {
            receivedInput = input;
            return {
                parts: [
                    { model: '当前泵壳', name: '泵壳套件', qty: 1, snapshotPrice: 98, costSource: 'manual' },
                    { model: '6*200', name: '机筒螺丝', qty: 4, dynamicRule: 'longScrewByBarrelLength' },
                ],
            };
        },
    });

    assert.equal(receivedInput.templateId, 3);
    assert.equal(receivedInput.customBarrelLength, 175);
    assert.equal(receivedInput.longScrewExtraLength, 25);
    assert.deepEqual(receivedInput.optionalParts, [{ model: '出水口', qty: 1 }]);
    assert.deepEqual(receivedInput.packingParts, [{ model: '木箱', qty: 1 }]);
    assert.equal(result.partsCost, 100.6);
    assert.equal(result.currentTotalCost, 100.6);
});

test('配方当前成本黄金样本保持列表和编辑器共用口径', () => {
    const catalog = [
        ['202', 1.2, '万佳轴承', '轴承'],
        ['203', 1.6, '万佳轴承', '轴承'],
        ['14*28*38', 1.85, '你我发', '油封'],
        ['14*28', 0.28, '鹏杰油封', '油封'],
        ['八角注塑提手带叫头', 2, '力博配件-双凌店面', '配件'],
        ['5*12-201-内六', 0.049, '五金城-螺丝店', '螺丝'],
        ['110*2.65', 0.19, '泽国五金城-皮垫', '皮垫'],
        ['切边6mm长螺丝', 1, '军军', '螺丝', JSON.stringify({ screwPricing: { enabled: true, diameter: 6, modelPrefix: '6*' } })],
        ['6*20-201-内六-组合', 0.07, '五金城-螺丝店', '螺丝'],
        ['2.5寸尖皮垫', 0.25, '端隆水泵配件', '皮垫'],
        ['6*25-内六-201-组合', 0.09, '五金城-螺丝店', '螺丝'],
        ['18μF', 2.5, '亿峰电容', '电容'],
        ['25μF', 3.5, '亿峰电容', '电容'],
        ['2寸塑料出水口', 0.5, '山市力博', '配件'],
        ['浮球-线径0.55', 7.4, '林加伟', '浮球'],
        ['浮球-线径0.75', 7.6, '林加伟', '浮球'],
        ['电缆-线径0.55', 1.45, '林加伟', '电缆线', JSON.stringify({ cableAccessoryFees: { standard: 2.6, xinjie: 3.4 }, cableAccessoryNames: { standard: '普通铜套', xinjie: '新界式' } })],
        ['电缆-线径0.75', 1.88, '林加伟', '电缆线', JSON.stringify({ cableAccessoryFees: { standard: 2.6, xinjie: 3.4 }, cableAccessoryNames: { standard: '普通铜套', xinjie: '新界式' } })],
        ['说明书', 0.5, '新野印刷', '包装'],
        ['v550木箱', 13, '李仁连', '包装'],
        ['外箱贴纸', 1.5, '四通', '包装'],
        ['珍珠棉', 2, '大溪珍珠棉', '包装'],
        ['600w上下泡沫', 1.9, '山市泡沫厂', '包装'],
    ].map(([model, price, supplier, category, notes = '']) => ({ model, price, supplier, category, notes }));
    const template = {
        id: 1,
        shellModel: 'V750-大脚板-2寸',
        costMode: 'bundle',
        bundleCost: 95,
        partsJson: JSON.stringify([
            { name: '花板轴承', model: '202', supplier: '万佳轴承', qty: 1 },
            { name: '油缸轴承', model: '203', supplier: '万佳轴承', qty: 1 },
            { name: '机械油封', model: '14*28*38', supplier: '你我发', qty: 1 },
            { name: '骨架油封', model: '14*28', supplier: '鹏杰油封', qty: 1 },
            { name: '提手', model: '八角注塑提手带叫头', supplier: '力博配件-双凌店面', qty: 1 },
            { name: '提手螺丝', model: '5*12-201-内六', supplier: '五金城-螺丝店', qty: 2 },
            { name: '压板螺丝', model: '5*12-201-内六', supplier: '五金城-螺丝店', qty: 4 },
            { name: '上帽O型圈', model: '110*2.65', supplier: '泽国五金城-皮垫', qty: 2 },
            { name: '油缸O型圈', model: '110*2.65', supplier: '泽国五金城-皮垫', qty: 2 },
            { name: '机筒螺丝', model: '切边6mm长螺丝', supplier: '军军', qty: 4 },
            { name: '泵头螺丝', model: '6*20-201-内六-组合', supplier: '五金城-螺丝店', qty: 4 },
            { name: '法兰扁皮垫', model: '2.5寸尖皮垫', supplier: '端隆水泵配件', qty: 1 },
            { name: '法兰螺丝', model: '6*25-内六-201-组合', supplier: '五金城-螺丝店', qty: 2 },
        ]),
        shellComponentsJson: '[]',
    };
    const coils = [
        { id: 1, spec: '12', sheets: 120, material: '钢带', slotType: '小眼', unitPrice: 0.21, wireWeight: 0.559, copperBase: 108.59, coilFee: 8, rotorFee: 5, defaultWireGauge: '0.55', defaultCapacitor: '18', schemeStatus: 'official' },
        { id: 2, spec: '12', sheets: 140, material: '钢带', slotType: '小眼', unitPrice: 0.21, wireWeight: 0.677, copperBase: 108.59, coilFee: 8, rotorFee: 5, defaultWireGauge: '0.55', defaultCapacitor: '25', schemeStatus: 'official' },
        { id: 3, spec: '12', sheets: 160, material: '钢带', slotType: '小眼', unitPrice: 0.21, wireWeight: 0.763, copperBase: 108.59, coilFee: 8, rotorFee: 5, defaultWireGauge: '0.75', defaultCapacitor: '25', schemeStatus: 'official' },
    ];
    const partsByModel = {};
    for (const item of catalog) (partsByModel[item.model] ||= []).push(item);
    const getSetting = key => key === 'float_accessory_delta' ? '0.6' : undefined;
    const buildBomDraft = input => buildRecipeBomDraft(input, {
        template,
        shellMeta: { isStainless: true },
        partsCatalog: catalog,
        coils,
        getSetting,
    });
    const packingPartsJson = JSON.stringify([
        { model: '说明书', supplier: '新野印刷', qty: 1, packagingMaterial: '说明书' },
        { model: 'v550木箱', supplier: '李仁连', qty: 1, packagingMaterial: '木箱' },
        { model: '外箱贴纸', supplier: '四通', qty: 1, packagingMaterial: '其他包材' },
        { model: '珍珠棉', supplier: '大溪珍珠棉', qty: 1, packagingMaterial: '珍珠棉' },
        { model: '600w上下泡沫', supplier: '山市泡沫厂', qty: 1, packagingMaterial: '泡沫' },
    ]);
    const baseRecipe = {
        templateId: 1,
        coilSpec: '12',
        coilMaterial: '钢带',
        coilSlotType: '小眼',
        hasFloat: 1,
        floatAccessoryType: 'xinjie',
        hasCable: 1,
        cableLength: 8,
        cableAccessoryType: 'xinjie',
        extraPartsJson: JSON.stringify([{ model: '2寸塑料出水口', supplier: '山市力博', qty: 1 }]),
        packingPartsJson,
        assemblyWage: 6,
        packingWage: 2.5,
        surfaceTreatmentMode: 'electrophoresis_powder_coating',
        surfaceTreatmentCost: 7.5,
        managementFee: 5,
    };
    const samples = [
        { name: 'v550-tokoy', expected: 272.49, coilSheets: 120, coilWireWeight: 0.559, floatWire: '0.55', cableWire: '0.55', customBarrelLength: null, longScrewExtraLength: 0 },
        { name: 'v750-tokoy', expected: 292.11, coilSheets: 140, coilWireWeight: 0.677, floatWire: '0.55', cableWire: '0.55', customBarrelLength: 175, longScrewExtraLength: 25 },
        { name: 'V1100-2寸', expected: 310.44, coilSheets: 160, coilWireWeight: 0.763, floatWire: '0.75', cableWire: '0.75', customBarrelLength: 185, longScrewExtraLength: 25 },
    ];

    for (const [index, sample] of samples.entries()) {
        const result = calculateCurrentRecipeCost({
            ...baseRecipe,
            ...sample,
            id: index + 1,
            partsJson: '[]',
        }, {
            partsByModel,
            calculateRecipeCost,
            coils,
            getSetting,
            buildBomDraft,
        });
        assert.equal(result.costComplete, true, sample.name);
        assert.deepEqual(result.missingParts, [], sample.name);
        assert.equal(result.currentTotalCost, sample.expected, sample.name);
    }
});
