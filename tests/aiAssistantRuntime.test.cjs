const test = require('node:test');
const assert = require('node:assert/strict');
const { runAiAssistant, assistantReadTools } = require('../api/services/aiAssistantRuntime.cjs');
const { AI_TOOLS } = require('../api/routes/ai/tools.cjs');
const { getAiCapability } = require('../api/capabilities/registry.cjs');
const { beginAssistantSession, TTL_MS } = require('../api/services/aiAssistantSession.cjs');
const { modelResultView, previousContext } = require('../api/services/aiAssistantContext.cjs');
const verified = data => ({ success: true, data, executionEvidence: { verified: true, kind: 'formal_api_query' } });
const call = (name, args, id = name) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
function fixture(turns, extra = {}) {
    let index = 0;
    return {
        loadMemory: async () => ({ items: [] }), loadCorrections: () => '',
        fetchAiProvider: async (messages, options) => {
            const answer = typeof turns[index] === 'function' ? turns[index](messages, options) : turns[index]; index++;
            return { json: async () => ({ choices: [{ message: answer }], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } }) };
        }, executeToolCall: async () => verified([]), ...extra,
    };
}
function input(text, session = '') { return { messages: [{ role: 'user', content: text }], confirmationSubject: 'test-owner', conversationId: session || undefined }; }

test('large order list uses a model summary and keeps full evidence; next question remains usable', async () => {
    const full = verified([{ id: 1, customerName: '客户A', status: '待确认', itemsJson: JSON.stringify([{ partsJson: JSON.stringify(Array.from({ length: 300 }, () => ({ model: '配件', price: 20 }))) }]) }]);
    const original = JSON.stringify(full);
    const result = await runAiAssistant(input('最近5个订单', 'large-list-regression'), fixture([
        { tool_calls: [call('get_recent_orders', { limit: 5 })] },
        messages => { const text = messages.find(m => m.role === 'tool').content; assert.match(text, /list_summary/); assert.match(text, /get_order_detail/); assert.doesNotMatch(text, /配件/); return { content: '客户A有一个待确认订单。' }; },
    ], { executeToolCall: async () => full }));
    assert.equal(JSON.stringify(result.toolResults[0].result), original);
    const next = await runAiAssistant(input('V750的成本是多少', 'large-list-regression'), fixture([
        messages => { assert.ok(JSON.stringify(messages).length < 15000); return { tool_calls: [call('get_all_recipes', { keyword: 'V750' })] }; },
        { content: '未找到匹配配方。' },
    ]));
    assert.equal(next.toolResults.length, 1);
});

test('list views preserve filters, identities and errors across order recipe quotation families', () => {
    for (const name of ['get_recent_orders', 'get_all_recipes', 'search_quotations']) {
        const receipt = { ...verified([{ id: 2, name: 'A', itemsJson: '[]', cost: 3 }]), count: 1, queryReceipt: { truncated: true } };
        const view = modelResultView(name, receipt);
        assert.equal(view.data[0].id, 2); assert.equal(view.data[0].cost, 3);
        assert.deepEqual(view.data[0].omittedFields, ['itemsJson']); assert.equal(view.queryReceipt.truncated, true);
        assert.equal(receipt.data[0].itemsJson, '[]');
        assert.deepEqual(modelResultView(name, { success: false, error: 'failure' }), { success: false, error: 'failure' });
    }
});

test('detail JSON is losslessly decoded and oversized historical context explicitly requires requery', () => {
    const source = verified({ id: 1, itemsJson: JSON.stringify([{ partsJson: '[{"model":"A","price":12}]' }]), badJson: '{broken' });
    const view = modelResultView('get_order_detail', source);
    assert.equal(view.data.itemsJson[0].partsJson[0].price, 12);
    assert.equal(view.data.badJson, '{broken'); assert.equal(typeof source.data.itemsJson, 'string');
    const text = previousContext({ toolResults: [{ name: 'get_order_detail', result: verified({ detail: '大'.repeat(20000) }) }] });
    assert.match(text, /重新查询/); assert.ok(text.length < 200);
});

