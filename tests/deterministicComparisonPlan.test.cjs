'use strict';
/**
 * E1-B — Deterministic Comparison Planning
 *
 * 覆盖用户点名的测试 7–11：
 *   7  五种成本比较问法 → 同一个 formal plan
 *   8  comparison capability 必然执行
 *   9  model 不调用工具也不能绕过 software plan
 *   10 配置差异问题不得误调用 cost comparison
 *   11 库存比较不得误调用 cost comparison
 *
 * 机制：语义层归一成 COST_COMPARISON（questionSemantics.parseComparisonSubjects）→
 * 正式需求（frameBuilder/factCapabilityRegistry）→ 软件计划（evidencePlanner）→
 * 运行时注入（aiAssistantRuntime.deterministicComparisonCalls）。没有平行 planner。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { classifyQuestion, parseComparisonSubjects } = require('../api/business-semantics/questionSemantics.cjs');
const { buildBusinessEvidencePlan } = require('../api/business-semantics/evidencePlanner.cjs');
const { requiredFactsFor } = require('../api/business-semantics/frameBuilder.cjs');
const { FactCapabilityRegistry } = require('../api/business-semantics/factCapabilityRegistry.cjs');
const { runAiAssistant } = require('../api/services/aiAssistantRuntime.cjs');

const A = 'PHASED-浮球-有';
const B = 'PHASED-浮球-无';
const COMPARISON_FAMILIES = [
    `${A} 和 ${B} 差多少钱？`,
    `${A}比${B}贵多少？`,
    `比较一下 ${A} 和 ${B} 成本。`,
    `${A}和${B}哪个成本高，高多少？`,
    `${A} 与 ${B} 的成本差额是多少？`,
];
const planOf = userText => buildBusinessEvidencePlan({ userText, toolResults: [] });

test('E1-B-7 五种成本比较问法归一成同一个 formal plan', () => {
    const plans = COMPARISON_FAMILIES.map(question => ({ question, plan: planOf(question) }));
    for (const { question, plan } of plans) {
        assert.ok(plan, `必须产出正式证据计划：${question}`);
        assert.equal(plan.questionKind, 'COST_COMPARISON', question);
        const calls = plan.execution.calls.map(item => ({ capability: item.capability, arguments: item.arguments }));
        assert.deepEqual(calls, [{ capability: 'compare_recipes', arguments: { recipe1: A, recipe2: B } }],
            `必须只规划一次正式比较调用：${question}`);
    }
    // 计划形状完全一致（同一目标、同一主体、同一能力）。
    const signatures = new Set(plans.map(({ plan }) => JSON.stringify(plan.execution.calls.map(item => [item.capability, item.arguments]))));
    assert.equal(signatures.size, 1, `五种问法必须共享同一个计划，实际 ${signatures.size} 个`);
    // 需求与能力登记来自正式契约，不是临时 if。
    assert.deepEqual(requiredFactsFor(classifyQuestion(COMPARISON_FAMILIES[0])), ['RECIPE_COST_COMPARISON']);
    assert.equal(FactCapabilityRegistry.RECIPE_COST_COMPARISON.capability, 'compare_recipes');
});

test('E1-B-7b 请求正文没有金额口径词时不得规划比较（A08 的规格差异问法）', () => {
    const subjects = parseComparisonSubjects('这两项产品规格有什么不同？');
    assert.deepEqual(subjects, []);
    assert.equal(planOf('这两项产品规格有什么不同？'), null);
});

test('E1-B-7c 主体不可解析时软件不猜主体（只有「这两个」）', () => {
    const question = '这两个差多少钱？';
    assert.deepEqual(parseComparisonSubjects(question), []);
    const plan = planOf(question);
    assert.equal(plan, null, '主体不明确时必须留给澄清，而不是猜两个对象去比较');
});

test('E1-B-10 配置差异问题不得误调用 cost comparison', () => {
    for (const question of ['这两项产品规格有什么不同？', `${A} 和 ${B} 有什么区别？`, `${A} 的配置和 ${B} 差在哪？`]) {
        const plan = planOf(question);
        const capabilities = (plan?.execution?.calls || []).map(item => item.capability);
        assert.equal(capabilities.includes('compare_recipes'), false, `不得规划成本比较：${question}`);
    }
});

test('E1-B-11 库存比较不得误调用 cost comparison', () => {
    const question = '12-200和12-180库存差多少？';
    const plan = planOf(question);
    const capabilities = (plan?.execution?.calls || []).map(item => item.capability);
    assert.equal(capabilities.includes('compare_recipes'), false, '库存比较不得路由到成本比较');
    assert.equal(classifyQuestion(question).kind, 'INVENTORY_QUERY');
    // 线圈简写的成本比较由既有线圈通道负责，不得被这里抢走。
    assert.deepEqual(parseComparisonSubjects('12-200和12-180成本差多少？'), []);
});

test('E1-B-8/9 模型完全不提议工具调用，正式比较仍然必须执行并把差额交给用户', async () => {
    const executed = [];
    let providerCalls = 0;
    const fixture = {
        loadMemory: async () => ({ items: [] }),
        loadCorrections: () => '',
        // 模型每一轮都只回一句自然语言，**从不**提议任何 tool_calls。
        fetchAiProvider: async () => {
            providerCalls += 1;
            return { json: async () => ({ choices: [{ message: { content: '两个方案的正式差额见下方明细。' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) };
        },
        executeToolCall: async (name, args) => {
            executed.push({ name, args });
            return { success: true, data: {}, executionEvidence: { verified: true, kind: 'formal_api_query' },
                recipe1: { name: A, cost: 271.98 }, recipe2: { name: B, cost: 263.98 }, costDiff: '8.00' };
        },
    };
    const result = await runAiAssistant({
        messages: [{ role: 'user', content: `${A} 和 ${B} 差多少钱？` }],
        confirmationSubject: 'e1b-owner', conversationId: `e1b-${crypto.randomUUID()}`, env: { AI_PROVIDER: 'local' },
    }, fixture);
    assert.equal(providerCalls, 1, '测试前提：模型只被调用一次且没有提议任何工具');
    assert.deepEqual(executed.map(item => ({ name: item.name, args: item.args })),
        [{ name: 'compare_recipes', args: { recipe1: A, recipe2: B } }],
        '正式比较必须由软件计划执行，不能依赖模型决定');
    // 差额必须由正式回执进入用户可见回答（不再出现 Phase D 的「只剩一张表」）。
    assert.match(result.finalContent, /271\.98/);
    assert.match(result.finalContent, /263\.98/);
    assert.match(result.finalContent, /8(?:\.00)?/, '正式差额必须交付');
    assert.equal(result.telemetry.outcome, 'completed');
});

test('E1-B-10b 规格差异问法在真实链路里不会触发正式成本比较', async () => {
    const executed = [];
    const fixture = {
        loadMemory: async () => ({ items: [] }),
        loadCorrections: () => '',
        fetchAiProvider: async () => ({ json: async () => ({ choices: [{ message: { content: '两项规格的差异是浮球。' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) }),
        executeToolCall: async (name, args) => { executed.push({ name, args }); return { success: true, data: {}, executionEvidence: { verified: true } }; },
    };
    await runAiAssistant({
        messages: [{ role: 'user', content: `${A} 和 ${B} 有什么配置区别？` }],
        confirmationSubject: 'e1b-owner', conversationId: `e1b-neg-${crypto.randomUUID()}`, env: { AI_PROVIDER: 'local' },
    }, fixture);
    assert.equal(executed.some(item => item.name === 'compare_recipes'), false,
        '只问配置差异时不得由软件规划成本比较');
});
