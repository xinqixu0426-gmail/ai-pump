'use strict';
/**
 * S2-R3-P2 — NO-OP CONFIGURATION ANSWER NORMALIZATION
 *
 * 真实 Owner canary 暴露的缺陷 1（本文件是它唯一的权威测试）：
 *   问「换成 12-120 线圈」（当前配置本来就是 12-120 钢带小眼）时，系统回答
 *     `临时方案完整成本为 ¥269.12，较当前 增加 ¥0.00。已正式应用的临时配置：coilId=1。`
 *   三处问题：
 *     ① 请求的正式配置 == 当前正式配置，却没有说「配置没有变化」；
 *     ② `coilId=1` 是内部字段名 + 内部 ID，泄漏进用户可见正文；
 *     ③ 「已正式应用的临时配置」自相矛盾（临时 / 已正式应用）。
 *
 * 核心原则（Supervisor 裁定）：
 *   NO_OP 的判据是**请求的 canonical 配置 == 当前 canonical 配置**，
 *   即正式比较回执的配置差异 `changes` 为空 ——
 *   **不是** `costDifference === 0`：不同配置碰巧同价仍然是真变更。
 *
 * 走真实 canary 入口（`runAiTaskControllerV2`），不新造 harness。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { runAiTaskControllerV2 } = require('../api/services/aiTaskControllerV2.cjs');
const { createTaskSessionStoreV2 } = require('../api/services/aiTaskSessionV2.cjs');

const V550 = Object.freeze({ id: 21, name: 'V550大脚板-2寸-经典款' });
/** 正式线圈方案：id=1 就是 V550 当前使用的 12-120 钢带小眼（NO_OP 情形），id=2 是 12-140。 */
const COILS = Object.freeze([
    { id: 1, spec: '12', sheets: 120, material: '钢带', slotType: '小眼', schemeCode: 'COIL-0001', schemeName: '正式方案', schemeStatus: 'official', stock: 100, cost: 98.38 },
    { id: 2, spec: '12', sheets: 140, material: '钢带', slotType: '小眼', schemeCode: 'COIL-0002', schemeName: '正式方案', schemeStatus: 'official', stock: 100, cost: 116.58 },
]);
const evidence = { verified: true, kind: 'formal_api_query' };
const objectReceipt = data => ({ success: true, data, executionEvidence: evidence });
const listReceipt = rows => ({
    success: true, count: rows.length, data: rows,
    queryReceipt: { appliedFilters: {}, totalCount: rows.length, returnedCount: rows.length, truncated: false, possiblyTruncated: false, authoritative: true },
    executionEvidence: evidence,
});

/**
 * 生产形态 executor：`compare_recipe_scenarios` 回执涵盖
 *   - 候选配置与当前配置**相同**（`changes: []`，delta 0，cost 相同）；
 *   - 候选配置**真的不同**（`changes` 非空）；
 *   - 候选配置不同但**成本碰巧相同**（delta 0，`changes` 非空）—— NO_OP 反例。
 */
function configExecutor(options = {}) {
    const calls = [];
    const changes = options.changes || [];
    const baseCost = options.baseCost ?? 273.38;
    const candidateCost = options.candidateCost ?? baseCost;
    const execute = async (toolName, args = {}) => {
        calls.push({ toolName, args });
        if (toolName === 'get_all_recipes') return listReceipt([V550]);
        // 线圈覆盖必须先经正式线圈候选绑定，不能凭用户文本直接指定方案 ID。
        if (toolName === 'search_coils') {
            const shorthand = String(args.spec ?? '').trim();
            const schemeCode = String(args.schemeCode ?? '').trim();
            if (schemeCode) return listReceipt(COILS.filter(row => row.schemeCode === schemeCode));
            return listReceipt(shorthand ? COILS.filter(row => `${row.spec}-${row.sheets}` === shorthand) : COILS);
        }
        if (toolName === 'compare_recipe_scenarios') {
            const scenario = args.scenarios[0];
            return objectReceipt({
                readSetId: crypto.randomUUID(), recipe: { id: args.recipeId, name: V550.name },
                scenarios: [
                    { scenarioKey: 'base', configurationHash: 'base-config', cost: { complete: true, currentTotalCost: baseCost }, appliedOverrides: {}, notApplied: [] },
                    {
                        scenarioKey: scenario.scenarioKey, configurationHash: options.sameConfiguration ? 'base-config' : 'candidate-config',
                        cost: { complete: true, currentTotalCost: candidateCost }, appliedOverrides: scenario.overrides, notApplied: [],
                    },
                ],
                comparisons: [{ baseScenarioKey: 'base', candidateScenarioKey: scenario.scenarioKey, status: 'COMPARABLE', delta: Math.round((candidateCost - baseCost) * 100) / 100, currency: 'CNY' }],
                changes: changes.map(change => ({ scenarioKey: scenario.scenarioKey, ...change })),
            });
        }
        throw new Error(`UNEXPECTED_TOOL ${toolName}`);
    };
    return { calls, execute };
}

