const test = require('node:test');
const assert = require('node:assert/strict');
const { listAiCapabilities } = require('../api/capabilities/registry.cjs');
const {
    plannerCapabilityDirectory,
    selectToolsForIntent,
} = require('../api/services/aiCapabilityCatalogV2.cjs');

test('V2 能力目录：注册表中的每个 AI 能力自动进入规划目录', () => {
    const directory = plannerCapabilityDirectory();
    assert.equal(directory.length, listAiCapabilities().length);
    assert.ok(directory.every(item => item.name && item.description && item.domains.length > 0));
});

test('V2 能力目录：查询轮不暴露写能力，计划能力优先', () => {
    const tools = selectToolsForIntent({
        mode: 'query',
        domains: ['order'],
        steps: [{ capabilityName: 'get_recent_orders', objective: '查订单' }],
    });
    const names = tools.map(tool => tool.function.name);
    assert.equal(names[0], 'get_recent_orders');
    assert.ok(names.includes('get_purchase_overview'));
    assert.equal(names.includes('create_order'), false);
});

test('V2 能力目录：写轮只在模型明确判定 command 后开放同域写能力', () => {
    const names = selectToolsForIntent({
        mode: 'command',
        domains: ['catalog'],
        steps: [{ capabilityName: 'adjust_part_stock', objective: '调整库存' }],
    }).map(tool => tool.function.name);
    assert.equal(names[0], 'adjust_part_stock');
    assert.ok(names.includes('create_part'));
    assert.ok(names.includes('search_parts'));
});

test('V2 能力目录：重叠查询能力必须声明互斥的权威职责', () => {
    const directory = new Map(plannerCapabilityDirectory().map(item => [item.name, item]));
    assert.match(directory.get('search_customer_history').description, /具名客户.*全部报价/);
    assert.match(directory.get('search_customer_history').description, /区分客户不存在/);
    assert.match(directory.get('search_quotations').description, /报价状态/);
    assert.match(directory.get('search_quotations').description, /应使用 search_customer_history/);
    assert.match(directory.get('search_coils').description, /全部正式方案.*权威/);
    assert.match(directory.get('calculate_coil_cost').description, /不负责列出.*全部正式方案/);
    assert.match(directory.get('calculate_coil_cost').description, /必须使用 search_coils/);
    assert.match(directory.get('search_factory_knowledge').description, /禁止用知识快照代替当前价格/);
    assert.match(directory.get('search_parts').description, /电缆、电容、油封、机筒、轴承/);
    assert.match(directory.get('get_all_recipes').description, /具体物料名称.*应使用 search_parts/);
});
