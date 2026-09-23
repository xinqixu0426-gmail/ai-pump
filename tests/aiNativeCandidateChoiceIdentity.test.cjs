'use strict';
/**
 * NATIVE 候选可选择身份（PHASE D 真实验收暴露的 defect）。
 *
 * REPRODUCE：真实线圈库里大量方案的 `scheme_name` 都是「正式方案」，而
 * `projectCanonicalRecord` 用 `schemeName` 作 `displayName`。于是 Native 澄清
 * 生成的 choices 出现两个**完全一样**的标签，工作台下拉框显示两行「正式方案」，
 * 用户无法做业务选择（真实验收：12-220 匹配 COIL-0006 / COIL-0010）。
 *
 * ROOT CAUSE：clarification 的候选标签直接用 entity.displayName，没有「候选选择身份」
 * 契约 —— displayName 是业务显示名，不保证唯一。
 *
 * 契约（与 A04/D09 同源）：候选选择必须有**唯一、可见**的选择身份；
 * 内部代号可以被隐藏，但不能让候选变得不可区分。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { runAiTaskControllerV2 } = require('../api/services/aiTaskControllerV2.cjs');
const { createTaskSessionStoreV2 } = require('../api/services/aiTaskSessionV2.cjs');

function verified(data, extra = {}) {
    return { success: true, data, ...extra, executionEvidence: { verified: true, calls: [{ method: 'GET', path: '/api/formal' }] } };
}
const queryReceipt = { authoritative: true, truncated: false, possiblyTruncated: false };

/** 同名不同 canonical identity 的线圈：displayName 相同，schemeCode 不同。 */
function sameNamedCoilExecutor() {
    const calls = [];
    return {
        calls,
        execute: async (toolName, args) => {
            calls.push({ toolName, args });
            if (toolName === 'get_all_recipes') return verified([{ id: 301, name: 'V550' }], { queryReceipt });
            if (toolName === 'search_coils') {
                return verified([
                    { id: 41, spec: '12', sheets: 220, material: '钢带', slotType: '小眼', schemeName: '正式方案', schemeCode: 'COIL-0041' },
                    { id: 42, spec: '12', sheets: 220, material: '冷轧', slotType: '国标眼', schemeName: '正式方案', schemeCode: 'COIL-0042' },
                ], { queryReceipt });
            }
            if (toolName === 'preview_recipe_cost') return verified({ recipeId: args.recipeId, recipeName: 'V550', currentTotalCost: 108.5, pricingComplete: true });
            if (toolName === 'compare_recipe_scenarios') {
                const scenario = args.scenarios[0];
                const base = { scenarioKey: 'base', configurationHash: 'base-configuration', cost: { complete: true, currentTotalCost: 108.5 }, appliedOverrides: {}, notApplied: [] };
                const candidate = { scenarioKey: scenario.scenarioKey, configurationHash: 'candidate-configuration', cost: { complete: true, currentTotalCost: 116.5 }, appliedOverrides: scenario.overrides, notApplied: [] };
                return verified({ readSetId: crypto.randomUUID(), recipe: { id: 301, name: 'V550' }, scenarios: [base, candidate], comparisons: [{ baseScenarioKey: 'base', candidateScenarioKey: scenario.scenarioKey, status: 'COMPARABLE', delta: 8, currency: 'CNY' }] });
            }
            throw new Error(`unexpected tool ${toolName}`);
        },
    };
}
const input = (text, conversationId) => ({
    ownerKey: 'server-owner', requestId: crypto.randomUUID(), conversationId,
    messages: [{ role: 'user', content: text }],
});

test('NATIVE 候选标签：同名候选必须仍然可区分（否则用户无法做业务选择）', async () => {
    const fixture = sameNamedCoilExecutor();
    const result = await runAiTaskControllerV2(
        input('v550换成12-220，和现在成本比一下，其他不变，先不要保存', 'same-name-coil'),
        { executeToolCall: fixture.execute, sessionStore: createTaskSessionStoreV2() },
    );
    assert.equal(result.task.state, 'WAITING_INPUT');
    assert.equal(result.task.questions[0].reasonCode, 'COIL_AMBIGUOUS');
    const choices = result.task.questions[0].choices;
    assert.equal(choices.length, 2);
    // 真实缺陷：两个选项的 label 完全相同 → 下拉框里无法选择。
    assert.equal(new Set(choices.map(choice => choice.label)).size, choices.length,
        `同名候选的可见标签必须唯一，实际：${JSON.stringify(choices.map(choice => choice.label))}`);
    // canonical identity 与候选集哈希不受展示标签影响。
    assert.deepEqual(choices.map(choice => choice.entity.entityId), ['41', '42']);
    assert.equal(new Set(choices.map(choice => choice.entity.displayName)).size, 1, '前提：两者 displayName 确实相同');
});

test('NATIVE 候选标签：显示名已经唯一时不得改写（不制造无谓的展示变化）', async () => {
    const fixture = sameNamedCoilExecutor();
    fixture.execute = async (toolName, args) => {
        if (toolName === 'search_coils') {
            return verified([
                { id: 41, spec: '12', sheets: 220, material: '钢带', slotType: '小眼', schemeName: '12-220 钢带', schemeCode: 'COIL-0041' },
                { id: 42, spec: '12', sheets: 220, material: '冷轧', slotType: '国标眼', schemeName: '12-220 冷轧', schemeCode: 'COIL-0042' },
            ], { queryReceipt });
        }
        return sameNamedCoilExecutor().execute(toolName, args);
    };
    const result = await runAiTaskControllerV2(
        input('v550换成12-220，和现在成本比一下，其他不变，先不要保存', 'unique-coil'),
        { executeToolCall: fixture.execute, sessionStore: createTaskSessionStoreV2() },
    );
    const choices = result.task.questions[0].choices;
    assert.deepEqual(choices.map(choice => choice.label), ['12-220 钢带', '12-220 冷轧']);
});

test('NATIVE 候选标签：唯一可区分之后，用户仍可用序号完成选择（回归保护）', async () => {
    const fixture = sameNamedCoilExecutor();
    const sessions = createTaskSessionStoreV2();
    const first = await runAiTaskControllerV2(
        input('v550换成12-220，和现在成本比一下，其他不变，先不要保存', 'same-name-coil-2'),
        { executeToolCall: fixture.execute, sessionStore: sessions },
    );
    assert.equal(first.task.state, 'WAITING_INPUT');
    const second = await runAiTaskControllerV2(
        input('第二个', 'same-name-coil-2'),
        { executeToolCall: fixture.execute, sessionStore: sessions },
    );
    assert.equal(second.task.taskId, first.task.taskId, '同一澄清会话必须留在同一个 task');
    assert.equal(second.task.planRevision, 2);
    assert.equal(second.task.state, 'SUCCEEDED');
    // 用户选的是**第二个候选**（entityId 42），与它的可见标签无关。
    const compare = fixture.calls.filter(call => call.toolName === 'compare_recipe_scenarios').at(-1);
    assert.equal(compare.args.scenarios[0].overrides.coilId, 42);
});