const input = (text, conversationId) => ({
    ownerKey: 's2r3p2-owner', requestId: crypto.randomUUID(), conversationId: conversationId || 's2r3p2',
    messages: [{ role: 'user', content: text }],
});
const turn = (fixture, text, conversationId) => runAiTaskControllerV2(
    input(text, conversationId), { executeToolCall: fixture.execute, sessionStore: createTaskSessionStoreV2(), provider: null });

/** 用户可见正文绝不能出现的内部痕迹。 */
const INTERNAL_FIELD_NAMES = /\b(?:coilId|coilSheets|coilSpec|coilMaterial|coilSlotType|cableLength|cableWire|hasFloat|hasCable|packingParts|surfaceTreatmentCost|customBarrelLength|floatWire)\b\s*[=:]/u;
const OLD_CONTRADICTION = /已正式应用的临时配置/u;
const ZERO_DELTA = /[增减]少?\s*¥0\.00/u;

// ══ 核心：真 NO_OP ═══════════════════════════════════════════════════════
test('P2-1 请求配置 == 当前配置 → 明确说「配置没有变化」，不给 Δ0、不泄漏字段名、不说「已正式应用的临时配置」', async () => {
    const fixture = configExecutor({ sameConfiguration: true, changes: [], baseCost: 273.38, candidateCost: 273.38 });
    const result = await turn(fixture, 'V550大脚板-2寸-经典款换成12-120线圈，成本是多少？');
    assert.equal(result.task.state, 'SUCCEEDED', result.answer.content);
    const answer = result.answer.content;
    assert.match(answer, /配置(?:与当前正式配置一致|没有变化)/u, answer);
    assert.match(answer, /273\.38/u, 'NO_OP 仍须给出当前完整成本');
    assert.doesNotMatch(answer, ZERO_DELTA, answer);
    assert.doesNotMatch(answer, INTERNAL_FIELD_NAMES, answer);
    assert.doesNotMatch(answer, OLD_CONTRADICTION, answer);
});

test('P2-2 NO_OP 判据来自正式配置差异事实，而不是成本差额', async () => {
    // 两个场景的成本差额**都是 0**，唯一区别是正式配置差异是否为空：
    //   A. changes 为空（请求配置 == 当前配置）→ 必须 NO_OP；
    //   B. changes 非空但 delta 仍为 0（不同配置碰巧同价）→ 必须**不是** NO_OP。
    // 这条对照正是「不得用 costDifference === 0 判 NO_OP」的直接证据。
    const noOpFixture = configExecutor({ sameConfiguration: true, changes: [], baseCost: 273.38, candidateCost: 273.38 });
    const noOp = await turn(noOpFixture, 'V550大脚板-2寸-经典款换成12-120线圈，成本是多少？', 's2r3p2-noop-fact');
    assert.match(noOp.answer.content, /配置(?:与当前正式配置一致|没有变化)/u, noOp.answer.content);
    // 配置差异事实必须由正式回执挂载，且必须是完整投影。
    const changesFact = noOp.task.facts.find(fact => fact.key.predicate === 'scenario.configuration_changes');
    assert.ok(changesFact, '正式回执提供 changes 时必须挂载配置差异事实');
    assert.equal(changesFact.complete, true);
    assert.equal(changesFact.evidenceState, 'VERIFIED_POSITIVE');
    assert.equal(changesFact.key.scenarioKey, 'candidate_1');

    const samePriceFixture = configExecutor({
        changes: [{ field: 'cableLength', from: 8, to: 5 }], baseCost: 273.38, candidateCost: 273.38,
    });
    const samePrice = await turn(samePriceFixture, 'V550大脚板-2寸-经典款电缆改成5米，其他不变，看看成本', 's2r3p2-same-price-fact');
    assert.doesNotMatch(samePrice.answer.content, /配置(?:与当前正式配置一致|没有变化)/u, samePrice.answer.content);
});