test('compact tool directory retains every tool and validation constraint including description-named parameters', () => {
    const { compactToolDescriptions } = require('../api/services/aiAssistantContext.cjs');
    const tools = assistantReadTools();
    const compact = compactToolDescriptions(tools);
    assert.deepEqual(compact.map(t => t.function.name), tools.map(t => t.function.name));
    for (let i = 0; i < tools.length; i++) {
        assert.deepEqual(Object.keys(compact[i].function.parameters.properties), Object.keys(tools[i].function.parameters.properties));
        assert.deepEqual(compact[i].function.parameters.required, tools[i].function.parameters.required);
    }
    const sample = compactToolDescriptions([{ function: { description: '说明。更多说明', parameters: { type: 'object', properties: { description: { type: 'string', minLength: 3, description: '描述字段' } }, required: ['description'] } } }]);
    assert.deepEqual(sample[0].function.parameters.properties.description, { type: 'string', minLength: 3 });
});

test('large successful detail reserves a final answer instead of failing on tool directory overhead', async () => {
    const result = await runAiAssistant(input('查看明细'), fixture([
        { tool_calls: [call('get_dashboard_summary', {})] },
        (_messages, options) => { assert.deepEqual(options.tools, []); return { content: '已取得概况，尚未查询其他业务。' }; },
    ], { executeToolCall: async () => verified({ detail: '明'.repeat(20000) }) }));
    assert.doesNotMatch(result.finalContent, /超过上下文容量/);
    assert.equal(result.toolResults[0].result.data.detail.length, 20000);
});

test('verified order list supports detail selection in the same session but never a different session', async () => {
    await runAiAssistant(input('最近订单', 'list-selection'), fixture([
        { tool_calls: [call('get_recent_orders', { limit: 5 })] }, { content: '找到客户A的订单。' },
    ], { executeToolCall: async () => verified([{ id: 17, customerName: '客户A' }]) }));
    const turns = [{ tool_calls: [call('get_order_detail', { orderId: 17 })] }, { content: '已读明细。' }];
    const accepted = await runAiAssistant(input('第一个详情', 'list-selection'), fixture(turns));
    assert.equal(accepted.toolResults[0].result.success, true);
    const rejected = await runAiAssistant(input('第一个详情', 'other-list-selection'), fixture(turns));
    assert.equal(rejected.toolResults[0].result.code, 'UNGROUNDED_ORDER_ID');
    const { validateAiToolIdentifierGrounding } = require('../api/services/aiToolIdentifierGrounding.cjs');
    assert.ok(validateAiToolIdentifierGrounding({ toolName: 'get_order_detail', args: { orderId: 17 }, toolResults: [{ name: 'get_recent_orders', result: { success: true, data: [{ id: 17 }] } }] }));
});

