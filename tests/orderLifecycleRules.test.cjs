const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '../src/utils/orderLifecycleRules.ts');
const source = fs.readFileSync(sourcePath, 'utf8')
    .replace(/import[^;]+;\n/g, '');
const compiled = ts.transpileModule(`${source}\nmodule.exports = { ORDER_STATUS_COLOR, buildOrderKpis, orderPurchaseProgress, filterOrders, sortOrders };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleStub = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', compiled)(moduleStub, moduleStub.exports);
const {
    ORDER_STATUS_COLOR,
    buildOrderKpis,
    orderPurchaseProgress,
    filterOrders,
    sortOrders,
} = moduleStub.exports;

function order(overrides) {
    return {
        id: overrides.id,
        customerName: overrides.customerName || '客户',
        contractNo: overrides.contractNo || '',
        status: overrides.status || '待采购',
        items: overrides.items || [{ id: 'i', recipeName: '普通泵', qty: 1, partsJson: '[]', unitCost: 1, profitMargin: 1.1, unitPrice: 1.1 }],
        purchaseList: overrides.purchaseList || [],
        todos: overrides.todos || [],
        totalCost: overrides.totalCost || 0,
        totalPrice: overrides.totalPrice || 0,
        totalProfit: overrides.totalProfit || 0,
        createdAt: overrides.createdAt || '2026-06-29T00:00:00.000Z',
        updatedAt: overrides.updatedAt || '2026-06-29T00:00:00.000Z',
    };
}

function purchase(overrides) {
    return {
        model: overrides.model,
        name: overrides.name || overrides.model,
        supplier: overrides.supplier || '',
        totalQty: overrides.totalQty || overrides.needToBuy || 0,
        currentStock: overrides.currentStock || 0,
        needToBuy: overrides.needToBuy || 0,
        purchased: Boolean(overrides.purchased),
        partId: overrides.partId,
    };
}

test('订单生命周期规则统计 KPI、筛选和排序', () => {
    const orders = [
        order({ id: '1', customerName: '客户A', status: '待采购', totalPrice: 100, totalProfit: 20, createdAt: '2026-06-01' }),
        order({ id: '2', customerName: '客户B', status: '采购中', totalPrice: 200, totalProfit: 30, createdAt: '2026-06-02', items: [{ recipeName: '深井泵' }] }),
        order({ id: '3', customerName: '客户A', status: '已完成', totalPrice: 300, totalProfit: 40, createdAt: '2026-06-03' }),
    ];

    assert.equal(ORDER_STATUS_COLOR['采购中'], 'info');
    assert.deepEqual(buildOrderKpis(orders), { pending: 2, completed: 1, totalRevenue: 600, totalProfit: 90 });
    assert.deepEqual(filterOrders({ orders, customer: '客户A', status: '全部', searchQuery: '' }).map(item => item.id), ['1', '3']);
    assert.deepEqual(filterOrders({ orders, status: '采购中', searchQuery: '深井' }).map(item => item.id), ['2']);
    assert.deepEqual(sortOrders(orders, 'createdAt', 'desc').map(item => item.id), ['3', '2', '1']);
});

test('订单生命周期规则计算采购进度', () => {
    const sourceOrder = order({
        id: '1',
        purchaseList: [
            purchase({ model: 'A', supplier: 'S1', needToBuy: 2 }),
            purchase({ model: 'B', supplier: 'S1', needToBuy: 1, purchased: true }),
            purchase({ model: 'C', supplier: 'S1', needToBuy: 0 }),
        ],
        todos: [{ id: 't1', supplier: 'S1', description: '买 A', done: false }],
    });

    assert.deepEqual(orderPurchaseProgress(sourceOrder), { needCount: 2, purchasedCount: 1 });
});
