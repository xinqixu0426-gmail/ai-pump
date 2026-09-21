const test = require('node:test');
const assert = require('node:assert/strict');
const { executeQueryTool } = require('../api/routes/ai/executors/queryExecutors.cjs');

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

test('业务变更 AI executor：透传结构化筛选并返回权威回执和来源', async () => {
    const requested = [];
    const page = {
        items: [{ id: 18, capabilityId: 'orders.update_draft' }],
        total: 1,
        appliedFilters: { period: 'today', domain: 'order' },
        asOf: '2026-08-23T04:00:00.000Z',
    };
    const result = await executeQueryTool(
        'search_business_changes',
        { period: 'today', domain: 'order', keyword: '合同' },
        async (url, options) => {
            requested.push({ url, method: options.method });
            return jsonResponse({ success: true, data: page });
        }
    );
    assert.equal(requested.length, 1);
    assert.match(requested[0].url, /^\/api\/business-changes\?/);
    assert.match(requested[0].url, /period=today/);
    assert.match(requested[0].url, /domain=order/);
    assert.match(requested[0].url, /keyword=%E5%90%88%E5%90%8C/);
    assert.equal(result.summary, '找到 1 条符合条件的业务变更。');
    assert.deepEqual(result.receipt, {
        appliedFilters: page.appliedFilters,
        totalCount: 1,
        returnedCount: 1,
        truncated: false,
        possiblyTruncated: false,
        authoritative: true,
    });
    assert.deepEqual(result.sources, [{
        sourceTable: 'business_change_events',
        evidenceLevel: 'authoritative_business_event',
        asOf: page.asOf,
    }]);
});

test('业务变更 AI executor：正式零结果如实返回，API 失败不伪装成无变更', async () => {
    const empty = await executeQueryTool(
        'search_business_changes',
        { semanticQuery: '不存在的修改' },
        async () => jsonResponse({
            success: true,
            data: {
                items: [],
                total: 0,
                appliedFilters: { semanticQuery: '不存在的修改' },
                asOf: '2026-08-23T04:00:00.000Z',
            },
        })
    );
    assert.equal(empty.summary, '没有找到符合当前筛选条件的业务变更。');
    assert.equal(empty.receipt.totalCount, 0);
    assert.equal(empty.receipt.authoritative, true);

    await assert.rejects(
        executeQueryTool(
            'search_business_changes',
            { period: 'today' },
            async () => jsonResponse({
                success: false,
                code: 'business_change_query_failed',
                error: '事件数据库暂时不可用',
            }, 503)
        ),
        error => error.code === 'business_change_query_failed'
            && error.statusCode === 503
            && /事件数据库暂时不可用/.test(error.message)
    );
});
