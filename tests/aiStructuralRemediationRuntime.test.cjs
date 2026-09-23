'use strict';
/**
 * AI-NATIVE STRUCTURAL REMEDIATION V1 —— **真实调用链**回归。
 *
 * 这些用例跑的是 `runAiAssistant` / `runAiTaskControllerV2` 本身：
 *   用户输入 → 语义抽取 → 工具执行 → 以正式回执为证据 → 金额守卫 →
 *   语义/影响边界 → 展示规范化 → 最终回答
 * 与 `tests/aiStructuralRemediation.test.cjs`（函数/契约级）严格区分：
 * 函数测试通过**不等于**整链通过，整链通过也不等于真实模型/人工验收通过。
 *
 * A08 的教训：旧闭环用例把正确结论写进输入字符串，再验证后处理没删掉它 ——
 * 它既没有证明结论来自正式证据，也跳过了运行时前置的 `unsupportedMoneyInAnswer`。
 * 这里每个正向用例都要求「结论所需的金额/事实先有正式依据」，并配错误差额的负对照。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { runAiAssistant } = require('../api/services/aiAssistantRuntime.cjs');
const { runAiTaskControllerV2 } = require('../api/services/aiTaskControllerV2.cjs');
const { createTaskSessionStoreV2 } = require('../api/services/aiTaskSessionV2.cjs');
const { unsupportedMoneyInAnswer, markdownTableRows } = require('../api/services/aiAssistantAnswer.cjs');
const { moneyGuardDecision, evaluateAnswerMoney } = require('../api/services/aiMoneyGuard.cjs');
const { normalizeAnswerPresentation, buildListCriticality } = require('../api/services/aiPresentationNormalizer.cjs');

const verified = data => ({ success: true, data, executionEvidence: { verified: true, kind: 'formal_api_query' } });
// V2 控制器要求正式回执带执行证据调用清单，金额/查询回执按能力各自的合同附带。
const verifiedReceipt = (data, extra = {}) => ({ success: true, data, ...extra, executionEvidence: { verified: true, calls: [{ method: 'GET', path: '/api/formal' }] } });
const call = (name, args, id = name) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const input = (text, session = crypto.randomUUID()) => ({ messages: [{ role: 'user', content: text }], confirmationSubject: 'test-owner', conversationId: session });

function fixture(turns, extra = {}) {
    let index = 0;
    return {
        loadMemory: async () => ({ items: [] }), loadCorrections: () => '',
        fetchAiProvider: async (messages, options) => {
            const answer = typeof turns[index] === 'function' ? turns[index](messages, options) : turns[index];
            index += 1;
            return { json: async () => ({ choices: [{ message: answer }], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } }) };
        },
        executeToolCall: async () => verified([]),
        ...extra,
    };
}
const tableRows = text => markdownTableRows(text).filter(row => row.header.includes('金额')).map(row => row.cells.join('/'));

// ── A08｜真实守卫顺序回放 ────────────────────────────────────────────
// 生产形状：两项配置只有浮球不同，正式差额 8.50 由 compare_recipes 的正式字段给出
// （costDiff 与 driver amount 都在正式结果里，不是模型自己相减出来的）。
const BALL_DIFFERENCE_RESULTS = () => [{
    name: 'compare_recipes',
    result: {
        ...verified({}),
        recipe1: { name: '配置甲', spec: 'V550', cost: 326.5, partsCost: 305, laborCost: 21.5, partsCount: 2 },
        recipe2: { name: '配置乙', spec: 'V550', cost: 318, partsCost: 296.5, laborCost: 21.5, partsCount: 1 },
        costDiff: '8.50',
        comparison: [{
            key: 'name:浮球-新界式', model: '浮球-新界式', name: '浮球-新界式',
            model1: '浮球-线径1', model2: '-', qty1: 1, amount1: 8.5, qty2: 0, amount2: 0,
            diff: 8.5, difference: '仅配方1有', onlyIn: '配置甲',
        }],
    },
}];
const BALL_CONCLUSION = '两项配置的差别在浮球：配置甲带浮球（浮球-新界式，线径 1），配置乙不带浮球，因此配置甲成本高 8.50 元。';
const COST_GOAL = Object.freeze({ monetary: true, kind: 'COST_QUERY', operation: 'READ_COST' });
const applyGuard = (answer, toolResults, turn) => {
    const decision = moneyGuardDecision(answer, toolResults, turn);
    if (decision.action === 'append') return `${answer}\n\n${decision.appendable || decision.summary}`;
    if (decision.action === 'replaceTable') return decision.appendable || decision.summary;
    if (decision.action === 'replace') return decision.summary;
    return answer;
};

test('A08 回放真实守卫顺序：结论先有正式依据，再经过守卫与展示层仍然交付', () => {
    const results = BALL_DIFFERENCE_RESULTS();
    // (1) 运行时前置检查（unsupportedMoneyInAnswer）——旧闭环用例跳过的正是这一步。
    assert.deepEqual(unsupportedMoneyInAnswer(BALL_CONCLUSION, results), [], '差额 8.50 必须由本轮正式字段支持');
    // (2) 分支确实执行：非金额结论不得被整段替换。
    const decision = moneyGuardDecision(BALL_CONCLUSION, results, COST_GOAL);
    assert.notEqual(decision.action, 'replace');
    assert.deepEqual(decision.unsupportedClaims, []);
    // (3) 展示层之后结论与差额都在。
    const final = normalizeAnswerPresentation(applyGuard(BALL_CONCLUSION, results, COST_GOAL), '这两项配置有什么不同');
    assert.match(final, /带浮球/);
    assert.match(final, /不带浮球/);
    assert.match(final, /8\.50/);
    // NEGATIVE_CONTROL：把差额改成编造的 9.99 → 前置检查必须拦下，守卫必须替换。
    const wrong = BALL_CONCLUSION.replace('8.50', '9.99');
    assert.deepEqual(unsupportedMoneyInAnswer(wrong, results), [9.99]);
    assert.equal(moneyGuardDecision(wrong, results, COST_GOAL).action, 'replace');
});

test('A08 真实链路：浮球差异回答经过完整流水线后仍然交付，且差额有正式依据', async () => {
    const results = BALL_DIFFERENCE_RESULTS();
    const result = await runAiAssistant(input('对比配置甲和配置乙的成本，说明差异原因'), fixture([
        { tool_calls: [call('compare_recipes', { recipe1: '配置甲', recipe2: '配置乙' })] },
        { content: BALL_CONCLUSION },
    ], { executeToolCall: async () => results[0].result }));
    assert.equal(result.telemetry.outcome, 'completed');
    assert.match(result.finalContent, /带浮球/, '非金额结论必须交付');
    assert.match(result.finalContent, /不带浮球/);
    assert.match(result.finalContent, /8\.50/, '有正式依据的差额必须交付');
    // 交付出去的差额确实来自本轮正式证据。
    assert.deepEqual(unsupportedMoneyInAnswer(result.finalContent, result.toolResults ?? results), []);
});

test('A08 NEGATIVE_CONTROL：真实链路里编造的差额不得被交付', async () => {
    const results = BALL_DIFFERENCE_RESULTS();
    const result = await runAiAssistant(input('对比配置甲和配置乙的成本，说明差异原因'), fixture([
        { tool_calls: [call('compare_recipes', { recipe1: '配置甲', recipe2: '配置乙' })] },
        { content: '配置甲成本高 9.99 元。' },
        { content: '配置甲成本高 9.99 元。' },
    ], { executeToolCall: async () => results[0].result }));
    assert.doesNotMatch(result.finalContent, /9\.99/);
    assert.notEqual(result.telemetry.outcome, 'completed');
});

// ── 场景 1/3：同价不同实体、同名不同 canonical identity（真实链路）──
test('RUNTIME-01 两个实体金额相同：真实链路的金额表必须两条都在', async () => {
    const result = await runAiAssistant(input('对比配置甲和配置乙的成本'), fixture([
        { tool_calls: [call('compare_recipes', { recipe1: '配置甲', recipe2: '配置乙' })] },
        { content: '两项配置的成本相同。' },
    ], { executeToolCall: async () => ({ ...verified({}), recipe1: { name: '配置甲', cost: 100 }, recipe2: { name: '配置乙', cost: 100 }, costDiff: '0' }) }));
    const rows = tableRows(result.finalContent);
    assert.ok(rows.some(row => row.startsWith('配置甲/')), `配置甲 必须可见：${result.finalContent}`);
    assert.ok(rows.some(row => row.startsWith('配置乙/')), `配置乙 必须可见：${result.finalContent}`);
});

test('RUNTIME-03 同名不同 canonical identity：两条都必须可见', async () => {
    const result = await runAiAssistant(input('对比配置甲和配置乙的成本'), fixture([
        { tool_calls: [call('compare_recipes', { recipe1: '同名配方', recipe2: '同名配方' })] },
        { content: '两项配置名称相同但身份不同，成本也不同。' },
    ], { executeToolCall: async () => ({ ...verified({}), recipe1: { id: 9, name: '同名配方', cost: 100 }, recipe2: { id: 8, name: '同名配方', cost: 200 }, costDiff: '100' }) }));
    const costRows = markdownTableRows(result.finalContent)
        .filter(row => row.header.includes('金额') && row.cells[1] === '成本')
        .map(row => Number(row.cells[2]));
    assert.deepEqual(costRows, [100, 200], `同名不同身份的两条都必须保留：${result.finalContent}`);
});

// ── 场景 2：两个实体金额交换（真实链路）──────────────────────────────
test('RUNTIME-02 金额交换：真实链路必须发现并纠正回正式关联', async () => {
    const results = () => ({ ...verified({}), recipe1: { name: '配置甲', cost: 100 }, recipe2: { name: '配置乙', cost: 200 }, costDiff: '100' });
    const swapped = '| 对象 | 项目 | 金额 |\n|---|---|---:|\n| 配置甲 | 成本 | 200 |\n| 配置乙 | 成本 | 100 |\n| 对比配方 | 成本差额（后者减前者） | 100 |';
    const result = await runAiAssistant(input('对比配置甲和配置乙的成本'), fixture([
        { tool_calls: [call('compare_recipes', { recipe1: '配置甲', recipe2: '配置乙' })] },
        { content: swapped },
        { content: swapped },
    ], { executeToolCall: async () => results() }));
    // 交付的回答里不得出现交换后的关联。
    assert.doesNotMatch(result.finalContent, /\| 配置甲 \| 成本 \| 200 \|/);
    assert.doesNotMatch(result.finalContent, /\| 配置乙 \| 成本 \| 100 \|/);
    // 正式关联必须仍然可见（要么模型被要求改正，要么由 canonical 表补回）。
    assert.match(result.finalContent, /配置甲[\s\S]*?100/);
    assert.match(result.finalContent, /配置乙[\s\S]*?200/);
});

// ── 场景 4：库存数量与成本恰好同值（真实链路）────────────────────────
test('RUNTIME-04 库存数量与成本同值：数量不得被当成金额声明而丢弃结论', async () => {
    const toolResults = [{ name: 'search_coils', result: verified({ stock: 123, cost: 123 }) }];
    // 运行时同款的前置检查：数量 123 不是金额声明，成本 123 是正式金额。
    assert.deepEqual(evaluateAnswerMoney('当前库存123套，档案成本123元。', toolResults).unsupportedClaims, []);
    assert.deepEqual(unsupportedMoneyInAnswer('当前库存123套，档案成本123元。', toolResults), []);
    const result = await runAiAssistant(input('查询 12-120 的正式线圈档案'), fixture([
        { tool_calls: [call('search_coils', { spec: '12-120' })] },
        { content: '当前库存123套，档案成本123元。' },
    ], { executeToolCall: async () => toolResults[0].result }));
    assert.equal(result.telemetry.outcome, 'completed');
    assert.match(result.finalContent, /当前库存123套/, '正确结论不得被替换');
    assert.match(result.finalContent, /档案成本123元/);
});

// ── 场景 5：缺料用未见过的新表达（真实链路）──────────────────────────
test('RUNTIME-05 缺料换一种从未出现过的写法，仍必须保留（结构化关键性）', async () => {
    // E1-A：缺料状态来自**真实 producer** check_order_readiness 的 shortages[].model
    // （不再是合成字段），仍然验证「换一种写法也必须保留」。
    const readiness = {
        order: { id: 1, contractNo: 'PHASED-ORDER-1', customerName: '客户-001', status: '生产中', itemCount: 1, totalUnits: 300 },
        verdict: 'waiting_materials', canProduce: false, summary: '缺料',
        metrics: { shortageCount: 1 },
        blockers: [], warnings: [],
        shortages: [{ identityKey: 'part:71', model: '6202轴承', shortageQty: 300, purchaseUnit: '件', procurementStage: '待采购', inventoryType: 'PART' }],
    };
    const rows = [
        ...Array.from({ length: 10 }, (_, index) => `- 常规件${index + 1}：需求400个，现存400个。`),
        '- 6202轴承：需求400个，现存100个，缺口300个（这是本轮的新写法）。',
        '- 常规件12：需求400个，现存400个。',
    ];
    const result = await runAiAssistant(input('订单1 的备料情况怎么样，缺什么？'), fixture([
        { tool_calls: [call('check_order_readiness', { orderId: 1 })] },
        { content: `备料检查结果如下。\n\n${rows.join('\n')}` },
    ], { executeToolCall: async () => verified(readiness) }));
    assert.match(result.finalContent, /缺口300个/, '未见过的新写法同样必须保留（判据来自结构化状态）');
    assert.match(result.finalContent, /本轮正式结果中处于缺料\/未定价\/未完成\/待选择状态的条目已全部保留/);
});

// ── 场景 10：配方成本不得被展示成线圈成本（真实链路）─────────────────
test('RUNTIME-10 配方成本不得被展示成线圈成本，线圈成本必须标成线圈口径', async () => {
    const recipeRun = await runAiAssistant(input('对比配置甲和配置乙的成本'), fixture([
        { tool_calls: [call('compare_recipes', { recipe1: '配置甲', recipe2: '配置乙' })] },
        { content: '两项配置成本如下。' },
    ], { executeToolCall: async () => ({ ...verified({}), recipe1: { name: '配置甲', cost: 268 }, recipe2: { name: '配置乙', cost: 300 }, costDiff: '32' }) }));
    assert.doesNotMatch(recipeRun.finalContent, /线圈档案成本/, '配方/整机成本不得被改写成线圈口径');
    // 同一根因的另一半：只有**线圈实体**的 cost 才使用线圈口径。该标签来自事实投影
    // （entity type = coil），由守卫按同一权威渲染 canonical 核对表。
    const coilDecision = moneyGuardDecision('线圈档案成本如下。', [{ name: 'search_coils', result: verified([{ schemeCode: 'COIL-A', cost: 166.7136 }]) }]);
    assert.match(coilDecision.summary, /线圈档案成本/);
    assert.match(coilDecision.summary, /166\.7136/, '来源精度必须保留');
});

// ── 场景 9：内部 ID 隐藏后仍能唯一选择（真实链路）────────────────────
test('RUNTIME-09 真实流水线的展示层：投影后无法区分候选时必须保留 ID 列', async () => {
    const answer = [
        'V750 相关配方当前有 2 个名称（未唯一匹配）：',
        '',
        '| 配方ID | 当前成本 |',
        '|---|---:|',
        '| 9 | 100 |',
        '| 8 | 100 |',
        '',
        '请告知你要看哪一个（或指定配方ID），我再读取其明细。',
    ].join('\n');
    const result = await runAiAssistant(input('查询 12-120 的正式线圈档案'), fixture([
        { tool_calls: [call('search_coils', { spec: '12-120' })] },
        { content: answer },
    ], { executeToolCall: async () => verified([{ id: 9, cost: 100 }, { id: 8, cost: 100 }]) }));
    assert.match(result.finalContent, /\| 配方ID \|/, '两行成本相同 ⇒ ID 是唯一区分身份，必须保留');
    assert.match(result.finalContent, /请告知你要看哪一个/);
});

// ── 场景 6/7/8：候选澄清的动作边界（真实控制器）──────────────────────
function controllerFixture(options = {}) {
    const calls = [];
    const execute = async (toolName, args) => {
        calls.push({ toolName, args });
        if (toolName === 'get_all_recipes') return verifiedReceipt([{ id: 301, name: 'V550' }], { queryReceipt: { authoritative: true, truncated: false, possiblyTruncated: false } });
        if (toolName === 'search_coils') return verifiedReceipt(options.coils ?? [{ id: 41, schemeName: '12-220 A', schemeCode: 'A' }, { id: 42, schemeName: '12-220 B', schemeCode: 'B' }], { queryReceipt: { authoritative: true, truncated: false, possiblyTruncated: false } });
        if (toolName === 'preview_recipe_cost') return verifiedReceipt({ recipeId: args.recipeId, recipeName: 'V550', currentTotalCost: 108.5, pricingComplete: true });
        if (toolName === 'compare_recipe_scenarios') {
            const scenario = args.scenarios[0];
            const base = { scenarioKey: 'base', configurationHash: 'base-configuration', cost: { complete: true, currentTotalCost: 108.5 }, appliedOverrides: {}, notApplied: [] };
            const candidate = { scenarioKey: scenario.scenarioKey, configurationHash: 'candidate-configuration', cost: { complete: true, currentTotalCost: 116.5 }, appliedOverrides: scenario.overrides, notApplied: [] };
            return verifiedReceipt({ readSetId: crypto.randomUUID(), recipe: { id: 301, name: 'V550' }, scenarios: [base, candidate], comparisons: [{ baseScenarioKey: 'base', candidateScenarioKey: scenario.scenarioKey, status: 'COMPARABLE', delta: 8, currency: 'CNY' }] });
        }
        throw new Error(`unexpected tool ${toolName}`);
    };
    return { execute, calls };
}
const controllerInput = (text, requestId, conversationId) => ({ ownerKey: 'server-owner', requestId, conversationId, messages: [{ role: 'user', content: text }] });
const AMBIGUOUS_COIL_QUESTION = 'V550换成12-220，和现在成本比一下，其他不变，先不要保存';

async function askAmbiguousCoil() {
    const fixture = controllerFixture();
    const sessions = createTaskSessionStoreV2();
    const first = await runAiTaskControllerV2(controllerInput(AMBIGUOUS_COIL_QUESTION, 'pending-1', 'pending-conversation'), { executeToolCall: fixture.execute, sessionStore: sessions });
    assert.equal(first.task.state, 'WAITING_INPUT');
    assert.equal(first.task.questions[0].reasonCode, 'COIL_AMBIGUOUS');
    return { fixture, sessions, first };
}

test('RUNTIME-06 候选选择肯定句：只有明确的整句选择才完成候选绑定', async () => {
    const { fixture, sessions, first } = await askAmbiguousCoil();
    const second = await runAiTaskControllerV2(controllerInput('第二个', 'pending-2', 'pending-conversation'), { executeToolCall: fixture.execute, sessionStore: sessions });
    assert.equal(second.task.taskId, first.task.taskId);
    assert.equal(second.task.state, 'SUCCEEDED');
    assert.equal(fixture.calls.find(item => item.toolName === 'compare_recipe_scenarios').args.scenarios[0].overrides.coilId, 42);
});

test('RUNTIME-07 候选选择否定句：不得从句内抢数字当选择', async () => {
    const { fixture, sessions, first } = await askAmbiguousCoil();
    for (const text of ['不要第一个', '不是第二个']) {
        const next = await runAiTaskControllerV2(controllerInput(text, `pending-neg-${text}`, 'pending-conversation'), { executeToolCall: fixture.execute, sessionStore: sessions });
        assert.equal(next.task.taskId, first.task.taskId, `${text}：仍然停留在同一个待澄清问题上`);
        assert.equal(next.task.state, 'WAITING_INPUT', `${text}：不得当作已选择`);
        assert.equal(next.detail.errorCode, 'CLARIFICATION_NOT_SELECTED');
        assert.equal(next.task.questions[0].answeredAt, null, `${text}：澄清问题不得被标记为已回答`);
    }
    assert.equal(fixture.calls.some(item => item.toolName === 'compare_recipe_scenarios'), false, '否定句绝不能触发候选绑定后的试算');
});

test('RUNTIME-08 待澄清时用户发起新问题：按新任务解析，不得把句内数字当选择', async () => {
    const { fixture, sessions, first } = await askAmbiguousCoil();
    const next = await runAiTaskControllerV2(controllerInput('先查2寸泵壳的价格', 'pending-new-task', 'pending-conversation'), { executeToolCall: fixture.execute, sessionStore: sessions });
    assert.notEqual(next.task.taskId, first.task.taskId, '新问题必须开始一个新任务');
    assert.equal(fixture.calls.some(item => item.toolName === 'compare_recipe_scenarios'), false, '不得因为句内出现 2 就绑定 choice_2 并试算');
    // 原候选澄清不得被当成已回答。
    assert.equal(first.task.questions[0].answeredAt, null);
});

test('RUNTIME-08 NEGATIVE_CONTROL：同一会话仍可用明确选择续接澄清', async () => {
    const { fixture, sessions } = await askAmbiguousCoil();
    const chosen = await runAiTaskControllerV2(controllerInput('第2个', 'pending-choice-2', 'pending-conversation'), { executeToolCall: fixture.execute, sessionStore: sessions });
    assert.equal(chosen.task.state, 'SUCCEEDED');
    assert.equal(fixture.calls.find(item => item.toolName === 'compare_recipe_scenarios').args.scenarios[0].overrides.coilId, 42);
});

// ── 结构化关键性输入的构造（供展示层使用，不读最终文字）──────────────
test('RUNTIME support：清单关键性只由结构化状态产生', () => {
    const criticality = buildListCriticality([{ name: 'preview_virtual_readiness', result: verified({
        recipeName: 'v550-tokoy', status: 'SHORTAGE', coverage: { shortageCount: 1, complete: true },
        shortages: [{ resourceType: 'PART', partId: 71, model: '6202轴承', shortageQty: 300 }], warnings: [],
    }) }]);
    assert.ok(criticality.mustShowTokens.includes('6202轴承'));
    // 没有接入 producer 的能力（即使结果里带 stock）不产生结构化关键性。
    assert.deepEqual(buildListCriticality([{ name: 'search_parts', result: verified([{ model: '常规件', stock: 400 }]) }]).mustShowTokens, []);
    assert.equal(normalizeAnswerPresentation('明细如下。\n\n- 常规件：库存充足。', '', { criticality }).includes('本轮正式结果'), false);
});
