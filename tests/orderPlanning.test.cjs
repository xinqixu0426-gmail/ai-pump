const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOrderPlan, buildPurchaseList, buildBalancedOrderPlans, buildSavedBalancedOrderPlanViews } = require('../api/services/orderPlanning.cjs');
const { purchaseRowIdentity } = require('../api/services/purchaseIdentity.cjs');

test('采购现名视图按保存 ID 读取，保留多配置行、采购进度和原始快照', () => {
    const catalog = [{ id: 1, model: '电缆-旧规格', supplier: '甲', price: 3, stock: 0 },
        { id: 2, model: '浮球-旧规格', supplier: '乙', price: 8, stock: 0 }];
    const order = { id: 1, items_json: JSON.stringify([{ qty: 2, partsJson: JSON.stringify([
        ...[1.5, 3.5].map(cableLength => ({ partId: 1, model: catalog[0].model, supplier: '甲', qty: 1, cableAssembly: true, cableLength })),
        { partId: 2, model: catalog[1].model, supplier: '乙', qty: 1 },
    ]) }]) };
    const previous = buildBalancedOrderPlans([order], catalog).get(1).purchaseList.map((row, index) => ({ ...row,
        id: `saved-row-${index}`, orderedQty: 1, receivedQty: 1, stockedQty: 0,
        purchasePrice: 10 + index, purchasePriceRecorded: true, actualSupplier: '实际采购商',
        stockInHistory: [],
    }));
    order.purchase_list_json = JSON.stringify(previous);
    const before = JSON.stringify(order);
    const renamed = catalog.map((part, index) => ({ ...part, model: `新显示名称${index}` }));
    const view = buildSavedBalancedOrderPlanViews([order], renamed).get(1);
    assert.equal(view.purchaseList.length, 3);
    for (let index = 0; index < 3; index += 1) {
        const row = view.purchaseList[index];
        const old = previous[index];
        assert.equal(row.model, renamed.find(part => part.id === row.partId).model);
        for (const field of ['id', 'partId', 'identityKey', 'purchaseUnit', 'stockQtyPerUnit', 'plannedQty', 'orderedQty', 'receivedQty', 'stockedQty', 'purchasePrice', 'purchasePriceRecorded', 'actualSupplier']) {
            assert.equal(row[field], old[field], field);
        }
        assert.equal(purchaseRowIdentity(row), old.identityKey, '显示名称变化不得改变配置身份');
    }
    assert.equal(JSON.stringify(order), before);
    assert.throws(() => buildBalancedOrderPlans([order], renamed, { readSavedReferences: true }), { code: 'BOM_PART_ID_MODEL_MISMATCH' });
});

test('采购现名视图拒绝供应商冲突、停用、失效 ID 和无法接续的历史进度', () => {
    const part = { id: 1, model: '新名', supplier: '甲', stock: 0, price: 1 };
    const order = { id: 1, items_json: JSON.stringify([{ qty: 1, partsJson: JSON.stringify([{ partId: 1, model: '旧名', supplier: '甲', qty: 1 }]) }]) };
    assert.throws(() => buildSavedBalancedOrderPlanViews([order], [{ ...part, supplier: '乙' }]), { code: 'BOM_PART_ID_SUPPLIER_MISMATCH' });
    assert.throws(() => buildSavedBalancedOrderPlanViews([order], [{ ...part, deletedAt: 'deleted' }]), { code: 'BOM_PART_ID_NOT_FOUND' });
    assert.throws(() => buildSavedBalancedOrderPlanViews([order], [{ ...part, id: 2 }]), { code: 'BOM_PART_ID_NOT_FOUND' });
    assert.throws(() => buildSavedBalancedOrderPlanViews([{ ...order,
        purchase_list_json: JSON.stringify([{ model: '旧名', supplier: '甲', orderedQty: 1 }]),
    }], [part]), { code: 'PURCHASE_CONTINUITY_LOST' });
});

const partsCatalog = [
    { Id: 1, model: '201', name: '轴承', category: '轴承', supplier: '轴承供应商', stock: 3, price: 1.1 },
    { Id: 3, model: '电缆-线径0.75', name: '电缆线', category: '电缆线', supplier: '线缆供应商', stock: 5, price: 1.88 },
    {
        Id: 2,
        model: 'φ6 不锈钢长螺丝',
        category: '螺丝',
        supplier: '螺丝供应商',
        stock: 100,
        price: 0.3,
        notes: JSON.stringify({
            screwPricing: {
                enabled: true,
                diameter: 6,
            },
        }),
    },
];

