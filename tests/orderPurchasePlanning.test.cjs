const test = require('node:test');
const assert = require('node:assert/strict');
const {
    getOrderWithCurrentPurchasePlan,
    listOrdersWithCurrentPurchasePlans,
} = require('../api/services/orderPurchasePlanning.cjs');

function createFixture() {
    const record = {
        id: 7,
        status: '待采购',
        created_at: '2026-08-01T00:00:00.000Z',
        deleted_at: null,
        items_json: '[]',
        purchase_list_json: '[{"model":"旧快照"}]',
    };
    const database = {
        prepare(sql) {
            return {
                all() {
                    assert.match(sql, /FROM orders/);
                    return [record];
                },
                get(id) {
                    assert.equal(id, 7);
                    return record;
                },
            };
        },
        transaction(callback) {
            const read = (...args) => callback(...args);
            read.deferred = read;
            return read;
        },
    };
    const writes = [];
    const dbAccessors = {
        db: database,
        dbGetAllParts: () => [],
        dbGetAllCoils: () => [],
        dbGetAllOrders: () => [{
            id: 7,
            status: '待采购',
            purchaseListJson: record.purchase_list_json,
            updatedAt: '2026-08-01T00:00:00.000Z',
        }],
        orderRow: row => ({
            id: row.id,
            status: row.status,
            purchaseListJson: row.purchase_list_json,
            updatedAt: '2026-08-01T00:00:00.000Z',
        }),
        safeUpdate: (...args) => writes.push(args),
    };
    return { database, dbAccessors, writes };
}

test('订单列表和详情查询返回实时采购计划视图但不写库', () => {
    const fixture = createFixture();
    const options = {
        db: fixture.database,
        dbAccessors: fixture.dbAccessors,
    };
    const list = listOrdersWithCurrentPurchasePlans(options);
    const detail = getOrderWithCurrentPurchasePlan(7, options);
    assert.equal(list.length, 1);
    assert.equal(list[0].purchaseListJson, '[]');
    assert.equal(detail.purchaseListJson, '[]');
    assert.equal(detail.updatedAt, '2026-08-01T00:00:00.000Z');
    assert.deepEqual(fixture.writes, []);
});

test('采购计划查询模块不再暴露绕过正式命令的持久化入口', () => {
    const planning = require('../api/services/orderPurchasePlanning.cjs');
    assert.equal(planning.persistCurrentBalancedPurchasePlans, undefined);
});
