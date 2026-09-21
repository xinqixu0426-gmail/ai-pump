const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createQuotationQueries,
    normalizeCustomerName,
    normalizeLimit,
    normalizeStatus,
} = require('../api/services/quotationQueries.cjs');

function createFixture() {
    const quotations = [
        { id: 1, customerId: 10, status: '已拒绝', totalPrice: 100 },
        { id: 2, customerId: 11, status: '报价中', totalPrice: 200 },
        { id: 3, customerId: 10, status: '报价中', totalPrice: 300, remark: '完整报价备注' },
        { id: 4, customerId: 12, status: '已接受', totalPrice: 400 },
    ];
    const customers = [
        { id: 10, name: '华东泵业' },
        { id: 11, name: '远海机械' },
        { id: 12, name: '华南设备' },
    ];
    return {
        queries: createQuotationQueries({
            listQuotations: () => quotations,
            listCustomers: () => customers,
        }),
    };
}

test('报价 Query 按正式状态精确筛选并附加客户名称', () => {
    const fixture = createFixture();
    const result = fixture.queries.list({ status: '报价中' });

    assert.deepEqual(result.map(quotation => quotation.id), [3, 2]);
    assert.deepEqual(result.map(quotation => quotation.customerName), ['华东泵业', '远海机械']);
    assert.ok(result.every(quotation => quotation.status === '报价中'));
});

test('报价 Query 支持客户模糊筛选、组合条件和数量限制', () => {
    const fixture = createFixture();

    assert.deepEqual(
        fixture.queries.list({ customerName: '华', limit: 2 }).map(quotation => quotation.id),
        [4, 3]
    );
    assert.deepEqual(
        fixture.queries.list({ status: '报价中', customerName: '华东', limit: 1 })
            .map(quotation => quotation.id),
        [3]
    );
});

test('报价 Query 按 ID 返回完整正式报价并附加客户名称', () => {
    const fixture = createFixture();

    const result = fixture.queries.get(3);

    assert.equal(result.id, 3);
    assert.equal(result.customerId, 10);
    assert.equal(result.customerName, '华东泵业');
    assert.equal(result.remark, '完整报价备注');
});

test('报价详情 Query 区分非法 ID 和正式未找到', () => {
    const fixture = createFixture();

    assert.throws(
        () => fixture.queries.get('bad'),
        error => error.code === 'INVALID_QUOTATION_ID' && error.statusCode === 400
    );
    assert.throws(
        () => fixture.queries.get(999),
        error => error.code === 'QUOTATION_NOT_FOUND' && error.statusCode === 404
    );
});

test('报价 Query 拒绝非法状态和越界 limit', () => {
    assert.equal(normalizeStatus(' 报价中 '), '报价中');
    assert.equal(normalizeLimit('50'), 50);
    assert.throws(() => normalizeStatus('采购中'), /报价状态无效/);
    assert.throws(() => normalizeCustomerName('客'.repeat(81)), /80 个字符/);
    assert.throws(() => normalizeLimit('1.5'), /1 到 100/);
    assert.throws(() => normalizeLimit('5abc'), /1 到 100/);
    assert.throws(() => normalizeLimit(0), /1 到 100/);
    assert.throws(() => normalizeLimit(101), /1 到 100/);
});
