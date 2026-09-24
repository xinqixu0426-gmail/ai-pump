// S2-R2P1：AI 工具结果预算语义分层（raw 回执安全上限 / 模型视图预算）。
// 缺陷：96 KiB 曾被用在「正式 API 回执是否有效」的判断上，导致「列一下配方」这类
// 有大投影的全量列表被整轮改写成 AI_QUERY_RESULT_TOO_LARGE。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runAiAssistant } = require('../api/services/aiAssistantRuntime.cjs');
const { modelResultView, answerOnlyMessages } = require('../api/services/aiAssistantContext.cjs');
const {
    MODEL_VIEW_RESULT_LIMIT,
    RAW_RECEIPT_SAFETY_LIMIT,
    enforceAiModelViewBudget,
    enforceAiRawReceiptSafety,
} = require('../api/services/aiToolProtocol.cjs');

const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const call = (name, args, id = name) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const verified = data => ({ success: true, data, executionEvidence: { verified: true, kind: 'formal_api_query' } });
function input(text, session = '') {
    return { messages: [{ role: 'user', content: text }], confirmationSubject: 'test-owner', conversationId: session || undefined };
}
function fixture(turns, extra = {}) {
    let index = 0;
    return {
        loadMemory: async () => ({ items: [] }), loadCorrections: () => '',
        fetchAiProvider: async (messages, options) => {
            const turn = turns[Math.min(index, turns.length - 1)]; index++;
            const answer = typeof turn === 'function' ? turn(messages, options) : turn;
            return { json: async () => ({ choices: [{ message: answer }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) };
        },
        executeToolCall: async () => verified([]),
        ...extra,
    };
}
// 工具面关闭后运行时会把 tool 回执改写成 role=user 的引用消息（answerOnlyMessages）；
// 预算断言必须同时覆盖两种形态，否则会因为轮次级 token 预算改变了消息形态而误判。
const resultMessages = messages => messages.filter(message => message.role === 'tool'
    || (message.role === 'user' && /以下是已执行查询返回的数据/u.test(String(message.content))));
const noAnswerOnly = messages => answerOnlyMessages(messages);

// 全量配方列表形状：raw 每行都带 partsJson / snapshotPartsJson（真实正式响应形状），
// 投影只保留标量摘要。Json 字段会被投影省略，因此 partsPadding 只放大 raw，
// 从而把「raw 安全上限」和「模型视图预算」两道门的判定分开。
const recipeList = (count, { partsPadding = 0 } = {}) => verified(Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `R-${String(index + 1).padStart(6, '0')}`,
    coilId: 501,
    templateId: 401,
    partsJson: JSON.stringify([{ partId: 601, model: 'shell', qty: 1, pad: 'p'.repeat(partsPadding) }]),
    snapshotPartsJson: '[]',
})));
// 订单列表形状：itemsJson 同样只存在于 raw，用来制造「raw 很大、投影很小」的组合。
const orderList = (count, { pad = 0 } = {}) => verified(Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    customerName: `C-${String(index + 1).padStart(5, '0')}`,
    status: 'pending',
    itemsJson: JSON.stringify([{ partId: 601, pad: 'p'.repeat(pad) }]),
    totalPrice: 1,
})));

test('S2-R2P1 raw 超 96 KiB 但投影在预算内时结果必须交付（本票核心）', async () => {
    const raw = recipeList(100, { partsPadding: 1200 });
    const view = modelResultView('get_all_recipes', raw);
    assert.ok(bytes(raw) > MODEL_VIEW_RESULT_LIMIT, `raw 必须超过 96 KiB，实测 ${bytes(raw)}`);
    assert.ok(bytes(view) <= MODEL_VIEW_RESULT_LIMIT, `投影必须在 96 KiB 内，实测 ${bytes(view)}`);
    // 旧缺陷：96 KiB 门作用在 raw 上 → 整轮被改写成失败。
    assert.equal(enforceAiRawReceiptSafety('get_all_recipes', raw), raw, 'raw 在 1 MiB 安全上限内必须原样通过');
    assert.equal(enforceAiModelViewBudget('get_all_recipes', view, []).allowed, true);

    let delivered = '';
    const result = await runAiAssistant(input('列一下配方', 's2r2p1-core'), fixture([
        { tool_calls: [call('get_all_recipes', {})] },
        messages => {
            delivered = resultMessages(messages)[0].content;
            return { content: `共 ${view.data.length} 个配方。` };
        },
    ], { executeToolCall: async () => raw }));
    assert.match(delivered, /list_summary/, '模型必须收到既有列表投影');
    assert.match(delivered, /get_recipe_detail/, '投影必须继续指向详情工具');
    assert.doesNotMatch(delivered, /AI_QUERY_RESULT_TOO_LARGE/, '不得把可交付结果改写成失败');
    assert.equal(result.toolResults.length, 1);
    assert.equal(result.toolResults[0].result.success, true);
    assert.notEqual(result.toolResults[0].result.code, 'AI_QUERY_RESULT_TOO_LARGE');
    assert.equal(result.finalContent, '共 100 个配方。');
    assert.doesNotMatch(result.finalContent, /本轮没有取得正式业务 API 的有效结果/);
});

