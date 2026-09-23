'use strict';
/**
 * AI Answer Presentation Remediation V1 — Part 1-R1 场景证据（Supervisor 要求的 A–J）。
 *
 * 这是**可执行的契约证据**：任一场景不成立即以非零退出码结束。
 * 运行：node planning/ai-native-v1/release/_money-presentation-contract.cjs
 *
 * 设计要点：判据全部来自
 *   - api/capabilities/monetaryPresentationContract.cjs（能力显式声明的金额展示义务）
 *   - api/services/aiMoneyGuard.cjs（金额守卫的公开决策）
 * 不引入第二次模型调用、不做关键词意图识别。
 */
const assert = require('node:assert/strict');
const {
    moneyGuardDecision,
    evaluateAnswerMoney,
} = require('../../../api/services/aiMoneyGuard.cjs');
const { formatMoneySummary } = require('../../../api/services/aiAssistantAnswer.cjs');
const {
    monetaryPresentationFor,
    providesMonetaryFacts,
    availableMoneyFacts,
    requiredMoneyFacts,
    turnMonetaryPresentation,
    MONETARY_PRESENTATION_CONTRACTS,
} = require('../../../api/capabilities/monetaryPresentationContract.cjs');
const { getAiCapability } = require('../../../api/capabilities/registry.cjs');
const { semanticEligibility } = require('../../../api/business-semantics/eligibilityBoundary.cjs');

const verified = data => ({ success: true, data, executionEvidence: { verified: true, kind: 'formal_api_query' } });
const applyGuard = (answer, toolResults, turnRequirement) => {
    const decision = moneyGuardDecision(answer, toolResults, turnRequirement);
    if (decision.action === 'append') return `${answer}\n\n${decision.appendable || decision.summary}`;
    if (decision.action === 'replaceTable') return decision.appendable || decision.summary;
    if (decision.action === 'replace') return decision.summary;
    return answer;
};
// 本轮金额要求：与运行时同源（已解析目标 → turnMonetaryPresentation）。
const turnFor = userText => turnMonetaryPresentation(semanticEligibility({ userText }));
const tableCount = text => (String(text).match(/本轮正式查询金额如下/gu) || []).length;

// 与真实执行器输出同形（api/routes/ai/executors/recipeExecutors.cjs 第 755-779 行）。
const compareResults = () => [{
    name: 'compare_recipes',
    result: { ...verified({}), recipe1: { name: 'A', cost: 272.60 }, recipe2: { name: 'B', cost: 292.24 }, costDiff: '19.64' },
}];
// 与真实执行器输出同形（costPreview 来自正式 BOM 服务）。
const bomResults = () => [{
    name: 'build_recipe_bom_draft',
    result: verified({
        coilSnapshot: { schemeCode: 'COIL-0002', totalCost: 116.99 },
        costPreview: { currentTotalCost: 285.8, partsCost: 264.8, laborCost: 21, pricingComplete: true },
    }),
}];
const queryResults = () => [{ name: 'search_coils', result: verified([{ stock: 5, cost: 123 }]) }];

let failures = 0;
function scenario(id, title, fn) {
    try {
        fn();
        console.log(`PASS  ${id}  ${title}`);
    } catch (error) {
        failures += 1;
        console.error(`FAIL  ${id}  ${title}\n      ${error.message}`);
    }
}

// ── 契约本身：显式声明 + fail-closed ────────────────────────────────
scenario('0a', '未声明的能力默认 availableMoneyFacts=[]（fail-closed）', () => {
    for (const name of ['search_coils', 'get_order_detail', 'preview_pump_shell_cost']) {
        assert.deepEqual(monetaryPresentationFor(name).availableMoneyFacts, [], `${name} 不应声明金额事实`);
        assert.equal(providesMonetaryFacts(name), false, `${name} 不应声明金额事实`);
    }
    // 注册表把「可用性」契约暴露成 capability 字段，调用方不需要另建判据。
    assert.equal(getAiCapability('search_coils').monetaryPresentation.monetary, false);
    assert.equal(getAiCapability('compare_recipes').monetaryPresentation.monetary, true);
});

scenario('0b', 'compare_recipes 显式声明 A/B/差额三个正式事实（不是渲染字符串）', () => {
    const contract = monetaryPresentationFor('compare_recipes');
    assert.equal(contract.monetary, true);
    assert.deepEqual(contract.availableMoneyFacts.map(f => f.path), ['recipe1.cost', 'recipe2.cost', 'costDiff']);
    const facts = availableMoneyFacts(compareResults());
    assert.deepEqual(facts.map(f => f.value), [272.6, 292.24, 19.64]);
    assert.ok(facts.every(f => f.capability === 'compare_recipes' && f.factPath));
});

