const test = require('node:test');
const assert = require('node:assert/strict');
const { runAiAssistant, assistantReadTools } = require('../api/services/aiAssistantRuntime.cjs');
const { AI_TOOLS } = require('../api/routes/ai/tools.cjs');
const { getAiCapability } = require('../api/capabilities/registry.cjs');
const { beginAssistantSession, TTL_MS } = require('../api/services/aiAssistantSession.cjs');
const { modelResultView, previousContext } = require('../api/services/aiAssistantContext.cjs');
const { stabilizeLocalAnswer } = require('../api/services/aiAssistantAnswer.cjs');
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

test('local answer stabilization removes exact paragraph loops and bounds default replies', () => {
    const repeated = `查询完成。\n\n${'补充说明。\n\n'.repeat(100)}查询完成。`;
    const stabilized = stabilizeLocalAnswer(repeated, '查一下库存');
    assert.equal(stabilized.match(/查询完成/g).length, 1);
    assert.ok([...stabilized].length <= 600);
    assert.ok([...stabilizeLocalAnswer('明细。'.repeat(700), '给我全部详细明细')].length > 600);
});

function streamResponse(events) {
    const body = `${events.map(event => `data: ${JSON.stringify(event)}\n`).join('')}data: [DONE]\n`;
    return new Response(new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();
            for (const line of body.split(/(?<=\n)/)) controller.enqueue(encoder.encode(line));
            controller.close();
        },
    }));
}

test('direct assistant reply streams provider content chunks without a duplicate final event', async () => {
    const events = [];
    const result = await runAiAssistant({
        ...input('你好，只回答你好'),
        env: { AI_PROVIDER: 'local' },
        stream: true,
        emit: (type, payload) => events.push({ type, payload }),
    }, fixture([], {
        fetchAiProvider: async (_messages, options) => {
            assert.deepEqual(options.tools, []);
            return streamResponse([
                { choices: [{ delta: { content: '你' } }] },
                { choices: [{ delta: { content: '好' } }] },
                { choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } },
            ]);
        },
    }));
    assert.equal(result.finalContent, '你好');
    assert.deepEqual(events.filter(event => event.type === 'content').map(event => event.payload.content), ['你', '好']);
    assert.equal(events.at(-1).type, 'done');
});

test('tool-assisted reply stays buffered until execution evidence and final answer are complete', async () => {
    const events = [];
    let round = 0;
    const result = await runAiAssistant({
        ...input('V750 配方成本是多少'),
        env: { AI_PROVIDER: 'local' },
        stream: true,
        emit: (type, payload) => events.push({ type, payload }),
    }, fixture([], {
        fetchAiProvider: async () => {
            round++;
            if (round === 1) return streamResponse([{
                choices: [{ delta: { tool_calls: [{
                    index: 0,
                    id: 'cost-call',
                    type: 'function',
                    function: { name: 'preview_recipe_cost', arguments: '{"recipeName":"V750"}' },
                }] } }],
            }]);
            return streamResponse([
                { choices: [{ delta: { content: 'V750 当前成本为' } }] },
                { choices: [{ delta: { content: '100元。' } }] },
            ]);
        },
        executeToolCall: async () => verified({ totalCost: 100 }),
    }));
    assert.equal(result.finalContent, 'V750 当前成本为100元。');
    assert.deepEqual(events.filter(event => event.type === 'content').map(event => event.payload.content), ['V750 当前成本为100元。']);
    assert.ok(events.findIndex(event => event.type === 'tool_result') < events.findIndex(event => event.type === 'content'));
});

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

test('part list model view removes duplicate aliases and timestamps without dropping rows', () => {
    const rows = Array.from({ length: 108 }, (_, index) => ({
        id: index + 1,
        Id: index + 1,
        model: `P-${index + 1}`,
        category: '零件',
        subcategory: '',
        price: 1.2,
        supplier: '供应商',
        stock: 0,
        remark: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        CreatedAt: '2026-01-01T00:00:00.000Z',
    }));
    const receipt = { ...verified(rows), count: rows.length };
    const view = modelResultView('search_parts', receipt, { userText: '列出全部缺货零件明细' });
    assert.equal(view.groupedParts.reduce((total, group) => total + group.items.length, 0), rows.length);
    assert.deepEqual(view.groupedParts[0].columns, ['id', 'model', 'price', 'stock', 'supplier']);
    assert.equal(view.groupedParts[0].items[0][1], 'P-1');
    assert.equal(receipt.data[0].Id, 1);
    assert.equal(view.modelView.kind, 'grouped_part_list');

    const summary = modelResultView('search_parts', receipt, { userText: '有哪些缺货零件' });
    assert.equal(summary.samplePartsByCategory[0].items.length, 3);
    assert.equal(summary.samplePartsByCategory[0].omittedCount, 105);
    assert.equal(summary.modelView.kind, 'summarized_part_list');
});

