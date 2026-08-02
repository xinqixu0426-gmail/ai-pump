const test = require('node:test');
const assert = require('node:assert/strict');
const { AI_TOOLS, WRITE_TOOLS } = require('../api/routes/ai/tools.cjs');
const {
    AI_TOOL_METADATA,
    DEFAULT_MAX_TOOLS,
    routeAiTools,
} = require('../api/routes/ai/toolRouting.cjs');

function route(text, options = {}) {
    return routeAiTools([{ role: 'user', content: text }], options);
}

test('AI 工具路由：全部工具都有领域、读写和数据模式元数据', () => {
    assert.equal(Object.keys(AI_TOOL_METADATA).length, AI_TOOLS.length);
    for (const tool of AI_TOOLS) {
        const name = tool.function.name;
        const metadata = AI_TOOL_METADATA[name];
        assert.ok(metadata, `${name} 缺少工具元数据`);
        assert.ok(metadata.domains.length > 0, `${name} 缺少领域`);
        assert.equal(metadata.access, WRITE_TOOLS.has(name) ? 'write' : 'read');
        assert.ok(['live', 'derived', 'stable'].includes(metadata.dataMode));
    }
});

test('AI 工具路由：普通闲聊不向模型发送业务工具', () => {
    const result = route('你好，今天心情怎么样');
    assert.equal(result.reason, 'casual_conversation');
    assert.deepEqual(result.tools, []);
    assert.deepEqual(result.toolNames, []);
});

test('AI 工具路由：配方成本只暴露成本和配方工具且不带写工具', () => {
    const result = route('V750配方成本是多少');
    assert.deepEqual(result.domains, ['cost', 'recipe']);
    assert.ok(result.toolNames.includes('preview_recipe_cost'));
    assert.equal(result.toolNames.includes('query_recipe_cost_by_name'), false);
    assert.equal(result.toolNames.includes('query_recipe_cost_by_id'), false);
    assert.equal(result.toolNames.some(name => WRITE_TOOLS.has(name)), false);
    assert.ok(result.toolNames.length <= DEFAULT_MAX_TOOLS);
    assert.equal(result.toolNames.includes('delete_order'), false);
});

test('AI 工具路由：零件查询统一使用可筛选搜索工具', () => {
    const result = route('查询所有零件');
    assert.deepEqual(result.domains, ['catalog']);
    assert.ok(result.toolNames.includes('search_parts'));
    assert.equal(result.toolNames.includes('get_all_parts'), false);
});

test('AI 工具路由：线圈俗称入库进入独立线圈库存领域', () => {
    const result = route('12-120,12-140各入库50套');
    assert.deepEqual(result.domains, ['coil']);
    assert.equal(result.writeIntent, true);
    assert.ok(result.toolNames.includes('adjust_coil_stock'));
    assert.equal(result.toolNames.includes('update_part'), false);
    assert.ok(result.toolNames.length <= DEFAULT_MAX_TOOLS);
});

test('AI 工具路由：订单页面上下文可让简短指令保留订单工具', () => {
    const result = route('下一步怎么处理', {
        pageContext: { resourceType: 'order', resourceId: 12, view: 'readiness' },
    });
    assert.deepEqual(result.domains, ['order']);
    assert.ok(result.toolNames.includes('plan_order_readiness_actions'));
    assert.equal(result.toolNames.includes('delete_part'), false);
});

test('AI 工具路由：用途问题同时提供知识和配方检索', () => {
    const result = route('切割杂草用的泵壳是哪一个');
    assert.deepEqual(result.domains, ['knowledge', 'recipe']);
    assert.ok(result.toolNames.includes('search_factory_knowledge'));
    assert.ok(result.toolNames.includes('get_factory_knowledge_detail'));
    assert.equal(result.toolNames.includes('update_recipe'), false);
});

test('AI 工具路由：报价转订单包含计划与受保护执行器', () => {
    const result = route('把报价转成订单');
    assert.equal(result.writeIntent, true);
    assert.ok(result.domains.includes('quotation'));
    assert.ok(result.domains.includes('order'));
    assert.ok(result.toolNames.includes('plan_factory_workflow'));
    assert.ok(result.toolNames.includes('execute_factory_workflow_step'));
    assert.ok(result.toolNames.length <= DEFAULT_MAX_TOOLS);
});

test('AI 工具路由：确定性预取工具必须进入模型工具集合', () => {
    const result = route('订单12现在怎么样', {
        requiredToolNames: ['get_order_detail', 'search_factory_knowledge'],
    });
    assert.ok(result.toolNames.includes('get_order_detail'));
    assert.ok(result.toolNames.includes('search_factory_knowledge'));
});

test('AI 工具路由：未知业务问题使用小型通用回退而不是全部工具', () => {
    const result = route('帮我看看工厂系统里的数据');
    assert.equal(result.fallback, true);
    assert.equal(result.reason, 'general_business_fallback');
    assert.ok(result.toolNames.includes('get_dashboard_summary'));
    assert.ok(result.toolNames.length < AI_TOOLS.length);
    assert.equal(result.toolNames.some(name => WRITE_TOOLS.has(name)), false);
});

test('AI 工具路由：环境开关关闭后恢复完整工具集合', () => {
    const result = route('V750成本是多少', {
        env: { AI_DYNAMIC_TOOL_ROUTING_ENABLED: 'false' },
    });
    assert.equal(result.reason, 'routing_disabled');
    assert.equal(result.toolNames.length, AI_TOOLS.length);
});