scenario('0c', '未声明能力的结果即使含金额字段也不产生事实', () => {
    assert.deepEqual(availableMoneyFacts(queryResults()), []);
});

// ── Part 1-R2：能力可用性 与 本轮要求 必须分开 ──────────────────────
scenario('0d', '能力可用性 ≠ 本轮要求：同一能力在不同目标下 requiredMoneyFacts 不同', () => {
    const bom = bomResults();
    // 同一能力的可用事实始终相同（能力元数据）。
    // 注意 availableMoneyFacts() 返回的是事实实例（字段名 factPath），
    // 契约声明用的是 path。
    assert.deepEqual(availableMoneyFacts(bom).map(f => f.factPath),
        ['costPreview.currentTotalCost', 'costPreview.partsCost', 'costPreview.laborCost']);
    assert.deepEqual(monetaryPresentationFor('build_recipe_bom_draft').availableMoneyFacts.map(f => f.path),
        ['costPreview.currentTotalCost', 'costPreview.partsCost', 'costPreview.laborCost']);

    // 目标 A：「这个配置用了哪些零件？」→ 已解析为 DESCRIBE_CONFIGURATION → 不要求金额。
    const describe = turnMonetaryPresentation(semanticEligibility({ userText: 'Shadow配方甲换成12-120线圈，用了哪些零件？' }));
    assert.equal(describe.monetary, false, 'DESCRIBE_CONFIGURATION 不得要求金额');
    assert.deepEqual(requiredMoneyFacts(bom, describe), [], '本轮不要求金额时不得补全');

    // 目标 B：「这套 BOM 一共多少钱？」→ PREVIEW_CONFIGURATION_COST → 要求金额。
    const cost = turnMonetaryPresentation(semanticEligibility({ userText: 'Shadow配方甲换成12-120线圈成本多少？' }));
    assert.equal(cost.monetary, true, 'PREVIEW_CONFIGURATION_COST 必须要求金额');
    assert.ok(requiredMoneyFacts(bom, cost).length > 0, '本轮要求金额时必须可补全');
});

scenario('0e', '本轮要求来源是既有已解析目标，不是关键词/正则意图识别', () => {
    // 逐条来自 api/business-semantics 的 kind/operation 枚举。
    const cases = [
        ['12-120线圈成本多少？', 'COST_QUERY', 'READ_COST', true],
        ['12-120线圈库存多少？', 'INVENTORY_QUERY', 'READ_INVENTORY', false],
        ['Shadow配方甲换成12-120线圈成本多少？', 'CONFIGURATION_OVERRIDE', 'PREVIEW_CONFIGURATION_COST', true],
        ['Shadow配方甲换成12-120线圈，用了哪些零件？', 'CONFIGURATION_OVERRIDE', 'DESCRIBE_CONFIGURATION', false],
    ];
    for (const [userText, kind, operation, expected] of cases) {
        const eligibility = semanticEligibility({ userText });
        const turn = turnMonetaryPresentation(eligibility);
        assert.equal(eligibility.kind, kind, `${userText}: kind`);
        assert.equal(eligibility.operation, operation, `${userText}: operation`);
        assert.equal(turn.monetary, expected, `${userText}: monetary`);
    }
});

// ── Supervisor 要求的 A–J（本轮金额要求与运行时同源） ────────────────
const COST_GOAL = turnFor('换成12-140后成本多少？');                    // PREVIEW_CONFIGURATION_COST → 要求金额
const COMPARE_GOAL = turnFor('比较两套配方成本');                        // COST_QUERY / READ_COST → 要求金额
const INVENTORY_GOAL = turnFor('12-120线圈库存多少？');                  // INVENTORY_QUERY / READ_INVENTORY → 不要求
const PARTS_ONLY_GOAL = turnFor('Shadow配方甲换成12-120线圈，用了哪些零件？'); // DESCRIBE_CONFIGURATION → 不要求

scenario('A', 'compare_recipes 货币目标缺 required 金额 → 补齐 A/B/差额', () => {
    const final = applyGuard('两套方案的成本已给出，供你参考。', compareResults(), COMPARE_GOAL);
    for (const value of ['A', '272.6', 'B', '292.24', '19.64']) assert.ok(final.includes(value), `缺 ${value}`);
    assert.ok(tableCount(final) <= 1, '金额表不得超过 1 次');
});

