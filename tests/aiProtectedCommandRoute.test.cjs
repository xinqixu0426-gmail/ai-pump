const test = require('node:test');
const assert = require('node:assert/strict');
const { runAiDispatcherV3 } = require('../api/services/aiDispatcherV3.cjs');
const {
    buildProtectedCommandIntent,
    buildProtectedCommandToolCall,
    detectProtectedCommandRoute,
    extractSingleCoilStockAdjustmentArgs,
    extractSinglePartCreateArgs,
    extractSinglePartUpdateArgs,
} = require('../api/services/aiProtectedCommandRoute.cjs');

function messages(content) {
    return [{ role: 'user', content }];
}

test('AI 写命令路由：明确录入单个零件进入受保护命令链', () => {
    const route = detectProtectedCommandRoute(messages(
        '帮我录入一个零件，类型 皮垫，型号120\\*2.65，单价1元，供应商泽国皮垫供应商'
    ));
    assert.equal(route.mode, 'command');
    assert.deepEqual(route.domains, ['catalog']);
    assert.equal(route.preferredCapability, 'create_part');
});

test('AI 写命令路由：能力询问、操作说明和否定命令不取得写权限', () => {
    for (const text of [
        '目前的AI能录入零件吗',
        '新增零件需要什么参数',
        '帮我看看怎么新增零件',
        '不要删除这个零件',
        '查询最近新增的零件',
    ]) {
        assert.equal(detectProtectedCommandRoute(messages(text)), null, text);
    }
});

test('AI 写命令路由：将/把开头的零件修改进入 update_part 命令链', () => {
    for (const text of [
        '将零件 A 的单价修改成5元',
        '把零件型号 A 的供应商改为新供应商',
    ]) {
        const route = detectProtectedCommandRoute(messages(text));
        assert.equal(route?.mode, 'command', text);
        assert.equal(route?.preferredCapability, 'update_part', text);
    }
    assert.equal(detectProtectedCommandRoute(messages('不要把零件 A 的单价修改成5元')), null);
    assert.equal(detectProtectedCommandRoute(messages('零件 A 的单价能修改成5元吗')), null);
});

test('AI 写命令路由：明确线圈库存增减确定性进入确认链，绝对目标不偷换成增量', () => {
    assert.deepEqual(extractSingleCoilStockAdjustmentArgs('把12-120线圈库存增加100套'), {
        items: [{ model: '12-120', changeQty: 100 }],
    });
    assert.deepEqual(extractSingleCoilStockAdjustmentArgs('12－140线圈库存出库3套'), {
        items: [{ model: '12-140', changeQty: -3 }],
    });
    assert.equal(extractSingleCoilStockAdjustmentArgs('把12-120线圈库存改成100'), null);

    const userMessages = messages('把12-120线圈库存增加100套');
    const route = detectProtectedCommandRoute(userMessages);
    assert.equal(route?.preferredCapability, 'adjust_coil_stock');
    const toolCall = buildProtectedCommandToolCall(userMessages, route);
    assert.equal(toolCall.function.name, 'adjust_coil_stock');
    assert.deepEqual(JSON.parse(toolCall.function.arguments), {
        items: [{ model: '12-120', changeQty: 100 }],
    });
});

test('AI 写命令路由：单零件字段从当前明确指令确定性提取并清理 Markdown 转义', () => {
    const userMessages = messages(
        '帮我录入一个零件，类型 皮垫，型号120\\*2.65，单价1元，供应商泽国皮垫供应商，库存 3'
    );
    assert.deepEqual(extractSinglePartCreateArgs(userMessages[0].content), {
        model: '120*2.65',
        category: '皮垫',
        price: 1,
        supplier: '泽国皮垫供应商',
        stock: 3,
    });
    const route = detectProtectedCommandRoute(userMessages);
    const toolCall = buildProtectedCommandToolCall(userMessages, route);
    assert.equal(toolCall.function.name, 'create_part');
    assert.deepEqual(JSON.parse(toolCall.function.arguments), {
        model: '120*2.65',
        category: '皮垫',
        price: 1,
        supplier: '泽国皮垫供应商',
        stock: 3,
    });
    assert.equal(extractSinglePartCreateArgs('帮我录入零件，型号 X'), null);
});

test('AI 写命令路由：修改字段确定性提取，刚才录入引用只绑定已验证上下文', () => {
    const recentPartWrite = {
        toolName: 'create_part',
        part: { id: 142, model: '确认卡编辑验收-0914', supplier: '测试供应商' },
    };
    assert.deepEqual(
        extractSinglePartUpdateArgs('将刚才录入的零件单价修改成5元', recentPartWrite),
        { model: '确认卡编辑验收-0914', price: 5 }
    );
    assert.equal(
        extractSinglePartUpdateArgs('将刚才录入的零件单价修改成5元', null),
        null
    );
    assert.deepEqual(
        extractSinglePartUpdateArgs('把零件 120\\*2.65 的供应商改为泽国二厂'),
        { model: '120*2.65', supplier: '泽国二厂' }
    );

    const userMessages = messages('将刚才录入的零件单价修改成5元');
    const route = detectProtectedCommandRoute(userMessages, { recentPartWrite });
    const toolCall = buildProtectedCommandToolCall(userMessages, route);
    assert.equal(toolCall.function.name, 'update_part');
    assert.deepEqual(JSON.parse(toolCall.function.arguments), {
        model: '确认卡编辑验收-0914',
        price: 5,
    });
    assert.deepEqual(buildProtectedCommandIntent(userMessages, route).steps, [{
        capabilityName: 'update_part',
        objective: '将刚才录入的零件单价修改成5元',
    }]);
});

test('AI 调度器：查询走只读助手，明确写命令走确认执行器', async () => {
    // NATIVE-HC1：读 → Native 任务运行时；写命令 → Native 显式「写未开放」。
    // Legacy 只读/写运行时都不再被调用。
    const calls = [];
    const legacy = { read: 0, command: 0 };
    const dependencies = {
        nativeTaskDelegation: true,
        runAiTaskControllerV2: async input => {
            calls.push(['native', input.commandRoute]);
            return { task: { goals: [] }, detail: {}, answer: { content: 'native' }, canaryAdmission: { eligible: true }, telemetry: {} };
        },
        runAiAssistant: async () => { legacy.read += 1; return {}; },
        runAiAgentRuntimeV3: async () => { legacy.command += 1; return {}; },
    };

    const read = await runAiDispatcherV3({ messages: messages('皮垫零件多少钱') }, dependencies);
    assert.equal(calls[0][0], 'native');
    assert.equal(calls[0][1], null);
    assert.equal(legacy.read, 0);
    assert.equal(legacy.command, 0);
    assert.equal(read.canaryAdmission.eligible, true);
    const write = await runAiDispatcherV3({ messages: messages('帮我录入零件，型号120*2.65，单价1元') }, dependencies);
    assert.equal(write.telemetry.outcome, 'native_write_disabled');
    assert.equal(legacy.read, 0);
    assert.equal(legacy.command, 0);
    // HC1：写命令不再交给 Legacy 命令运行时，而是 Native 显式拒绝写入；
    // 命令路由的识别结果仍由 detectProtectedCommandRoute 确定性产出。
    assert.equal(calls.length, 1, '写命令不得再进入任何 runtime');
    assert.equal(calls[0][1], null, '第一个（只读）调用没有命令路由');
    assert.equal(detectProtectedCommandRoute(messages('帮我录入零件，型号120*2.65，单价1元')).preferredCapability, 'create_part');
});

