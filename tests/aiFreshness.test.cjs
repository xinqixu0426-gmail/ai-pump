const test = require('node:test');
const assert = require('node:assert/strict');
const {
    requiresFreshToolLookup,
    buildFreshLookupToolCalls,
    explicitKnowledgeLookup,
    parseCoilInventoryInstruction,
    parsePartInventoryInstruction,
    purposeLookupQuery,
    resolveFreshLookupText,
} = require('../api/services/aiFreshness.cjs');
const {
    compileBusinessQuery,
} = require('../api/services/aiBusinessQueryCompiler.cjs');

test('AI 实时数据查询必须重新调用工具', () => {
    const messages = [
        { role: 'assistant', content: '800平刀切割泵壳原来的单价是 95 元。' },
        { role: 'user', content: '800平刀切割泵壳成本是多少' },
    ];

    assert.equal(requiresFreshToolLookup(messages), true);
    assert.equal(requiresFreshToolLookup([{ role: 'user', content: '现在订单状态怎么样' }]), true);
    assert.equal(requiresFreshToolLookup([{ role: 'user', content: '查一下最新铜价' }]), true);

    assert.deepEqual(buildFreshLookupToolCalls(messages), [
        { name: 'search_parts', args: { keyword: '800平刀切割泵壳' } },
    ]);
});

test('AI 普通闲聊不强制调用业务工具', () => {
    assert.equal(requiresFreshToolLookup([{ role: 'user', content: '你好' }]), false);
    assert.equal(requiresFreshToolLookup([{ role: 'user', content: '谢谢' }]), false);
    assert.equal(requiresFreshToolLookup([]), false);
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '你好' }]), []);
});

test('AI 只读查询失败后“再试一次”会重新执行最近的有效查询', () => {
    const messages = [
        { role: 'user', content: '帮我查下零件库中油封类别的供应商有哪些' },
        { role: 'assistant', content: '连接中断，未取得完整结果。' },
        { role: 'user', content: '再试一次' },
    ];

    assert.equal(resolveFreshLookupText(messages), '帮我查下零件库中油封类别的供应商有哪些');
    assert.equal(requiresFreshToolLookup(messages), true);
    assert.deepEqual(buildFreshLookupToolCalls(messages), [
        { name: 'search_parts', args: { category: '油封' } },
    ]);
});

test('AI 短重试指令不会继承或重复执行写操作', () => {
    const messages = [
        { role: 'user', content: '12-120 入库 50 套' },
        { role: 'assistant', content: '连接中断' },
        { role: 'user', content: '重试' },
    ];

    assert.equal(resolveFreshLookupText(messages), '重试');
    assert.equal(requiresFreshToolLookup(messages), false);
    assert.deepEqual(buildFreshLookupToolCalls(messages), []);
});

test('AI 零件类别查询使用 search_parts 的 category 参数', () => {
    const text = '帮我查下零件库中油封类别的供应商有哪些';

    assert.deepEqual(compileBusinessQuery(text).args, { category: '油封' });
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: text }]).at(-1), {
        name: 'search_parts',
        args: { category: '油封' },
    });

    assert.deepEqual(compileBusinessQuery('查一下类别为油封的零件').args, { category: '油封' });
    assert.deepEqual(buildFreshLookupToolCalls([{
        role: 'user',
        content: '查一下类别为油封的零件',
    }]), [
        { name: 'search_parts', args: { category: '油封' } },
    ]);
});

test('AI 低库存零件查询使用正式库存状态而不是把低库存当关键词', () => {
    assert.deepEqual(compileBusinessQuery('低库存的零件有哪些').args, { stockStatus: 'low' });
    assert.deepEqual(buildFreshLookupToolCalls([{
        role: 'user',
        content: '低库存的零件有哪些',
    }]), [{
        name: 'search_parts',
        args: { stockStatus: 'low' },
    }]);
    assert.deepEqual(buildFreshLookupToolCalls([{
        role: 'user',
        content: '库存不足的配件有哪些',
    }]), [{
        name: 'search_parts',
        args: { stockStatus: 'attention' },
    }]);
});

