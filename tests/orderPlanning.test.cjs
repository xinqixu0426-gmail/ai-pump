const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOrderPlan, buildPurchaseList } = require('../api/services/orderPlanning.cjs');

const partsCatalog = [
    { Id: 1, model: '201', name: '轴承', category: '轴承', supplier: '轴承供应商', stock: 3, price: 1.1 },
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
