const test = require('node:test');
const assert = require('node:assert/strict');
const {
    requiresFreshToolLookup,
    buildFreshLookupToolCalls,
    explicitKnowledgeLookup,
    parseCoilInventoryInstruction,
    purposeLookupQuery,
} = require('../api/services/aiFreshness.cjs');

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

test('AI 明确点名知识工具时由服务端执行知识预取', () => {
    const text = '先使用 search_factory_knowledge 按“成品电缆”查询 business_rule，再说明费用组成。';
    assert.deepEqual(explicitKnowledgeLookup(text), {
        name: 'search_factory_knowledge',
        args: { query: '成品电缆', entryType: 'business_rule', limit: 10 },
    });
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: text }]), [{
        name: 'search_factory_knowledge',
        args: { query: '成品电缆', entryType: 'business_rule', limit: 10 },
    }]);
});

test('AI 产品用途选择必须重新查询知识而不能复述旧会话答案', () => {
    const messages = [
        { role: 'assistant', content: '旧回答错误推荐了 SPA。' },
        { role: 'user', content: '切割杂草用的泵壳是哪一个' },
    ];

    assert.equal(requiresFreshToolLookup(messages), true);
    assert.deepEqual(buildFreshLookupToolCalls(messages), [{
        name: 'search_factory_knowledge',
        args: { query: '切割杂草', limit: 10 },
    }]);
    assert.equal(purposeLookupQuery('切割杂草用的泵壳是哪一个'), '切割杂草');
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

test('AI 将订单生产和齐料问题直接路由到生产准备检查', () => {
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '订单 #12 现在能不能生产' }]), [
        { name: 'search_factory_knowledge', args: { query: '订单 #12 能不能生产', limit: 10 } },
        { name: 'check_order_readiness', args: { orderId: 12 } },
    ]);
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '订单12是否齐料' }]), [
        { name: 'search_factory_knowledge', args: { query: '订单12是否齐料', limit: 10 } },
        { name: 'check_order_readiness', args: { orderId: 12 } },
    ]);
});

test('AI 将多订单生产准备问题路由到实时订单总览', () => {
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '哪些订单目前不能生产' }]), [
        { name: 'search_factory_knowledge', args: { query: '哪些订单目前不能生产', limit: 10 } },
        { name: 'get_order_readiness_overview', args: {} },
    ]);
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '全部订单生产准备总览' }]), [
        { name: 'search_factory_knowledge', args: { query: '全部订单生产准备总览', limit: 10 } },
        { name: 'get_order_readiness_overview', args: {} },
    ]);
});

test('AI 将订单客户要求和追溯问题路由到只读订单知识包', () => {
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '订单 #12 的客户包装要求是什么' }]).at(-1), {
        name: 'get_order_knowledge_package',
        args: { orderId: 12 },
    });
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '订单12之前做过哪些供应商调整' }]).at(-1), {
        name: 'get_order_knowledge_package',
        args: { orderId: 12 },
    });
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '订单12的质量和交付如何追溯' }]).at(-1), {
        name: 'get_order_knowledge_package',
        args: { orderId: 12 },
    });
});

test('AI 将今日优先事项路由到统一管理待办', () => {
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '今天最先需要处理什么' }]), [
        { name: 'get_management_action_center', args: {} },
    ]);
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '现在工厂有哪些风险需要优先跟进' }]), [
        { name: 'get_management_action_center', args: {} },
    ]);
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '请处理管理待办“订单数据阻塞”' }]), [
        { name: 'get_management_action_center', args: {} },
    ]);
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '最近解决了哪些问题，还有哪些反复出现' }]), [
        { name: 'get_management_action_center', args: {} },
    ]);
});

test('AI 将订单问题处理请求优先路由到生产准备处理方案', () => {
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '订单 #12 不能生产，下一步怎么处理' }]), [
        { name: 'search_factory_knowledge', args: { query: '订单 #12 不能生产 下一步怎么处理', limit: 10 } },
        { name: 'plan_order_readiness_actions', args: { orderId: 12 } },
    ]);
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '给订单12生成处理方案' }]), [
        { name: 'search_factory_knowledge', args: { query: '给订单12生成处理方案', limit: 10 } },
        { name: 'plan_order_readiness_actions', args: { orderId: 12 } },
    ]);
});

test('AI 执行订单处理步骤前先刷新当前处理方案', () => {
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '执行订单 #12 处理方案第1步' }]), [
        { name: 'search_factory_knowledge', args: { query: '执行订单 #12 处理方案第1步', limit: 10 } },
        { name: 'plan_order_readiness_actions', args: { orderId: 12 } },
    ]);
});

test('AI 将规格片数简写精确路由到全部线圈知识方案', () => {
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '给我12-220的线圈数据' }]), [
        { name: 'search_factory_knowledge', args: { query: '12-220', entryType: 'coil', limit: 10 } },
    ]);
});

test('AI 将多个规格片数俗称直接路由到独立线圈库存工具', () => {
    const expected = {
        items: [
            { model: '12-120', changeQty: 50 },
            { model: '12-140', changeQty: 50 },
        ],
    };

    assert.deepEqual(parseCoilInventoryInstruction('12-120,12-140各入库50套'), expected);
    assert.deepEqual(buildFreshLookupToolCalls([{
        role: 'user',
        content: '12-120,12-140各入库50套',
    }]), [{
        name: 'adjust_coil_stock',
        args: expected,
    }]);
});

test('AI 线圈库存俗称支持分项数量和出库方向', () => {
    assert.deepEqual(parseCoilInventoryInstruction('12-120入库50套，12-140入库30套'), {
        items: [
            { model: '12-120', changeQty: 50 },
            { model: '12-140', changeQty: 30 },
        ],
    });
    assert.deepEqual(parseCoilInventoryInstruction('定子12×120出库5套'), {
        items: [{ model: '12-120', changeQty: -5 }],
    });
    assert.equal(parseCoilInventoryInstruction('零件12-120入库50套'), null);
});
