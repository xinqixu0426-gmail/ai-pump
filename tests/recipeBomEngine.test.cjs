const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRecipeBomDraft } = require('../api/services/recipeBomEngine.cjs');

const partsCatalog = [
    { model: '不锈钢机筒', category: '配件', supplier: '错误分类供应商', price: 0.2 },
    { model: '不锈钢机筒', category: '泵壳搭配', supplier: '机筒供应商', price: 0.8 },
    { model: '铝机筒', category: '泵壳搭配', supplier: '铝件供应商', price: 8 },
    { model: 'V750铝铸件小套件', category: '泵壳搭配', supplier: '张启彪', price: 45 },
    { model: '6*基础', category: '螺丝', supplier: '螺丝供应商', price: 0.3, notes: JSON.stringify({ screwPricing: { enabled: true, diameter: 6 } }) },
    { model: '201', category: '轴承', supplier: '轴承供应商', price: 1.1 },
    { model: '20μF', category: '电容', supplier: '电容供应商', price: 3 },
    { model: '浮球-线径0.75', category: '浮球', supplier: '线缆供应商', price: 7.6 },
    { model: '电缆-线径0.75', category: '电缆线', supplier: '线缆供应商', price: 1.88, notes: JSON.stringify({ cableAccessoryFees: { standard: 0.5, xinjie: 1 }, cableAccessoryNames: { standard: '普通铜套', xinjie: '新界式' } }) },
    { model: '牛皮纸箱A', category: '包装', supplier: '包装供应商', price: 2 },
    { model: '泡沫内衬', category: '包装', supplier: '包装供应商', price: 0.8 },
].map((part, index) => ({ id: index + 1, ...part }));

const template = {
    Id: 1,
    shellModel: '测试泵壳',
    partsJson: JSON.stringify([
        { model: '6*170', name: '不锈钢长螺丝', supplier: '', qty: 4 },
        { model: '201', name: '轴承', supplier: '轴承供应商', qty: 2 },
    ]),
    shellComponentsJson: JSON.stringify([
        { name: '不锈钢拉伸筒', model: '不锈钢机筒', supplier: '机筒供应商', qty: 17, unitCost: 0.4, pricingMode: 'lengthCm', included: true, componentType: 'stainlessStretchBarrel' },
    ]),
    costMode: 'components',
    bundleCost: 0,
};

const coils = [
    {
        id: 77,
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
    assert.equal(coil.coilId, 77);
    assert.equal(coil.inventoryType, 'coil');
    assert.equal(coil.snapshotPrice, 21.1);
    assert.equal(coil.formula, '0.21×10 + 0.2×70 + 2.00 + 3.00');

    assert.ok(result.parts.find(part => part.name === '电容' && part.model === '20μF'));
    assert.ok(result.parts.find(part => part.name === '浮球'));
    const cable = result.parts.find(part => part.name === '成品电缆（新界式）');
    assert.equal(cable.model, '电缆-线径0.75');
    assert.equal(cable.qty, 1);
    assert.equal(cable.inventoryQty, 3);
    assert.equal(cable.snapshotPrice, 6.64);
    assert.match(cable.formula, /线材 1.88×3m \+ 新界式 1/);
    assert.equal(result.parts.some(part => part.model === '电缆配件费'), false);
    assert.ok(result.parts.find(part => part.model === '牛皮纸箱A' && part.packagingMaterial === '牛皮纸箱'));
    assert.ok(result.parts.find(part => part.model === '泡沫内衬' && part.packagingMaterial === '泡沫'));
});

test('后端 BOM draft 的新界式浮球统一读取全局附加费', () => {
    const result = buildRecipeBomDraft({
        hasFloat: true,
        floatWire: '0.75',
        floatAccessoryType: 'xinjie',
    }, {
        partsCatalog,
        coils,
        getSetting: key => key === 'float_accessory_delta' ? '0.6' : undefined,
    });

    const floatPart = result.parts.find(part => part.name === '浮球-新界式');
    assert.equal(floatPart.snapshotPrice, 8.2);
    assert.equal(floatPart.floatAccessoryDelta, 0.6);
    assert.match(floatPart.formula, /7\.6\+新界差价 0\.6/);
});

