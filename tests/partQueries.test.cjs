const test = require('node:test');
const assert = require('node:assert/strict');
const {
    LOW_STOCK_MAX,
    listParts,
} = require('../api/services/partQueries.cjs');

const parts = [
    { id: 1, model: '缺货轴承', category: '轴承', supplier: 'A', stock: 0, price: 5 },
    { id: 2, model: '低库存轴承', category: '轴承', supplier: 'A', stock: 1, price: 10 },
    { id: 3, model: '临界油封', category: '油封', supplier: 'B', stock: 5, price: 15 },
    { id: 4, model: '正常油封', category: '油封', supplier: 'B', stock: 6, price: 20 },
];

test('零件 Query：低库存使用与页面一致的 1 到 5 正式口径', () => {
    assert.equal(LOW_STOCK_MAX, 5);
    assert.deepEqual(
        listParts(parts, { stockStatus: 'low' }).map(part => part.id),
        [2, 3]
    );
    assert.deepEqual(
        listParts(parts, { stockStatus: 'out' }).map(part => part.id),
        [1]
    );
    assert.deepEqual(
        listParts(parts, { stockStatus: 'attention' }).map(part => part.id),
        [1, 2, 3]
    );
    assert.deepEqual(
        listParts(parts, { stockStatus: 'ok' }).map(part => part.id),
        [4]
    );
});

test('零件 Query：数值边界保持严格/包含语义且全量查询不隐式截断', () => {
    assert.deepEqual(listParts(parts, { priceBelow: 10 }).map(part => part.id), [1]);
    assert.deepEqual(listParts(parts, { minPrice: 10 }).map(part => part.id), [2, 3, 4]);
    assert.deepEqual(listParts(parts, { stockAbove: 5 }).map(part => part.id), [4]);
    assert.deepEqual(listParts(parts, { maxStock: 5 }).map(part => part.id), [1, 2, 3]);
    assert.deepEqual(listParts(parts).map(part => part.id), [1, 2, 3, 4]);
    assert.deepEqual(listParts(parts, { limit: 2 }).map(part => part.id), [1, 2]);
    assert.throws(() => listParts(parts, { limit: '2abc' }), /1 到 100/);
});

test('零件 Query：库存状态可与类别和关键词组合且拒绝未知状态', () => {
    assert.deepEqual(
        listParts(parts, { category: '油封', stockStatus: 'low' }).map(part => part.id),
        [3]
    );
    assert.deepEqual(
        listParts(parts, { keyword: '轴承', stockStatus: 'attention' }).map(part => part.id),
        [1, 2]
    );
    assert.deepEqual(
        listParts(parts, { supplier: 'B', stockStatus: 'attention' }).map(part => part.id),
        [3]
    );
    assert.throws(
        () => listParts(parts, { stockStatus: 'warning' }),
        error => error.statusCode === 400 && error.code === 'INVALID_PART_QUERY'
    );
});