test('all registered Query and Preview tools are available without domain or entity-scope gates', () => {
    assert.deepEqual(assistantReadTools().map(t => t.function.name), AI_TOOLS.filter(t => getAiCapability(t.function.name).access === 'read').map(t => t.function.name));
    for (const name of ['search_coils', 'get_all_recipes', 'get_dashboard_summary', 'get_order_detail', 'compare_recipes']) assert.ok(assistantReadTools().some(t => t.function.name === name));
});
test('single loop can read two types in one round and then global/order data without planning calls', async () => {
    const executed = [];
    const result = await runAiAssistant(input('查这个型号的成本以及订单和经营概况'), fixture([
        { tool_calls: [call('search_coils', { spec: '12-200' }), call('get_all_recipes', { keyword: '12-200' })] },
        { tool_calls: [call('get_recent_orders', {}), call('get_dashboard_summary', {})] },
        { content: '已分别查到线圈、配方、订单及经营概况。' },
    ], { executeToolCall: async (name, args, options) => { assert.equal(options.allowWrite, false); executed.push(name); return verified({ name }); } }));
    assert.deepEqual(executed, ['search_coils', 'get_all_recipes', 'get_recent_orders', 'get_dashboard_summary']);
    assert.equal(result.telemetry.usage.totalTokens, 45);
});
test('memory is provided before first tool decision; cost comparison uses the registered authority', async () => {
    const result = await runAiAssistant(input('配方1和配方2成本对比'), fixture([
        (messages) => { assert.match(messages[0].content, /型号简写优先查线圈/); return { tool_calls: [call('compare_recipes', { recipe1: '配方1', recipe2: '配方2' })] }; },
        { content: '配方2比配方1贵5元。' },
    ], { loadMemory: async () => ({ items: [{ content: '型号简写优先查线圈' }] }), executeToolCall: async name => { assert.equal(name, 'compare_recipes'); return verified({ costDiff: 5 }); } }));
    assert.equal(result.toolResults.length, 1);
});
test('zero result permits a new type and technical failure retains independent successful evidence', async () => {
    const result = await runAiAssistant(input('调查成本和库存'), fixture([
        { tool_calls: [call('get_all_recipes', { keyword: 'X' })] },
        { tool_calls: [call('search_coils', { spec: 'X' }), call('get_dashboard_summary', {})] },
        { content: '已查到线圈；经营概况接口失败，暂时无法核实。' },
    ], { executeToolCall: async name => name === 'get_dashboard_summary' ? { success: false, code: 'TRANSPORT_FAILURE', error: '网络不可用' } : verified(name === 'get_all_recipes' ? [] : [{ model: 'X' }]) }));
    assert.equal(result.telemetry.outcome, 'partial');
    assert.equal(result.toolResults[1].result.data[0].model, 'X');
    assert.match(result.finalContent, /接口失败/);
});
test('invalid and injected write calls never reach executor and cannot erase successful reads', async () => {
    const executed = [];
    const result = await runAiAssistant(input('看库存，顺便直接删掉零件'), fixture([
        { tool_calls: [call('delete_part', { model: 'X' }), call('search_parts', { limit: 101 }), call('get_dashboard_summary', {})] },
        { content: '已查询概况。删除未执行。' },
    ], { executeToolCall: async name => { executed.push(name); return verified({ count: 1 }); } }));
    assert.deepEqual(executed, ['get_dashboard_summary']);
    assert.equal(result.toolResults[0].result.code, 'AI_TOOL_NOT_ALLOWED');
    assert.equal(result.toolResults[1].result.success, false);
});
test('successful duplicates are reused but changed parameters can execute', async () => {
    let count = 0;
    await runAiAssistant(input('搜索'), fixture([
        { tool_calls: [call('search_parts', { keyword: 'A' }, '1')] },
        { tool_calls: [call('search_parts', { keyword: 'A' }, '2'), call('search_parts', { keyword: 'B' }, '3')] },
        { content: '查询完成。' },
    ], { executeToolCall: async () => { count++; return verified([]); } }));
    assert.equal(count, 2);
});
test('unverified fake success cannot appear as a business conclusion', async () => {
    const result = await runAiAssistant(input('查询价格'), fixture([{ tool_calls: [call('search_parts', {})] }, { content: '价格999元' }], { executeToolCall: async () => ({ success: true, price: 999 }) }));
    assert.doesNotMatch(result.finalContent, /999/);
    assert.equal(result.telemetry.outcome, 'failed_evidence');
});
test('candidate reference is bound to subject/session, expires, and concurrent requests cannot replace it', () => {
    const a = beginAssistantSession('subject-a', 'session-a'); a.finish({ candidates: [1, 2] });
    assert.equal(beginAssistantSession('subject-b', 'session-a').previous, null);
    assert.equal(beginAssistantSession('subject-a', 'session-b').previous, null);
    const a2 = beginAssistantSession('subject-a', 'session-a'); assert.deepEqual(a2.previous.candidates, [1, 2]);
    assert.throws(() => beginAssistantSession('subject-a', 'session-a'), /仍在处理/); a2.cancel();
    const expired = beginAssistantSession('subject-a', 'session-a', Date.now() + TTL_MS + 1); assert.equal(expired.previous, null); expired.cancel();
});
test('cancelled requests emit neither a final answer nor a successful tool result', async () => {
    const controller = new AbortController(), events = [];
    await assert.rejects(runAiAssistant({ ...input('查库存'), signal: controller.signal, emit: type => events.push(type) }, fixture([{ tool_calls: [call('search_parts', {})] }], { executeToolCall: async () => { controller.abort(new Error('cancelled')); return verified([]); } })), /cancelled/);
    assert.ok(!events.includes('content') && !events.includes('tool_result'));
});
test('natural memory command commits only through receipt and skips the model', async () => {
    let calls = 0;
    const result = await runAiAssistant(input('记入长期记忆：型号简写优先查线圈', 'memory-chat'), fixture([], { changeMemory: async body => { calls++; assert.equal(body.action, 'save'); assert.match(body.idempotencyKey, /^memory:/); return { status: 'completed', auditId: 1, memory: { id: 3, version: 1, content: body.content } }; } }));
    assert.match(result.finalContent, /已记入长期记忆/); assert.equal(calls, 1);
    await assert.rejects(runAiAssistant(input('记入长期记忆：规则B'), fixture([], { changeMemory: async () => ({ status: 'completed' }) })), /正式回执/);
});

