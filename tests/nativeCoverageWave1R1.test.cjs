'use strict';
/**
 * E2-R1 — COVERAGE EXPANSION WAVE 1 CLOSURE 回归矩阵
 *
 * 三块：
 *   1. FAMILY-01 配方成本比较（RECIPE_COST_COMPARISON 双主体正式目标）
 *   2. 跨轮 canonical 主体继承（只继承身份，不继承目标/事实/可变业务数值）
 *   3. BOM / 金额负向控制
 *
 * 全部走真实 Native 控制器（无 provider ⇒ 确定性语义层；显式 provider 时验证模型无权决定）。
 * 判据：数字只能来自本轮正式回执，控制器永不自行相减，不唯一就澄清。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { runAiTaskControllerV2 } = require('../api/services/aiTaskControllerV2.cjs');
const { createTaskSessionStoreV2 } = require('../api/services/aiTaskSessionV2.cjs');
const { extractTaskSemanticsV2, recipeCostComparisonIntent, recipeCostComparisonSubjects } = require('../api/services/aiTaskSemanticsV2.cjs');
const { projectMoneyFacts } = require('../api/services/moneyFactProjection.cjs');
const { ownerTrialCoverageSummary, canaryAdmission, validateCoverageAgainstCapabilities } = require('../api/services/aiNativeOwnerTrialCoverage.cjs');

const evidence = { verified: true, kind: 'formal_api_query' };
const listReceipt = (rows, filters = {}) => ({
    success: true, count: rows.length,
    queryReceipt: { appliedFilters: filters, totalCount: rows.length, returnedCount: rows.length, truncated: false, possiblyTruncated: false, authoritative: true },
    data: rows, executionEvidence: evidence,
});
const objectReceipt = data => ({ success: true, data, executionEvidence: evidence });
const unverified = data => ({ success: true, data });

const RECIPES = Object.freeze([
    { id: 11, name: 'PHASED-浮球-有', spec: '12-120，带浮球' },
    { id: 12, name: 'PHASED-浮球-无', spec: '12-120，不带浮球' },
    { id: 15, name: 'PHASED-同名方案', spec: '12-120' },
    { id: 16, name: 'PHASED-同名方案', spec: '12-140' },
    { id: 17, name: 'PHASED-双名-甲', spec: '12-120' },
    { id: 18, name: 'PHASED-双名-乙', spec: '12-140' },
    { id: 13, name: 'v550-tokoy', spec: '12-120，带浮球' },
    { id: 2, name: 'v750-tokoy', spec: '12-140，带浮球' },
]);
const RECIPE_COST = Object.freeze({ 11: 271.98, 12: 263.98, 15: 100, 16: 110, 17: 120, 18: 130, 13: 271.98, 2: 286.51 });
// 名称唯一、但用**部分名称**提问时会命中两条不同名称的记录（真实业务里最常见的澄清场景）：
// 例如「PHASED-浮球」同时命中 PHASED-浮球-有 / PHASED-浮球-无。
const COILS = Object.freeze([
    { id: 1, spec: '12', sheets: 120, schemeCode: 'COIL-0001', schemeName: '正式方案', schemeStatus: 'official', stock: 100, cost: 98.38 },
    { id: 5, spec: '12', sheets: 200, schemeCode: 'COIL-0005', schemeName: '正式方案', schemeStatus: 'testing', stock: 0, cost: 143.82 },
    { id: 6, spec: '12', sheets: 200, schemeCode: 'COIL-0006', schemeName: '正式方案', schemeStatus: 'official', stock: 7, cost: 144.9 },
    { id: 7, spec: '12', sheets: 140, schemeCode: 'COIL-0007', schemeName: '正式方案', schemeStatus: 'official', stock: 3, cost: 120.5 },
]);

function executor(options = {}) {
    const calls = [];
    const stock = new Map(COILS.map(row => [row.id, row.stock]));
    const run = async (toolName, args = {}) => {
        calls.push({ toolName, args });
        if (toolName === 'get_all_recipes') {
            const keyword = String(args.keyword ?? '').trim();
            const rows = RECIPES.filter(row => !keyword || row.name.includes(keyword));
            return listReceipt(rows, { keyword });
        }
        if (toolName === 'compare_recipes') {
            if (options.compareUnverified) return unverified({});
            // 真实能力的选择器解析：全数字 = canonical 主键；否则名称精确匹配、再退化为子串匹配；
            // 命中多条时**正式失败**（RECIPE_SELECTOR_AMBIGUOUS），不替用户挑第一条。
            const resolveSelector = value => {
                const text = String(value ?? '').trim();
                if (/^\d+$/u.test(text)) return RECIPES.filter(row => String(row.id) === text);
                const exact = RECIPES.filter(row => row.name === text);
                return exact.length ? exact : RECIPES.filter(row => row.name.includes(text));
            };
            const left = resolveSelector(args.recipe1);
            const right = resolveSelector(args.recipe2);
            if (left.length !== 1 || right.length !== 1) {
                return { success: false, code: 'RECIPE_SELECTOR_AMBIGUOUS', error: `配方“${args.recipe1}”/“${args.recipe2}”匹配到多条记录，请使用配方ID或完整名称`, executionEvidence: { verified: true, kind: 'formal_api_query_failure' } };
            }
            const leftRow = left[0];
            const rightRow = right[0];
            const costDiff = options.diffOverride ?? Number((RECIPE_COST[rightRow.id] - RECIPE_COST[leftRow.id]).toFixed(2));
            return objectReceipt({
                recipe1: { name: leftRow.name, spec: leftRow.spec, cost: RECIPE_COST[leftRow.id] },
                recipe2: { name: rightRow.name, spec: rightRow.spec, cost: RECIPE_COST[rightRow.id] },
                costDiff: String(costDiff), costBasis: 'currentFullCost', sourceOfTruth: 'costEngine',
            });
        }
        if (toolName === 'compare_recipe_scenarios') {
            const recipe = RECIPES.find(row => String(row.id) === String(args.recipeId));
            return objectReceipt({ scenarios: [{ cost: { currentTotalCost: RECIPE_COST[recipe.id], complete: true } }] });
        }
        if (toolName === 'search_coils') {
            const schemeCode = String(args.schemeCode ?? '').trim();
            const shorthand = String(args.spec ?? '').trim();
            const rows = schemeCode
                ? COILS.filter(row => row.schemeCode === schemeCode)
                : COILS.filter(row => `${row.spec}-${row.sheets}` === shorthand);
            return listReceipt(rows.map(row => ({ ...row, stock: stock.get(row.id) })), { schemeCode, spec: shorthand });
        }
        throw new Error(`UNEXPECTED_TOOL ${toolName}`);
    };
    return { calls, execute: run, setStock: (id, value) => stock.set(id, value) };
}

const input = (text, conversationId) => ({ ownerKey: 'e2r1-owner', requestId: crypto.randomUUID(), conversationId, messages: [{ role: 'user', content: text }] });
const turn = (fixture, sessions, text, conversationId, extra = {}) => runAiTaskControllerV2(
    input(text, conversationId),
    { executeToolCall: fixture.execute, sessionStore: sessions, provider: null, ...extra },
);
const factPredicates = task => task.facts.map(fact => fact.key.predicate);
const goalOf = (result, kind) => result.task.goals.find(goal => goal.kind === kind);
const MONEY_RE = /[¥￥]\s*\d+(?:\.\d+)?|\d+\.\d{2}/gu;
const moneyIn = text => [...String(text).matchAll(MONEY_RE)].map(match => match[0].replace(/[¥￥\s]/gu, ''));

// ══ 1. 配方成本比较 ═══════════════════════════════════════════════════
test('R1-CMP-1 两主体唯一 → RECIPE_COST_COMPARISON VERIFIED，三个事实、差额只来自回执', async () => {
    const fixture = executor();
    const result = await turn(fixture, createTaskSessionStoreV2(), 'v550-tokoy和v750-tokoy成本差多少？', 'r1-cmp-1');
    assert.equal(result.task.state, 'SUCCEEDED');
    assert.deepEqual(result.task.goals.map(goal => goal.kind), ['RECIPE_COST_COMPARISON']);
    assert.deepEqual(factPredicates(result.task), ['recipe.current_cost', 'recipe.current_cost', 'recipe.cost_difference']);
    assert.deepEqual(result.task.facts.map(fact => fact.key.entityId), ['13', '2', '13']);
    assert.deepEqual([...new Set(result.task.facts.map(fact => fact.key.qualifiers.basis))], ['FORMAL_COST_COMPARISON']);
    assert.deepEqual([...new Set(result.task.facts.map(fact => [fact.key.qualifiers.unit, fact.key.qualifiers.currency].join('/')))], ['pump/CNY']);
    assert.deepEqual([...new Set(result.task.facts.map(fact => fact.key.scenarioKey))], [null]);
    assert.match(result.answer.content, /v550-tokoy当前完整成本为 ¥271\.98/u);
    assert.match(result.answer.content, /v750-tokoy当前完整成本为 ¥286\.51/u);
    assert.match(result.answer.content, /高 ¥14\.53/u);
    assert.equal(fixture.calls.filter(call => call.toolName === 'compare_recipes').length, 1);
    const compare = fixture.calls.find(call => call.toolName === 'compare_recipes');
    assert.deepEqual([compare.args.recipe1, compare.args.recipe2], ['13', '2'], '已 canonical resolved 后必须发送主键选择器');
});

test('R1-CMP-2 A 主体多候选 → WAITING_INPUT，只澄清 A，且不调用 compare_recipes', async () => {
    const fixture = executor();
    const result = await turn(fixture, createTaskSessionStoreV2(), 'PHASED-同名方案和v750-tokoy成本差多少？', 'r1-cmp-2');
    assert.equal(result.task.state, 'WAITING_INPUT');
    assert.equal(goalOf(result, 'RECIPE_COST_COMPARISON').state, 'NEEDS_INPUT');
    assert.deepEqual(result.task.questions.map(question => question.reasonCode), ['RECIPE_COMPARISON_AMBIGUOUS']);
    assert.equal(result.task.questions[0].choices.length, 2);
    assert.match(result.answer.content, /请选择一个后再进行成本比较/u);
    assert.equal(fixture.calls.some(call => call.toolName === 'compare_recipes'), false, '未消歧前不得执行比较');
    assert.deepEqual(factPredicates(result.task), []);
});

test('R1-CMP-3 A 唯一、B 多候选 → WAITING_INPUT，澄清明确指向 B；选定后同一目标继续执行', async () => {
    const fixture = executor();
    const sessions = createTaskSessionStoreV2();
    const result = await turn(fixture, sessions, 'v550-tokoy和PHASED-浮球成本差多少？', 'r1-cmp-3');
    assert.equal(result.task.state, 'WAITING_INPUT');
    assert.match(result.task.questions[0].prompt, /“PHASED-浮球”有多个正式配方/u);
    assert.equal(result.task.questions[0].choices.length, 2);
    assert.equal(fixture.calls.filter(call => call.toolName === 'get_all_recipes').length, 2, 'A 已解析后才停在 B');
    const selected = await turn(fixture, sessions, '第二个', 'r1-cmp-3');
    assert.equal(selected.task.state, 'SUCCEEDED');
    assert.equal(goalOf(selected, 'RECIPE_COST_COMPARISON').state, 'VERIFIED');
    assert.match(selected.answer.content, /PHASED-浮球-无当前完整成本为 ¥263\.98/u, '必须使用用户选定的第二个候选');
    assert.equal(fixture.calls.filter(call => call.toolName === 'compare_recipes').length, 1);
});

test('R1-CMP-9 同名多主键：选定后按 canonical ID 比较成功（不再退回名称重新解析）', async () => {
    const fixture = executor();
    const sessions = createTaskSessionStoreV2();
    const first = await turn(fixture, sessions, 'v550-tokoy和PHASED-同名方案成本差多少？', 'r1-cmp-9');
    assert.equal(first.task.state, 'WAITING_INPUT');
    const selected = await turn(fixture, sessions, '第二个', 'r1-cmp-9');
    assert.equal(selected.task.state, 'SUCCEEDED', '同名不同主键必须用主键比较');
    const compare = fixture.calls.filter(call => call.toolName === 'compare_recipes').at(-1);
    assert.deepEqual([compare.args.recipe1, compare.args.recipe2], ['13', '16'], '比较实参必须是 canonical 主键，不是名称');
    assert.match(selected.answer.content, /PHASED-同名方案当前完整成本为 ¥110\.00/u);
    assert.match(selected.answer.content, /¥14\.53|¥-14\.53|低 ¥/u);
});

test('R1-CMP-4 A/B 都多候选 → 有界可恢复澄清顺序：先 A、选定后再 B', async () => {
    const fixture = executor();
    const sessions = createTaskSessionStoreV2();
    const first = await turn(fixture, sessions, 'PHASED-浮球和PHASED-双名成本差多少？', 'r1-cmp-4');
    assert.equal(first.task.state, 'WAITING_INPUT');
    assert.match(first.task.questions[0].prompt, /“PHASED-浮球”/u);
    const second = await turn(fixture, sessions, '第一个', 'r1-cmp-4');
    assert.equal(second.task.state, 'WAITING_INPUT', '选定 A 后必须停在 B 的澄清，不能只绑一个就执行');
    assert.match(second.task.questions.at(-1).prompt, /“PHASED-双名”/u);
    assert.equal(fixture.calls.some(call => call.toolName === 'compare_recipes'), false);
    const third = await turn(fixture, sessions, '第二个', 'r1-cmp-4');
    assert.equal(third.task.state, 'SUCCEEDED');
    assert.match(third.answer.content, /PHASED-浮球-有当前完整成本为 ¥271\.98/u);
    assert.match(third.answer.content, /PHASED-双名-乙当前完整成本为 ¥130\.00/u);
    assert.equal(fixture.calls.filter(call => call.toolName === 'compare_recipes').length, 1);
});

test('R1-CMP-5 缺少正式比较回执 → 不给任何金额（只给限制说明）', async () => {
    const fixture = executor({ compareUnverified: true });
    const result = await turn(fixture, createTaskSessionStoreV2(), 'v550-tokoy和v750-tokoy成本差多少？', 'r1-cmp-5');
    assert.notEqual(result.task.state, 'SUCCEEDED');
    assert.equal(goalOf(result, 'RECIPE_COST_COMPARISON').state, 'PARTIAL');
    assert.deepEqual(factPredicates(result.task), []);
    assert.deepEqual(moneyIn(result.answer.content), [], '没有正式回执时不得出现任何金额');
});

test('R1-CMP-6 模型不产出任何候选（无 tool call）→ 正式比较仍由服务器执行', async () => {
    const fixture = executor();
    const provider = async () => ({ choices: [{ message: { content: '' } }] });
    const result = await turn(fixture, createTaskSessionStoreV2(), 'v550-tokoy和v750-tokoy成本差多少？', 'r1-cmp-6', { provider });
    assert.equal(result.task.state, 'SUCCEEDED');
    assert.equal(goalOf(result, 'RECIPE_COST_COMPARISON').state, 'VERIFIED');
    assert.match(result.answer.content, /高 ¥14\.53/u);
});

test('R1-CMP-7 模型给出错误范围目标（单主体成本 + 降级比较）→ 被服务器规范化', async () => {
    const fixture = executor();
    const provider = async () => ({
        choices: [{
            message: {
                tool_calls: [{
                    function: {
                        name: 'submit_ai_task_proposal_candidate_v1',
                        arguments: JSON.stringify({
                            proposal: {
                                version: 1, goalSummary: 'compare costs',
                                subjects: [
                                    { subjectKey: 'subject_1', mention: 'v550-tokoy', typeHints: ['recipe'], sources: [{ sourceQuote: 'v550-tokoy' }] },
                                    { subjectKey: 'subject_2', mention: 'v750-tokoy', typeHints: ['recipe'], sources: [{ sourceQuote: 'v750-tokoy' }] },
                                ],
                                scenarios: [],
                                goals: [
                                    { goalKey: 'goal_1', kind: 'CURRENT_COST', description: '查 v550 成本', subjectKeys: ['subject_1'], scenarioKeys: [], dependsOn: [], requestedBasis: 'CURRENT', sources: [{ sourceQuote: 'v550-tokoy' }], quantity: null, unitPrice: null },
                                    { goalKey: 'goal_2', kind: 'RECIPE_COST_COMPARISON', description: '比较成本', subjectKeys: ['subject_1'], scenarioKeys: [], dependsOn: [], requestedBasis: 'CURRENT', sources: [{ sourceQuote: 'v550-tokoy' }], quantity: null, unitPrice: null },
                                ],
                                unparsedSpans: [],
                            },
                        }),
                    },
                }],
            },
        }],
    });
    const result = await turn(fixture, createTaskSessionStoreV2(), 'v550-tokoy和v750-tokoy成本差多少？', 'r1-cmp-7', { provider });
    assert.deepEqual(result.task.goals.map(goal => goal.kind), ['RECIPE_COST_COMPARISON'], '错误范围单主体成本目标必须被删除，比较主体由服务器决定');
    assert.equal(result.task.state, 'SUCCEEDED');
    assert.deepEqual(factPredicates(result.task), ['recipe.current_cost', 'recipe.current_cost', 'recipe.cost_difference']);
    assert.equal(result.answer.content.match(/当前完整成本为/gu).length, 2, '只允许两个主体的成本，不得额外给单主体成本块');
});

test('R1-CMP-8 控制器不自行相减：正式差额与成本不自洽时不产出差额、也不猜方向', async () => {
    const fixture = executor({ diffOverride: 99 });
    const result = await turn(fixture, createTaskSessionStoreV2(), 'v550-tokoy和v750-tokoy成本差多少？', 'r1-cmp-8');
    assert.deepEqual(factPredicates(result.task), ['recipe.current_cost', 'recipe.current_cost']);
    assert.deepEqual(moneyIn(result.answer.content).sort(), ['271.98', '286.51'], '只展示两个正式成本');
    assert.doesNotMatch(result.answer.content, /14\.53/u, '不得自行相减');
    assert.doesNotMatch(result.answer.content, /99\.00/u, '异常差额不得被当成结论输出');
    assert.match(result.answer.content, /不判断两者谁更高/u);
});

test('R1-CMP-10 口语比较问法（帮我比较一下 X 和 Y 哪个高一点）仍进入正式比较目标', async () => {
    const question = '帮我比较一下 v550-tokoy 和 PHASED-浮球-有 哪个成本高一点，高多少？';
    const detected = recipeCostComparisonSubjects('m1', question);
    assert.deepEqual(detected.map(item => item.mention), ['v550-tokoy', 'PHASED-浮球-有'], '尾部语气残留必须被裁掉后仍能定位主体');
    const semantics = await extractTaskSemanticsV2({ messageRef: 'm1', text: question, provider: null });
    assert.deepEqual(semantics.proposal.goals.map(goal => goal.kind), ['RECIPE_COST_COMPARISON']);
    assert.equal(semantics.proposal.goals[0].subjectKeys.length, 2);
});

// ══ 2. 跨轮 canonical 主体继承 ════════════════════════════════════════
test('R1-CONT-1 选中线圈成本 → 「这个还有库存吗」：目标切换、库存重读、成本事实不复用', async () => {
    const fixture = executor();
    const sessions = createTaskSessionStoreV2();
    const first = await turn(fixture, sessions, '12-120成本多少？', 'r1-cont-1');
    assert.deepEqual(factPredicates(first.task), ['coil.current_cost']);
    const second = await turn(fixture, sessions, '这个还有库存吗？', 'r1-cont-1');
    assert.equal(second.task.state, 'SUCCEEDED');
    assert.deepEqual(second.task.goals.map(goal => goal.kind), ['INVENTORY_QUERY'], '主体可以继承，目标不可以继承');
    assert.deepEqual(factPredicates(second.task), ['inventory.coil']);
    assert.match(second.answer.content, /当前正式库存为 100/u);
    assert.doesNotMatch(second.answer.content, /成本/u, '不得复用上一轮的成本口径');
});

test('R1-CONT-2 选中线圈库存 → 「这个成本多少」：切换为 COIL_COST 并重新正式读取', async () => {
    const fixture = executor();
    const sessions = createTaskSessionStoreV2();
    await turn(fixture, sessions, '12-140还有多少？', 'r1-cont-2');
    const second = await turn(fixture, sessions, '这个成本多少？', 'r1-cont-2');
    assert.equal(second.task.state, 'SUCCEEDED');
    assert.deepEqual(second.task.goals.map(goal => goal.kind), ['COIL_COST']);
    assert.deepEqual(factPredicates(second.task), ['coil.current_cost']);
    assert.match(second.answer.content, /¥120\.50/u);
});

test('R1-CONT-3 本轮显式主体覆盖旧焦点（不因会话有旧焦点而继续查旧对象）', async () => {
    const fixture = executor();
    const sessions = createTaskSessionStoreV2();
    await turn(fixture, sessions, '12-120成本多少？', 'r1-cont-3');
    const explicit = await turn(fixture, sessions, '12-140的成本是多少？', 'r1-cont-3');
    assert.equal(explicit.task.state, 'SUCCEEDED');
    assert.match(explicit.answer.content, /¥120\.50/u, '必须用本轮显式主体 12-140');
    assert.doesNotMatch(explicit.answer.content, /¥98\.38/u);
});

test('R1-CONT-4 上一轮焦点不唯一 → 先澄清，绝不自动绑定；选定后才继承', async () => {
    const fixture = executor();
    const sessions = createTaskSessionStoreV2();
    await turn(fixture, sessions, 'v550-tokoy和v750-tokoy成本差多少？', 'r1-cont-4');
    const ambiguous = await turn(fixture, sessions, '这个成本多少？', 'r1-cont-4');
    assert.equal(ambiguous.task.state, 'WAITING_INPUT');
    assert.equal(ambiguous.task.questions.at(-1).reasonCode, 'CONTINUATION_FOCUS_AMBIGUOUS');
    assert.deepEqual(factPredicates(ambiguous.task), [], '焦点不唯一时不得读取或绑定任一主体');
    const chosen = await turn(fixture, sessions, '第二个', 'r1-cont-4');
    assert.equal(chosen.task.state, 'SUCCEEDED');
    assert.match(chosen.answer.content, /v750-tokoy当前完整成本为 ¥286\.51/u);
});

test('R1-CONT-5 失效/过期会话不继承（无 continuation 时指代问题 fail-closed）', async () => {
    const fixture = executor();
    let now = 1_000_000;
    const sessions = createTaskSessionStoreV2({ now: () => now, ttlMs: 1000 });
    await turn(fixture, sessions, '12-120成本多少？', 'r1-cont-5');
    now += 60_000; // 会话过期
    const stale = await turn(fixture, sessions, '这个还有库存吗？', 'r1-cont-5');
    assert.deepEqual(factPredicates(stale.task), [], '过期会话不得提供身份继承');
    assert.notEqual(stale.task.state, 'SUCCEEDED');
    assert.deepEqual(moneyIn(stale.answer.content), []);
});

test('R1-CONT-6 继承的是身份不是数值：库存变化后必须重新正式读取', async () => {
    const fixture = executor();
    const sessions = createTaskSessionStoreV2();
    await turn(fixture, sessions, '12-120成本多少？', 'r1-cont-6');
    const first = await turn(fixture, sessions, '这个还有库存吗？', 'r1-cont-6');
    assert.match(first.answer.content, /当前正式库存为 100/u);
    fixture.setStock(1, 0);
    const second = await turn(fixture, sessions, '这个还有库存吗？', 'r1-cont-6');
    assert.match(second.answer.content, /当前正式库存为 0/u, '可变业务数值必须重读，不能沿用上一轮');
    const inventoryReads = fixture.calls.filter(call => call.toolName === 'search_coils').length;
    assert.ok(inventoryReads >= 3, '每一次追问都必须重新正式读取（成本一次 + 两次库存）');
});

// ══ 3. BOM / 金额负向控制 ═════════════════════════════════════════════
test('R1-BOM-1 BOM 草稿金额经正式回执唯一映射绑定 canonical recipe', () => {
    const formal = data => ({ success: true, data, executionEvidence: { verified: true, kind: 'formal_api_query' } });
    const facts = projectMoneyFacts([
        { name: 'get_all_recipes', result: formal([{ id: 13, name: 'v550-tokoy', spec: '12-120' }]) },
        { name: 'build_recipe_bom_draft', result: formal({
            costPreview: { currentTotalCost: 285.8, partsCost: 264.8, laborCost: 21, pricingComplete: true },
            configurationBasis: { source: 'recipe', recipeName: 'v550-tokoy', configurationComplete: true },
            parts: [{ model: 'V750-大脚板-2寸' }],
        }) },
    ], { includeQueries: true });
    const bom = facts.filter(fact => fact.capability === 'build_recipe_bom_draft');
    assert.ok(bom.length > 0);
    assert.deepEqual([...new Set(bom.map(fact => fact.identityState))], ['CANONICAL']);
    assert.deepEqual([...new Set(bom.map(fact => fact.entityId))], ['recipe:13']);
    assert.deepEqual([...new Set(bom.map(fact => fact.identityResolvedBy))], ['FORMAL_RECEIPT_BINDING']);
});

test('R1-BOM-2 同名多主键时 BOM 金额 fail-closed，不绑定任一候选', () => {
    const formal = data => ({ success: true, data, executionEvidence: { verified: true, kind: 'formal_api_query' } });
    const facts = projectMoneyFacts([
        { name: 'get_all_recipes', result: formal([{ id: 15, name: 'PHASED-同名方案' }, { id: 16, name: 'PHASED-同名方案' }]) },
        { name: 'build_recipe_bom_draft', result: formal({
            costPreview: { currentTotalCost: 285.8, pricingComplete: true },
            configurationBasis: { source: 'recipe', recipeName: 'PHASED-同名方案', configurationComplete: true },
        }) },
    ], { includeQueries: true });
    const bom = facts.filter(fact => fact.capability === 'build_recipe_bom_draft');
    assert.deepEqual([...new Set(bom.map(fact => fact.identityState))], ['IDENTITY_INCOMPLETE']);
    assert.deepEqual([...new Set(bom.map(fact => fact.identityReasonCode))], ['AMBIGUOUS_BUSINESS_KEY']);
    assert.deepEqual([...new Set(bom.map(fact => fact.entityId))], [null]);
});

test('R1-MONEY-1 金额归属错配会被发现（同价不同主体不合并、金额交换可识别）', () => {
    const formal = data => ({ success: true, data, executionEvidence: { verified: true, kind: 'formal_api_query' } });
    const facts = projectMoneyFacts([{
        name: 'compare_recipes',
        result: { ...formal({}), recipe1: { name: 'PHASED-同价-甲', cost: 100 }, recipe2: { name: 'PHASED-同价-乙', cost: 100 }, costDiff: '0.00' },
    }], { includeQueries: true });
    const costs = facts.filter(fact => fact.predicate === 'cost');
    assert.equal(costs.length, 2, '同价不同实体必须保留两条');
    assert.deepEqual([...new Set(costs.map(fact => fact.objectLabel))].sort(), ['PHASED-同价-乙', 'PHASED-同价-甲']);
    assert.ok(new Set(costs.map(fact => fact.factPath)).size === 2, '不同位置的金额不得被合并');
});

test('R1-MONEY-2 同一数值的库存与成本是两个不同事实（口径不同不互相吞并）', async () => {
    const fixture = executor();
    const sessions = createTaskSessionStoreV2();
    const cost = await turn(fixture, sessions, '12-120成本多少？', 'r1-money-2');
    const inventory = await turn(fixture, sessions, '12-120还有多少？', 'r1-money-2');
    assert.deepEqual(factPredicates(cost.task), ['coil.current_cost']);
    assert.deepEqual(factPredicates(inventory.task), ['inventory.coil']);
    assert.equal(inventory.task.facts[0].key.qualifiers.basis, 'FORMAL_INVENTORY_QUERY');
    assert.equal(cost.task.facts[0].key.qualifiers.basis, 'FORMAL_COIL_COST_QUERY');
});

// ══ 4. 负向控制：不得进入比较 ═════════════════════════════════════════
test('R1-NEG-1 单主体成本问法仍是 CURRENT_COST（不得升级为比较）', async () => {
    const semantics = await extractTaskSemanticsV2({ messageRef: 'm1', text: 'v550-tokoy现在成本多少？', provider: null });
    assert.deepEqual(semantics.proposal.goals.map(goal => goal.kind), ['CURRENT_COST']);
    assert.equal(recipeCostComparisonIntent('v550-tokoy现在成本多少？'), null);
});

test('R1-NEG-2 非金额比较（配置差异）不得进入成本比较', async () => {
    const semantics = await extractTaskSemanticsV2({ messageRef: 'm1', text: 'v550-tokoy和v750-tokoy有什么配置区别？', provider: null });
    assert.equal(semantics.proposal.goals.some(goal => goal.kind === 'RECIPE_COST_COMPARISON'), false);
    assert.equal(recipeCostComparisonSubjects('m1', 'v550-tokoy和v750-tokoy有什么配置区别？'), null);
});

test('R1-NEG-3 线圈比较不得进入配方比较，也不得退化成单一线圈成本', async () => {
    const semantics = await extractTaskSemanticsV2({ messageRef: 'm1', text: '12-120和12-200哪个成本高？', provider: null });
    assert.deepEqual(semantics.proposal.goals.map(goal => goal.kind), ['OTHER']);
    const fixture = executor();
    const result = await turn(fixture, createTaskSessionStoreV2(), '12-120和12-200哪个成本高？', 'r1-neg-3');
    assert.deepEqual(factPredicates(result.task), []);
    assert.deepEqual(moneyIn(result.answer.content), []);
});

test('R1-NEG-4 无上下文指代（「这两个差多少钱」）必须 fail-closed', async () => {
    const semantics = await extractTaskSemanticsV2({ messageRef: 'm1', text: '这两个差多少钱？', provider: null });
    assert.deepEqual(semantics.proposal.goals.map(goal => goal.kind), ['OTHER']);
    const fixture = executor();
    const result = await turn(fixture, createTaskSessionStoreV2(), '这两个差多少钱？', 'r1-neg-4');
    assert.deepEqual(factPredicates(result.task), []);
    assert.deepEqual(moneyIn(result.answer.content), []);
});

// ══ 5. 覆盖清单 / canary ══════════════════════════════════════════════
test('R1-COVERAGE-1 配方成本比较升级为 SUPPORTED；NATIVE-R1 后计数为 12 / 10 / 1 / 1 且与能力一致', () => {
    const summary = ownerTrialCoverageSummary();
    // NATIVE-R1：新增报价查询 / 业务变更 / 线圈目录查询三族 + 经营概况由 UNSUPPORTED 转 SUPPORTED。
    assert.equal(summary.total, 12);
    assert.equal(summary.supported.length, 10);
    assert.equal(summary.partial.length, 1);
    assert.equal(summary.unsupported.length, 1);
    assert.deepEqual(validateCoverageAgainstCapabilities().problems, []);
    const entry = summary.supported.find(item => item.questionFamily === '两个方案的成本差额（比较）');
    assert.equal(entry.expectedGoal, 'RECIPE_COST_COMPARISON');
    assert.deepEqual(entry.requiredCapabilities, ['get_all_recipes', 'compare_recipes']);
    assert.deepEqual(entry.requiredFacts, ['recipe.current_cost', 'recipe.cost_difference']);
});

test('R1-COVERAGE-2 canary admission 随清单自动更新（比较族进入 canaryEligible）', () => {
    const summary = ownerTrialCoverageSummary();
    assert.ok(summary.canaryEligible.includes('两个方案的成本差额（比较）'));
    assert.equal(canaryAdmission({ questionFamily: '两个方案的成本差额（比较）' }).eligible, true);
    for (const entry of [...summary.partial, ...summary.unsupported]) {
        assert.equal(canaryAdmission({ questionFamily: entry.questionFamily }).eligible, false);
        assert.equal(summary.canaryEligible.includes(entry.questionFamily), false);
    }
});
