'use strict';
/**
 * S2-R1 — CURRENT FUNCTION STABILITY CLOSURE 回归矩阵
 *
 * A. 当前 vs 保存成本口径（CURRENT 权威必须由回执声明的当前重算口径证明）
 * B. SUPPORTED family 准入不再依赖 V 风格命名（复用正式资源解析，负结果仍 fail-closed）
 * C. 线圈椭圆追问不得误路由到配方
 * D. 缺对象时的范围受限措辞
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { deterministicSemanticAnswer } = require('../api/business-semantics/answerBoundary.cjs');
const { coilEllipticalFollowUp, selectLocalAssistantTools } = require('../api/services/aiToolShortlist.cjs');
const { extractTaskSemanticsV2 } = require('../api/services/aiTaskSemanticsV2.cjs');
const { runAiTaskControllerV2 } = require('../api/services/aiTaskControllerV2.cjs');
const { createTaskSessionStoreV2 } = require('../api/services/aiTaskSessionV2.cjs');

const evidence = { verified: true, kind: 'formal_api_query' };
const receipt = (data, extra = {}) => ({ success: true, data, ...extra, executionEvidence: evidence });
const listReceipt = (rows, extra = {}) => ({ success: true, count: rows.length, queryReceipt: { appliedFilters: {}, totalCount: rows.length, returnedCount: rows.length, truncated: false, possiblyTruncated: false, authoritative: true }, data: rows, ...extra, executionEvidence: evidence });
// Legacy 边界单元测试需要运行时的 tool-result 形状 {name, result}；
// 控制器夹具的 executeToolCall 必须返回**载荷本身**（无 name/result 包裹）。
const tool = (name, payload) => ({ name, result: payload });
const RECIPE_NAME = 'V550大脚板-2寸-经典款';
const frameFor = (status = 'VERIFIED') => ({ question: { kind: 'COST_QUERY' }, subject: { requestedToken: RECIPE_NAME, canonicalId: 12, resolutionStatus: 'CANONICAL' }, completeness: { status }, evidence: { facts: [], verifiedFacts: [], missingFacts: [] } });
const recipeIdentity = () => tool('get_all_recipes', listReceipt([{ id: 12, name: RECIPE_NAME }]));

// ══ A. CURRENT vs SAVED ══════════════════════════════════════════════
test('S2R1-A1 current≠saved：问当前成本必须返回当前重算值', () => {
    const toolResults = [recipeIdentity(), tool('full_calculate', receipt({
        costBasis: 'currentFullCost', basis: 'currentTemplateAndRecipeParameters', sourceOfTruth: 'costEngine',
        currentTotalCost: 269.28, savedTotalCost: 266.74, difference: 2.54, costComplete: true, totalCost: '269.28',
    }))];
    const answer = deterministicSemanticAnswer(frameFor(), toolResults, `${RECIPE_NAME}现在成本多少？`);
    assert.match(answer, /当前完整成本为 269\.28/u);
    assert.doesNotMatch(answer, /266\.74/u, '保存快照不得出现在当前成本回答里');
});

test('S2R1-A2 明确问保存成本：返回保存快照并显式标注历史口径', () => {
    const toolResults = [recipeIdentity(), tool('full_calculate', receipt({
        costBasis: 'currentFullCost', currentTotalCost: 269.28, savedTotalCost: 266.74, costComplete: true,
    }))];
    const answer = deterministicSemanticAnswer(frameFor(), toolResults, `${RECIPE_NAME}的保存成本是多少？`);
    assert.match(answer, /保存成本快照为 266\.74/u);
    assert.match(answer, /历史保存口径/u);
    assert.doesNotMatch(answer, /当前完整成本/u, '保存问题不得表述为当前成本');
});

test('S2R1-A3 current==saved：口径仍必须是当前（不能退化成保存）', () => {
    const toolResults = [recipeIdentity(), tool('full_calculate', receipt({
        costBasis: 'currentFullCost', currentTotalCost: 269.28, savedTotalCost: 269.28, difference: 0, costComplete: true,
    }))];
    const answer = deterministicSemanticAnswer(frameFor(), toolResults, `${RECIPE_NAME}当前成本是多少？`);
    assert.match(answer, /当前完整成本为 269\.28/u);
    assert.doesNotMatch(answer, /保存成本快照/u);
});

test('S2R1-A4 只有保存快照、当前重算缺失：不得把保存值冒充当前', () => {
    const toolResults = [recipeIdentity(), tool('full_calculate', receipt({
        costBasis: 'currentFullCost', currentTotalCost: null, totalCost: null, savedTotalCost: 266.74, costComplete: false,
        currentCostUnavailableReason: 'CURRENT_RECOMPUTE_INCOMPLETE',
    }))];
    const answer = deterministicSemanticAnswer(frameFor(), toolResults, `${RECIPE_NAME}现在成本多少？`);
    assert.doesNotMatch(answer, /当前完整成本为/u, '当前值缺失时不得给出当前成本');
    assert.match(answer, /不能当作当前完整成本/u);
});

test('S2R1-A5 草稿/覆盖试算口径不得被当成当前成本（stale/draft 也不行）', () => {
    const draft = [recipeIdentity(), tool('full_calculate', receipt({
        costBasis: 'configuredBomDraft', sourceOfTruth: 'costEngine', costPreview: { currentTotalCost: 266.74, pricingComplete: true },
    }))];
    const answer = deterministicSemanticAnswer(frameFor(), draft, `${RECIPE_NAME}现在成本多少？`);
    assert.doesNotMatch(answer, /当前完整成本为/u, '草稿口径不能证明当前成本');
    const override = [recipeIdentity(), tool('full_calculate', receipt({
        costBasis: 'overridePreview', currentTotalCost: null, totalCost: '264.93', costComplete: true,
    }))];
    const overrideAnswer = deterministicSemanticAnswer(frameFor(), override, `${RECIPE_NAME}现在成本多少？`);
    assert.doesNotMatch(overrideAnswer, /当前完整成本为/u, '覆盖试算口径不能证明当前成本');
});

test('S2R1-A6 Legacy 当前口径与 Native 事实同源（同一回执、同一指针、同一值）', () => {
    const scenarioReceipt = tool('compare_recipe_scenarios', receipt({
        scenarios: [{ cost: { currentTotalCost: 269.28, complete: true } }],
    }));
    const legacyAnswer = deterministicSemanticAnswer(frameFor(), [recipeIdentity(), scenarioReceipt], `${RECIPE_NAME}现在成本多少？`);
    assert.match(legacyAnswer, /当前完整成本为 269\.28/u);
    // Native 控制器对同一回执使用的正式指针（见 tests/nativeCoverageWave1R1.test.cjs）：
    // /data/scenarios/0/cost/currentTotalCost —— 两边读的是同一个值。
    assert.equal(scenarioReceipt.result.data.scenarios[0].cost.currentTotalCost, 269.28);
    // 同一回执里的保存快照必须保持独立口径。
    const withSaved = tool('full_calculate', receipt({
        costBasis: 'currentFullCost', currentTotalCost: 269.28, savedTotalCost: 266.74, costComplete: true,
    }));
    assert.match(deterministicSemanticAnswer(frameFor(), [recipeIdentity(), withSaved], `${RECIPE_NAME}现在成本多少？`), /当前完整成本为 269\.28/u);
    assert.match(deterministicSemanticAnswer(frameFor(), [recipeIdentity(), withSaved], `${RECIPE_NAME}保存成本是多少？`), /266\.74/u);
});

// ══ B. SUPPORTED family admission（不依赖命名形态）═══════════════════
test('S2R1-B7 V 风格命名：进入 CURRENT_COST 且主体为 recipe', async () => {
    const semantics = await extractTaskSemanticsV2({ messageRef: 'm1', text: `${RECIPE_NAME}现在成本是多少？`, provider: null });
    assert.deepEqual(semantics.proposal.goals.map(goal => goal.kind), ['CURRENT_COST']);
    const key = semantics.proposal.goals[0].subjectKeys[0];
    assert.equal(semantics.proposal.subjects.find(item => item.subjectKey === key).typeHints.join(','), 'recipe');
});

test('S2R1-B8/B9 非 V / 任意正式名称：同样进入 CURRENT_COST（命名形态不再决定准入）', async () => {
    for (const name of ['PHASED-浮球-有', '大脚板-2寸-经典款', 'SHADOW-浮球-甲']) {
        const semantics = await extractTaskSemanticsV2({ messageRef: 'm1', text: `${name}现在成本是多少？`, provider: null });
        assert.deepEqual(semantics.proposal.goals.map(goal => goal.kind), ['CURRENT_COST'], name);
        const key = semantics.proposal.goals[0].subjectKeys[0];
        const subject = semantics.proposal.subjects.find(item => item.subjectKey === key);
        assert.equal(subject.mention, name, `${name} 的候选主体必须是用户 mention 本身`);
        assert.equal(subject.typeHints.join(','), 'recipe', name);
    }
    const bare = await extractTaskSemanticsV2({ messageRef: 'm1', text: '现在成本是多少？', provider: null });
    assert.deepEqual(bare.proposal.goals.map(goal => goal.kind), ['OTHER'], '没有名称时仍 fail-closed');
});

test('S2R1-B10 不存在的配方：进入 Native 后得到范围受限的正式负结果（零金额）', async () => {
    const fixture = recipeExecutor({ recipes: [{ id: 12, name: RECIPE_NAME }] });
    const result = await turn(fixture, 'V999不存在的配方现在成本多少？', 's2r1-b10');
    assert.notEqual(result.task.state, 'SUCCEEDED');
    assert.match(result.answer.content, /正式配方目录中没有找到/u);
    assert.match(result.answer.content, /不能据此判断整个系统/u);
    assert.deepEqual([...result.answer.content.matchAll(/¥\s*\d+/gu)], []);
});

test('S2R1-B11 多候选配方：澄清（不默认、不模糊取第一条）', async () => {
    const fixture = recipeExecutor({ recipes: [{ id: 12, name: '大脚板-2寸-经典款' }, { id: 13, name: '大脚板-2寸-经典款' }] });
    const result = await turn(fixture, '大脚板-2寸-经典款现在成本多少？', 's2r1-b11');
    assert.equal(result.task.state, 'WAITING_INPUT');
    assert.equal(result.task.questions[0].reasonCode, 'RECIPE_AMBIGUOUS');
    assert.deepEqual(result.task.facts, []);
});

// ══ C. 线圈椭圆追问 ══════════════════════════════════════════════════
test('S2R1-C12/C13 椭圆线圈追问继承上一轮目标族，且只暴露线圈能力', () => {
    const tools = [{ type: 'function', function: { name: 'calculate_coil_cost' } }, { type: 'function', function: { name: 'search_coils' } }, { type: 'function', function: { name: 'preview_recipe_cost' } }];
    const env = { AI_LOCAL_TOOL_SHORTLIST_ENABLED: 'true' };
    const costFollowUp = coilEllipticalFollowUp('那12-120呢？', { previousGoalFamily: 'COIL_COST' });
    assert.equal(costFollowUp.capability, 'calculate_coil_cost');
    assert.deepEqual(selectLocalAssistantTools('那12-120呢？', { tools, env, previousGoalFamily: 'COIL_COST' }).map(tool => tool.function.name), ['calculate_coil_cost']);
    const inventoryFollowUp = coilEllipticalFollowUp('那12-120呢？', { previousGoalFamily: 'COIL_INVENTORY' });
    assert.equal(inventoryFollowUp.capability, 'search_coils');
    assert.deepEqual(selectLocalAssistantTools('那12-120呢？', { tools, env, previousGoalFamily: 'COIL_INVENTORY' }).map(tool => tool.function.name), ['search_coils']);
    // 未知上一轮域：中性正式线圈读取，绝不路由到配方
    assert.equal(coilEllipticalFollowUp('那12-120呢？', {}).capability, 'search_coils');
    assert.deepEqual(selectLocalAssistantTools('那12-120呢？', { tools, env }).map(tool => tool.function.name), ['search_coils']);
});

test('S2R1-C14 线圈之后问显式配方：切换域（不继承线圈目标）', async () => {
    assert.equal(coilEllipticalFollowUp(`那${RECIPE_NAME}呢？`, { previousGoalFamily: 'COIL_COST' }), null);
    const semantics = await extractTaskSemanticsV2({ messageRef: 'm1', text: `那${RECIPE_NAME}现在成本多少？`, provider: null });
    assert.deepEqual(semantics.proposal.goals.map(goal => goal.kind), ['CURRENT_COST']);
    const subjectKey = semantics.proposal.goals[0].subjectKeys[0];
    assert.equal(semantics.proposal.subjects.find(item => item.subjectKey === subjectKey).typeHints.join(','), 'recipe');
});

test('S2R1-C15 简写本身多候选：澄清（不默认第一套）', async () => {
    const fixture = recipeExecutor({
        coils: [
            { id: 1, spec: '12', sheets: 120, schemeCode: 'COIL-0001', schemeName: '正式方案', schemeStatus: 'official', stock: 10, cost: 98.38 },
            { id: 5, spec: '12', sheets: 120, schemeCode: 'COIL-0005', schemeName: '正式方案', schemeStatus: 'testing', stock: 0, cost: 143.82 },
        ],
    });
    const result = await turn(fixture, '12-120成本多少？', 's2r1-c15');
    assert.equal(result.task.state, 'WAITING_INPUT');
    assert.equal(result.task.questions[0].reasonCode, 'COIL_COST_AMBIGUOUS');
});

// ══ D. 缺对象措辞（范围受限）══════════════════════════════════════════
test('S2R1-D16 配方负结果：只覆盖配方目录，不声称全局不存在', async () => {
    const fixture = recipeExecutor({ recipes: [] });
    const result = await turn(fixture, 'V999不存在的配方现在成本多少？', 's2r1-d16');
    assert.match(result.answer.content, /只覆盖配方目录/u);
    assert.doesNotMatch(result.answer.content, /系统中不存在|系统里没有/u);
    assert.deepEqual(result.task.facts.map(fact => fact.evidenceState), ['VERIFIED_NEGATIVE'], '负结果是正式事实，不是金额事实');
    assert.deepEqual([...result.answer.content.matchAll(/[¥￥]\s*\d+/gu)], []);
});

test('S2R1-D17 线圈负结果：显式说明只覆盖正式线圈目录', async () => {
    const fixture = recipeExecutor({ coils: [] });
    const result = await turn(fixture, '12-999成本多少？', 's2r1-d17');
    assert.notEqual(result.task.state, 'SUCCEEDED');
    assert.match(result.answer.content, /正式线圈目录/u);
    assert.match(result.answer.content, /只覆盖正式线圈目录/u);
    assert.deepEqual([...result.answer.content.matchAll(/¥\s*\d+/gu)], []);
});

// ── 夹具 ─────────────────────────────────────────────────────────────
function recipeExecutor({ recipes = [{ id: 12, name: RECIPE_NAME }], coils = null } = {}) {
    const calls = [];
    const coilRows = coils === null ? [{ id: 1, spec: '12', sheets: 120, schemeCode: 'COIL-0001', schemeName: '正式方案', schemeStatus: 'official', stock: 100, cost: 101.07 }] : coils;
    const execute = async (toolName, args = {}) => {
        calls.push({ toolName, args });
        if (toolName === 'get_all_recipes') {
            const keyword = String(args.keyword ?? '').trim().toLowerCase();
            const rows = recipes.filter(row => !keyword || row.name.toLowerCase().includes(keyword));
            return listReceipt(rows, { queryReceipt: { appliedFilters: { keyword }, totalCount: rows.length, returnedCount: rows.length, truncated: false, possiblyTruncated: false, authoritative: true } });
        }
        if (toolName === 'search_coils') {
            const schemeCode = String(args.schemeCode ?? '').trim();
            const shorthand = String(args.spec ?? '').trim();
            const rows = schemeCode ? coilRows.filter(row => row.schemeCode === schemeCode) : coilRows.filter(row => `${row.spec}-${row.sheets}` === shorthand);
            return listReceipt(rows);
        }
        if (toolName === 'compare_recipe_scenarios') return receipt({ scenarios: [{ cost: { currentTotalCost: 269.28, complete: true } }] });
        throw new Error(`UNEXPECTED_TOOL ${toolName}`);
    };
    return { calls, execute };
}
const turn = (fixture, text, conversationId) => runAiTaskControllerV2(
    { ownerKey: 's2r1-owner', requestId: crypto.randomUUID(), conversationId, messages: [{ role: 'user', content: text }] },
    { executeToolCall: fixture.execute, sessionStore: createTaskSessionStoreV2(), provider: null },
);
