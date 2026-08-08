const test = require('node:test');
const assert = require('node:assert/strict');
const {
    CustomerQueryError,
    createCustomerQueries,
    normalizeContextLimit,
} = require('../api/services/customerQueries.cjs');

function createFixture() {
    const customers = [
        {
            id: 7,
            name: '邱焕',
            updatedAt: '2026-08-01T00:00:00.000Z',
        },
        {
            id: 8,
            name: '邱焕二厂',
            updatedAt: '2026-08-02T00:00:00.000Z',
        },
    ];
    const quotations = [
        {
            id: 5,
            customerId: 7,
            createdAt: '2026-07-25T00:00:00.000Z',
            itemsJson: JSON.stringify([{ baseRecipeName: 'V750 菲律宾' }]),
        },
        {
            id: 3,
            customerId: 7,
            createdAt: '2026-07-22T00:00:00.000Z',
            itemsJson: JSON.stringify([{ baseRecipeName: 'V750 常规' }]),
        },
        {
            id: 8,
            customerId: 9,
            createdAt: '2026-07-28T00:00:00.000Z',
            itemsJson: '[]',
        },
    ];
    const orders = [
        {
            id: 12,
            customerName: '邱焕',
            itemsJson: JSON.stringify([{ recipeName: 'V750 菲律宾' }]),
        },
        {
            id: 13,
            customerName: '其他客户',
            itemsJson: JSON.stringify([{ recipeName: 'V750 菲律宾' }]),
        },
    ];
    const queries = createCustomerQueries({
        listCustomers: () => customers,
        listOrders: () => orders,
        listQuotations: () => quotations,
    });
    return {
        customers,
        queries,
    };
}

test('客户 Query 统一聚合正式客户、报价和订单事实', () => {
    const fixture = createFixture();
    const context = fixture.queries.getCustomerContext(7);

    assert.deepEqual(fixture.queries.getAllCustomers(), fixture.customers);
    assert.equal(context.customer.name, '邱焕');
    assert.deepEqual(
        context.quotations.map(item => item.createdAt),
        [
            '2026-07-22T00:00:00.000Z',
            '2026-07-25T00:00:00.000Z',
        ]
    );
    assert.deepEqual(
        context.quotations.map(item => item.displaySequence),
        [1, 2]
    );
    assert.equal(
        context.quotations.some(item => 'id' in item || 'Id' in item),
        false
    );
    assert.deepEqual(context.orders.map(item => item.id), [12]);
    assert.equal(
        context.summary,
        '找到 邱焕 的历史报价 2 条、订单 1 条。'
    );
    assert.deepEqual(context.provenance, {
        kind: 'live_business',
        sourceOfTruth: ['customers', 'quotations', 'orders'],
    });
    assert.deepEqual(
        context.sourceOfTruth,
        ['customers', 'quotations', 'orders']
    );
    assert.equal(Number.isNaN(Date.parse(context.asOf)), false);
});

test('客户 Query 按型号筛选历史并限制数量', () => {
    const context = createFixture().queries.getCustomerContext(7, {
        keyword: '菲律宾',
        limit: 1,
    });

    assert.equal(context.quotations.length, 1);
    assert.equal(context.quotations[0].items[0].baseRecipeName, 'V750 菲律宾');
    assert.equal(context.orders.length, 1);
    assert.equal(context.query.limit, 1);
    assert.equal(normalizeContextLimit(undefined), null);
    assert.equal(normalizeContextLimit(50), 50);
    assert.throws(() => normalizeContextLimit(1000), /1 到 50/);
    assert.throws(() => normalizeContextLimit(-1), /1 到 50/);
});

test('客户列表 Query 按正式 ID、名称和数量字段筛选', () => {
    const queries = createFixture().queries;

    assert.deepEqual(queries.getAllCustomers({ id: 7 }).map(item => item.id), [7]);
    assert.deepEqual(queries.getAllCustomers({ name: '邱焕' }).map(item => item.id), [7, 8]);
    assert.deepEqual(queries.getAllCustomers({ name: '邱焕', limit: 1 }).map(item => item.id), [7]);
    assert.throws(() => queries.getAllCustomers({ id: 'bad' }), /非法客户ID/);
    assert.throws(() => queries.getAllCustomers({ limit: '1.5' }), /1 到 100/);
});

test('客户 Query 对非法和不存在的客户返回稳定错误', () => {
    const queries = createFixture().queries;

    assert.throws(
        () => queries.getCustomerContext('bad'),
        error => (
            error instanceof CustomerQueryError
            && error.statusCode === 400
            && error.message === '非法客户ID'
        )
    );
    assert.throws(
        () => queries.getCustomerContext(999),
        error => (
            error instanceof CustomerQueryError
            && error.statusCode === 404
            && error.message === '客户不存在'
        )
    );
});