test('采购清单按 BOM × 订单数量汇总并扣库存', () => {
    const purchaseList = buildPurchaseList([
        {
            qty: 2,
            partsJson: JSON.stringify([
                { model: '201', name: '轴承', supplier: '轴承供应商', qty: 2 },
            ]),
        },
    ], partsCatalog);

    assert.equal(purchaseList.length, 1);
    assert.equal(purchaseList[0].model, '201');
    assert.equal(purchaseList[0].totalQty, 4);
    assert.equal(purchaseList[0].currentStock, 3);
    assert.equal(purchaseList[0].needToBuy, 1);
    assert.equal(purchaseList[0].partId, 1);
    assert.equal(purchaseList[0].purchasePrice, 0);
    assert.equal(purchaseList[0].purchasePriceRecorded, false);
    assert.equal(purchaseList[0].referencePrice, 1.1);
    assert.equal(purchaseList[0].referencePriceSource, 'part_catalog');
});

test('参数化长螺丝采购项可使用基础螺丝供应商且不扣基础库存', () => {
    const purchaseList = buildPurchaseList([
        {
            qty: 1,
            partsJson: JSON.stringify([
                { model: '6*195', name: '不锈钢长螺丝', supplier: '', qty: 4 },
            ]),
        },
    ], partsCatalog);

    assert.equal(purchaseList.length, 1);
    assert.equal(purchaseList[0].model, '6*195');
    assert.equal(purchaseList[0].supplier, '螺丝供应商');
    assert.equal(purchaseList[0].totalQty, 4);
    assert.equal(purchaseList[0].currentStock, 0);
    assert.equal(purchaseList[0].needToBuy, 4);
    assert.equal(purchaseList[0].partId, undefined);
});

test('参数化长螺丝补建零件后自动关联 partId 并保留原采购进度', () => {
    const catalog = [
        ...partsCatalog,
        { Id: 4, model: '6*195', category: '螺丝', supplier: '螺丝供应商', stock: 0, price: 0.63 },
    ];
    const plans = buildBalancedOrderPlans([{
        id: 1,
        created_at: '2026-01-01',
        items: [{
            qty: 1,
            partsJson: JSON.stringify([
                { model: '6*195', name: '机筒螺丝', supplier: '螺丝供应商', qty: 4, dynamicRule: 'longScrewByBarrelLength' },
            ]),
        }],
        purchase_list_json: JSON.stringify([{
            model: '6*195',
            name: '机筒螺丝',
            supplier: '螺丝供应商',
            plannedQty: 4,
            orderedQty: 2,
            receivedQty: 1,
            stockedQty: 0,
            identityKey: 'model:6*195|supplier:螺丝供应商',
            inventoryType: 'part',
        }]),
    }], catalog);
    const screw = plans.get(1).purchaseList[0];

    assert.equal(screw.partId, 4);
    assert.equal(screw.identityKey, 'part:4');
    assert.equal(screw.orderedQty, 2);
    assert.equal(screw.receivedQty, 1);
});

test('采购清单将旧电缆两行合并为按根采购的成品电缆', () => {
    const purchaseList = buildPurchaseList([{
        qty: 2,
        partsJson: JSON.stringify([
            { model: '电缆-线径0.75', name: '电缆线', supplier: '线缆供应商', qty: 8, snapshotPrice: 1.88 },
            { model: '电缆配件费', name: '新界式', qty: 1, snapshotPrice: 3.4, cableAccessoryType: 'xinjie' },
        ]),
    }], partsCatalog);

    assert.equal(purchaseList.length, 1);
    assert.equal(purchaseList[0].model, '电缆-线径0.75');
    assert.equal(purchaseList[0].totalQty, 2);
    assert.equal(purchaseList[0].currentStock, 0);
    assert.equal(purchaseList[0].needToBuy, 2);
    assert.equal(purchaseList[0].purchaseUnit, '根');
    assert.equal(purchaseList[0].stockQtyPerUnit, 8);
    assert.equal(purchaseList[0].specification, '每根 8m + 新界式');
});

test('采购计划自动把历史电缆米数进度换算为成品电缆根数', () => {
    const items = [{
        qty: 30,
        partsJson: JSON.stringify([{
            model: '电缆-线径0.75',
            name: '成品电缆（新界式）',
            supplier: '线缆供应商',
            qty: 1,
            inventoryQty: 8,
            cableLength: 8,
            cableAccessoryType: 'xinjie',
            cableAccessoryName: '新界式',
            cableAssembly: true,
        }]),
    }];
    const plans = buildBalancedOrderPlans([{
        id: 1,
        created_at: '2026-01-01',
        items,
        purchase_list_json: JSON.stringify([{
            model: '电缆-线径0.75',
            name: '成品电缆（新界式）',
            supplier: '线缆供应商',
            plannedQty: 240,
            orderedQty: 240,
            receivedQty: 0,
            stockedQty: 0,
            partId: 3,
            identityKey: 'part:3',
        }]),
    }], partsCatalog);
    const cable = plans.get(1).purchaseList[0];

    assert.equal(cable.totalQty, 30);
    assert.equal(cable.plannedQty, 30);
    assert.equal(cable.orderedQty, 30);
    assert.equal(cable.purchaseUnit, '根');
    assert.equal(cable.stockQtyPerUnit, 8);
});

