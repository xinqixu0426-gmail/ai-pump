const test = require('node:test');
const assert = require('node:assert/strict');
const {
    enforceAiModelViewBudget,
    enforceAiRawReceiptSafety,
    enforceAiToolResultBudget,
    buildAiToolPlan,
    buildAiToolResultMessage,
    enforceAiToolResultSize,
    explicitIdentifierFromUserText,
    groundCandidateSelectionArgument,
    groundMissingTargetArgument,
    parseAiToolArguments,
    prepareAiToolCalls,
    prioritizeBusinessEvidence,
    selectedCandidateFromReply,
    sanitizeModelInferredFilters,
    validationErrorForModel,
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

test('AI tool protocol：组合 schema 失败时把具体缺失字段反馈给模型', () => {
    const [prepared] = prepareAiToolCalls([
        buildAiToolCall('preview_recipe_cost', {}, 'cost-1'),
    ], 'model');

    assert.equal(prepared.validationStatus, 'rejected');
    assert.match(prepared.validationError, /args\.recipeId 为必填字段/);
    assert.match(prepared.validationError, /args\.recipeName 为必填字段/);
    assert.match(validationErrorForModel(new Error('普通错误')), /普通错误/);
});

test('AI tool protocol：只从用户唯一明确型号补齐只读对象字段', () => {
    const call = buildAiToolCall('preview_recipe_cost', {}, 'cost-2');
    assert.equal(explicitIdentifierFromUserText('V750 的成本是多少'), 'V750');
    assert.equal(explicitIdentifierFromUserText('给我总结一下v750-普通的测试报告'), 'v750-普通');
    assert.equal(explicitIdentifierFromUserText('V750-大脚板-2寸的详情'), 'V750-大脚板-2寸');
    assert.equal(explicitIdentifierFromUserText('V1600-3”-12-180 的测试报告'), 'V1600-3”-12-180');
    assert.equal(explicitIdentifierFromUserText('对比 V750 和 V550'), '');

    const grounded = groundMissingTargetArgument(
        call,
        'preview_recipe_cost',
        'V750',
        'V750 的成本是多少'
    );
    assert.deepEqual(parseAiToolArguments(grounded.function.arguments), { recipeName: 'V750' });

    const restoredExactTarget = groundMissingTargetArgument(
        buildAiToolCall('get_recipe_technical_files', { recipeName: 'v750' }, 'files-1'),
        'get_recipe_technical_files',
        'v750-普通',
        '给我总结一下v750-普通的测试报告'
    );
    assert.deepEqual(parseAiToolArguments(restoredExactTarget.function.arguments), {
        recipeName: 'v750-普通',
    });

    const differentTarget = groundMissingTargetArgument(
        buildAiToolCall('get_recipe_technical_files', { recipeName: 'v750-tokoy' }, 'files-2'),
        'get_recipe_technical_files',
        'v750-普通',
        '给我总结一下v750-普通的测试报告'
    );
    assert.deepEqual(parseAiToolArguments(differentTarget.function.arguments), {
        recipeName: 'v750-tokoy',
    });

    const sanitized = groundMissingTargetArgument(
        buildAiToolCall('build_recipe_bom_draft', {
            templateId: 123,
            shellModel: 'V750-大脚板-2寸',
        }, 'bom-1'),
        'build_recipe_bom_draft',
        'V750-大脚板-2寸',
        'V750-大脚板-2寸的壳，做12-120片'
    );
    assert.deepEqual(parseAiToolArguments(sanitized.function.arguments), {
        shellModel: 'V750-大脚板-2寸',
    });

    const inferredShell = groundMissingTargetArgument(
        buildAiToolCall('build_recipe_bom_draft', { templateId: 750 }, 'bom-2'),
        'build_recipe_bom_draft',
        '',
        'V750-大脚板-2寸的壳，做12-120片，带浮球'
    );
    assert.deepEqual(parseAiToolArguments(inferredShell.function.arguments), {
        shellModel: 'V750-大脚板-2寸',
    });

    const customer = groundMissingTargetArgument(
        buildAiToolCall('search_customer_history', {}, 'customer-1'),
        'search_customer_history',
        '',
        '查询客户邱焕现有的全部报价'
    );
    assert.deepEqual(parseAiToolArguments(customer.function.arguments), { customerName: '邱焕' });

    const ungrounded = groundMissingTargetArgument(
        call,
        'preview_recipe_cost',
        'V1100',
        'V750 的成本是多少'
    );
    assert.equal(ungrounded, call);

    const writeCall = buildAiToolCall('delete_recipe', {}, 'delete-1');
    assert.equal(
        groundMissingTargetArgument(writeCall, 'delete_recipe', 'V750', '删除 V750'),
        writeCall
    );
});

test('AI tool protocol：未明确分类时移除模型自行添加的零件分类过滤', () => {
    const sanitized = sanitizeModelInferredFilters(
        buildAiToolCall('search_parts', { keyword: '800平刀切割泵壳', category: '切割泵壳' }, 'parts-1'),
        'search_parts',
        '查询800平刀切割泵壳目前的单价'
    );
    assert.deepEqual(parseAiToolArguments(sanitized.function.arguments), { keyword: '800平刀切割泵壳' });
    const explicit = buildAiToolCall('search_parts', { category: '泵壳' }, 'parts-2');
    assert.equal(sanitizeModelInferredFilters(explicit, 'search_parts', '查询分类为泵壳的零件'), explicit);
});

test('AI tool protocol：序号只绑定同会话上一轮已验证候选', () => {
    const call = buildAiToolCall('preview_recipe_cost', {}, 'cost-3');
    const previous = [{
        name: 'preview_recipe_cost',
        result: {
            success: false,
            requiresClarification: true,
            candidates: [{ id: 4, name: 'v750-普通' }, { id: 2, name: 'v750-tokoy' }],
            executionEvidence: { verified: true },
        },
    }];
    const selected = groundCandidateSelectionArgument(
        call,
        'preview_recipe_cost',
        '第二个',
        previous
    );
    assert.deepEqual(parseAiToolArguments(selected.function.arguments), { recipeId: 2 });
    const selectedByName = groundCandidateSelectionArgument(
        call,
        'preview_recipe_cost',
        '普通的',
        previous
    );
    assert.deepEqual(parseAiToolArguments(selectedByName.function.arguments), { recipeId: 4 });
    assert.equal(selectedCandidateFromReply('两个都看', previous[0].result.candidates), null);
    assert.equal(
        groundCandidateSelectionArgument(call, 'preview_recipe_cost', '第三个', previous),
        call
    );
    assert.equal(
        groundCandidateSelectionArgument(call, 'preview_recipe_cost', '2', [{
            ...previous[0],
            result: { ...previous[0].result, executionEvidence: { verified: false } },
        }]),
        call
    );
    const writeCall = buildAiToolCall('delete_recipe', {}, 'delete-2');
    assert.equal(
        groundCandidateSelectionArgument(writeCall, 'delete_recipe', '2', previous),
        writeCall
    );
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

// S2-R2P1：下面三个用例覆盖的是 **aiAgentRuntimeV3 沿用的原始回执门**（默认 256 KiB，调用方显式传 maxBytes）。
// 私人助理运行时（aiAssistantRuntime）自 S2-R2P1 起不再用 raw 尺寸判断结果有效性：
// 96 KiB 只判定 modelResultView 的投影（enforceAiModelViewBudget），raw 只受 1 MiB 工程安全上限约束
// （enforceAiRawReceiptSafety）。因此这里额外断言同一形状在两条路径上的不同结论，
// 防止把「raw 超限即失败」重新当成私人助理的契约。
test('AI tool protocol：V3 原始回执门超限时明确失败且不裁剪业务字段；私人助理按投影判定', () => {
    const executionEvidence = {
        verified: true,
        kind: 'formal_api_query',
        calls: [{ method: 'GET', path: '/api/recipes' }],
    };
    const oversized = enforceAiToolResultSize('get_all_recipes', {
        success: true,
        data: [{ id: 1, partsJson: 'x'.repeat(1024) }],
        executionEvidence,
    }, 200);

    assert.equal(oversized.success, false);
    assert.equal(oversized.code, 'AI_QUERY_RESULT_TOO_LARGE');
    assert.match(oversized.error, /未删除任何业务字段/);
    assert.match(oversized.error, /筛选条件.*limit.*详情/);
    assert.equal(oversized.executionEvidence, executionEvidence);
    assert.equal(enforceAiToolResultSize('create_order', {
        success: true,
        data: 'x'.repeat(1024),
    }, 200).success, true);

    // 私人助理路径：同一个「raw 很大」的形状不再因 raw 尺寸失败，
    // 只有投影真正超过模型预算时才拒绝，并且拒绝带明确的 reason。
    const rawReceipt = {
        success: true,
        data: [{ id: 1, name: 'R-1', partsJson: 'x'.repeat(200 * 1024) }],
        executionEvidence,
    };
    assert.ok(Buffer.byteLength(JSON.stringify(rawReceipt), 'utf8') > 96 * 1024);
    assert.ok(Buffer.byteLength(JSON.stringify(rawReceipt), 'utf8') < 1024 * 1024);
    assert.equal(enforceAiRawReceiptSafety('get_all_recipes', rawReceipt), rawReceipt,
        'raw 在 1 MiB 安全上限内必须原样保留');
    const projected = { success: true, data: [{ id: 1, name: 'R-1', omittedFields: ['partsJson'] }], executionEvidence };
    assert.equal(enforceAiModelViewBudget('get_all_recipes', projected, []).allowed, true);
    const refusedView = enforceAiModelViewBudget('get_all_recipes', projected, [], 10);
    assert.equal(refusedView.allowed, false);
    assert.equal(refusedView.reason, 'MODEL_VIEW_RESULT_TOO_LARGE');
    assert.equal(refusedView.result.code, 'AI_QUERY_RESULT_TOO_LARGE');
    assert.equal(refusedView.result.executionEvidence.verified, true);
});

test('AI tool protocol：V3 自动知识伴随结果也经过同一原始回执门；私人助理由投影预算判定', () => {
    const oversized = enforceAiToolResultBudget('get_order_knowledge_package', {
        success: true,
        data: {
            confirmedKnowledge: [{ content: 'x'.repeat(1024) }],
            coverage: { summary: '订单知识' },
        },
        executionEvidence: { verified: true },
    }, [], 400);

    assert.equal(oversized.code, 'AI_QUERY_RESULT_TOO_LARGE');
    assert.equal(oversized.executionEvidence.verified, true);

    // get_order_knowledge_package 没有列表投影，因此它的模型视图与 raw 同形：
    // 私人助理路径下它由模型视图预算拒绝，而不是由 raw 尺寸拒绝。
    const knowledge = {
        success: true,
        data: { confirmedKnowledge: { customerRequirement: 'b'.repeat(100 * 1024), executionRecords: [] } },
        executionEvidence: { verified: true, kind: 'formal_api_query' },
    };
    assert.ok(Buffer.byteLength(JSON.stringify(knowledge), 'utf8') > 96 * 1024);
    assert.equal(enforceAiRawReceiptSafety('get_order_knowledge_package', knowledge), knowledge,
        '180 KB 量级的正式回执不是工程事故，必须保留');
    const viewBudget = enforceAiModelViewBudget('get_order_knowledge_package', knowledge, []);
    assert.equal(viewBudget.allowed, false);
    assert.equal(viewBudget.reason, 'MODEL_VIEW_RESULT_TOO_LARGE');
    assert.match(viewBudget.result.error, /未删除任何业务字段/);
    assert.equal(viewBudget.result.executionEvidence.verified, true);
});

test('AI tool protocol：V3 累计原始回执超限时整体拒绝；私人助理按投影累计判定', () => {
    const existing = [{
        name: 'search_parts',
        result: { success: true, data: 'a'.repeat(180) },
    }];
    const candidate = { success: true, data: 'b'.repeat(180) };
    assert.equal(Buffer.byteLength(JSON.stringify(candidate), 'utf8') < 500, true);

    const checked = enforceAiToolResultBudget(
        'search_templates',
        candidate,
        existing,
        500
    );
    assert.equal(checked.code, 'AI_QUERY_RESULT_TOO_LARGE');

    // 私人助理路径：累计预算按投影累计，且 raw 越大越不该被误判。
    const bigRaw = { success: true, data: 'b'.repeat(200 * 1024) };
    const smallView = { success: true, data: { kind: 'list_summary' } };
    assert.equal(enforceAiRawReceiptSafety('search_templates', bigRaw), bigRaw);
    assert.equal(enforceAiModelViewBudget('search_templates', smallView, [], 500).allowed, true,
        '投影很小时累计不得因为 raw 很大而被拒绝');
    assert.equal(enforceAiModelViewBudget('search_templates', smallView,
        [{ name: 'search_parts', result: { success: true, data: 'a'.repeat(600) } }], 500).reason,
    'CUMULATIVE_MODEL_VIEW_BUDGET_EXCEEDED');
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