test('AI 零件全量和短品类查询只传有效的正式筛选条件', () => {
    assert.deepEqual(compileBusinessQuery('列出所有零件').args, {});
    assert.deepEqual(compileBusinessQuery('零件有哪些').args, {});
    assert.deepEqual(compileBusinessQuery('列出电缆').args, { keyword: '电缆' });
    assert.deepEqual(buildFreshLookupToolCalls([{
        role: 'user',
        content: '列出所有零件',
    }]), [{
        name: 'search_parts',
        args: {},
    }]);
    assert.deepEqual(buildFreshLookupToolCalls([{
        role: 'user',
        content: '列出电缆',
    }]), [{
        name: 'search_parts',
        args: { keyword: '电缆' },
    }]);
    assert.deepEqual(buildFreshLookupToolCalls([{
        role: 'user',
        content: '列出所有电缆',
    }]), [{
        name: 'search_parts',
        args: { keyword: '电缆' },
    }]);
});

test('AI 精确型号查询会剥离字段描述而保留完整零件型号', () => {
    assert.deepEqual(buildFreshLookupToolCalls([{
        role: 'user',
        content: '查询型号TEST-机筒-1100的当前库存、单价和供应商',
    }]), [{
        name: 'search_parts',
        args: { keyword: 'TEST-机筒-1100' },
    }]);
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
        { name: 'get_copper_price', args: {} },
    ]);
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '订单 #12 当前状态怎么样' }]), [
        { name: 'get_order_detail', args: { orderId: 12 } },
    ]);
});

test('AI 将订单生产和齐料问题直接路由到生产准备检查', () => {
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '订单 #12 现在能不能生产' }]), [
        { name: 'check_order_readiness', args: { orderId: 12 } },
    ]);
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '订单12是否齐料' }]), [
        { name: 'check_order_readiness', args: { orderId: 12 } },
    ]);
});

test('AI 将多订单生产准备问题路由到实时订单总览', () => {
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '哪些订单目前不能生产' }]), [
        { name: 'get_order_readiness_overview', args: {} },
    ]);
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '全部订单生产准备总览' }]), [
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
        { name: 'plan_order_readiness_actions', args: { orderId: 12 } },
    ]);
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '给订单12生成处理方案' }]), [
        { name: 'plan_order_readiness_actions', args: { orderId: 12 } },
    ]);
});

test('AI 执行订单处理步骤前先刷新当前处理方案', () => {
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '执行订单 #12 处理方案第1步' }]), [
        { name: 'plan_order_readiness_actions', args: { orderId: 12 } },
    ]);
});

test('AI 订单、采购和配方事实查询只调用对应正式业务工具', () => {
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '查一下最近的订单' }]), [
        { name: 'get_recent_orders', args: { limit: 10 } },
    ]);
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '查一下当前采购情况' }]), [
        { name: 'get_purchase_overview', args: {} },
    ]);
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '查一下订单12的采购进度' }]), [
        { name: 'get_order_detail', args: { orderId: 12 } },
    ]);
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '查一下所有配方' }]), [
        { name: 'get_all_recipes', args: {} },
    ]);
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: 'V750配方成本是多少' }]), [
        { name: 'preview_recipe_cost', args: { recipeName: 'V750' } },
    ]);
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '查一下配方为V750的成本' }]), [
        { name: 'preview_recipe_cost', args: { recipeName: 'V750' } },
    ]);
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '配方 #12 当前成本是多少' }]), [
        { name: 'preview_recipe_cost', args: { recipeId: 12 } },
    ]);
    assert.deepEqual(buildFreshLookupToolCalls([{
        role: 'user',
        content: 'V1600-3”-12-180配方技术档案中的Excel附件是什么资料？',
    }]), [{
        name: 'get_recipe_technical_files',
        args: { recipeName: 'V1600-3”-12-180' },
    }]);
    assert.deepEqual(buildFreshLookupToolCalls([{
        role: 'user',
        content: '总结V1600-3”-12-180性能测试报告中的有效测试数据。只展示逐条测试点数据，不要提到被忽略的模板字段名称。',
    }]), [{
        name: 'get_recipe_technical_files',
        args: { recipeName: 'V1600-3”-12-180' },
    }]);
    assert.deepEqual(buildFreshLookupToolCalls([{
        role: 'user',
        content: '配方TEST-PUMP-750A用了哪些零件',
    }]), [{
        name: 'get_recipe_detail',
        args: { recipeName: 'TEST-PUMP-750A' },
    }]);
    assert.deepEqual(buildFreshLookupToolCalls([{
        role: 'user',
        content: '查一下配方TEST-PUMP-750A的明细和当前成本',
    }]), [{
        name: 'get_recipe_detail',
        args: { recipeName: 'TEST-PUMP-750A', includeCurrentCost: true },
    }]);
});