test('S2-R2P1 raw 超预算时仍完整保留正式回执：Evidence、身份与 partsJson 不因投影改变', async () => {
    const raw = recipeList(100, { partsPadding: 1200 });
    const original = JSON.stringify(raw);
    const result = await runAiAssistant(input('列一下配方', 's2r2p1-evidence'), fixture([
        { tool_calls: [call('get_all_recipes', {})] },
        { content: '已列出。' },
    ], { executeToolCall: async () => raw }));
    const stored = result.toolResults[0].result;
    assert.equal(JSON.stringify(stored), original, 'toolResults 必须继续保存 raw formal result');
    assert.equal(stored.executionEvidence.verified, true);
    assert.equal(stored.executionEvidence.kind, 'formal_api_query');
    assert.ok(JSON.stringify(stored).includes('partsJson'), 'raw 中的 partsJson 必须仍然存在');
    assert.ok(JSON.stringify(stored).includes('snapshotPartsJson'), 'raw 中的 snapshotPartsJson 必须仍然存在');
    assert.equal(stored.data[0].coilId, 501);
    assert.equal(stored.data[0].templateId, 401);
});

test('S2-R2P1 投影真正超过 96 KiB 时有界拒绝送入模型且不删除任何业务字段', async () => {
    const raw = recipeList(1000);
    const view = modelResultView('get_all_recipes', raw);
    assert.ok(bytes(view) > MODEL_VIEW_RESULT_LIMIT, `投影必须超过 96 KiB，实测 ${bytes(view)}`);
    assert.equal(enforceAiRawReceiptSafety('get_all_recipes', raw), raw, 'raw 本身未超 1 MiB 安全上限');

    let delivered = '';
    const result = await runAiAssistant(input('列一下配方', 's2r2p1-modelview'), fixture([
        { tool_calls: [call('get_all_recipes', {})] },
        messages => {
            delivered = resultMessages(messages)[0].content;
            return { content: '配方较多，请补充筛选条件。' };
        },
    ], { executeToolCall: async () => raw }));
    assert.match(delivered, /AI_QUERY_RESULT_TOO_LARGE/);
    assert.match(delivered, /MODEL_VIEW_RESULT_TOO_LARGE/);
    assert.match(delivered, /未删除任何业务字段/);
    assert.ok(delivered.length < MODEL_VIEW_RESULT_LIMIT, '送入模型的内容必须有界');
    // 正式回执仍然完整落在 toolResults，供 Money Guard / 身份 / Evidence 使用。
    assert.equal(result.toolResults[0].result.success, true);
    assert.ok(JSON.stringify(result.toolResults[0].result).includes('snapshotPartsJson'));
});