test('采购计划同时生成供应商待办', () => {
    const plan = buildOrderPlan([
        {
            qty: 1,
            partsJson: JSON.stringify([
                { model: '201', name: '轴承', supplier: '轴承供应商', qty: 5 },
            ]),
        },
    ], partsCatalog);

    assert.equal(plan.purchaseList[0].needToBuy, 2);
    assert.equal(plan.todos.length, 1);
    assert.equal(plan.todos[0].supplier, '轴承供应商');
    assert.match(plan.todos[0].description, /201×2/);
});

test('外包装估算只用于成本预估，不进入正式采购清单', () => {
    const purchaseList = buildPurchaseList([{
        qty: 30,
        partsJson: JSON.stringify([
            {
                model: '外包装估算',
                name: '外包装估算（牛皮纸箱）',
                qty: 1,
                snapshotPrice: 4,
                packagingMaterial: '牛皮纸箱',
                costSource: 'manual',
            },
            { model: '201', name: '轴承', supplier: '轴承供应商', qty: 1 },
        ]),
    }], partsCatalog);

    assert.deepEqual(purchaseList.map(item => item.model), ['201']);
});

test('不锈钢接轴加工工艺不进入采购清单', () => {
    const purchaseList = buildPurchaseList([{
        qty: 2,
        partsJson: JSON.stringify([
            { model: '201', name: '轴承', supplier: '轴承供应商', qty: 1 },
            {
                model: '不锈钢接轴加工',
                name: '转子不锈钢接轴加工',
                qty: 1,
                snapshotPrice: 6,
                inventoryType: 'none',
                costRole: 'rotorProcess',
                processCode: 'stainless_friction_weld',
            },
        ]),
    }], partsCatalog);

    assert.deepEqual(purchaseList.map(item => item.model), ['201']);
});

test('缺少 inventoryType 的历史接轴工艺快照仍不进入采购清单', () => {
    const result = buildPurchaseList([{
        qty: 2,
        partsJson: JSON.stringify([{
            name: '转子不锈钢接轴加工',
            model: '不锈钢接轴加工',
            qty: 1,
            snapshotPrice: 6,
            costRole: 'rotorProcess',
            processCode: 'stainless_friction_weld',
        }]),
    }], []);

    assert.deepEqual(result, []);
});

test('同型号不同供应商按独立物料采购', () => {
    const catalog = [
        { Id: 10, model: '轴承X', supplier: '供应商A', stock: 1, price: 1 },
        { Id: 11, model: '轴承X', supplier: '供应商B', stock: 2, price: 1.2 },
    ];
    const purchaseList = buildPurchaseList([{
        qty: 1,
        partsJson: JSON.stringify([
            { model: '轴承X', supplier: '供应商A', qty: 3 },
            { model: '轴承X', supplier: '供应商B', qty: 4 },
        ]),
    }], catalog);

    assert.equal(purchaseList.length, 2);
    assert.deepEqual(purchaseList.map(item => [item.supplier, item.needToBuy]), [
        ['供应商A', 2],
        ['供应商B', 2],
    ]);
});

test('指定供应商不存在时不得借用同型号其他供应商的库存身份', () => {
    const catalog = [
        { Id: 10, model: '轴承X', supplier: '供应商A', stock: 8, price: 1 },
        { Id: 11, model: '轴承X', supplier: '供应商B', stock: 6, price: 1.2 },
    ];
    const [item] = buildPurchaseList([{
        qty: 1,
        partsJson: JSON.stringify([
            { model: '轴承X', supplier: '供应商C', qty: 2 },
        ]),
    }], catalog);

    assert.equal(item.supplier, '供应商C');
    assert.equal(item.partId, undefined);
    assert.equal(item.currentStock, 0);
    assert.equal(item.needToBuy, 2);
    assert.equal(item.referencePriceSource, 'none');
});