test('后端 BOM draft 的成品电缆统一读取全局名称和配件费', () => {
    const result = buildRecipeBomDraft({
        hasCable: true,
        cableWire: '0.75',
        cableLength: 3,
        cableAccessoryType: 'xinjie',
    }, {
        partsCatalog,
        coils,
        getSetting: key => key === 'cable_accessories'
            ? JSON.stringify({ xinjie: { name: '全局防水接头', fee: 2.6 } })
            : undefined,
    });

    const cable = result.parts.find(part => part.cableAssembly);
    assert.equal(cable.name, '成品电缆（全局防水接头）');
    assert.equal(cable.snapshotPrice, 8.24);
    assert.equal(cable.cableAccessorySource, 'system_settings');
    assert.equal(cable.formulaVersion, 'complete-cable-v1');
});

test('后端 BOM draft 兼容配方保存的完整电缆型号且不重复拼接线径前缀', () => {
    const result = buildRecipeBomDraft({
        hasCable: true,
        cableWire: '电缆-线径0.75',
        cableLength: 3,
        cableAccessoryType: 'standard',
    }, {
        partsCatalog,
        coils,
    });

    const cable = result.parts.find(part => part.cableAssembly);
    assert.equal(cable.model, '电缆-线径0.75');
    assert.equal(cable.pricingComplete, true);
});

test('后端 BOM draft 兼容带业务前缀的完整电缆型号', () => {
    const catalog = [
        ...partsCatalog,
        { model: 'TEST-电缆-3x1.0', supplier: '测试供应商', price: 5.8, category: '电缆' },
    ];
    const result = buildRecipeBomDraft({
        hasCable: true,
        cableWire: 'TEST-电缆-3x1.0',
        cableLength: 3,
        cableAccessoryType: 'standard',
    }, {
        partsCatalog: catalog,
        coils,
    });

    const cable = result.parts.find(part => part.cableAssembly);
    assert.equal(cable.model, 'TEST-电缆-3x1.0');
    assert.equal(cable.pricingComplete, true);
});