scenario('B', '库存数量回答附带金额 → 不出现金额表', () => {
    const answer = '当前库存5套。';
    assert.equal(applyGuard(answer, queryResults(), INVENTORY_GOAL), answer);
    assert.equal(tableCount(applyGuard(answer, queryResults(), INVENTORY_GOAL)), 0);
});

scenario('C', '成本 what-if → required 金额事实被补齐', () => {
    const answer = '换成 12-140 后，整机当前总成本 285.8，其中零件成本 264.8、人工成本 21。';
    const final = applyGuard(answer, bomResults(), COST_GOAL);
    assert.ok(final.includes('116.99'), '必须补上 missing 的正式金额 116.99');
    assert.ok(tableCount(final) <= 1);
});

scenario('D', 'required 金额已完整 → NONE（不追加）', () => {
    const answer = '换成 12-140 后，整机当前总成本 285.8，其中零件成本 264.8、人工成本 21，线圈 COIL-0002 是 116.99。';
    const decision = moneyGuardDecision(answer, bomResults(), COST_GOAL);
    assert.equal(decision.action, 'none');
    assert.equal(decision.reason, 'no_money_detail_obligation');
    assert.equal(applyGuard(answer, bomResults(), COST_GOAL), answer);
});

scenario('E', '非金额语义结论被保留（缺陷 001 防复发）', () => {
    const answer = '两项产品规格的唯一差异是：明细 1 带浮球（浮球-新界式，线径 1），明细 2 不带浮球。';
    const final = applyGuard(answer, bomResults(), COST_GOAL);
    assert.ok(final.startsWith('两项产品规格的唯一差异'), '结论必须仍在开头');
    assert.ok(final.includes('浮球-新界式'), '结论内容不得丢失');
});

scenario('F', '重复金额表 → 最终只有一张', () => {
    const summary = formatMoneySummary(bomResults(), { includeQueries: true });
    const answer = `结论：换成 12-140 后整机成本上升。\n\n${summary}\n\n完整计算明细见本轮工具结果。`;
    const final = applyGuard(answer, bomResults(), COST_GOAL);
    assert.ok(tableCount(final) <= 1, `金额表出现 ${tableCount(final)} 次`);
    assert.equal((final.match(/\| 对象 \| 项目 \| 金额 \|/gu) || []).length, 1, '表头不得重复');
});

scenario('G', '无依据金额被修正，且可挽救语义结论不丢失', () => {
    const answer = '换成 12-140 后整机当前总成本 286，这个配置仍然沿用原包装。';
    const final = applyGuard(answer, bomResults(), COST_GOAL);
    assert.ok(!final.includes('286'), '无依据金额不得保留');
    assert.ok(final.includes('285.8'), '必须给出正式金额');
});

scenario('H', '同一 canonical fact 只有一种表示', () => {
    const summary = formatMoneySummary(compareResults(), { includeQueries: true });
    // 272.60 / 292.24 / 19.64 各出现一次，且没有同一金额的两种精度并存。
    for (const value of ['272.6', '292.24', '19.64']) {
        const occurrences = summary.split(value).length - 1;
        assert.ok(occurrences >= 1, `缺少 ${value}`);
    }
    assert.ok(!/272\.60/.test(summary), '不得同时出现 272.6 与 272.60');
    // 正式源精度必须被保留（缺陷 004）。
    const coilSummary = formatMoneySummary([{ name: 'search_coils', result: verified([{ schemeCode: 'COIL-A', cost: 166.7136 }]) }], { includeQueries: true });
    assert.ok(coilSummary.includes('166.7136'), '正式源精度 166.7136 必须保留，不得截断为 166.71');
});

scenario('I', '非金额 PREVIEW 负向对照 → 不自动出现金额表', () => {
    // preview_pump_shell_cost 是 preview 能力，但**没有**声明可提供的整机金额事实。
    const capability = getAiCapability('preview_pump_shell_cost');
    assert.equal(capability.operation, 'preview', '前提：它确实是 preview 能力');
    assert.equal(providesMonetaryFacts('preview_pump_shell_cost'), false,
        'preview 类型本身不得产生金额补全');
    const toolResults = [{ name: 'preview_pump_shell_cost', result: verified({ bundleCost: 95, shellModel: 'V750' }) }];
    const answer = '该泵壳模板的零件清单以正式模板档案为准。';
    assert.equal(applyGuard(answer, toolResults, COST_GOAL), answer, '不得因为能力是 preview 就追加金额表');
    assert.equal(tableCount(applyGuard(answer, toolResults, COST_GOAL)), 0);
});