test('S2-R2P1 原始回执异常超大时按 1 MiB 工程安全上限拒绝', async () => {
    const raw = verified(Array.from({ length: 4000 }, (_, index) => ({
        id: index + 1, name: `R-${index}`, blob: 'x'.repeat(400),
    })));
    assert.ok(bytes(raw) > RAW_RECEIPT_SAFETY_LIMIT, `raw 必须超过 1 MiB，实测 ${bytes(raw)}`);
    const refused = enforceAiRawReceiptSafety('get_all_recipes', raw);
    assert.equal(refused.success, false);
    assert.equal(refused.code, 'AI_QUERY_RESULT_TOO_LARGE');
    assert.equal(refused.reason, 'RAW_RECEIPT_SAFETY_LIMIT_EXCEEDED');
    assert.equal(refused.executionEvidence.verified, true);

    const result = await runAiAssistant(input('列一下配方', 's2r2p1-rawsafety'), fixture([
        { tool_calls: [call('get_all_recipes', {})] },
        { content: '结果异常，已停止。' },
    ], { executeToolCall: async () => raw }));
    assert.equal(result.toolResults[0].result.reason, 'RAW_RECEIPT_SAFETY_LIMIT_EXCEEDED');
});

test('S2-R2P1 多个大 raw、投影累计未超预算时全部交付', async () => {
    const first = orderList(100, { pad: 1000 });
    const second = orderList(100, { pad: 1000 });
    assert.ok(bytes(first) > MODEL_VIEW_RESULT_LIMIT && bytes(second) > MODEL_VIEW_RESULT_LIMIT,
        `两个 raw 都必须超过 96 KiB，实测 ${bytes(first)} / ${bytes(second)}`);
    const firstView = modelResultView('get_recent_orders', first);
    const secondView = modelResultView('get_recent_orders', second);
    const cumulative = enforceAiModelViewBudget('get_recent_orders', secondView, [{ name: 'get_recent_orders', result: firstView }]);
    assert.equal(cumulative.allowed, true, `投影累计未超预算时必须继续交付，累计 ${cumulative.cumulativeBytes} 字节`);

    let executed = 0;
    const delivered = [];
    const result = await runAiAssistant(input('列一下最近订单', 's2r2p1-cumulative-ok'), fixture([
        { tool_calls: [call('get_recent_orders', { limit: 100 }, 'o1'), call('get_recent_orders', { limit: 99 }, 'o2')] },
        messages => {
            for (const message of resultMessages(messages)) delivered.push(message.content);
            return { content: '两批结果都已在预算内取得。' };
        },
    ], { executeToolCall: async () => { executed++; return executed === 1 ? first : second; } }));
    assert.equal(executed, 2);
    assert.equal(result.toolResults.length, 2);
    assert.equal(delivered.length, 2);
    for (const content of delivered) assert.doesNotMatch(content, /AI_QUERY_RESULT_TOO_LARGE/);
    assert.equal(result.finalContent, '两批结果都已在预算内取得。');
});

test('S2-R2P1 投影累计真超预算时安全收敛：关闭后续读取且不发送超大上下文', async () => {
    const first = orderList(100);
    const second = orderList(900);
    const firstView = modelResultView('get_recent_orders', first);
    const secondView = modelResultView('get_recent_orders', second);
    assert.ok(bytes(firstView) <= MODEL_VIEW_RESULT_LIMIT, '单条投影本身必须在预算内');
    assert.ok(bytes(secondView) <= MODEL_VIEW_RESULT_LIMIT, '单条投影本身必须在预算内');
    const overBudget = enforceAiModelViewBudget('get_recent_orders', secondView, [{ name: 'get_recent_orders', result: firstView }]);
    assert.equal(overBudget.allowed, false);
    assert.equal(overBudget.reason, 'CUMULATIVE_MODEL_VIEW_BUDGET_EXCEEDED');

    let executed = 0;
    const delivered = [];
    let lastTools = null;
    const result = await runAiAssistant(input('列一下最近订单', 's2r2p1-cumulative-over'), fixture([
        { tool_calls: [call('get_recent_orders', { limit: 100 }, 'o1'), call('get_recent_orders', { limit: 99 }, 'o2')] },
        (messages, options) => {
            lastTools = options.tools;
            for (const message of resultMessages(messages)) delivered.push(message.content);
            return { content: '已用现有结果回答。' };
        },
    ], { executeToolCall: async () => { executed++; return executed === 1 ? first : second; } }));
    assert.equal(executed, 2);
    assert.equal(delivered.length, 2);
    assert.doesNotMatch(delivered[0], /AI_QUERY_RESULT_TOO_LARGE/);
    assert.match(delivered[1], /CUMULATIVE_MODEL_VIEW_BUDGET_EXCEEDED/);
    assert.ok(delivered.every(content => content.length < MODEL_VIEW_RESULT_LIMIT), '送入模型的内容必须有界');
    assert.equal(result.toolResults.length, 2, '累计超限不得丢弃已取得的正式回执');
    assert.deepEqual(lastTools, [], '累计预算用完后必须关闭工具面');
    assert.equal(result.finalContent, '已用现有结果回答。');
});

