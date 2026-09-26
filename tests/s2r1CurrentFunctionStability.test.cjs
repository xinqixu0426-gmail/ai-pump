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

const { extractTaskSemanticsV2 } = require('../api/services/aiTaskSemanticsV2.cjs');
const { runAiTaskControllerV2 } = require('../api/services/aiTaskControllerV2.cjs');
const { createTaskSessionStoreV2 } = require('../api/services/aiTaskSessionV2.cjs');

const evidence = { verified: true, kind: 'formal_api_query' };
const receipt = (data, extra = {}) => ({ success: true, data, ...extra, executionEvidence: evidence });
const listReceipt = (rows, extra = {}) => ({ success: true, count: rows.length, queryReceipt: { appliedFilters: {}, totalCount: rows.length, returnedCount: rows.length, truncated: false, possiblyTruncated: false, authoritative: true }, data: rows, ...extra, executionEvidence: evidence });
const RECIPE_NAME = 'V550大脚板-2寸-经典款';

// ══ A. CURRENT vs SAVED ══════════════════════════════════════════════

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