test('AI 将规格片数简写精确路由到正式线圈库存方案', () => {
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '给我12-220的线圈数据' }]), [
        { name: 'search_coils', args: { spec: '12', sheets: 220 } },
    ]);
});

test('AI 将线圈库存问题路由到正式线圈 API 而不是知识库', () => {
    assert.deepEqual(buildFreshLookupToolCalls([{ role: 'user', content: '150-96线圈库存是多少' }]), [
        { name: 'search_coils', args: { spec: '150', sheets: 96 } },
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

test('AI 将多型号零件入库直接编译为单个原子库存命令', () => {
    const messages = [
        {
            role: 'assistant',
            content: '| 型号 | 库存 |\n|---|---|\n| `TEST-机筒-1100` | 4 |\n| `TEST-电容-30uF` | 5 |',
        },
        {
            role: 'user',
            content: '这两个型号我都进了30，把库存+30',
        },
    ];
    const expected = {
        items: [
            { model: 'TEST-机筒-1100', changeQty: 30 },
            { model: 'TEST-电容-30uF', changeQty: 30 },
        ],
    };

    assert.deepEqual(parsePartInventoryInstruction(messages), expected);
    assert.deepEqual(buildFreshLookupToolCalls(messages), [{
        name: 'adjust_part_stock',
        args: expected,
    }]);
    assert.deepEqual(parsePartInventoryInstruction('`A-01`、`B-02`各出库5件'), {
        items: [
            { model: 'A-01', changeQty: -5 },
            { model: 'B-02', changeQty: -5 },
        ],
    });
    assert.deepEqual(parsePartInventoryInstruction('TEST-电容-30uF的库存加30个'), {
        items: [{ model: 'TEST-电容-30uF', changeQty: 30 }],
    });
    assert.deepEqual(parsePartInventoryInstruction('把 TEST-电容-30uF 的库存增加30件'), {
        items: [{ model: 'TEST-电容-30uF', changeQty: 30 }],
    });
    assert.deepEqual(parsePartInventoryInstruction('TEST-机筒-1100库存+100'), {
        items: [{ model: 'TEST-机筒-1100', changeQty: 100 }],
    });
    assert.deepEqual(buildFreshLookupToolCalls([{
        role: 'user',
        content: 'TEST-机筒-1100库存+100',
    }]), [{
        name: 'adjust_part_stock',
        args: {
            items: [{ model: 'TEST-机筒-1100', changeQty: 100 }],
        },
    }]);
    assert.deepEqual(buildFreshLookupToolCalls([{
        role: 'user',
        content: '零件型号 V750-12-120 入库30套',
    }]), [{
        name: 'adjust_part_stock',
        args: {
            items: [{ model: 'V750-12-120', changeQty: 30 }],
        },
    }]);
    assert.deepEqual(parseCoilInventoryInstruction('12-120库存+30套'), {
        items: [{ model: '12-120', changeQty: 30 }],
    });
    assert.deepEqual(parsePartInventoryInstruction('`特殊型号的`库存加2件'), {
        items: [{ model: '特殊型号的', changeQty: 2 }],
    });
});