test('coil preview cannot collapse same-material electrical variants or silently exclude testing status', async () => {
    const { executeCostTool } = require('../api/routes/ai/executors/costExecutors.cjs');
    const calls = [];
    const internalFetch = async (url, options) => {
        calls.push({ url, options });
        return new Response(JSON.stringify({ success: true, data: [
            { id: 1, spec: '120', diameterMm: 120, sheets: 200, material: '钢带', slotType: '小眼', schemeCode: 'A', schemeStatus: 'official' },
            { id: 2, spec: '120', diameterMm: 120, sheets: 200, material: '钢带', slotType: '小眼', schemeCode: 'B', schemeStatus: 'testing' },
        ] }));
    };
    const result = await executeCostTool('calculate_coil_cost', { spec: '12', sheets: 200, material: '钢带', slotType: '小眼' }, internalFetch);
    assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/coils');
    assert.equal(result.data.requiresVariantSelection, true);
    assert.deepEqual(result.data.variants.map(v => v.schemeCode), ['A', 'B']);
});

test('explicit custom interpolation still reaches cost API when no saved scheme exists', async () => {
    const { executeCostTool } = require('../api/routes/ai/executors/costExecutors.cjs');
    const calls = [];
    const result = await executeCostTool('calculate_coil_cost', { spec: '12', sheets: 201, material: '钢带', slotType: '小眼' }, async (url, options) => {
        calls.push(url); return new Response(JSON.stringify({ success: true, data: options.method === 'GET' ? [] : { cost: 12 } }));
    });
    assert.equal(result.data.cost, 12); assert.deepEqual(calls, ['/api/coils', '/api/coils/calculate']);
});

test('explicit testing scheme preview uses existing includeTesting contract without business writes', async () => {
    const { executeCostTool } = require('../api/routes/ai/executors/costExecutors.cjs');
    const { calculateCoilCost } = require('../api/services/coilCost.cjs');
    const result = await executeCostTool('calculate_coil_cost', { spec: '12', sheets: 200, coilId: 2, material: '钢带', slotType: '小眼' }, async (url, options) => {
        assert.equal(url, '/api/coils/calculate');
        const body = JSON.parse(options.body); assert.equal(body.includeTesting, true);
        const calculated = calculateCoilCost([{ id: 2, spec: '120', diameterMm: 120, sheets: 200, material: '钢带', slotType: '小眼', schemeStatus: 'testing', unitPrice: 0.2, wireWeight: 1, copperBase: 80, coilFee: 8, rotorFee: 5 }], body);
        return new Response(JSON.stringify(calculated), { status: calculated.success ? 200 : 400 });
    });
    assert.equal(result.success, true);
});

test('tool proposals are bounded across rounds including failures', async () => {
    let count = 0;
    const turn = { tool_calls: Array.from({ length: 6 }, (_, i) => call('search_parts', { keyword: String(i) }, `id-${i}`)) };
    const result = await runAiAssistant(input('调查'), fixture([turn, turn], { executeToolCall: async () => { count++; return verified([]); } }));
    assert.equal(count, 6); assert.equal(result.telemetry.outcome, 'budget_exhausted');
});

test('resource IDs cannot become monetary facts; repair retains read tools to obtain missing evidence', async () => {
    let executed = 0;
    const result = await runAiAssistant(input('比较成本'), fixture([
        { tool_calls: [call('compare_recipes', { recipe1: 'A', recipe2: 'B' })] },
        { content: '线圈成本154元，差额5元。' },
        (messages, options) => { assert.ok(options.tools.length > 0); return { content: '正式成本差额5元。' }; },
    ], { executeToolCall: async () => { executed++; return verified({ partId: 154, costDiff: 5 }); } }));
    assert.equal(executed, 1); assert.doesNotMatch(result.finalContent, /154/); assert.match(result.finalContent, /5元/);
});

