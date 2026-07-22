const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRecipeBomDraft } = require('../api/services/recipeBomEngine.cjs');

const partsCatalog = [
    { model: '不锈钢机筒', category: '配件', supplier: '错误分类供应商', price: 0.2 },
    { model: '不锈钢机筒', category: '泵壳搭配', supplier: '机筒供应商', price: 0.8 },
    { model: '铝机筒', category: '泵壳搭配', supplier: '铝件供应商', price: 8 },
    { model: '6*基础', category: '螺丝', supplier: '螺丝供应商', price: 0.3, notes: JSON.stringify({ screwPricing: { enabled: true, diameter: 6 } }) },
    { model: '201', category: '轴承', supplier: '轴承供应商', price: 1.1 },
    { model: '20μF', category: '电容', supplier: '电容供应商', price: 3 },
    { model: '浮球-线径0.75', category: '浮球', supplier: '线缆供应商', price: 7.6 },
    { model: '电缆-线径0.75', category: '电缆线', supplier: '线缆供应商', price: 1.88, notes: JSON.stringify({ cableAccessoryFees: { standard: 0.5, xinjie: 1 }, cableAccessoryNames: { standard: '普通铜套', xinjie: '新界式' } }) },
    { model: '牛皮纸箱A', category: '包装', supplier: '包装供应商', price: 2 },
    { model: '泡沫内衬', category: '包装', supplier: '包装供应商', price: 0.8 },
];

const template = {
    Id: 1,
    shellModel: '测试泵壳',
    partsJson: JSON.stringify([
        { model: '6*170', name: '不锈钢长螺丝', supplier: '', qty: 4 },
        { model: '201', name: '轴承', supplier: '轴承供应商', qty: 2 },
    ]),
    shellComponentsJson: JSON.stringify([
        { name: '不锈钢拉伸筒', model: '不锈钢机筒', qty: 17, unitCost: 0.4, pricingMode: 'lengthCm', included: true, componentType: 'stainlessStretchBarrel' },
    ]),
    costMode: 'components',
    bundleCost: 0,
};

const coils = [
    {
        spec: 'Y90',
        material: '钢带',
        sheets: 10,
        unitPrice: 0.21,
        wireWeight: 0.2,
        copperBase: 70,
        coilFee: 2,
        rotorFee: 3,
        cost: 21,
        defaultWireGauge: '0.75',
        defaultCapacitor: '20μF',
    },
];

const interpolationCoils = [
    {
        spec: 'Y90',
        material: '钢带',
        sheets: 10,
        unitPrice: 0.2,
        wireWeight: 0.2,
        copperBase: 70,
        coilFee: 2,
        rotorFee: 3,
        defaultCapacitor: '20μF',
    },
    {
        spec: 'Y90',
        material: '钢带',
        sheets: 20,
        unitPrice: 0.2,
        wireWeight: 0.4,
        copperBase: 70,
        coilFee: 4,
        rotorFee: 5,
        defaultCapacitor: '20μF',
    },
];

test('后端 BOM draft 可组装模板、长螺丝、线圈、电容和动态配置', () => {
    const result = buildRecipeBomDraft({
        templateId: 1,
        customBarrelLength: 190,
        coilSpec: 'Y90',
        coilSheets: 10,
        coilMaterial: '钢带',
        hasFloat: true,
        floatWire: '0.75',
        hasCable: true,
        cableWire: '0.75',
        cableLength: 3,
        cableAccessoryType: 'xinjie',
        longScrewExtraLength: 10,
        packingParts: [
            { model: '牛皮纸箱A', supplier: '包装供应商', qty: 1 },
            { model: '泡沫内衬', supplier: '包装供应商', qty: 1 },
        ],
        optionalParts: [],
    }, {
        template,
        shellMeta: { barrelLength: 170 },
        partsCatalog,
        coils,
    });

    assert.equal(result.shellPrice, 15.2);
    assert.equal(result.capacitorModel, '20μF');
    assert.equal(result.customBarrelLength, 190);
    assert.equal(result.longScrewExtraLength, 10);
    assert.equal(result.coilSnapshot.wireGauge, '0.75');

    const screw = result.parts.find(part => part.name === '不锈钢长螺丝');
    assert.equal(screw.model, '6*200');
    assert.equal(screw.snapshotPrice, 0.65);
    assert.match(screw.formula, /长螺丝长度=190\+10=200mm/);

    const barrel = result.parts.find(part => part.name === '不锈钢拉伸筒(按cm)');
    assert.equal(barrel.qty, 19);
    assert.equal(barrel.snapshotPrice, 0.8);
    assert.equal(barrel.formula, '不锈钢拉伸筒: 0.8×19cm（长度来自配方/型号变体）');

    const coil = result.parts.find(part => part.name === '线圈转子');
    assert.equal(coil.model, 'Y90-10');
    assert.equal(coil.snapshotPrice, 21.1);
    assert.equal(coil.formula, '0.21×10 + 0.2×70 + 2.00 + 3.00');

    assert.ok(result.parts.find(part => part.name === '电容' && part.model === '20μF'));
    assert.ok(result.parts.find(part => part.name === '浮球'));
    assert.ok(result.parts.find(part => part.name === '电缆线' && part.formula === '电缆单价 1.88×3m'));
    assert.ok(result.parts.find(part => part.model === '电缆配件费' && part.snapshotPrice === 1 && part.formula === '电缆配件费(新界式)'));
    assert.ok(result.parts.find(part => part.model === '牛皮纸箱A' && part.packagingMaterial === '牛皮纸箱'));
    assert.ok(result.parts.find(part => part.model === '泡沫内衬' && part.packagingMaterial === '泡沫'));
});