// ══ 反例：不同配置即便同价也是真变更 ═════════════════════════════════════
test('P2-3 不同配置但碰巧同价 → 仍然报告为真变更（绝不用 delta===0 判 NO_OP）', async () => {
    const fixture = configExecutor({
        changes: [{ field: 'cableLength', from: 8, to: 5 }],
        baseCost: 273.38, candidateCost: 273.38,
    });
    const result = await turn(fixture, 'V550大脚板-2寸-经典款电缆改成5米，其他不变，看看成本', 's2r3p2-same-price');
    assert.equal(result.task.state, 'SUCCEEDED', result.answer.content);
    const answer = result.answer.content;
    assert.doesNotMatch(answer, /配置(?:与当前正式配置一致|没有变化)/u, answer);
    assert.match(answer, /电缆长度/u, answer);
    assert.match(answer, /8\s*米/u, answer);
    assert.match(answer, /5\s*米/u, answer);
    assert.doesNotMatch(answer, INTERNAL_FIELD_NAMES, answer);
});

// ══ 真变更：字段名一律翻译成业务语言 ═════════════════════════════════════
test('P2-4 真变更只出现业务语言，内部字段名与内部 ID 一律不进正文', async () => {
    const fixture = configExecutor({
        changes: [{ field: 'coilId', from: 1, to: 2 }, { field: 'coilSheets', from: 120, to: 140 }],
        baseCost: 273.38, candidateCost: 291.58,
    });
    const result = await turn(fixture, 'V550大脚板-2寸-经典款换成12-140线圈，成本是多少？', 's2r3p2-real-change');
    assert.equal(result.task.state, 'SUCCEEDED', result.answer.content);
    const answer = result.answer.content;
    assert.match(answer, /更换线圈方案/u, answer);
    assert.match(answer, /线圈片数/u, answer);
    assert.match(answer, /120\s*片/u, answer);
    assert.match(answer, /140\s*片/u, answer);
    assert.match(answer, /291\.58/u, answer);
    assert.doesNotMatch(answer, INTERNAL_FIELD_NAMES, answer);
    assert.doesNotMatch(answer, OLD_CONTRADICTION, answer);
});

test('P2-5 布尔类配置变更使用自然业务说法（带/不带），不输出 hasFloat=true', async () => {
    const fixture = configExecutor({ changes: [{ field: 'hasFloat', from: true, to: false }] });
    const result = await turn(fixture, 'V550大脚板-2寸-经典款不要浮球，看看成本', 's2r3p2-bool');
    const answer = result.answer.content;
    assert.match(answer, /不带浮球/u, answer);
    assert.doesNotMatch(answer, INTERNAL_FIELD_NAMES, answer);
    assert.doesNotMatch(answer, /true|false/u, answer);
});

test('P2-6 未知配置字段退化为业务语言，绝不输出字段名本身', async () => {
    const { renderAppliedOverride, renderConfigurationChange } = require('../api/services/aiTaskAnswerV2.cjs');
    const rendered = renderAppliedOverride('someFutureInternalField', 7);
    assert.doesNotMatch(rendered, /someFutureInternalField/u, rendered);
    assert.match(rendered, /配置项调整/u, rendered);
    const changed = renderConfigurationChange({ field: 'someFutureInternalField', from: 1, to: 2 });
    assert.doesNotMatch(changed, /someFutureInternalField/u, changed);
    // 缺失值必须是「未指定」，不能伪装成 0 或空串。
    assert.match(renderConfigurationChange({ field: 'customBarrelLength', from: null, to: 180 }), /未指定/u);
    // 线圈方案变更不暴露内部 ID。
    assert.doesNotMatch(renderConfigurationChange({ field: 'coilId', from: 1, to: 2 }), /\b1\b|\b2\b/u);
});