test('S2-R2P1 列表投影后的详情读取路径不变', async () => {
    const list = recipeList(3);
    const detail = { success: true, recipe: { id: 2, name: 'R-000002', parts: [] },
        executionEvidence: { verified: true, kind: 'formal_api_query' } };
    const result = await runAiAssistant(input('列一下配方', 's2r2p1-detail'), fixture([
        { tool_calls: [call('get_all_recipes', {})] },
        { tool_calls: [call('get_recipe_detail', { recipeId: 2 })] },
        { content: 'R-000002 的明细已取得。' },
    ], { executeToolCall: async name => (name === 'get_recipe_detail' ? detail : list) }));
    assert.deepEqual(result.toolResults.map(item => item.name), ['get_all_recipes', 'get_recipe_detail']);
    assert.equal(result.toolResults[1].result.recipe.id, 2);
    assert.equal(result.finalContent, 'R-000002 的明细已取得。');
});

test('S2-R2P1 同一 tool result 一轮内只投影一次：知识文档去重不漂移', async () => {
    // 源码级守卫：预算判定与模型消息必须共用同一个投影对象。
    // 重复投影会让 knowledgeDocuments 的 documentRef 分配漂移（上一轮失败尝试的根因）。
    const source = fs.readFileSync(path.resolve('api/services/aiAssistantRuntime.cjs'), 'utf8');
    assert.equal((source.match(/modelResultView\(name, result, \{ knowledgeDocuments/g) || []).length, 1,
        '工具循环里只允许一个 modelResultView 调用点');
    assert.equal((source.match(/buildAiToolResultMessage\(call, modelResultView/g) || []).length, 0,
        '不允许在 buildAiToolResultMessage 里二次投影');
    assert.equal((source.match(/enforceAiModelViewBudget\(name, projectedView, modelViews\)/g) || []).length, 1);
    assert.equal((source.match(/buildAiToolResultMessage\(call, projectedView\)/g) || []).length, 1);

    const document = { id: 1, title: 'rule', content: 'body'.repeat(200) };
    const knowledge = () => ({ success: true, data: [{ ...document }],
        executionEvidence: { verified: true, kind: 'formal_api_query' } });
    const delivered = [];
    await runAiAssistant(input('查一下知识', 's2r2p1-knowledge'), fixture([
        { tool_calls: [call('search_factory_knowledge', { query: 'rule' }, 'k1'), call('search_factory_knowledge', { query: 'rule' }, 'k2')] },
        messages => {
            for (const message of resultMessages(messages)) delivered.push(message.content);
            return { content: '已取得规则正文。' };
        },
    ], { executeToolCall: async () => knowledge() }));
    assert.equal(delivered.length, 2);
    assert.match(delivered[0], /knowledge-document-1/);
    assert.match(delivered[1], /documentAlreadyProvided/, '同一文档必须复用既有 documentRef，说明投影与去重台账一致');
    assert.doesNotMatch(delivered[1], /knowledge-document-2/);
});

// answerOnlyMessages 是工具面关闭后的既有转写路径；这里显式断言它不会破坏预算拒绝的可读性。
test('S2-R2P1 工具面关闭后的转写仍完整保留预算拒绝理由', () => {
    const refused = enforceAiModelViewBudget('get_all_recipes', { success: true, data: [], executionEvidence: {} }, [], -1).result;
    const [converted] = answerOnlyMessages([{ role: 'tool', name: 'get_all_recipes', tool_call_id: 'x', content: JSON.stringify(refused) }]);
    assert.equal(converted.role, 'user');
    assert.match(converted.content, /AI_QUERY_RESULT_TOO_LARGE/);
    assert.match(converted.content, /MODEL_VIEW_RESULT_TOO_LARGE/);
    assert.equal(noAnswerOnly([{ role: 'tool', name: 't', content: 'x' }]).length, 1);
});
