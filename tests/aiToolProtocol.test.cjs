const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildAiToolPlan,
    buildAiToolResultMessage,
    parseAiToolArguments,
    prepareAiToolCalls,
    prioritizeBusinessEvidence,
    viewTypeForAiTool,
} = require('../api/services/aiToolProtocol.cjs');

function buildAiToolCall(name, args, id) {
    return {
        id,
        type: 'function',
        function: { name, arguments: JSON.stringify(args || {}) },
    };
}

test('AI tool protocol：参数只接受 JSON 对象并对异常输入安全降级', () => {
    assert.deepEqual(parseAiToolArguments('{"orderId":27}'), { orderId: 27 });
    assert.deepEqual(parseAiToolArguments({ orderId: 27 }), { orderId: 27 });
    assert.deepEqual(parseAiToolArguments('not-json'), {});
    assert.deepEqual(parseAiToolArguments('[1,2]'), {});
});

test('AI tool protocol：计划统一标识读写风险并压缩参数摘要', () => {
    const plan = buildAiToolPlan([
        buildAiToolCall('get_recent_orders', { limit: 5 }, 'read-1'),
        buildAiToolCall('create_order', { customerName: '客户甲', items: [{ recipeId: 3 }] }, 'write-1'),
    ], new Set(['create_order']));

    assert.equal(plan.steps[0].label, '读取最近订单');
    assert.equal(plan.steps[0].mode, 'read');
    assert.equal(plan.steps[1].label, '新建订单');
    assert.equal(plan.steps[1].mode, 'write');
    assert.equal(plan.steps[1].requiresConfirmation, true);
    assert.deepEqual(plan.steps[1].argsSummary, [
        { key: 'customerName', value: '客户甲' },
        { key: 'items', value: '共 1 项' },
    ]);
    assert.match(plan.summary, /1 个写操作需要确认/);
});

test('AI tool protocol：模型候选参数只按统一 schema 校验，不用正则二次猜语义', () => {
    const prepared = prepareAiToolCalls([
        buildAiToolCall('search_parts', { keyword: '有没有', stockStatus: 'out' }, 'read-1'),
        buildAiToolCall('search_parts', { query: '轴承' }, 'read-2'),
    ], 'model');

    assert.deepEqual(parseAiToolArguments(prepared[0].toolCall.function.arguments), {
        keyword: '有没有',
        stockStatus: 'out',
    });
    assert.equal(prepared[0].validationStatus, 'validated');
    assert.equal(prepared[1].validationStatus, 'rejected');
    const plan = buildAiToolPlan(prepared, new Set());
    assert.equal(plan.steps[0].source, 'model');
    assert.equal(plan.steps[0].validationStatus, 'validated');
    assert.equal(plan.steps[1].validationStatus, 'rejected');
    assert.deepEqual(plan.steps[1].argsSummary, []);
    assert.match(plan.summary, /不会执行/);
});

test('AI tool protocol：查询轮次拒绝模型越权调用库存写工具', () => {
    const [prepared] = prepareAiToolCalls([{
        id: 'call-write',
        type: 'function',
        function: {
            name: 'adjust_part_stock',
            arguments: JSON.stringify({
                items: [{ model: 'TEST-机筒-1100', changeQty: 100 }],
            }),
        },
    }], 'model', {
        allowedToolNames: ['search_factory_knowledge'],
        writeIntent: false,
        writeTools: new Set(['adjust_part_stock']),
    });

    assert.equal(prepared.validationStatus, 'rejected');
    assert.equal(prepared.validationCode, 'AI_TOOL_NOT_ALLOWED_FOR_CURRENT_TURN');

    const [writeRejected] = prepareAiToolCalls([{
        id: 'call-write-offered',
        type: 'function',
        function: {
            name: 'adjust_part_stock',
            arguments: '{}',
        },
    }], 'model', {
        allowedToolNames: ['adjust_part_stock'],
        writeIntent: false,
        writeTools: new Set(['adjust_part_stock']),
    });
    assert.equal(writeRejected.validationStatus, 'rejected');
    assert.equal(writeRejected.validationCode, 'AI_WRITE_TOOL_NOT_ALLOWED_FOR_READ_TURN');
});

test('AI tool protocol：新增编排与事实草稿工具也从能力注册表取得展示名', () => {
    const plan = buildAiToolPlan([
        buildAiToolCall('plan_factory_workflow', {}, 'plan-1'),
        buildAiToolCall('save_order_requirement_draft', { orderId: 27 }, 'draft-1'),
    ], new Set(['save_order_requirement_draft']));

    assert.equal(plan.steps[0].label, '生成工厂工作流计划');
    assert.equal(plan.steps[1].label, '保存客户要求草稿');
});

test('AI tool protocol：工具调用与模型回执使用同一序列化格式', () => {
    const call = buildAiToolCall('get_order_detail', { orderId: 27 }, 'call-27');
    const message = buildAiToolResultMessage(call, { success: true, data: { id: 27 } });

    assert.equal(call.function.arguments, '{"orderId":27}');
    assert.equal(message.role, 'tool');
    assert.equal(message.tool_call_id, 'call-27');
    assert.equal(message.name, 'get_order_detail');
    assert.match(message.content, /^\{"success":true,"data":\{"id":27\}\}/);
    assert.match(message.content, /只输出面向用户的结果/);
    assert.match(message.content, /不展示内部思考、逐步推理、工具选择或处理过程/);
    assert.match(message.content, /一个简短标题和 2-5 个短要点/);
    assert.doesNotMatch(message.content, /120 个汉字/);
});

test('AI tool protocol：取得本轮证据后移除历史 assistant 事实干扰', () => {
    const messages = [
        { role: 'system', content: '系统规则' },
        { role: 'user', content: '旧问题' },
        { role: 'assistant', content: '旧库存 10' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'parts' }] },
        { role: 'tool', tool_call_id: 'parts', content: '{"stock":8}' },
    ];
    const prioritized = prioritizeBusinessEvidence(messages, 2);

    assert.match(prioritized[0].content, /本轮证据优先/);
    assert.match(prioritized[0].content, /只输出面向用户的结果/);
    assert.match(prioritized[0].content, /不展示内部推理链/);
    assert.match(prioritized[0].content, /确认、失败和关键风险不得省略/);
    assert.equal(prioritized.some(message => message.content === '旧库存 10'), false);
    assert.equal(prioritized.at(-1).content, '{"stock":8}');
});

test('AI tool protocol：工具详情视图映射集中且未知工具安全回退', () => {
    assert.equal(viewTypeForAiTool('get_order_detail'), 'order_detail');
    assert.equal(viewTypeForAiTool('unknown_tool'), 'action_result');
});
