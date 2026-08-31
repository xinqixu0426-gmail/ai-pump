const test = require('node:test');
const assert = require('node:assert/strict');
const { listAiCapabilities } = require('../api/capabilities/registry.cjs');
const {
    buildDomainDirectoryPrompt,
    plannerCapabilityDirectory,
    selectToolsForIntent,
} = require('../api/services/aiCapabilityCatalogV2.cjs');
const { discoveryCapabilitiesForIntent } = require('../api/services/aiCapabilityGraphV3.cjs');

test('V3 业务域目录：订单知识包与指定配方技术报告保持权威边界', () => {
    const prompt = buildDomainDirectoryPrompt();
    assert.match(prompt, /order:.*不读取成品型号对应的配方技术附件/);
    assert.match(prompt, /recipe:.*性能测试报告.*逐条测试点/);
    assert.match(prompt, /drawing:.*不读取配方性能测试报告/);
});

test('V2 能力目录：注册表中的每个 AI 能力自动进入规划目录', () => {
    const directory = plannerCapabilityDirectory();
    assert.equal(directory.length, listAiCapabilities().length);
    assert.ok(directory.every(item => (
        item.name
        && item.description
        && item.domains.length > 0
        && typeof item.requiredInputs === 'string'
    )));
    const byName = new Map(directory.map(item => [item.name, item]));
    assert.equal(byName.get('preview_pump_shell_cost').requiredInputs, 'customBarrelLength');
    assert.equal(byName.get('preview_recipe_cost').requiredInputs, 'recipeId|recipeName');
    assert.equal(byName.get('search_coils').requiredInputs, 'none');
});

test('V3 恢复调查：模型可见 discovery 能力不能越过第一阶段业务域信封', () => {
    const capabilities = listAiCapabilities();
    const quotationRecovery = discoveryCapabilitiesForIntent({ domains: ['quotation'] });
    assert.equal(quotationRecovery.includes('get_all_recipes'), false);
    assert.equal(quotationRecovery.includes('search_customers'), true);
    for (const name of quotationRecovery) {
        const capability = capabilities.find(item => item.toolName === name);
        assert.equal(capability.domains.includes('quotation'), true);
    }
    for (const domain of new Set(capabilities.flatMap(item => item.domains))) {
        for (const name of discoveryCapabilitiesForIntent({ domains: [domain] })) {
            const capability = capabilities.find(item => item.toolName === name);
            assert.equal(capability.domains.includes(domain), true, `${domain} 不得恢复到 ${name}`);
        }
    }
    assert.equal(
        discoveryCapabilitiesForIntent({ domains: ['recipe'] }).includes('get_all_recipes'),
        true
    );
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
    assert.match(directory.get('get_quotation_detail').description, /完整详情/);
    assert.match(directory.get('get_quotation_detail').description, /备注、转换订单信息/);
    assert.match(directory.get('get_quotation_detail').description, /search_quotations/);
    assert.doesNotMatch(directory.get('get_quotation_detail').description, /search_customer_history/);
    assert.match(directory.get('search_templates').description, /完整正式字段/);
    assert.match(directory.get('get_template_detail').description, /BOM、泵壳组件、转子参数、工资/);
    assert.match(directory.get('search_coils').description, /全部已登记.*权威/);
    assert.match(directory.get('search_coils').description, /schemeStatus.*正式、测试和停用/);
    assert.match(directory.get('calculate_coil_cost').description, /不负责列出.*全部已登记方案/);
    assert.match(directory.get('calculate_coil_cost').description, /必须使用 search_coils/);
    assert.match(directory.get('search_factory_knowledge').description, /禁止用知识快照代替当前价格/);
    assert.match(directory.get('search_parts').description, /电缆、电容、油封、机筒、轴承/);
    assert.match(directory.get('get_all_recipes').description, /具体物料名称.*应使用 search_parts/);
});

test('V2 能力目录：单对象查询不暴露全局经营和管理能力', () => {
    const names = selectToolsForIntent({
        mode: 'query',
        domains: ['order', 'management'],
        entityScope: 'single',
        steps: [{ capabilityName: 'get_order_detail', objective: '读取单个订单' }],
    }).map(tool => tool.function.name);
    assert.ok(names.includes('get_order_detail'));
    assert.equal(names.includes('get_business_alerts'), false);
    assert.equal(names.includes('get_management_action_center'), false);
    assert.equal(names.includes('get_order_readiness_overview'), false);
    assert.equal(names.includes('get_dashboard_summary'), false);
});