test('customer history model view keeps display order and counts without embedding full BOM snapshots', () => {
    const receipt = verified({
        customer: { id: 1, name: '邱焕' },
        quotations: [{ id: 9, status: '已转订单', totalCost: 100, totalPrice: 120, items: [{ partsJson: '大'.repeat(20000) }] }],
        orders: [{ id: 7, itemsJson: '大'.repeat(20000) }],
    });
    const view = modelResultView('search_customer_history', receipt);
    assert.equal(view.data.quotationCount, 1);
    assert.equal(view.data.orderCount, 1);
    assert.equal(view.data.quotations[0].displayOrder, 1);
    assert.equal(view.data.quotations[0].itemCount, 1);
    assert.equal(JSON.stringify(view).includes('大'), false);
    assert.equal(receipt.data.quotations[0].id, 9);
});

test('order detail model view omits raw snapshots and expands purchase or todo summaries only when requested', () => {
    const order = {
        id: 7,
        customerName: '客户A',
        contractNo: 'HT-7',
        status: '采购中',
        itemsJson: JSON.stringify([{
            recipeName: 'V750', spec: '12-120', qty: 5, unitCost: 100,
            partsJson: JSON.stringify([{ model: '轴承', snapshotPrice: 2 }]),
        }]),
        purchaseListJson: JSON.stringify([{
            model: '轴承', name: '上轴承', supplier: '供应商A', totalQty: 5,
            currentStock: 0, needToBuy: 5, orderedQty: 2, stockedQty: 0, purchased: false,
            stockInHistory: [{ qty: 1 }],
        }, {
            model: '油封', name: '油封', supplier: '供应商B', totalQty: 2,
            currentStock: 10, needToBuy: 0, orderedQty: 0, stockedQty: 0, purchased: false,
        }]),
        todosJson: JSON.stringify([{ description: '联系供应商A', done: false }]),
    };
    const receipt = {
        success: true,
        order,
        executionEvidence: { verified: true, kind: 'formal_api_query' },
    };
    const plain = modelResultView('get_order_detail', receipt, { userText: '列一下订单详情' });
    assert.equal(plain.order.items[0].recipeName, 'V750');
    assert.equal(plain.order.purchaseItemCount, 2);
    assert.equal(plain.order.pendingPurchaseCount, 1);
    assert.equal(plain.order.pendingTodoCount, 1);
    assert.equal(plain.order.purchases, undefined);
    assert.equal(plain.order.todos, undefined);
    assert.doesNotMatch(JSON.stringify(plain), /partsJson|stockInHistory/);
    assert.ok(receipt.order.itemsJson.includes('partsJson'));

    const purchase = modelResultView('get_order_detail', receipt, { userText: '这张订单缺什么料，采购和库存怎么样' });
    assert.equal(purchase.order.purchases[0].model, '轴承');
    assert.equal(purchase.order.todos, undefined);

    const todo = modelResultView('get_order_detail', receipt, { userText: '这张订单还有哪些未完成待办' });
    assert.deepEqual(todo.order.todos, [{ description: '联系供应商A', done: false }]);
});

function dashboardReceipt() {
    return {
        success: true,
        summary: {
            generatedAt: '2026-09-14T10:52:39.883Z',
            kpis: { totalCost: 69367, totalRevenue: 76303, totalProfit: 6936 },
            orders: {
                total: 2, active: 2, pendingPurchase: 0, purchasing: 1, completed: 0, today: 0, '采购完成': 1,
                latest: [{ id: 2, customerName: '台州叶总', contractNo: '20260100', status: '采购完成', totalPrice: 14929 }],
            },
            parts: { total: 133, lowStock: 0, outOfStock: 111 },
            financials: {
                totalCost: 69367, totalRevenue: 76303, totalProfit: 6936, profitRate: 9.09,
                orderBook: { totalCost: 69367, totalRevenue: 76303, totalProfit: 6936 },
                completed: { totalCost: 0, totalRevenue: 0, totalProfit: 0, profitRate: 0 },
            },
            workbench: {
                items: [
                    { key: 'pending_purchase', label: '待采购', count: 1, desc: '订单中仍有未采购零件', severity: 'warning' },
                    { key: 'ready_to_receive', label: '待入库', count: 0, desc: '等待入库', severity: 'success' },
                ],
                pendingPurchaseItems: Array.from({ length: 30 }, (_, index) => ({ model: `采购明细-${index}`, needToBuy: 200 })),
                outOfStockParts: Array.from({ length: 111 }, (_, index) => ({ model: `缺货明细-${index}`, price: 1 })),
            },
        },
        executionEvidence: { verified: true, kind: 'formal_api_query' },
    };
}

