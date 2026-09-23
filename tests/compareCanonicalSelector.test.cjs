'use strict';
/**
 * S1-A — compare_recipes canonical selector（身份不得二次退回自然语言）
 *
 * 契约：一旦主体已经 canonical resolved（Native Task 已按正式目录回执绑定主键），
 * 后续比较能力必须按**主键**比较；名称只在没有 canonical ID 时作为回退，
 * 且名称多匹配时必须正式失败。不得 fuzzy select / 取第一条 / 名称相等捷径 / 数组下标选择。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { buildCostDifference } = require('../api/services/costDifference.cjs');
const { runAiTaskControllerV2 } = require('../api/services/aiTaskControllerV2.cjs');
const { createTaskSessionStoreV2 } = require('../api/services/aiTaskSessionV2.cjs');

const evidence = { verified: true, kind: 'formal_api_query' };
const listReceipt = rows => ({ success: true, count: rows.length, queryReceipt: { appliedFilters: {}, totalCount: rows.length, returnedCount: rows.length, truncated: false, possiblyTruncated: false, authoritative: true }, data: rows, executionEvidence: evidence });
const objectReceipt = data => ({ success: true, data, executionEvidence: evidence });

// 两个配方**同名不同主键**（真实库里 PHASED-同名方案 就是这种情况）。
const RECIPES = Object.freeze([
    { id: 13, name: 'v550-tokoy', spec: '12-120' },
    { id: 15, name: 'PHASED-同名方案', spec: '12-120' },
    { id: 16, name: 'PHASED-同名方案', spec: '12-140' },
    { id: 2, name: 'v750-tokoy', spec: '12-140' },
]);
const COST = Object.freeze({ 13: 271.98, 15: 100, 16: 110, 2: 286.51 });
const costOf = id => ({ totalCost: COST[id], partsCost: COST[id] - 21, laborCost: 21, itemCount: 20, details: [] });

function serviceComparison(selector1, selector2) {
    const resolve = selector => {
        const text = String(selector).trim();
        if (/^\d+$/u.test(text)) return RECIPES.filter(row => String(row.id) === text);
        const exact = RECIPES.filter(row => row.name === text);
        return exact.length ? exact : RECIPES.filter(row => row.name.includes(text));
    };
    const left = resolve(selector1); const right = resolve(selector2);
    if (left.length !== 1 || right.length !== 1) {
        return { failed: true, code: 'RECIPE_SELECTOR_AMBIGUOUS' };
    }
    const result = buildCostDifference({ recipe1: selector1, recipe2: selector2 }, {
        recipes: RECIPES, leftCost: costOf(left[0].id), rightCost: costOf(right[0].id),
    });
    return { failed: false, leftId: left[0].id, rightId: right[0].id, totalDiff: result.totalDiff, direction: result.direction };
}

function fixture(options = {}) {
    const calls = [];
    const execute = async (toolName, args = {}) => {
        calls.push({ toolName, args });
        if (toolName === 'get_all_recipes') {
            const keyword = String(args.keyword ?? '').trim();
            return listReceipt(RECIPES.filter(row => !keyword || row.name.includes(keyword)));
        }
        if (toolName === 'compare_recipes') {
            const resolve = selector => {
                const text = String(selector ?? '').trim();
                if (/^\d+$/u.test(text)) return RECIPES.filter(row => String(row.id) === text);
                const exact = RECIPES.filter(row => row.name === text);
                return exact.length ? exact : RECIPES.filter(row => row.name.includes(text));
            };
            const left = resolve(args.recipe1); const right = resolve(args.recipe2);
            if (left.length !== 1 || right.length !== 1) {
                return { success: false, code: 'RECIPE_SELECTOR_AMBIGUOUS', error: '匹配到多条记录，请使用配方ID或完整名称', executionEvidence: { verified: true, kind: 'formal_api_query_failure' } };
            }
            const nameOverride = options.nameOverride || {};
            return objectReceipt({
                recipe1: { name: nameOverride.recipe1 ?? left[0].name, cost: COST[left[0].id] },
                recipe2: { name: nameOverride.recipe2 ?? right[0].name, cost: COST[right[0].id] },
                costDiff: Number((COST[right[0].id] - COST[left[0].id]).toFixed(2)).toFixed(2), costBasis: 'currentFullCost',
            });
        }
        throw new Error(`UNEXPECTED_TOOL ${toolName}`);
    };
    return { calls, execute };
}

const input = (text, conversationId) => ({ ownerKey: 's1-owner', requestId: crypto.randomUUID(), conversationId, messages: [{ role: 'user', content: text }] });
const turn = (f, sessions, text, conversationId) => runAiTaskControllerV2(input(text, conversationId), { executeToolCall: f.execute, sessionStore: sessions, provider: null });
const compareCall = f => f.calls.filter(call => call.toolName === 'compare_recipes').at(-1);
const moneyIn = text => [...String(text).matchAll(/[¥￥]\s*\d+(?:\.\d+)?|\d+\.\d{2}/gu)].map(match => match[0].replace(/[¥￥\s]/gu, ''));

// ── 1. unique names + IDs → comparison PASS ───────────────────────────
test('S1-A1 唯一名称 + canonical ID：比较成功，且实参用主键', async () => {
    const f = fixture();
    const result = await turn(f, createTaskSessionStoreV2(), 'v550-tokoy和v750-tokoy成本差多少？', 's1a-1');
    assert.equal(result.task.state, 'SUCCEEDED');
    assert.deepEqual([compareCall(f).args.recipe1, compareCall(f).args.recipe2], ['13', '2']);
    assert.match(result.answer.content, /高 ¥14\.53/u);
});

// ── 2. same name / different IDs → canonical IDs compare correctly ────
test('S1-A2 同名不同主键：按 canonical ID 比较正确（不再整体失败）', async () => {
    const f = fixture();
    const sessions = createTaskSessionStoreV2();
    const first = await turn(f, sessions, 'v550-tokoy和PHASED-同名方案成本差多少？', 's1a-2');
    assert.equal(first.task.state, 'WAITING_INPUT');
    const selected = await turn(f, sessions, '第二个', 's1a-2');
    assert.equal(selected.task.state, 'SUCCEEDED');
    assert.deepEqual([compareCall(f).args.recipe1, compareCall(f).args.recipe2], ['13', '16'], '第二个候选 = id 16');
    assert.match(selected.answer.content, /PHASED-同名方案当前完整成本为 ¥110\.00/u);
    assert.deepEqual(moneyIn(selected.answer.content).sort((a, b) => Number(a) - Number(b)), ['110.00', '161.98', '271.98'], '金额只能来自正式回执');
    assert.match(selected.answer.content, /低 ¥161\.98/u, '方向按契约（后减前为负 ⇒ 后者更低）');
});

// ── 3. only name + unique match → fallback PASS ───────────────────────
test('S1-A3 只有名称且唯一匹配：名称回退仍然可用（能力层）', () => {
    const byName = serviceComparison('PHASED-同名方案', 'v750-tokoy');
    assert.equal(byName.failed, true, '同名多条即使名称回退也必须失败');
    const uniqueByName = buildCostDifference({ recipe1: 'v550-tokoy', recipe2: 'v750-tokoy' }, {
        recipes: RECIPES, leftCost: costOf(13), rightCost: costOf(2),
    });
    assert.equal(uniqueByName.left.id, 13);
    assert.equal(uniqueByName.right.id, 2);
    assert.equal(uniqueByName.totalDiff, 14.53);
});

// ── 4. only name + ambiguous → fail closed ────────────────────────────
test('S1-A4 名称命中多条：正式失败（不取第一条、不做模糊选择）', () => {
    const ambiguous = serviceComparison('PHASED-同名方案', 'v750-tokoy');
    assert.deepEqual(ambiguous, { failed: true, code: 'RECIPE_SELECTOR_AMBIGUOUS' });
    assert.throws(() => buildCostDifference({ recipe1: 'PHASED-同名方案', recipe2: 'v750-tokoy' }, { recipes: RECIPES, leftCost: costOf(15), rightCost: costOf(2) }), error => error.code === 'RECIPE_SELECTOR_AMBIGUOUS');
});

// ── 5. ID/name disagree → ID authority wins ───────────────────────────
test('S1-A5 ID 与名称冲突时以主键为准（同一实参只认主键语义）', () => {
    const byId = buildCostDifference({ recipe1: '13', recipe2: '2' }, { recipes: RECIPES, leftCost: costOf(13), rightCost: costOf(2) });
    assert.equal(byId.left.name, 'v550-tokoy');
    assert.equal(byId.left.id, 13);
    // 名称与主键不一致时（例如用户说的是另一个同名记录的写法），主键解析不会退化为名称匹配
    const conflicting = serviceComparison('13', 'v750-tokoy');
    assert.equal(conflicting.leftId, 13);
    assert.equal(conflicting.totalDiff, 14.53);
});

// ── 6. A canonical / B canonical → neither re-resolved by fuzzy name ──
test('S1-A6 两主体都已 canonical：实参不含名称，且回执身份不符时 fail-closed', async () => {
    const f = fixture();
    const result = await turn(f, createTaskSessionStoreV2(), 'v550-tokoy和v750-tokoy成本差多少？', 's1a-6');
    const call = compareCall(f);
    for (const value of [call.args.recipe1, call.args.recipe2]) {
        assert.match(String(value), /^\d+$/u, '选择器必须是 canonical 主键');
        assert.equal(RECIPES.some(row => row.name === value), false, '不得发送名称');
    }
    assert.equal(result.task.state, 'SUCCEEDED');

    // 回执身份与已绑定身份不一致（能力返回了别的配方）→ 不给结论
    const mismatched = fixture({ nameOverride: { recipe1: '别的配方' } });
    const failed = await turn(mismatched, createTaskSessionStoreV2(), 'v550-tokoy和v750-tokoy成本差多少？', 's1a-6b');
    assert.notEqual(failed.task.state, 'SUCCEEDED');
    assert.deepEqual(moneyIn(failed.answer.content), []);
});
