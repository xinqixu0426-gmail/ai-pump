const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOrderPlan, buildPurchaseList, buildBalancedOrderPlans } = require('../api/services/orderPlanning.cjs');

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
