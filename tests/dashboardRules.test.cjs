const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '../src/utils/dashboardRules.ts');
const source = fs.readFileSync(sourcePath, 'utf8')
    .replace(/import[^;]+;\n/g, '');
const compiled = ts.transpileModule(`${source}\nmodule.exports = { sameLocalDay, groupOrdersByStatus, pendingPurchaseItemCount, outOfStockPartCount, buildDashboardKpis, buildDashboardTrends, buildDashboardWorkbench };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleStub = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', compiled)(moduleStub, moduleStub.exports);
const {
    sameLocalDay,
    groupOrdersByStatus,
    pendingPurchaseItemCount,
    outOfStockPartCount,
    buildDashboardKpis,
    buildDashboardTrends,
    buildDashboardWorkbench,
} = moduleStub.exports;

function order(overrides) {
    return {
        id: overrides.id,
        customerName: overrides.customerName || '客户',
        contractNo: overrides.contractNo || '',
        status: overrides.status || '待采购',
        items: [],
        purchaseList: overrides.purchaseList || [],
        todos: [],
        totalCost: 0,
        totalPrice: overrides.totalPrice || 0,
        totalProfit: overrides.totalProfit || 0,
        createdAt: overrides.createdAt || '2026-06-29T08:00:00.000Z',
        updatedAt: overrides.updatedAt || '2026-06-29T08:00:00.000Z',
    };
}

function purchase(overrides) {
    return {
        model: overrides.model || 'A',
        name: overrides.name || 'A',
        supplier: overrides.supplier || '',
        totalQty: overrides.totalQty || overrides.needToBuy || 0,
        currentStock: overrides.currentStock || 0,
        needToBuy: overrides.needToBuy || 0,
        purchased: Boolean(overrides.purchased),
    };
}

test('看板规则统计状态分组、顶部角标和 KPI fallback', () => {
    const orders = [
        order({ id: '1', status: '待采购', totalPrice: 100, totalProfit: 20, purchaseList: [purchase({ supplier: 'S1', needToBuy: 2 })] }),
        order({ id: '2', status: '采购中', totalPrice: 200, totalProfit: 30, purchaseList: [purchase({ supplier: 'S1', needToBuy: 1, purchased: true })] }),
        order({ id: '3', status: '已完成', totalPrice: 300, totalProfit: 40, purchaseList: [purchase({ supplier: 'S2', needToBuy: 5 })] }),
    ];
    const parts = [{ stock: 0 }, { stock: 3 }, { stock: 9 }];
    const grouped = groupOrdersByStatus(orders);
    const kpis = buildDashboardKpis({ businessSummary: null, orders, ordersByStatus: grouped, parts });

    assert.equal(grouped['待采购'].length, 1);
    assert.equal(grouped['采购中'].length, 1);
    assert.equal(pendingPurchaseItemCount(orders), 1);
    assert.equal(outOfStockPartCount(parts), 1);
    assert.deepEqual(kpis, { totalRevenue: 600, totalProfit: 90, pendingCount: 2, lowStockParts: 2 });
});

test('看板规则生成趋势和 fallback 工作台', () => {
    const now = new Date('2026-06-29T12:00:00.000Z');
    const orders = [
        order({ id: '1', status: '待采购', totalPrice: 100, totalProfit: 20, createdAt: '2026-06-29T08:00:00.000Z', purchaseList: [purchase({ supplier: 'S1', needToBuy: 2 })] }),
        order({ id: '2', status: '采购中', totalPrice: 200, totalProfit: 30, createdAt: '2026-06-28T08:00:00.000Z', purchaseList: [purchase({ supplier: 'S1', needToBuy: 1, purchased: true })] }),
    ];
    const workbench = buildDashboardWorkbench({
        businessSummary: null,
        orders,
        parts: [{ stock: 0 }, { stock: 4 }, { stock: 10 }],
        now,
    });
    const trends = buildDashboardTrends(orders, 2);

    assert.equal(sameLocalDay('2026-06-29T01:00:00.000Z', now), true);
    assert.equal(sameLocalDay('2026-06-27T12:00:00.000Z', now), false);
    assert.deepEqual(trends.revTrend.map(point => point.value), [200, 100]);
    assert.equal(workbench.items.find(item => item.key === 'pending_purchase').count, 1);
    assert.equal(workbench.items.find(item => item.key === 'ready_to_receive').count, 1);
    assert.equal(workbench.items.find(item => item.key === 'out_of_stock_parts').desc, '另有 1 个低库存零件');
    assert.equal(workbench.items.find(item => item.key === 'today_orders').count, 1);
    assert.equal(workbench.supplierFocus[0].supplier, 'S1');
    assert.equal(workbench.supplierFocus[0].pending, 2);
});

test('看板规则优先使用后端业务汇总', () => {
    const summary = {
        financials: { totalRevenue: 1000, totalProfit: 200 },
        orders: { active: 3 },
        parts: { lowStock: 2, outOfStock: 1 },
        workbench: {
            items: [{ key: 'pending_purchase', label: '待采购', count: 8, desc: '后端', path: '/purchase' }],
            supplierFocus: [{ supplier: 'S1', pendingQty: 6, orderIds: ['1', '2'] }],
        },
    };

    assert.deepEqual(buildDashboardKpis({ businessSummary: summary, orders: [], ordersByStatus: { 待采购: [], 采购中: [], 已完成: [] }, parts: [] }), {
        totalRevenue: 1000,
        totalProfit: 200,
        pendingCount: 3,
        lowStockParts: 3,
    });
    const workbench = buildDashboardWorkbench({ businessSummary: summary, orders: [], parts: [] });
    assert.equal(workbench.items[0].count, 8);
    assert.equal(workbench.supplierFocus[0].orderIds.size, 2);
});