// ══ 受限分支：没有正式配置差异事实时不得声称「没有变化」 ═════════════════
test('P2-7 回执未提供 changes 时：不声称「没有变化」，也不泄漏字段名（缺失 ≠ 无差异）', async () => {
    // 夹具不返回 changes 字段 → 配置差异事实缺席。
    const fixture = configExecutor();
    delete fixture.changes;
    const execute = async (toolName, args = {}) => {
        if (toolName === 'compare_recipe_scenarios') {
            const scenario = args.scenarios[0];
            return objectReceipt({
                readSetId: crypto.randomUUID(), recipe: { id: args.recipeId, name: V550.name },
                scenarios: [
                    { scenarioKey: 'base', configurationHash: 'base-config', cost: { complete: true, currentTotalCost: 273.38 }, appliedOverrides: {}, notApplied: [] },
                    { scenarioKey: scenario.scenarioKey, configurationHash: 'candidate-config', cost: { complete: true, currentTotalCost: 281.38 }, appliedOverrides: scenario.overrides, notApplied: [] },
                ],
                comparisons: [{ baseScenarioKey: 'base', candidateScenarioKey: scenario.scenarioKey, status: 'COMPARABLE', delta: 8, currency: 'CNY' }],
                // 注意：没有 changes 字段
            });
        }
        if (toolName === 'get_all_recipes') return listReceipt([V550]);
        if (toolName === 'search_coils') {
            const shorthand = String(args.spec ?? '').trim();
            const schemeCode = String(args.schemeCode ?? '').trim();
            if (schemeCode) return listReceipt(COILS.filter(row => row.schemeCode === schemeCode));
            return listReceipt(shorthand ? COILS.filter(row => `${row.spec}-${row.sheets}` === shorthand) : COILS);
        }
        throw new Error(`UNEXPECTED_TOOL ${toolName}`);
    };
    const result = await runAiTaskControllerV2(
        input('V550大脚板-2寸-经典款换成12-140线圈，成本是多少？', 's2r3p2-no-changes'),
        { executeToolCall: execute, sessionStore: createTaskSessionStoreV2(), provider: null });
    assert.equal(result.task.state, 'SUCCEEDED', result.answer.content);
    const answer = result.answer.content;
    const fact = result.task.facts.find(item => item.key.predicate === 'scenario.configuration_changes');
    assert.equal(fact, undefined, '回执没有 changes 时该事实必须缺席，不得伪造空数组');
    assert.doesNotMatch(answer, /配置(?:与当前正式配置一致|没有变化)/u, answer);
    assert.doesNotMatch(answer, INTERNAL_FIELD_NAMES, answer);
    assert.match(answer, /281\.38/u, answer);
});

// ══ 既有 Owner 场景不回归 ════════════════════════════════════════════════
test('P2-8 纯当前成本问法不受影响（不引入配置变更语义）', async () => {
    const fixture = configExecutor();
    const result = await turn(fixture, 'V550大脚板-2寸-经典款的成本是多少？', 's2r3p2-cost-only');
    assert.equal(result.task.state, 'SUCCEEDED', result.answer.content);
    // 只有当前成本目标，没有配置比较目标。
    assert.deepEqual(result.task.goals.map(goal => goal.kind), ['CURRENT_COST']);
    // 也没有配置差异事实（那属于候选配置比较，不属于当前成本查询）。
    assert.equal(result.task.facts.some(fact => fact.key.predicate === 'scenario.configuration_changes'), false);
    assert.doesNotMatch(result.answer.content, /配置(?:与当前正式配置一致|没有变化)|配置变化/u, result.answer.content);
    assert.doesNotMatch(result.answer.content, INTERNAL_FIELD_NAMES, result.answer.content);
});