test('persistent unsupported monetary claims fail without publishing the draft', async () => {
    const events = [];
    const result = await runAiAssistant({ ...input('成本'), emit: (type, event) => { if (type === 'content') events.push(event.content); } }, fixture([
        { tool_calls: [call('compare_recipes', { recipe1: 'A', recipe2: 'B' })] },
        { content: '154元' }, { content: '155元' },
    ], { executeToolCall: async () => verified({ id: 154, costDiff: 5 }) }));
    assert.equal(result.telemetry.outcome, 'failed_answer'); assert.doesNotMatch(events.join(''), /154|155/);
});

test('history-only monetary answer must obtain current evidence while all read tools remain available', async () => {
    const events = [];
    const result = await runAiAssistant({ ...input('两个都看'), emit: (type, event) => { if (type === 'content') events.push(event.content); } }, fixture([
        { content: '上一轮结果是99元。' },
        (messages, options) => { assert.ok(options.tools.some(t => t.function.name === 'search_coils')); return { tool_calls: [call('search_coils', { spec: '12-200' })] }; },
        { content: '本轮查询成本100元。' },
    ], { executeToolCall: async () => verified({ cost: 100 }) }));
    assert.match(result.finalContent, /100元/); assert.doesNotMatch(events.join(''), /99元/);
});

test('formal decimal strings are valid evidence and omitted amounts render from the receipt', async () => {
    const { unsupportedMoneyInAnswer } = require('../api/services/aiAssistantAnswer.cjs');
    assert.deepEqual(unsupportedMoneyInAnswer('成本差额19.64元', [{ result: verified({ costDiff: '19.64' }) }]), []);
    const result = await runAiAssistant(input('对比成本'), fixture([
        { tool_calls: [call('compare_recipes', { recipe1: 'A', recipe2: 'B' })] },
        { content: '两套方案的成本已给出，供你参考。' },
    ], { executeToolCall: async () => ({ ...verified({}), recipe1: { name: 'A', cost: 272.60 }, recipe2: { name: 'B', cost: 292.24 }, costDiff: '19.64' }) }));
    assert.match(result.finalContent, /A.*272.6/); assert.match(result.finalContent, /B.*292.24/); assert.match(result.finalContent, /19.64/);
});

test('partial evidence can be completed with another tool after an unsupported draft', async () => {
    const result = await runAiAssistant(input('两个都看'), fixture([
        { tool_calls: [call('get_copper_price', {})] },
        { content: '方案成本100元。' },
        (messages, options) => { assert.ok(options.tools.some(t => t.function.name === 'compare_recipes')); return { tool_calls: [call('compare_recipes', { recipe1: 'A', recipe2: 'B' })] }; },
        { content: '方案成本101元。' },
    ], { executeToolCall: async name => verified(name === 'get_copper_price' ? { price: 80 } : { totalCost: 101 }) }));
    assert.equal(result.toolResults.length, 2);
    assert.match(result.finalContent, /101元/);
    assert.doesNotMatch(result.finalContent, /100元/);
});

test('quoting the user proposed price in a write-disabled reply needs no business read', async () => {
    const result = await runAiAssistant(input('新增零件X，价格10元'), fixture([
        { content: '已理解零件X、价格10元；业务写操作尚未启用，本次没有新增。' },
    ]));
    assert.match(result.finalContent, /没有新增/);
    assert.equal(result.toolResults.length, 0);
});

test('candidate directory prices cannot be rendered as a completed cost preview', () => {
    const { formatMoneySummary } = require('../api/services/aiAssistantAnswer.cjs');
    assert.equal(formatMoneySummary([{ name: 'calculate_coil_cost', result: verified({ requiresVariantSelection: true, variants: [{ schemeCode: 'A', cost: 100 }] }) }]), '');
});

test('cost fallback preserves current total and formal configuration, including incomplete pricing', () => {
    const { formatMoneySummary } = require('../api/services/aiAssistantAnswer.cjs');
    for (const pricingComplete of [true, false]) {
        const result = formatMoneySummary([{ name: 'build_recipe_bom_draft', result: verified({
            parts: [{ model: '壳体-A', name: '泵壳套件' }, { model: '18-160', name: '线圈转子' }, { model: '泡沫', name: '包装' }],
            costPreview: { currentTotalCost: '253.23', partsCost: 232.23, laborCost: 21, pricingComplete },
        }) }]);
        assert.match(result, /当前总成本.*253.23/);
        assert.match(result, /壳体-A.*18-160.*泡沫/);
        assert.equal(result.includes('不是完整报价'), !pricingComplete);
    }
});