test('后端 BOM draft 启用电缆时拒绝空线径、非正长度和非法配件类型', () => {
    assert.throws(
        () => buildRecipeBomDraft({ hasCable: true, cableLength: 3 }, { partsCatalog, coils }),
        error => error?.code === 'CABLE_MODEL_REQUIRED'
    );
    assert.throws(
        () => buildRecipeBomDraft({ hasCable: true, cableWire: '0.75', cableLength: 0 }, { partsCatalog, coils }),
        error => error?.code === 'CABLE_LENGTH_INVALID'
    );
    assert.throws(
        () => buildRecipeBomDraft({ hasCable: true, cableWire: '0.75', cableLength: 3, cableAccessoryType: 'unknown' }, { partsCatalog, coils }),
        error => error?.code === 'CABLE_ACCESSORY_TYPE_INVALID'
    );
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

test('供应商小套件只生成父项 BOM，组成项不重复计价或扣库存', () => {
    const subassemblyTemplate = {
        ...template,
        partsJson: '[]',
        shellComponentsJson: JSON.stringify([
            {
                name: '铝铸件小套件',
                model: 'V750铝铸件小套件',
                supplier: '张启彪',
                qty: 1,
                unitCost: 0,
                pricingMode: 'fixed',
                included: true,
                componentType: 'subassembly',
                subassemblyContents: [
                    { name: '上帽', qty: 1, referenceUnitPrice: 12 },
                    { name: '铝机筒', qty: 1, referenceUnitPrice: 20 },
                    { name: '油缸盖', qty: 1, note: '与上帽同厂' },
                ],
            },
        ]),
    };

    const result = buildRecipeBomDraft({}, {
        template: subassemblyTemplate,
        partsCatalog,
        coils,
    });

    const subassembly = result.parts.find(part => part.model === 'V750铝铸件小套件');
    assert.ok(subassembly);
    assert.equal(subassembly.snapshotPrice, 45);
    assert.equal(subassembly.componentType, 'subassembly');
    assert.equal(subassembly.inventoryType, 'part');
    assert.deepEqual(subassembly.subassemblyContents, [
        { name: '上帽', qty: 1, referenceUnitPrice: 12 },
        { name: '铝机筒', qty: 1, referenceUnitPrice: 20 },
        { name: '油缸盖', qty: 1, note: '与上帽同厂' },
    ]);
    assert.match(subassembly.formula, /子项不单独计价/);
    assert.equal(result.parts.some(part => ['上帽', '铝机筒', '油缸盖'].includes(part.name)), false);
    assert.equal(result.shellPrice, 45);
});

test('BOM 引擎拒绝历史模板中的显式零数量，不再静默改成 1', () => {
    const invalidTemplate = {
        ...template,
        partsJson: '[]',
        shellComponentsJson: JSON.stringify([{
            name: '铝机筒',
            model: '铝机筒',
            qty: 0,
            unitCost: 8,
            pricingMode: 'fixed',
            included: true,
            componentType: 'standard',
        }]),
    };

    assert.throws(
        () => buildRecipeBomDraft({}, {
            template: invalidTemplate,
            partsCatalog,
            coils,
        }),
        /component\.qty 必须是正数/
    );
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

test('后端 BOM draft 可精确获取 12 冷轧国标眼绕组并计入成本', () => {
    const coldRolledCoils = [
        {
            spec: '12',
            diameterMm: 120,
            material: '冷轧',
            slotType: '国标眼',
            schemeStatus: 'official',
            sheets: 220,
            unitPrice: 0.23,
            wireWeight: 0.82,
            copperBase: 70,
            coilFee: 8,
            rotorFee: 5,
            defaultWireGauge: '0.75',
            defaultCapacitor: '20μF',
        },
    ];
    const result = buildRecipeBomDraft({
        coilSpec: '12',
        coilSheets: 220,
        coilMaterial: '冷轧',
        coilSlotType: '国标眼',
    }, {
        partsCatalog,
        coils: coldRolledCoils,
    });

    assert.equal(result.coilSnapshot.material, '冷轧');
    assert.equal(result.coilSnapshot.slotType, '国标眼');
    assert.equal(result.coilSnapshot.source, '精确匹配');
    assert.equal(result.coilSnapshot.totalCost, 121);
    const coil = result.parts.find(part => part.name === '线圈转子');
    assert.equal(coil.model, '12-220');
    assert.equal(coil.material, '冷轧');
    assert.equal(coil.slotType, '国标眼');
    assert.equal(coil.snapshotPrice, 121);
});

test('正式 BOM 重建保留选择项 partId 并使用该目录身份和价格', () => {
    const partsCatalog = [
        { id: 801, model: '纸箱-A', supplier: '供应商甲', category: '包装', price: 5 },
        { id: 802, model: '纸箱-A', supplier: '供应商乙', category: '包装', price: 4 },
        { id: 803, model: '附加件-A', supplier: '供应商丙', category: '标准件', price: 7 },
    ];
    const result = buildRecipeBomDraft({
        requireStablePartIdentity: true,
        optionalParts: [{ partId: 803, model: '附加件-A', supplier: '', qty: 1, snapshotPrice: 0.01 }],
        packingParts: [{ partId: 801, model: '纸箱-A', supplier: '', qty: 1, snapshotPrice: 0.01, packingRole: 'container' }],
    }, { partsCatalog, coils: [] });

    const optional = result.parts.find(part => part.partId === 803);
    const packing = result.parts.find(part => part.partId === 801);
    assert.equal(optional.supplier, '供应商丙');
    assert.equal(optional.snapshotPrice, 7);
    assert.equal(packing.supplier, '供应商甲');
    assert.equal(packing.snapshotPrice, 5);
});

test('正式 BOM 重建允许人工估价可选件和包装件不绑定目录身份', () => {
    const result = buildRecipeBomDraft({
        requireStablePartIdentity: true,
        optionalParts: [{ partId: 999, model: '临时加工件', qty: 2, snapshotPrice: 12.5, costSource: 'manual' }],
        packingParts: [{ partId: 998, model: '定制包装', qty: 1, snapshotPrice: 18, costSource: 'manual' }],
    }, { partsCatalog: [], coils: [] });

    const optional = result.parts.find(part => part.model === '临时加工件');
    const packing = result.parts.find(part => part.model === '定制包装');
    assert.equal(optional.partId, undefined);
    assert.equal(optional.snapshotPrice, 12.5);
    assert.equal(optional.costSource, 'manual');
    assert.equal(packing.partId, undefined);
    assert.equal(packing.snapshotPrice, 18);
    assert.equal(packing.costSource, 'manual');
});

test('正式 BOM 重建拒绝多供应商电缆最低价猜选', () => {
    const cables = [
        { id: 811, model: '电缆-线径0.75', supplier: '供应商甲', category: '电缆', price: 2 },
        { id: 812, model: '电缆-线径0.75', supplier: '供应商乙', category: '电缆', price: 1.5 },
    ];
    assert.throws(
        () => buildRecipeBomDraft({
            requireStablePartIdentity: true,
            hasCable: true,
            cableWire: '0.75',
            cableLength: 5,
            cableAccessoryType: 'standard',
        }, { partsCatalog: cables, coils: [], getSetting: () => undefined }),
        error => error.code === 'BOM_PART_IDENTITY_AMBIGUOUS'
            && error.statusCode === 422
    );
});
