const test = require('node:test');
const assert = require('node:assert/strict');
const {
    coilCostComparisonPairs,
    inferredDomains,
    isLocalAssistantMode,
    selectLocalAssistantTools,
    shouldUseLocalToolShortlist,
} = require('../api/services/aiToolShortlist.cjs');

const names = query => selectLocalAssistantTools(query, {
    env: { AI_LOCAL_TOOL_SHORTLIST_ENABLED: 'true' },
}).map(tool => tool.function.name);

test('本地工具短名单按业务问题选择强匹配工具和必要目录', () => {
    assert.deepEqual(inferredDomains('V750 配方成本是多少'), ['recipe', 'cost']);
    assert.deepEqual(names('V750 配方成本是多少'), ['preview_recipe_cost']);
    assert.deepEqual(names('有哪些缺货零件'), ['search_parts']);
    assert.deepEqual(names('V550F-H-TOKOY 有没有测试报告'), ['get_recipe_technical_files']);
    assert.equal(names('对比 A 和 B 的配方成本')[0], 'compare_recipes');
    assert.ok(names('客户 A 最近订单').includes('get_recent_orders'));
    assert.equal(names('客户 A 最近订单').includes('search_customers'), false);
    assert.deepEqual(names('查询客户邱焕现有的全部报价'), ['search_customer_history']);
    assert.deepEqual(names('V1600-3”-12-180 模板字段是否有测试报告'), ['get_recipe_technical_files']);
    assert.equal(names('切割杂草用的泵壳和明确标注的切割专用配件')[0], 'search_factory_knowledge');
    assert.deepEqual(names('V750-大脚板-2寸的壳，做12-120片，带浮球，木箱，需要珍珠棉，成本多少'), ['build_recipe_bom_draft']);
    assert.deepEqual(names('12-200的线圈都做了哪些配方'), ['get_all_recipes', 'search_coils']);
    assert.deepEqual(names('查一下12-120的线圈做的配方'), ['get_all_recipes', 'search_coils']);
    assert.deepEqual(names('对比 12-120 与 12-140 的成本'), ['calculate_coil_cost']);
    assert.deepEqual(names('对比 12-120 与 12-140 线圈的成本'), ['calculate_coil_cost']);
});

test('线圈简写成本对比不会抢占明确的配方对比', () => {
    assert.deepEqual(coilCostComparisonPairs('对比 12-120 与 12-140 的成本'), [
        { spec: '12', sheets: 120 },
        { spec: '12', sheets: 140 },
    ]);
    assert.deepEqual(coilCostComparisonPairs('对比配方 12-120 与 12-140 的成本'), []);
    assert.equal(names('对比配方 12-120 与 12-140 的成本')[0], 'compare_recipes');
});

test('无明确业务域时普通对话不带工具，型号问题只带跨目录发现工具', () => {
    assert.deepEqual(names('你好'), []);
    assert.deepEqual(names('V750 是什么'), [
        'get_all_recipes',
        'search_parts',
        'search_coils',
        'search_templates',
    ]);
});

test('工具短名单只在本地模式启用，并可通过环境开关回退', () => {
    assert.equal(isLocalAssistantMode({ AI_PROVIDER: 'local' }), true);
    assert.equal(shouldUseLocalToolShortlist({ AI_PROVIDER: 'local' }), true);
    assert.equal(shouldUseLocalToolShortlist({ AI_PROVIDER: 'local-first' }), true);
    assert.equal(shouldUseLocalToolShortlist({ AI_PROVIDER: 'deepseek' }), false);
    assert.equal(shouldUseLocalToolShortlist({
        AI_PROVIDER: 'local',
        AI_LOCAL_TOOL_SHORTLIST_ENABLED: 'false',
    }), false);
});