test('BOM 已绑定 partId 仍拒绝明确供应商漂移，未声明供应商可按 ID 读取', () => {
    const catalog = [
        { Id: 10, model: '轴承X', supplier: '供应商A-新', stock: 8, price: 1 },
        { Id: 11, model: '轴承X', supplier: '供应商B', stock: 6, price: 1.2 },
    ];
    const makeItems = supplier => [{ qty: 1, partsJson: JSON.stringify([
        { partId: 10, model: '轴承X', supplier, qty: 2 },
    ]) }];
    assert.throws(() => buildPurchaseList(makeItems('供应商A-旧'), catalog),
        { code: 'PURCHASE_PART_SUPPLIER_CHANGED' });
    const [item] = buildPurchaseList(makeItems(''), catalog);
    assert.equal(item.partId, 10);
    assert.equal(item.supplier, '供应商A-新');
    assert.equal(item.currentStock, 8);
    assert.equal(item.needToBuy, 0);
});

test('BOM 未指定供应商时只有同型号唯一候选才允许自动绑定库存', () => {
    const one = buildPurchaseList([{
        qty: 1,
        partsJson: JSON.stringify([{ model: '轴承Y', qty: 2 }]),
    }], [{ Id: 20, model: '轴承Y', supplier: '唯一供应商', stock: 3, price: 1 }]);
    assert.equal(one[0].partId, 20);

    const multiple = buildPurchaseList([{
        qty: 1,
        partsJson: JSON.stringify([{ model: '轴承Y', qty: 2 }]),
    }], [
        { Id: 20, model: '轴承Y', supplier: '供应商A', stock: 3, price: 1 },
        { Id: 21, model: '轴承Y', supplier: '供应商B', stock: 3, price: 1.1 },
    ]);
    assert.equal(multiple[0].partId, undefined);
    assert.equal(multiple[0].currentStock, 0);
    assert.equal(multiple[0].needToBuy, 2);
});

test('多个活动订单按顺序共享库存且不会重复占用', () => {
    const catalog = [{ Id: 20, model: '机械密封', supplier: '供应商A', stock: 10, price: 5 }];
    const item = {
        qty: 1,
        partsJson: JSON.stringify([{ model: '机械密封', supplier: '供应商A', qty: 8 }]),
    };
    const plans = buildBalancedOrderPlans([
        { id: 1, created_at: '2026-01-01', items: [item], purchase_list_json: '[]' },
        { id: 2, created_at: '2026-01-02', items: [item], purchase_list_json: '[]' },
    ], catalog);

    assert.equal(plans.get(1).purchaseList[0].needToBuy, 0);
    assert.equal(plans.get(2).purchaseList[0].currentStock, 2);
    assert.equal(plans.get(2).purchaseList[0].needToBuy, 6);
});

test('线圈转子按正式线圈方案分配库存，不要求写入零件库', () => {
    const coilsCatalog = [{
        id: 31,
        spec: '12',
        sheets: 180,
        material: '钢带',
        slotType: '小眼',
        schemeStatus: 'official',
        pricingMode: 'kit',
        kitPrice: 146.8,
        stock: 8,
        cost: 146.8,
    }];
    const item = {
        qty: 6,
        partsJson: JSON.stringify([{
            model: '12-180',
            name: '线圈转子',
            material: '钢带',
            slotType: '小眼',
            qty: 1,
            costSource: 'coil',
        }]),
    };
    const plans = buildBalancedOrderPlans([
        { id: 1, created_at: '2026-01-01', items: [item], purchase_list_json: '[]' },
        { id: 2, created_at: '2026-01-02', items: [item], purchase_list_json: '[]' },
    ], partsCatalog, { coilsCatalog });
    const first = plans.get(1).purchaseList[0];
    const second = plans.get(2).purchaseList[0];

    assert.equal(first.inventoryType, 'coil');
    assert.equal(first.coilId, 31);
    assert.equal(first.partId, undefined);
    assert.equal(first.purchaseUnit, '套');
    assert.equal(first.currentStock, 8);
    assert.equal(first.needToBuy, 0);
    assert.equal(first.referencePrice, 146.8);
    assert.equal(first.referencePriceSource, 'coil_total_cost');
    assert.equal(second.currentStock, 2);
    assert.equal(second.needToBuy, 4);
    assert.equal(second.referencePrice, 146.8);
    assert.equal(second.referencePriceSource, 'coil_total_cost');
});

test('没有正式方案的计算型线圈保持非库存项', () => {
    const purchaseList = buildPurchaseList([{
        qty: 3,
        partsJson: JSON.stringify([{
            model: '12-190',
            name: '线圈转子',
            material: '钢带',
            slotType: '小眼',
            qty: 1,
            costSource: 'coil',
        }]),
    }], partsCatalog, { coilsCatalog: [] });

    assert.equal(purchaseList[0].inventoryType, 'none');
    assert.equal(purchaseList[0].coilId, undefined);
    assert.equal(purchaseList[0].plannedQty, 3);
    assert.equal(purchaseList[0].referencePrice, 0);
    assert.equal(purchaseList[0].referencePriceSource, 'none');
});