test('formal monetary evidence includes copper price basis but excludes IDs, weights and unverified data', () => {
    const { unsupportedMoneyInAnswer } = require('../api/services/aiAssistantAnswer.cjs');
    const tools = [{ result: verified({ copperBase: 109.91, cost: 166.7136, id: 456, wireWeight: 0.96 }) },
        { result: { success: true, data: { price: 999 } } }];
    assert.deepEqual(unsupportedMoneyInAnswer('铜价109.91元，成本166.71元', tools), []);
    assert.deepEqual(unsupportedMoneyInAnswer('456元，0.96元，999元', tools), [456, 0.96, 999]);
});

test('invalid answer falls back to query receipt amounts with complete candidate identities', async () => {
    const result = await runAiAssistant(input('列出线圈方案和档案成本'), fixture([
        { tool_calls: [call('search_coils', { spec: '18' })] },
        { content: '999元' }, { content: '998元' },
    ], { executeToolCall: async () => verified([
        { schemeCode: 'COIL-A', spec: '18', sheets: 160, material: '钢带', slotType: '小眼', cost: 166.7136 },
        { schemeCode: 'COIL-B', spec: '18', sheets: 160, material: '冷轧', slotType: '国标眼', cost: 195.84155 },
    ]) }));
    assert.match(result.finalContent, /COIL-A.*18-160.*钢带.*小眼.*166.7136/);
    assert.match(result.finalContent, /COIL-B.*冷轧.*国标眼.*195.84155/);
    assert.doesNotMatch(result.finalContent, /999|998/);
});

test('missing target feedback and budget answers preserve formal negatives, never network failures', () => {
    const { unfinishedReply } = require('../api/services/aiAssistantAnswer.cjs');
    for (const entityType of ['recipe', 'part', 'customer']) {
        const missing = { success: false, code: 'AI_RESOURCE_NOT_FOUND', query: '精确目标-A', entityType,
            error: '未找到精确目标-A', executionEvidence: { verified: true, kind: 'formal_api_query_failure' } };
        assert.equal(modelResultView('get_recipe_detail', missing).modelView.kind, 'verified_target_missing');
        assert.match(unfinishedReply([{ result: missing }]), /已核实[\s\S]*未找到精确目标-A/);
        for (const result of [{ ...missing, executionEvidence: { verified: false } }, { ...missing, code: 'AI_PROVIDER_NETWORK_ERROR' }]) {
            assert.equal(modelResultView('get_recipe_detail', result).modelView, undefined);
            assert.doesNotMatch(unfinishedReply([{ result }]), /已核实/);
        }
    }
});

test('query cost fields do not overwrite a valid nonfinancial answer', async () => {
    const result = await runAiAssistant(input('线圈库存有多少'), fixture([
        { tool_calls: [call('search_coils', { spec: '18' })] }, { content: '当前库存5套。' },
    ], { executeToolCall: async () => verified([{ stock: 5, cost: 123 }]) }));
    assert.equal(result.finalContent, '当前库存5套。');
});

test('a raw provider tool protocol is never published or executed and preserves verified negative facts', async () => {
    const protocol = '<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="create_part">x</｜｜DSML｜｜invoke>';
    let executions = 0;
    const events = [];
    const result = await runAiAssistant({ ...input('查不存在的配方'), emit: (type, payload) => { if (type === 'content') events.push(payload.content); } }, fixture([
        { tool_calls: [call('get_recipe_detail', { recipeName: '不存在-A' })] },
        { content: protocol }, { content: protocol },
    ], { executeToolCall: async () => { executions++; return { success: false, code: 'AI_RESOURCE_NOT_FOUND', query: '不存在-A', entityType: 'recipe', error: '未找到配方：不存在-A', executionEvidence: { verified: true, kind: 'formal_api_query_failure' } }; } }));
    assert.equal(executions, 1);
    assert.equal(result.telemetry.outcome, 'failed_protocol');
    assert.match(result.finalContent, /未找到配方：不存在-A/);
    assert.doesNotMatch(events.join(''), /DSML|create_part|invoke/);
});

