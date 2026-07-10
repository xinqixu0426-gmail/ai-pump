const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '../src/utils/purchaseCenterRules.ts');
const source = fs.readFileSync(sourcePath, 'utf8')
    .replace(/import[^;]+;\n/g, '');
const compiled = ts.transpileModule(`${source}\nmodule.exports = { supplierLabel, taskStatus, statusText, statusColor, buildPurchaseTasks, buildPurchaseStats };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleStub = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', compiled)(moduleStub, moduleStub.exports);
const {
    supplierLabel,
    taskStatus,
    statusText,
    statusColor,
    buildPurchaseTasks,
    buildPurchaseStats,
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
        totalPrice: 0,
        totalProfit: 0,
        createdAt: '2026-06-29T00:00:00.000Z',
        updatedAt: '2026-06-29T00:00:00.000Z',
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
    };
}

test('采购中心规则按供应商和型号聚合未完成订单采购需求', () => {
    const orders = [
        order({
            id: 'o1',
            customerName: '客户A',
            purchaseList: [
                purchase({ model: '轴承A', name: '轴承', supplier: 'S1', needToBuy: 3 }),
                purchase({ model: '库存足够', supplier: 'S1', needToBuy: 0 }),
            ],
        }),
        order({
            id: 'o2',
            status: '采购中',
            customerName: '客户B',
            purchaseList: [purchase({ model: '轴承A', name: '轴承', supplier: 'S1', needToBuy: 2, purchased: true })],
        }),
        order({
            id: 'o3',
            status: '已完成',
            purchaseList: [purchase({ model: '轴承A', supplier: 'S1', needToBuy: 9 })],
        }),
        order({
            id: 'o4',
            purchaseList: [purchase({ model: '螺丝B', supplier: '', needToBuy: 1 })],
        }),
    ];

    const tasks = buildPurchaseTasks(orders);
    const bearing = tasks.find(task => task.key === 'S1||轴承A');
    const screw = tasks.find(task => task.key === '||螺丝B');

    assert.equal(supplierLabel('  '), '未指定供应商');
    assert.equal(bearing.totalNeed, 5);
    assert.equal(bearing.purchasedNeed, 2);
    assert.equal(bearing.pendingNeed, 3);
    assert.equal(bearing.orderCount, 2);
    assert.equal(taskStatus(bearing), 'partial');
    assert.equal(statusText(taskStatus(bearing)), '部分已采');
    assert.equal(statusColor(taskStatus(bearing)), 'info');
    assert.equal(screw.supplierLabel, '未指定供应商');
});
test('采购中心规则生成统计摘要', () => {
    const orders = [
        order({ id: 'o1', purchaseList: [purchase({ model: 'A', supplier: 'S1', needToBuy: 3 })] }),
        order({ id: 'o2', purchaseList: [purchase({ model: 'B', supplier: 'S2', needToBuy: 2, purchased: true })] }),
        order({ id: 'o3', status: '已完成', purchaseList: [purchase({ model: 'C', supplier: 'S3', needToBuy: 5 })] }),
    ];
    const tasks = buildPurchaseTasks(orders);
    const stats = buildPurchaseStats(orders, tasks, 2);

    assert.deepEqual(stats, {
        activeOrderCount: 2,
        supplierCount: 2,
        taskCount: 2,
        pendingTaskCount: 1,
        purchasedNeed: 2,
        pendingNeed: 3,
        totalNeed: 5,
    });
});
