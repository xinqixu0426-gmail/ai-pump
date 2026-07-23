const test = require('node:test');
const assert = require('node:assert/strict');
const { requiresFreshToolLookup, buildFreshLookupToolCalls } = require('../api/services/aiFreshness.cjs');

test('AI 实时数据查询必须重新调用工具', () => {
    const messages = [
        { role: 'assistant', content: '800平刀切割泵壳原来的单价是 95 元。' },
        { role: 'user', content: '800平刀切割泵壳成本是多少' },
    ];

    assert.equal(requiresFreshToolLookup(messages), true);
    assert.equal(requiresFreshToolLookup([{ role: 'user', content: '现在订单状态怎么样' }]), true);
    assert.equal(requiresFreshToolLookup([{ role: 'user', content: '查一下最新铜价' }]), true);

    assert.deepEqual(buildFreshLookupToolCalls(messages), [
        { name: 'search_factory_knowledge', args: { query: '800平刀切割泵壳', limit: 10 } },
        { name: 'search_parts', args: { keyword: '800平刀切割泵壳' } },
    ]);
});

test('AI 普通闲聊不强制调用业务工具', () => {
    assert.equal(requiresFreshToolLookup([{ role: 'user', content: '你好' }]), false);
    assert.equal(requiresFreshToolLookup([{ role: 'user', content: '谢谢' }]), false);
    assert.equal(requiresFreshToolLookup([]), false);
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '你好' }]), []);
});

test('AI 为铜价和订单状态预取对应实时工具', () => {
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '查一下最新铜价' }]), [
        { name: 'search_factory_knowledge', args: { query: '铜价', limit: 10 } },
        { name: 'get_copper_price', args: {} },
    ]);
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '订单 #12 当前状态怎么样' }]), [
        { name: 'search_factory_knowledge', args: { query: '订单 #12', limit: 10 } },
        { name: 'get_order_detail', args: { orderId: 12 } },
    ]);
});

test('AI 将规格片数简写精确路由到全部线圈知识方案', () => {
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '给我12-220的线圈数据' }]), [
        { name: 'search_factory_knowledge', args: { query: '12-220', entryType: 'coil', limit: 10 } },
    ]);
});