test('a raw material price cannot stand in for an obtained total cost', async () => {
    const result = await runAiAssistant(input('配方A成本'), fixture([
        { tool_calls: [call('preview_recipe_cost', { recipeName: 'A' })] },
        { content: '以上金额按铜价109.91元核算。' },
    ], { executeToolCall: async () => verified({ copperBase: 109.91, currentTotalCost: 253.23 }) }));
    assert.match(result.finalContent, /当前总成本.*253.23/);
});

test('verified missing targets are not re-executed and remain visible when tool budget is exhausted', async () => {
    let calls = 0;
    const missing = { success: false, code: 'AI_RESOURCE_NOT_FOUND', query: '不存在-A', entityType: 'recipe',
        error: '未找到配方：不存在-A', executionEvidence: { verified: true, kind: 'formal_api_query_failure' } };
    const result = await runAiAssistant(input('查看不存在-A的资料'), fixture([
        { tool_calls: [call('get_recipe_detail', { recipeName: '不存在-A' }, 'a')] },
        { tool_calls: [call('get_recipe_detail', { recipeName: '不存在-A' }, 'b')] },
        { tool_calls: Array.from({ length: 9 }, (_, i) => call('get_all_recipes', { keyword: String(i) }, `c${i}`)) },
    ], { executeToolCall: async () => { calls++; return missing; } }));
    assert.equal(calls, 1);
    assert.match(result.finalContent, /未找到配方：不存在-A/);
    assert.equal(result.telemetry.outcome, 'budget_exhausted');
});

test('empty formal query feedback preserves scope and rejects incomplete or failed evidence', () => {
    const { verifiedEmptyQuery, unfinishedReply } = require('../api/services/aiAssistantAnswer.cjs');
    const { modelResultView } = require('../api/services/aiAssistantContext.cjs');
    const result = { success: true, data: [], queryReceipt: { authoritative: true, appliedFilters: { keyword: '范围A' }, totalCount: 0, returnedCount: 0, truncated: false, possiblyTruncated: false }, executionEvidence: { verified: true, kind: 'formal_api_query' } };
    assert.equal(verifiedEmptyQuery(result), true);
    assert.equal(modelResultView('get_all_recipes', result).modelView.kind, 'verified_empty_query');
    assert.match(unfinishedReply([{ name: 'get_all_recipes', result }]), /范围A/);
    for (const invalid of [
        { ...result, success: false },
        { ...result, executionEvidence: { verified: false } },
        { ...result, data: [{ id: 1 }] },
        ...['authoritative', 'truncated', 'possiblyTruncated', 'totalCount', 'returnedCount'].map(key => ({ ...result, queryReceipt: { ...result.queryReceipt, [key]: key === 'authoritative' ? false : 1 } })),
    ]) assert.equal(verifiedEmptyQuery(invalid), false);
});

test('template model view distinguishes bundle costs from catalog unit prices without changing receipts', () => {
    const { modelResultView } = require('../api/services/aiAssistantContext.cjs');
    for (const name of ['search_templates', 'get_template_detail']) {
        const result = { success: true, data: { id: 4, bundleCost: 95, assemblyWage: 6 }, executionEvidence: { verified: true, kind: 'formal_api_query' } };
        const view = modelResultView(name, result);
        assert.equal(view.modelView.kind, 'template_configuration');
        assert.match(view.modelView.note, /search_parts/);
        assert.deepEqual(view.data, result.data);
        assert.equal(result.modelView, undefined);
        assert.equal(modelResultView(name, { success: false, error: '接口失败' }).modelView, undefined);
    }
});

test('final model round explicitly closes querying and asks for evidence-based synthesis', async () => {
    let rounds = 0;
    const deps = fixture([], { fetchAiProvider: async (messages, options) => {
        rounds++;
        if (!options.tools.length) {
            assert.match(messages.at(-1).content, /查询阶段已结束/);
            assert.ok(messages.every(message => message.role !== 'tool' && !message.tool_calls && !message.reasoning_content));
            assert.ok(messages.some(message => message.role === 'user' && /已执行查询返回的数据/.test(message.content)));
            return { json: async () => ({ choices: [{ message: { content: '已查询库存，其他问题尚未核实。' } }] }) };
        }
        return { json: async () => ({ choices: [{ message: { tool_calls: [call('get_all_recipes', {}, `round${rounds}`)] } }] }) };
    } });
    const result = await runAiAssistant(input('查询库存', 'final-synthesis'), deps);
    assert.equal(rounds, 7);
    assert.match(result.finalContent, /尚未核实/);
});