test('dashboard model view keeps one semantic financial summary and omits bulky detail collections', () => {
    const receipt = dashboardReceipt();
    const original = JSON.stringify(receipt);
    const view = modelResultView('get_dashboard_summary', receipt, { userText: '今天的经营情况是什么' });
    assert.equal(view.modelView.kind, 'dashboard_summary');
    assert.equal(view.summary.financials.totalCost, 69367);
    assert.equal(view.summary.orders.purchaseCompleted, 1);
    assert.equal(view.summary.completedFinancials.totalCost, 0);
    assert.equal(view.summary.parts.outOfStock, 111);
    assert.doesNotMatch(JSON.stringify(view.summary), /采购明细|缺货明细|orderBook|kpis/);
    assert.ok(JSON.stringify(view).length < original.length / 4);
    assert.equal(JSON.stringify(receipt), original);
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
test('local runtime offers a short relevant tool list while cloud runtime keeps the full directory', async () => {
    const offered = [];
    await runAiAssistant({ ...input('V750 配方成本是多少'), env: { AI_PROVIDER: 'local' } }, fixture([
        (messages, options) => {
            assert.match(messages[0].content, /默认最终回答不超过 300 个中文字符/);
            assert.equal(options.toolChoice, 'required');
            offered.push(options.tools.map(tool => tool.function.name));
            return { tool_calls: [call('preview_recipe_cost', { recipeName: 'V750' })] };
        },
        { content: 'V750 当前成本为100元。' },
    ], { executeToolCall: async () => verified({ totalCost: 100 }) }));
    assert.ok(offered[0].length <= 6);
    assert.deepEqual(offered[0], ['preview_recipe_cost']);
});

test('dashboard overview renders once from formal evidence without a model repair round', async () => {
    const result = await runAiAssistant({ ...input('今天的经营情况是什么'), env: { AI_PROVIDER: 'local' } }, fixture([
        { tool_calls: [call('get_dashboard_summary', {})] },
    ], { executeToolCall: async () => dashboardReceipt() }));
    assert.equal(result.telemetry.modelRequestCount, 1);
    assert.equal(result.telemetry.executedTools, 1);
    assert.match(result.finalContent, /收入 76,303 元/);
    assert.match(result.finalContent, /成本 69,367 元/);
    assert.match(result.finalContent, /利润 6,936 元/);
    assert.match(result.finalContent, /缺货 111 项/);
    assert.match(result.finalContent, /采购完成 1 单/);
    assert.match(result.finalContent, /待采购 1 项/);
    assert.equal((result.finalContent.match(/69,367/g) || []).length, 1);
    assert.doesNotMatch(result.finalContent, /完整计算明细|读取运营看板/);
});

test('dashboard monetary fallback uses canonical financial paths without duplicate nested totals', () => {
    const { formatMoneySummary } = require('../api/services/aiAssistantAnswer.cjs');
    const summary = formatMoneySummary([{ name: 'get_dashboard_summary', result: dashboardReceipt() }], { includeQueries: true });
    assert.match(summary, /订单总盘.*总收入.*76303/);
    assert.match(summary, /订单总盘.*总成本.*69367/);
    assert.match(summary, /订单总盘.*总利润.*6936/);
    assert.equal((summary.match(/69367/g) || []).length, 1);
    assert.doesNotMatch(summary, /已完成订单.*0/);
});
test('local business turn excludes historical assistant prose and retries a skipped formal query', async () => {
    const providerCalls = [];
    const executed = [];
    const result = await runAiAssistant({
        messages: [
            { role: 'user', content: '12-200线圈' },
            { role: 'assistant', content: '无需查询，历史回答说它没有配方。' },
            { role: 'user', content: '12-200的线圈都做了哪些配方' },
        ],
        confirmationSubject: 'test-owner',
        env: { AI_PROVIDER: 'local' },
    }, fixture([
        (messages, options) => {
            providerCalls.push(options.tools.map(tool => tool.function.name));
            assert.doesNotMatch(JSON.stringify(messages), /历史回答说它没有配方/);
            return { content: '无需查询，没有配方。' };
        },
        { tool_calls: [call('search_coils', { spec: '12', sheets: 200 })] },
        { tool_calls: [call('get_all_recipes', { keyword: '12-200' })] },
        { content: '12-200线圈当前用于Q12-200配方。' },
    ], {
        executeToolCall: async (name, args) => {
            executed.push({ name, args });
            return name === 'search_coils'
                ? verified([{ schemeCode: 'COIL-200', spec: '12', sheets: 200 }])
                : verified([{ id: 8, name: 'Q12-200', coilSpec: '12', coilSheets: 200 }]);
        },
    }));
    assert.deepEqual(providerCalls[0], ['get_all_recipes', 'search_coils']);
    assert.equal(result.toolResults.length, 2);
    assert.equal(executed.find(item => item.name === 'get_all_recipes').args.keyword, undefined);
    assert.match(result.finalContent, /Q12-200/);
});

test('local coil recipe relation requires both formal sides before answering', async () => {
    const result = await runAiAssistant({
        ...input('12-200的线圈都做了哪些配方'),
        env: { AI_PROVIDER: 'local' },
    }, fixture([
        { tool_calls: [call('get_all_recipes', { keyword: '12-200' })] },
        { content: '配方名称没有匹配，要继续查线圈吗？' },
        { content: '12-200线圈用于Q12-200配方。' },
    ], {
        executeToolCall: async name => name === 'search_coils'
            ? verified([{ id: 20, spec: '12', sheets: 200 }])
            : verified([{ id: 8, name: 'Q12-200', coilId: 20, coilSpec: '12', coilSheets: 200 }]),
    }));
    assert.deepEqual(result.toolResults.map(item => item.name), ['get_all_recipes', 'search_coils']);
    assert.match(result.finalContent, /Q12-200/);
});

test('local business turn fails closed when the model twice skips offered tools', async () => {
    const events = [];
    const result = await runAiAssistant({
        ...input('查询 12-200 线圈'),
        env: { AI_PROVIDER: 'local' },
        emit: (type, payload) => events.push({ type, payload }),
    }, fixture([
        { content: '无需查询。' },
        { content: '库存是5。' },
    ]));
    assert.equal(result.telemetry.outcome, 'failed_evidence');
    assert.match(result.finalContent, /没有可验证的结论/);
    assert.deepEqual(events.filter(event => event.type === 'content').map(event => event.payload.content), [result.finalContent]);
});
test('local runtime fills the official coil status requested in natural language', async () => {
    let executedArgs;
    await runAiAssistant({ ...input('查询 12-120 的正式线圈档案'), env: { AI_PROVIDER: 'local' } }, fixture([
        { tool_calls: [call('search_coils', { spec: '12-120' })] },
        { content: '已查询正式线圈档案。' },
    ], { executeToolCall: async (_name, args) => { executedArgs = args; return verified([]); } }));
    assert.equal(executedArgs.schemeStatus, 'official');
});
test('local runtime normalizes a full coil shorthand before grounding model-supplied numbers', async () => {
    let executedArgs;
    const result = await runAiAssistant({ ...input('12-200线圈成本是多少'), env: { AI_PROVIDER: 'local' } }, fixture([
        { tool_calls: [call('calculate_coil_cost', { spec: '12-200', sheets: 1 })] },
        { content: '12-200线圈当前成本为144.56元。' },
    ], {
        executeToolCall: async (_name, args) => {
            executedArgs = args;
            return verified({ spec: args.spec, sheets: args.sheets, cost: 144.56 });
        },
    }));
    assert.deepEqual(executedArgs, { spec: '12', sheets: 200 });
    assert.match(result.finalContent, /144\.56/);
});
test('paired coil shorthand cost comparison bypasses recipe comparison and renders the verified difference', async () => {
    const executed = [];
    const result = await runAiAssistant({
        ...input('对比 12-120 与 12-140 的成本'),
        env: { AI_PROVIDER: 'local' },
    }, fixture([], {
        executeToolCall: async (name, args) => {
            executed.push({ name, args });
            return verified({
                spec: args.spec,
                sheets: args.sheets,
                totalCost: args.sheets === 120 ? 99.09 : 116.14,
            });
        },
    }));
    assert.deepEqual(executed, [
        { name: 'calculate_coil_cost', args: { spec: '12', sheets: 120 } },
        { name: 'calculate_coil_cost', args: { spec: '12', sheets: 140 } },
    ]);
    assert.match(result.finalContent, /12-120.*99\.09/s);
    assert.match(result.finalContent, /12-140.*116\.14/s);
    assert.match(result.finalContent, /12-140 高 17\.05 元/);
    assert.equal(result.telemetry.modelRequestCount, 0);
});
test('current coil shorthand overrides stale shorthand values in long conversation history', async () => {
    let executedArgs;
    const result = await runAiAssistant({
        messages: [
            { role: 'user', content: '查12-200线圈' },
            { role: 'assistant', content: '旧查询结果' },
            { role: 'user', content: '查12-120线圈' },
            { role: 'assistant', content: '旧查询结果' },
            { role: 'user', content: '12-220线圈成本' },
        ],
        confirmationSubject: 'test-owner',
        env: { AI_PROVIDER: 'local' },
    }, fixture([
        { tool_calls: [call('calculate_coil_cost', { spec: '12-220', sheets: 6 })] },
        { content: '12-220线圈成本为188元。' },
    ], {
        executeToolCall: async (_name, args) => {
            executedArgs = args;
            return verified({ spec: args.spec, sheets: args.sheets, cost: 188 });
        },
    }));
    assert.deepEqual(executedArgs, { spec: '12', sheets: 220 });
    assert.match(result.finalContent, /188元/);
});
test('semantic-only knowledge matches cannot become a confirmed usage relationship', async () => {
    const result = await runAiAssistant({ ...input('切割杂草用的泵壳和专用配件有哪些'), env: { AI_PROVIDER: 'local' } }, fixture([
        { tool_calls: [call('search_factory_knowledge', { query: '切割杂草' })] },
        { content: 'qdxss 是切割杂草的专用配件。' },
    ], {
        executeToolCall: async () => ({
            ...verified([{ sourceTable: 'parts', model: 'qdxss', evidenceLevel: 'semantic_candidate' }]),
            retrievalGuidance: { semanticCandidatesAreEvidence: false, semanticCandidateCount: 1 },
        }),
    }));
    assert.match(result.finalContent, /没有检索到明确的 business_rules/);
    assert.doesNotMatch(result.finalContent, /qdxss/);
    assert.equal(result.telemetry.outcome, 'partial');
});
test('winding answers retain each matched coil material and slot identity', async () => {
    const result = await runAiAssistant(input('查询12-120线圈档案中已设置的绕组数据'), fixture([
        { tool_calls: [call('search_coils', { spec: '12-120' })] },
        { content: '主线0.64，副线0.49。' },
    ], { executeToolCall: async () => verified([{ material: '钢带', slotType: '小眼', mainWireGauge: '0.64', auxWireGauge: '0.49' }]) }));
    assert.match(result.finalContent, /钢带\/小眼/);
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
    const result = await runAiAssistant(input('调查'), fixture([turn, turn, (messages, options) => {
        assert.equal(options.tools.length, 0);
        assert.ok(messages.every(message => !message.tool_calls));
        return { content: '已完成部分查询，追加范围尚未核实。' };
    }], { executeToolCall: async () => { count++; return verified([]); } }));
    assert.equal(count, 6); assert.equal(result.telemetry.outcome, 'partial');
    assert.match(result.finalContent, /追加范围尚未核实/);
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
        (messages, options) => { assert.equal(options.toolChoice, 'required'); assert.ok(options.tools.some(t => t.function.name === 'search_coils')); return { tool_calls: [call('search_coils', { spec: '12-200' })] }; },
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

test('missing recipe technical files always end with an explicit unavailable conclusion', () => {
    const { appendMissingTechnicalFileConclusion } = require('../api/services/aiAssistantAnswer.cjs');
    const missing = {
        success: false,
        code: 'AI_RESOURCE_NOT_FOUND',
        query: 'V1600-3”-12-180',
        entityType: 'recipe',
        executionEvidence: { verified: true, kind: 'formal_api_query_failure' },
    };
    const result = appendMissingTechnicalFileConclusion(
        '没有有效测试数据可供总结。',
        '总结V1600-3”-12-180性能测试报告。',
        [{ name: 'get_recipe_technical_files', result: missing }]
    );
    assert.match(result, /V1600-3”-12-180/);
    assert.match(result, /性能测试报告不可用/);
    assert.equal(
        appendMissingTechnicalFileConclusion('该性能测试报告无法提供。', '查测试报告', [{ name: 'get_recipe_technical_files', result: missing }]),
        '该性能测试报告无法提供。'
    );
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
        { content: '未找到配方：不存在-A，无法读取它的资料。' },
    ], { executeToolCall: async () => { calls++; return missing; } }));
    assert.equal(calls, 1);
    assert.match(result.finalContent, /未找到配方：不存在-A/);
    assert.equal(result.telemetry.outcome, 'partial');
});

test('empty formal query feedback preserves scope and rejects incomplete or failed evidence', () => {
    const { verifiedEmptyQuery, unfinishedReply } = require('../api/services/aiAssistantAnswer.cjs');
    const { modelResultView } = require('../api/services/aiAssistantContext.cjs');
    const result = { success: true, data: [], queryReceipt: { authoritative: true, appliedFilters: { keyword: '范围A' }, totalCount: 0, returnedCount: 0, truncated: false, possiblyTruncated: false }, executionEvidence: { verified: true, kind: 'formal_api_query' } };
    assert.equal(verifiedEmptyQuery(result), true);
    for (const name of ['get_all_recipes', 'search_templates', 'get_template_detail']) {
        assert.equal(modelResultView(name, result).modelView.kind, 'verified_empty_query');
        assert.deepEqual(modelResultView(name, result).queryReceipt, result.queryReceipt);
    }
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
        assert.equal(view.modelView.costTool, 'build_recipe_bom_draft');
        assert.match(view.modelView.note, /未指定的可选参数不猜测/);
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

test('knowledge views share identical documents only within the current turn, preserving evidence and changes', () => {
    const { modelResultView } = require('../api/services/aiAssistantContext.cjs');
    const cache = { knowledgeDocuments: new Map() };
    const row = { id: 1, content: '完整业务规则'.repeat(150), summary: '原摘要', metadata: { fact: '唯一值' }, metadataJson: '{"fact":"唯一值"}', searchText: '重复索引', evidenceLevel: 'semantic_candidate' };
    const result = { success: true, data: [row], sources: [{ sourceId: 1 }] };
    const first = modelResultView('search_factory_knowledge', result, cache);
    const again = modelResultView('search_factory_knowledge', result, cache);
    assert.equal(first.data[0].content, row.content);
    assert.equal(first.data[0].searchText, undefined);
    assert.equal(first.data[0].metadataJson, undefined);
    assert.equal(again.data[0].documentRef, first.data[0].documentRef);
    assert.equal(again.data[0].content, undefined);
    assert.equal(again.data[0].evidenceLevel, 'semantic_candidate');
    assert.deepEqual(again.sources, result.sources);
    const changed = modelResultView('search_factory_knowledge', { ...result, data: [{ ...row, content: row.content + '修订' }] }, cache);
    assert.notEqual(changed.data[0].documentRef, first.data[0].documentRef);
    assert.match(changed.data[0].content, /修订$/);
    assert.equal(modelResultView('search_factory_knowledge', result).data[0].content, row.content);
    assert.equal(row.searchText, '重复索引');
    const withGuidance = { ...result, summary: `1条结果：${row.content}`, answerGuidance: { requiredEvidencePolicy: '保留依据', businessRuleStatements: [row.content] } };
    const compact = modelResultView('search_factory_knowledge', withGuidance);
    assert.equal(compact.data[0].content, row.content);
    assert.equal(compact.answerGuidance.requiredEvidencePolicy, '保留依据');
    assert.ok(compact.summary.length < withGuidance.summary.length);
    const uniqueGuidance = { ...withGuidance, answerGuidance: { businessRuleStatements: ['正文中没有的独立事实'] } };
    assert.deepEqual(modelResultView('search_factory_knowledge', uniqueGuidance).answerGuidance, uniqueGuidance.answerGuidance);
});

test('unnecessary query permission gets one continuation while real candidate ambiguity remains explicit', async () => {
    const names = [];
    const result = await runAiAssistant(input('800平刀切割泵壳的零件单价是多少', 'completion-review'), fixture([
        { tool_calls: [call('search_templates', { shellModel: '800平刀切割' })] },
        { content: '模板套件95元不是零件价，请提供该泵壳的型号关键词，我再查询。' },
        (messages, options) => { assert.ok(options.tools.length); assert.match(messages.at(-1).content, /不要让用户重复提供/); assert.ok(!messages.some(message => message.content?.includes('模板套件95元不是零件价'))); assert.match(messages.at(-1).content, /完整回答/); return { tool_calls: [call('search_parts', { keyword: '800平刀切割泵壳' })] }; },
        { content: '零件当前单价95元。' },
    ], { executeToolCall: async name => { names.push(name); return verified({ price: 95 }); } }));
    assert.deepEqual(names, ['search_templates', 'search_parts']);
    assert.equal(result.finalContent, '零件当前单价95元。');
    const ambiguous = await runAiAssistant(input('A的成本', 'true-ambiguity'), fixture([
        { tool_calls: [call('get_all_recipes', { keyword: 'A' })] },
        { content: '有两个候选，请确认要哪一个。' },
    ], { executeToolCall: async () => ({ ...verified([]), requiresClarification: true }) }));
    assert.match(ambiguous.finalContent, /两个候选/);
});


test('template-only answer is reviewed using missing preview evidence rather than wording', async () => {
    const result = await runAiAssistant(input('壳A搭配12-120的成本'), fixture([
        { tool_calls: [call('search_templates', { shellModel: '壳A' })] },
        { content: '需先补充材质和线重才能计算。' },
        { tool_calls: [call('build_recipe_bom_draft', { templateId: 1, coilSpec: '12', coilSheets: 120 })] },
        { content: '当前成本25元。' },
    ], { executeToolCall: async name => name === 'search_templates'
        ? verified([{ id: 1, shellModel: '壳A' }])
        : verified({ costPreview: { sourceOfTruth: 'costEngine', currentTotalCost: 25, pricingComplete: true } }) }));
    assert.deepEqual(result.toolResults.map(r => r.name), ['search_templates', 'build_recipe_bom_draft']);
    assert.equal(result.toolResults[1].args.useRecipeBaseline, true);
    assert.match(result.finalContent, /25/);
});

test('persisted candidate context restores a named selection after session loss', async () => {
    const candidateResult = {
        success: false,
        requiresClarification: true,
        candidates: [{ id: 4, name: 'v750-普通' }, { id: 5, name: 'v750-tokoy' }],
        executionEvidence: { verified: true, kind: 'formal_api_query_failure' },
    };
    const calls = [];
    const result = await runAiAssistant({
        ...input('普通的', 'persisted-candidate-selection'),
        env: { AI_PROVIDER: 'local' },
        persistedConversationContext: {
            question: 'V750 的成本是多少',
            answer: '请选择具体配方',
            toolResults: [{ name: 'preview_recipe_cost', result: candidateResult }],
        },
    }, fixture([
        { content: 'v750-普通当前成本为292.67元。' },
    ], {
        executeToolCall: async (name, args) => {
            calls.push({ name, args });
            return verified({ recipeId: args.recipeId, currentTotalCost: 292.67 });
        },
    }));
    assert.deepEqual(calls, [{ name: 'preview_recipe_cost', args: { recipeId: 4, useRecipeBaseline: true } }]);
    assert.match(result.finalContent, /292\.67/);
});

test('memory receipt survives continuation, retains the original question, and does not cross sessions', async () => {
    const session = 'memory-continue-bom';
    await runAiAssistant(input('壳A搭配12-120片带浮球的成本', session), fixture([
        { tool_calls: [call('search_templates', { shellModel: '壳A' })] },
        { content: '需先补充线圈参数。' },
        { content: '需先补充线圈参数。' },
    ], { executeToolCall: async () => verified([{ id: 1, shellModel: '壳A' }]) }));
    const events = [], saved = { status: 'completed', auditId: 1, memory: { id: 5, version: 1, content: '如果没有特别提示，直接用默认的线圈' } };
    const result = await runAiAssistant({ ...input('如果没有特别提示，直接用默认的线圈，记到长期记忆里。', session), emit: (type, value) => events.push({ type, ...value }) }, fixture([
        messages => {
            assert.match(JSON.stringify(messages), /继续本会话尚未取得试算结果的问题：壳A搭配12-120片带浮球的成本/);
            return { tool_calls: [call('search_coils', { spec: '12', sheets: 120, isDefault: true, schemeStatus: 'official' })] };
        },
        { tool_calls: [call('build_recipe_bom_draft', { shellModel: '壳A', coilId: 7, coilSpec: '12', coilSheets: 120, coilMaterial: '钢带', coilSlotType: '小眼', hasFloat: true })] },
        { content: '按默认方案计算，成本25元。' },
    ], { changeMemory: async () => saved, executeToolCall: async name => name === 'search_coils'
        ? verified([{ id: 7, spec: '12', sheets: 120, isDefault: true, schemeStatus: 'official' }])
        : verified({ costPreview: { sourceOfTruth: 'costEngine', currentTotalCost: 25, pricingComplete: true } }) }));
    assert.match(result.finalContent, /^已记入长期记忆：[\s\S]*25/);
    assert.equal(events.filter(e => e.type === 'done').length, 1);
    const state = beginAssistantSession('test-owner', session);
    assert.equal(state.previous.pendingQuestion, null); assert.equal(state.previous.memory.id, 5); state.cancel();
    const other = await runAiAssistant(input('记入长期记忆：规则A', 'another-memory-session'), fixture([], { changeMemory: async () => saved }));
    assert.equal(other.toolResults.length, 0);
});

test('failed continuation cannot lose a successfully persisted memory receipt or claim business success', async () => {
    const session = 'memory-continue-failure';
    const state = beginAssistantSession('test-owner', session);
    state.finish({ pendingQuestion: '壳A的成本', question: '壳A的成本', toolResults: [] });
    const events = [];
    await assert.rejects(runAiAssistant({ ...input('记入长期记忆：默认方案优先', session), emit: (type, value) => events.push({ type, ...value }) }, fixture([], {
        changeMemory: async () => ({ status: 'completed', auditId: 2, memory: { id: 6, version: 1, content: '默认方案优先' } }),
        fetchAiProvider: async () => { throw new Error('provider unavailable'); },
    })), /provider unavailable/);
    assert.match(events.find(e => e.type === 'content').content, /已记入长期记忆/);
    const restored = beginAssistantSession('test-owner', session);
    assert.equal(restored.previous.memory.id, 6); assert.equal(restored.previous.pendingQuestion, '壳A的成本'); restored.cancel();
});


test('BOM tool forwards a grounded explicit scheme to the existing formal API', async () => {
    const { executeBusinessTool } = require('../api/routes/ai/executors/businessExecutors.cjs');
    let body;
    await executeBusinessTool('build_recipe_bom_draft', { templateId: 1, coilId: 8, coilSpec: '12', coilSheets: 120, coilMaterial: '冷轧', coilSlotType: '国标眼' }, async (url, options) => {
        assert.equal(url, '/api/recipes/bom-draft'); body = JSON.parse(options.body);
        return new Response(JSON.stringify({ success: true, data: { costPreview: { currentTotalCost: 25 } } }));
    });
    assert.equal(body.useRecipeBaseline, undefined);
    assert.equal(body.coilId, 8); assert.equal(body.coilMaterial, '冷轧'); assert.equal(body.coilSlotType, '国标眼');
});


test('expired pending preview does not resume when a new memory is saved', async () => {
    const session = 'expired-memory-preview';
    const old = beginAssistantSession('test-owner', session); old.finish({ pendingQuestion: '旧模板成本' });
    const expired = beginAssistantSession('test-owner', session, Date.now() + TTL_MS + 1); expired.cancel();
    const result = await runAiAssistant(input('记入长期记忆：默认方案优先', session), fixture([], {
        changeMemory: async () => ({ status: 'completed', auditId: 3, memory: { id: 9, version: 1, content: '默认方案优先' } }),
    }));
    assert.equal(result.telemetry.outcome, 'memory_saved'); assert.equal(result.toolResults.length, 0);
});


test('template lists keep all identities and scalar settings without duplicating every nested BOM in model context', () => {
    const rows = [{ id: 1, shellModel: '壳A', bundleCost: 95, partsJson: JSON.stringify(Array.from({ length: 200 }, () => ({ model: '螺丝', qty: 4 }))), parts: [{ model: '螺丝' }] }];
    const full = verified(rows); const original = JSON.stringify(full);
    const view = modelResultView('search_templates', full);
    assert.equal(view.data[0].id, 1); assert.equal(view.data[0].bundleCost, 95);
    assert.deepEqual(view.data[0].omittedFields, ['partsJson', 'parts']);
    assert.equal(view.modelView.detailTool, 'get_template_detail');
    assert.equal(view.modelView.costTool, 'build_recipe_bom_draft');
    assert.ok(JSON.stringify(view).length < JSON.stringify(full).length / 2);
    assert.equal(JSON.stringify(full), original);
});


test('formal BOM total cannot be displaced by a preceding broad catalog in fallback summaries', () => {
    const { formatMoneySummary } = require('../api/services/aiAssistantAnswer.cjs');
    const summary = formatMoneySummary([
        { name: 'search_coils', result: verified(Array.from({ length: 20 }, (_, i) => ({ schemeCode: '方案' + i, cost: i + 1 }))) },
        { name: 'build_recipe_bom_draft', result: verified({ costPreview: { currentTotalCost: 273.23, partsCost: 252.23, laborCost: 21, pricingComplete: true }, parts: [] }) },
    ], { includeQueries: true });
    assert.match(summary, /273.23/);
    assert.ok(summary.indexOf('273.23') < summary.indexOf('方案0'));
});


test('currency table cells require current monetary evidence without treating model, quantity or percent as money', () => {
    const { unsupportedMoneyInAnswer } = require('../api/services/aiAssistantAnswer.cjs');
    const table = '| 型号 | 数量 | 金额（元） | 成本占比 |\n|---|---:|---:|---:|\n| 12-120 | 8 | **268.23** | 25% |';
    assert.deepEqual(unsupportedMoneyInAnswer(table, []), [268.23]);
    assert.deepEqual(unsupportedMoneyInAnswer(table, [{ result: verified({ cost: 268.23 }) }]), []);
    assert.deepEqual(unsupportedMoneyInAnswer('| 项目 | 成本 |\n|---|---:|\n| 合计 | 1,268.23 |', []), [1268.23]);
});

test('history-only currency table triggers a current read before publishing a changed configuration cost', async () => {
    const events = [];
    const result = await runAiAssistant({ ...input('包装换纸箱，其他配置不变'), emit: (type, event) => { if (type === 'content') events.push(event.content); } }, fixture([
        { content: '| 项目 | 金额（元） |\n|---|---:|\n| 总成本 | 268.23 |' },
        { tool_calls: [call('compare_recipes', { recipe1: 'A', recipe2: 'B' })] },
        { content: '当前成本257.23元。' },
    ], { executeToolCall: async () => verified({ totalCost: 257.23 }) }));
    assert.equal(result.toolResults.length, 1);
    assert.match(result.finalContent, /257.23/);
    assert.doesNotMatch(events.join(''), /268.23/);
});


test('oversized prior evidence preserves completed preview identity and overrides without carrying old prices', () => {
    const args = { templateId: 1, coilId: 2, hasFloat: false, packingParts: [{ model: '木箱' }] };
    const text = previousContext({ question: '不要浮球', toolResults: [
        { name: 'get_template_detail', result: verified({ detail: '大'.repeat(20000) }) },
        { name: 'build_recipe_bom_draft', args, result: verified({ costPreview: { currentTotalCost: 265.23 }, configurationBasis: { recipeId: 1, recipeName: '基准' } }) },
    ] });
    assert.match(text, /completedPreviewInputs/);
    assert.match(text, /"templateId":1/); assert.match(text, /"hasFloat":false/);
    assert.match(text, /木箱/); assert.doesNotMatch(text, /265.23/);
    const unverified = previousContext({ toolResults: [{ name: 'build_recipe_bom_draft', args, result: { data: { detail: '大'.repeat(20000) } } }] });
    assert.doesNotMatch(unverified, /completedPreviewInputs/);
});


test('private assistant requests current configuration pricing for existing recipe overrides', async () => {
    const result = await runAiAssistant(input('在售A不要浮球的成本'), fixture([
        { tool_calls: [call('preview_recipe_cost', { recipeName: '在售A', overrides: { hasFloat: false } })] },
        { content: '当前成本265.23元。' },
    ], { executeToolCall: async (name, args) => { assert.equal(args.useRecipeBaseline, true); return verified({ currentTotalCost: 265.23 }); } }));
    assert.match(result.finalContent, /265.23/);
});

test('task presentation restores an authoritative cable rule after repeated unsupported money drafts', async () => {
    const knowledge = {
        ...verified([]),
        answerGuidance: {
            businessRuleStatements: [
                '线材、长度、插头和规格共同组成一个成品电缆业务项。',
                '成品电缆是一个整体业务项，不把线材和插头/规格拆成两个独立收费项目。\n浮球新界式差价：0.6元',
            ],
        },
        sources: [{ sourceTable: 'business_rules' }],
    };
    const result = await runAiAssistant(input('先查成品电缆业务规则，再说明线材、长度、插头和规格是否应该拆成两个收费项目。'), fixture([
        { tool_calls: [call('search_factory_knowledge', { query: '成品电缆', entryType: 'business_rule' })] },
        { content: '成品电缆是整体，不应拆分，另外差价为0.6元。' },
        { content: '成品电缆不拆分，差价仍为0.6元。' },
    ], { executeToolCall: async () => knowledge }));
    assert.match(result.finalContent, /成品电缆/);
    assert.match(result.finalContent, /整体/);
    assert.match(result.finalContent, /不把.*拆/);
    assert.doesNotMatch(result.finalContent, /0\.6|无法核对的金额|已停止展示/);
});

test('task presentation restores configured BOM conditions omitted by the model answer', async () => {
    const bom = verified({
        parts: [
            { model: 'V750-大脚板-2寸', source: 'pump_shell_template', costRole: 'stainlessShellBundle' },
            { model: '12-120', costRole: 'coil' },
            { model: '浮球-线径0.55', costRole: 'float' },
            { model: 'v550木箱', costRole: 'packing' },
            { model: '珍珠棉', costRole: 'packing' },
        ],
        configurationBasis: { source: 'recipe', recipeName: 'v550-tokoy' },
        costPreview: { currentTotalCost: 272.17, partsCost: 251.17, laborCost: 21, pricingComplete: true },
    });
    const result = await runAiAssistant({
        ...input('V750-大脚板-2寸的壳，做12-120片，带浮球，木箱，需要珍珠棉，成本大概多少'),
        env: { AI_PROVIDER: 'local' },
    }, fixture([
        { tool_calls: [call('build_recipe_bom_draft', {
            shellModel: 'V750-大脚板-2寸', coilSpec: '12', coilSheets: 120, hasFloat: true,
            packingParts: [{ model: '木箱' }, { model: '珍珠棉' }],
        })] },
        { content: '当前总成本272.17元。' },
    ], { executeToolCall: async () => bom }));
    for (const expected of ['V750-大脚板-2寸', '12-120', '浮球', 'v550木箱', '珍珠棉', '272.17']) {
        assert.match(result.finalContent, new RegExp(expected));
    }
    assert.match(result.finalContent, /配方基准「v550-tokoy」/);
});