test('后端 BOM draft 不再使用泵壳 notes 默认机筒长度', () => {
    const result = buildRecipeBomDraft({
        templateId: 1,
        optionalParts: [],
    }, {
        template,
        shellMeta: { barrelLength: 170 },
        partsCatalog,
        coils,
    });

    assert.equal(result.customBarrelLength, null);

    const screw = result.parts.find(part => part.name === '不锈钢长螺丝');
    assert.equal(screw.model, '6*170');

    const barrel = result.parts.find(part => part.name === '不锈钢拉伸筒(按cm)');
    assert.equal(barrel.qty, 17);
});

test('后端 BOM draft 只有不锈钢拉伸筒组件才联动机筒长度和长螺丝', () => {
    const normalTemplate = {
        ...template,
        shellComponentsJson: JSON.stringify([
            { name: '铝机筒', model: '铝机筒', qty: 1, unitCost: 0.8, pricingMode: 'fixed', included: true, componentType: 'standard' },
        ]),
    };
    const result = buildRecipeBomDraft({
        customBarrelLength: 190,
        longScrewExtraLength: 10,
    }, {
        template: normalTemplate,
        partsCatalog,
        coils,
    });

    const barrel = result.parts.find(part => part.name === '铝机筒');
    const screw = result.parts.find(part => part.name === '不锈钢长螺丝');
    assert.equal(barrel.qty, 1);
    assert.equal(screw.model, '6*170');
    assert.equal(screw.dynamicRule, undefined);
});

test('不锈钢泵壳套件按机筒长度在整体价上加价', () => {
    const bundleTemplate = {
        ...template,
        costMode: 'bundle',
        bundleCost: 90,
        shellComponentsJson: '[]',
    };

    const result = buildRecipeBomDraft({
        templateId: 1,
        customBarrelLength: 170,
        optionalParts: [],
    }, {
        template: bundleTemplate,
        shellMeta: { isStainless: true },
        partsCatalog,
        coils,
    });

    const shell = result.parts.find(part => part.name === '泵壳套件');
    const shellRows = result.parts.filter(part => part.name === '泵壳套件' || String(part.name || '').includes('机筒长度加价'));
    assert.equal(result.shellPrice, 92);
    assert.equal(shellRows.length, 1);
    assert.equal(shell.snapshotPrice, 92);
    assert.equal(shell.baseSnapshotPrice, 90);
    assert.equal(shell.dynamicRule, 'stainlessShellBundleByBarrelLength');
    assert.equal(shell.barrelExtraCost, 2);
    assert.match(shell.formula, /150mm 起，每 10mm \+1/);
});

test('后端 BOM draft 线圈快照复用插值规则', () => {
    const result = buildRecipeBomDraft({
        coilSpec: 'Y90',
        coilSheets: 15,
        coilMaterial: '钢带',
    }, {
        partsCatalog,
        coils: interpolationCoils,
    });

    const coil = result.parts.find(part => part.name === '线圈转子');
    assert.equal(coil.snapshotPrice, 31);
    assert.equal(coil.source, '插值(10片↔20片, ratio=0.500)');
    assert.equal(result.coilSnapshot.formula, '0.2×15 + 0.3×70 + 3.00 + 4.00');
});

test('后端 BOM draft 支持客户指定线重重算线圈成本', () => {
    const result = buildRecipeBomDraft({
        coilSpec: 'Y90',
        coilSheets: 15,
        coilMaterial: '钢带',
        coilWireWeight: 0.5,
    }, {
        partsCatalog,
        coils: interpolationCoils,
    });

    const coil = result.parts.find(part => part.name === '线圈转子');
    assert.equal(result.coilSnapshot.wireWeight, 0.5);
    assert.equal(result.coilSnapshot.totalCost, 45);
    assert.equal(result.coilSnapshot.formula, '0.2×15 + 0.5×70 + 3.00 + 4.00');
    assert.equal(coil.snapshotPrice, 45);
    assert.equal(coil.formula, '0.2×15 + 0.5×70 + 3.00 + 4.00');
});
