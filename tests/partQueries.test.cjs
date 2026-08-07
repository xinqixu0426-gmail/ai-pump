const test = require('node:test');
const assert = require('node:assert/strict');
const {
    LOW_STOCK_MAX,
    listParts,
} = require('../api/services/partQueries.cjs');

const parts = [
    { id: 1, model: '缺货轴承', category: '轴承', supplier: 'A', stock: 0 },
    { id: 2, model: '低库存轴承', category: '轴承', supplier: 'A', stock: 1 },
    { id: 3, model: '临界油封', category: '油封', supplier: 'B', stock: 5 },
    { id: 4, model: '正常油封', category: '油封', supplier: 'B', stock: 6 },
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
