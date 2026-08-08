const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    OrderQueryError,
    createOrderQueries,
} = require('../api/services/orderQueries.cjs');

function createFixture() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE orders (
            id INTEGER PRIMARY KEY,
            customer_name TEXT NOT NULL,
            contract_no TEXT,
            status TEXT NOT NULL,
            items_json TEXT,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );
        INSERT INTO orders
            (id, customer_name, contract_no, status, items_json, updated_at, deleted_at)
        VALUES
            (1, '甲客户', 'HT-001', '待确认',
             '[{"recipeName":"QDX10","unitPrice":100,"unitCost":70,"profitMargin":1.2}]',
             '2026-08-01T00:00:00.000Z', NULL),
            (2, '甲客户二厂', 'HT-002', '生产中',
             '[{"recipeName":"QDX10","unitPrice":120}]',
             '2026-08-02T00:00:00.000Z', NULL),
            (3, '坏数据', 'HT-003', '待确认', '{bad',
             '2026-08-03T00:00:00.000Z', NULL),
            (4, '已删除客户', 'HT-004', '已取消', '[]',
             '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z');
    `);
    const listResult = [
        {
            id: 1,
            status: '待采购',
            customerName: '华东泵业',
            contractNo: 'HT-001',
            purchaseListJson: JSON.stringify([
                {
                    identityKey: 'S||A',
                    supplier: 'S',
                    model: 'A',
                    plannedQty: 10,
                    orderedQty: 4,
                    receivedQty: 2,
                    stockedQty: 1,
                },
                {
                    supplier: '',
                    model: 'B',
                    needToBuy: 2,
                },
            ]),
        },
        {
            id: 2,
            status: '采购中',
            customerName: '华南设备',
            contractNo: 'HT-002',
            purchaseList: [{
                identityKey: 'S||A',
                supplier: 'S',
                model: 'A',
                plannedQty: 5,
                purchased: true,
                receivedQty: 5,
                stockedQty: 3,
            }],
        },
        {
            id: 3,
            status: '已关闭',
            customerName: '华东泵业二厂',
            contractNo: 'HT-003',
            purchaseList: [{ supplier: '忽略', model: 'C', plannedQty: 99 }],
        },
    ];
    const queries = createOrderQueries({
        db,
        listOrdersWithCurrentPurchasePlans: () => listResult,
        getOrderWithCurrentPurchasePlan: id => (
            id === 1 ? { id: 1, purchaseList: [] } : null
        ),
        buildActiveOrdersReadinessOverview: () => ({ total: 2 }),
        buildOrderReadinessContext: record => ({
            readiness: { orderId: record.id, status: 'ready' },
        }),
    });
    return { db, listResult, queries };
}

test('订单 Query 返回实时列表、详情、准备度和准备度总览', () => {
    const fixture = createFixture();
    try {
        assert.equal(fixture.queries.getAllOrders(), fixture.listResult);
        assert.deepEqual(
            fixture.queries.getAllOrders({ status: '采购中', limit: 10 }).map(order => order.id),
            [2]
        );
        assert.deepEqual(fixture.queries.getOrder(1), {
            id: 1,
            purchaseList: [],
        });
        assert.deepEqual(fixture.queries.getOrderReadiness(1), {
            orderId: 1,
            status: 'ready',
        });
        assert.deepEqual(fixture.queries.getReadinessOverview(), {
            total: 2,
        });
    } finally {
        fixture.db.close();
    }
});

test('订单列表 Query 严格校验并组合状态、客户、合同号和数量字段', () => {
    const fixture = createFixture();
    try {
        assert.deepEqual(
            fixture.queries.getAllOrders({ customerName: '华东' }).map(order => order.id),
            [3, 1]
        );
        assert.deepEqual(
            fixture.queries.getAllOrders({ status: '采购中', contractNo: '002' }).map(order => order.id),
            [2]
        );
        assert.deepEqual(fixture.queries.getAllOrders({ limit: 2 }).map(order => order.id), [3, 2]);
        assert.throws(() => fixture.queries.getAllOrders({ status: '不存在' }), /订单状态无效/);
        assert.throws(() => fixture.queries.getAllOrders({ limit: '2abc' }), /1 到 100/);
        assert.throws(
            () => fixture.queries.getPurchaseOverview({ pendingOnly: 'yes' }),
            /true 或 false/
        );
    } finally {
        fixture.db.close();
    }
});

test('订单 Query 历史价格跳过坏 JSON 并返回最近有效事实', () => {
    const fixture = createFixture();
    try {
        assert.deepEqual(fixture.queries.getLatestRecipePrice('QDX10'), {
            unitPrice: 120,
            unitCost: 0,
            profitMargin: 1.1,
            customerName: '甲客户二厂',
            date: '2026-08-02T00:00:00.000Z',
        });
        assert.equal(
            fixture.queries.getLatestRecipePrice('不存在的配方'),
            null
        );
    } finally {
        fixture.db.close();
    }
});

test('订单 Query 采购总览只聚合活动订单的当前采购计划', () => {
    const fixture = createFixture();
    try {
        const overview = fixture.queries.getPurchaseOverview();
        assert.equal(overview.returnedCount, 2);
        assert.equal(overview.truncated, false);
        assert.deepEqual(overview.summary, {
            activeOrderCount: 2,
            supplierCount: 2,
            taskCount: 2,
            pendingTaskCount: 2,
            plannedQty: 17,
            orderedQty: 9,
            receivedQty: 7,
            stockedQty: 4,
            pendingQty: 8,
        });
        assert.deepEqual(
            overview.tasks.find(task => task.model === 'A'),
            {
                identityKey: 'S||A',
                supplier: 'S',
                supplierLabel: 'S',
                model: 'A',
                name: 'A',
                purchaseUnit: '',
                specification: '',
                plannedQty: 15,
                orderedQty: 9,
                receivedQty: 7,
                stockedQty: 4,
                pendingQty: 6,
                orderIds: [1, 2],
                orderCount: 2,
            }
        );
        assert.equal(overview.tasks.some(task => task.model === 'C'), false);
        const limited = fixture.queries.getPurchaseOverview({ limit: 1 });
        assert.equal(limited.summary.taskCount, 2);
        assert.equal(limited.returnedCount, 1);
        assert.equal(limited.truncated, true);
        assert.equal(limited.tasks[0].model, 'A');
        const supplierFiltered = fixture.queries.getPurchaseOverview({
            supplier: 'S',
            pendingOnly: true,
        });
        assert.equal(supplierFiltered.summary.taskCount, 1);
        assert.deepEqual(supplierFiltered.filters, {
            supplier: 'S',
            pendingOnly: true,
            limit: null,
        });
        assert.deepEqual(supplierFiltered.tasks.map(task => task.model), ['A']);
    } finally {
        fixture.db.close();
    }
});

test('订单 Query 候选查找优先精确匹配并兼容模糊客户名', () => {
    const fixture = createFixture();
    try {
        assert.deepEqual(fixture.queries.lookupOrders('甲客户'), [{
            id: 1,
            customerName: '甲客户',
            contractNo: 'HT-001',
            status: '待确认',
            updatedAt: '2026-08-01T00:00:00.000Z',
        }]);
        assert.deepEqual(
            fixture.queries.lookupOrders('二厂').map(order => order.id),
            [2]
        );
        assert.deepEqual(
            fixture.queries.lookupOrders('HT-002').map(order => order.id),
            [2]
        );
    } finally {
        fixture.db.close();
    }
});

test('订单 Query 对空查询、非法 ID 和不存在订单返回稳定错误', () => {
    const fixture = createFixture();
    try {
        assert.throws(
            () => fixture.queries.lookupOrders(' '),
            error => (
                error instanceof OrderQueryError
                && error.statusCode === 400
                && error.message === '请提供订单ID、客户名称或合同号'
            )
        );
        assert.throws(
            () => fixture.queries.getOrderReadiness('bad'),
            error => (
                error instanceof OrderQueryError
                && error.statusCode === 400
                && error.message === '非法订单ID'
            )
        );
        assert.throws(
            () => fixture.queries.getOrder(999),
            error => (
                error instanceof OrderQueryError
                && error.statusCode === 404
                && error.message === '订单不存在'
            )
        );
    } finally {
        fixture.db.close();
    }
});