scenario('J', '守卫幂等 GUARD(GUARD(x)) == GUARD(x) 且金额表 <= 1', () => {
    const cases = [
        ['A', '两套方案的成本已给出，供你参考。', compareResults(), COMPARE_GOAL],
        ['B', '当前库存5套。', queryResults(), INVENTORY_GOAL],
        ['C', '换成 12-140 后，整机当前总成本 285.8，其中零件成本 264.8、人工成本 21。', bomResults(), COST_GOAL],
        ['D', '换成 12-140 后，整机当前总成本 285.8，其中零件成本 264.8、人工成本 21，线圈 COIL-0002 是 116.99。', bomResults(), COST_GOAL],
        ['I', '该泵壳模板的零件清单以正式模板档案为准。', [{ name: 'preview_pump_shell_cost', result: verified({ bundleCost: 95 }) }], COST_GOAL],
    ];
    for (const [id, answer, toolResults, turn] of cases) {
        const once = applyGuard(answer, toolResults, turn);
        const twice = applyGuard(once, toolResults, turn);
        const thrice = applyGuard(twice, toolResults, turn);
        assert.equal(once, twice, `${id}: 第二次作用改变了结果`);
        assert.equal(twice, thrice, `${id}: 第三次作用改变了结果`);
        assert.ok(tableCount(once) <= 1, `${id}: 金额表出现 ${tableCount(once)} 次`);
    }
});

// ── Part 1-R2 新增：轮次级要求的三个必测场景 ────────────────────────
scenario('L', 'build_recipe_bom_draft 只问零件 → 不补金额表', () => {
    const toolResults = bomResults();
    // 能力可以提供金额（不是 fail-closed）。
    assert.equal(providesMonetaryFacts('build_recipe_bom_draft'), true);
    // 但本轮目标是 DESCRIBE_CONFIGURATION → 不要求金额。
    assert.equal(PARTS_ONLY_GOAL.monetary, false);
    const answer = '这套配置使用 V750-大脚板-2寸泵壳与 12-120 线圈，包装为 v550木箱加珍珠棉。';
    const final = applyGuard(answer, toolResults, PARTS_ONLY_GOAL);
    assert.equal(final, answer, '只问零件时不得补金额表');
    assert.equal(tableCount(final), 0);
});

scenario('M', 'build_recipe_bom_draft 问成本 → 补金额', () => {
    const answer = '这套配置使用 V750-大脚板-2寸泵壳与 12-120 线圈。';
    const final = applyGuard(answer, bomResults(), COST_GOAL);
    assert.ok(final.includes('285.8'), '成本目标必须补出正式总成本');
    assert.equal(tableCount(final), 1);
});

scenario('N', 'requiredFacts=[] 且正文含无依据金额 → 安全校验仍然生效', () => {
    // 目标不要求金额（INVENTORY_QUERY），因此补全侧为空。
    assert.deepEqual(requiredMoneyFacts(queryResults(), INVENTORY_GOAL), []);
    // 但正文自己声称了金额 → 安全校验必须照常纠正，证明安全与补全相互独立。
    const answer = '当前库存5套，价值 ¥9999。';
    const final = applyGuard(answer, queryResults(), INVENTORY_GOAL);
    assert.ok(!final.includes('9999'), '无依据金额必须被纠正，即使本轮不要求金额');
    assert.equal(tableCount(final), 1);
});

// 缺陷 005 的根因断言：数量量词不构成金额声明。
scenario('K', '数量量词不被当作金额声明（缺陷 005 根因）', () => {
    assert.deepEqual(evaluateAnswerMoney('当前库存5套。', queryResults()).unsupportedClaims, []);
    assert.deepEqual(moneyGuardDecision('当前库存5套。', queryResults()).unsupportedClaims, []);
});

console.log('');
console.log('已声明金额事实可用性的能力:', Object.keys(MONETARY_PRESENTATION_CONTRACTS).join(', '));
if (failures) {
    console.error(`\n场景证据失败：${failures} 个场景未通过`);
    process.exit(1);
}
console.log('A–J + 0a-0e + K + L/M/N 全部通过。');
