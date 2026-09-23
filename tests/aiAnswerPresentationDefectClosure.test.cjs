'use strict';
/**
 * Part 3 —— 五个验收缺陷的最终闭环证据（可执行矩阵）。
 *
 * Supervisor 要求为每个缺陷给出：DEFECT_ID / ORIGINAL_SYMPTOM / ROOT_CAUSE / FIX /
 * AUTOMATED_REGRESSION / NEGATIVE_CONTROL / FINAL_STATUS，且不改写历史缺陷记录。
 * 本文件把这些字段做成**可执行**断言：任一缺陷行为回退即失败。
 *
 * 历史缺陷记录保持原样（planning/ai-native-v1/release/LegacyAi*DefectV1.json），
 * 闭环结论由本文件 + AiAnswerPresentationRemediationPart3V1.json 承载。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    moneyGuardDecision,
    evaluateAnswerMoney,
} = require('../api/services/aiMoneyGuard.cjs');
const { formatMoneyDisplay, formatMoneySummary } = require('../api/services/aiAssistantAnswer.cjs');
const { normalizeAnswerPresentation } = require('../api/services/aiPresentationNormalizer.cjs');

const verified = data => ({ success: true, data, executionEvidence: { verified: true, kind: 'formal_api_query' } });
const applyGuard = (answer, toolResults, turn) => {
    const decision = moneyGuardDecision(answer, toolResults, turn);
    if (decision.action === 'append') return `${answer}\n\n${decision.appendable || decision.summary}`;
    if (decision.action === 'replaceTable') return decision.appendable || decision.summary;
    if (decision.action === 'replace') return decision.summary;
    return answer;
};
const normalize = (answer, userText = '') => normalizeAnswerPresentation(answer, userText);
const tableCount = text => (String(text).match(/本轮正式查询金额如下/gu) || []).length;

// 生产会话里记录的真实形状。
const ORDER_TOOL_RESULTS = () => [{ name: 'get_order_knowledge_package', result: verified({
    orderId: 1, customerName: '客户甲', status: '待确认',
    items: [
        { recipeName: '配置甲', unitCost: 326.5, unitPrice: 359.15, qty: 50 },
        { recipeName: '配置乙', unitCost: 318.0, unitPrice: 349.8, qty: 50 },
    ],
}) }];
const BOM_TOOL_RESULTS = () => [{ name: 'build_recipe_bom_draft', result: verified({
    coilSnapshot: { schemeCode: 'COIL-0002', material: '钢带', slotType: '小眼', totalCost: 116.99 },
    costPreview: { currentTotalCost: 285.8, partsCost: 264.8, laborCost: 21, pricingComplete: true },
}) }];
const COST_GOAL = Object.freeze({ monetary: true, kind: 'COST_QUERY', operation: 'READ_COST' });
const PARTS_ONLY_GOAL = Object.freeze({ monetary: false, kind: 'CONFIGURATION_OVERRIDE', operation: 'DESCRIBE_CONFIGURATION' });

// ── LEGACY-AI-ANSWER-001 ────────────────────────────────────────────
test('LEGACY-AI-ANSWER-001 已修：金额问题不得删除已验证的非金额结论', () => {
    // ORIGINAL_SYMPTOM：用户问「这两项产品规格有什么不同」，回答只剩一张内部金额表，结论消失。
    // ROOT_CAUSE：守卫以「正文没写 ¥/元」为前置条件整段替换。
    // FIX：是否保留正文完全由 evaluateAnswerMoney 决定，非金额结论永不删。
    const conclusion = '两项产品规格的唯一差异是：明细 1 带浮球（浮球-新界式，线径 1），明细 2 不带浮球。';
    const final = applyGuard(conclusion, ORDER_TOOL_RESULTS(), COST_GOAL);
    // AUTOMATED_REGRESSION
    assert.ok(final.startsWith('两项产品规格的唯一差异'), '结论必须仍在开头');
    assert.match(final, /浮球-新界式/, '结论内容不得丢失');
    // NEGATIVE_CONTROL：正文真的不可用时仍必须替换。
    // （需要本轮能产出正式明细；若契约声明的能力没产生任何正式金额，
    //  守卫返回 none 是对的 —— 没有正式内容可替换。）
    assert.equal(moneyGuardDecision('', BOM_TOOL_RESULTS(), COST_GOAL).action, 'replace');
    assert.equal(moneyGuardDecision('仅修正文案', BOM_TOOL_RESULTS(), COST_GOAL).action, 'replace');
});

test('LEGACY-AI-ANSWER-001 真实实例：浮球差异必须明说，用户不必靠金额相减推断', () => {
    // 测试库证据：明细 1 含 浮球-新界式 / 浮球-线径1 ×1 @ ¥8.50，明细 2 不含；
    // 326.50 − 318.00 = 8.50，359.15 − 349.80 = 9.35 = 8.50 × 1.1。
    const conclusion = '差别在浮球：明细 1 带浮球（浮球-新界式，线径 1），明细 2 不带浮球，因此明细 1 成本高 8.50 元。';
    const final = applyGuard(conclusion, ORDER_TOOL_RESULTS(), COST_GOAL);
    assert.match(final, /带浮球/, '必须显式说明带浮球');
    assert.match(final, /不带浮球/, '必须显式说明不带浮球');
    assert.match(final, /8\.50/, '正式差额可以留在正文作为次要证据');
});

// ── LEGACY-AI-ANSWER-002 ────────────────────────────────────────────
test('LEGACY-AI-ANSWER-002 已修：正常回答不得暴露工具显示名/内部 ID/机器表词汇', () => {
    // ROOT_CAUSE：aiAssistantAnswer 的 visit() 在结果缺 name/recipeName/model/schemeCode
    // 时回退用 capability.displayName 当对象名。
    // FIX：展示层以集中映射表把工具显示名换成业务对象名。
    const machine = '本轮正式查询金额如下（元）：\n\n| 对象 | 项目 | 金额 |\n|---|---|---:|\n'
        + '| 读取订单知识包 | 总成本 | 32225 |\n| 生成 BOM 草稿 | 当前总成本 | 285.8 |\n\n完整计算明细见本轮工具结果。';
    const out = normalize(machine);
    // AUTOMATED_REGRESSION
    assert.doesNotMatch(out, /读取订单知识包/);
    assert.doesNotMatch(out, /生成 BOM 草稿/);
    assert.match(out, /\| 订单 \| 总成本 \| 32225 \|/);
    // 内部 ID
    assert.doesNotMatch(normalize('配方ID 12（V750-大脚板-2寸）成本 285.8 元。'), /配方ID/);
    // NEGATIVE_CONTROL：显式 ID 请求可见；调试请求保留机器语言。
    assert.match(normalize('配方ID 12（V750-大脚板-2寸）成本 285.8 元。', '这个配方的ID是多少'), /配方ID 12/);
    assert.match(normalize(machine, '给我看调试信息和工具调用'), /读取订单知识包/);
});

// ── LEGACY-AI-ANSWER-003 ────────────────────────────────────────────
test('LEGACY-AI-ANSWER-003 已修：同一逻辑金额表只出现一次', () => {
    // ORIGINAL_SYMPTOM：1258 字的回答里同一张金额表出现两次（msg 230）。
    // ROOT_CAUSE：用「整块文本是否被正文包含」判断表格是否已出现，模型写出变体即判定失败。
    // FIX：按结构化「对象 + 项目」键去重；不同精度归一化后视为同一行。
    const summary = formatMoneySummary(BOM_TOOL_RESULTS(), { includeQueries: true });
    for (const variant of [
        summary,                                                              // 完整表
        summary.replace(/(\d+\.\d{3,})/gu, value => Number(value).toFixed(2)), // 同值不同精度
        `结论：换成 12-140 后整机成本上升。\n\n${summary}\n\n完整计算明细见本轮工具结果。`, // 表格带旁注
    ]) {
        const decision = moneyGuardDecision(variant, BOM_TOOL_RESULTS(), COST_GOAL);
        assert.equal(decision.action, 'none', '正文已含该表时不得再追加');
        assert.equal(tableCount(variant), 1, '金额表必须只出现一次');
    }
    // AUTOMATED_REGRESSION：重复作用不产生第二份。
    const once = applyGuard(`结论：成本上升。\n\n${summary}`, BOM_TOOL_RESULTS(), COST_GOAL);
    const twice = applyGuard(once, BOM_TOOL_RESULTS(), COST_GOAL);
    assert.equal(tableCount(once), 1);
    assert.equal(tableCount(twice), 1);
    // NEGATIVE_CONTROL：真的少一行时仍必须补齐。
    const missingRow = summary.split('\n').filter(line => line !== summary.split('\n').filter(l => /^\|/u.test(l.trim()))[3]).join('\n');
    assert.equal(moneyGuardDecision(missingRow, BOM_TOOL_RESULTS(), COST_GOAL).action, 'replaceTable');
});

// ── LEGACY-AI-ANSWER-004 ────────────────────────────────────────────
test('LEGACY-AI-ANSWER-004 已修：同一 canonical fact 只有一种表示，且保留来源精度', () => {
    // ORIGINAL_SYMPTOM：金额表可读性差 —— 同一笔钱同时出现两种精度，且分不清口径。
    // ROOT_CAUSE：formatMoneyDisplay 一律 toFixed(2)，把承载候选身份的正式源精度截断。
    // FIX：保留来源有效精度，只清浮点尾差；同值取最高精度表示统一其余叫法。
    // AUTOMATED_REGRESSION：正式源精度必须保留。
    assert.equal(formatMoneyDisplay(166.7136), '166.7136');
    assert.equal(formatMoneyDisplay(195.84155), '195.84155');
    assert.equal(formatMoneyDisplay(null), null, '「没有金额」不得渲染成 0');
    const coilSummary = formatMoneySummary([
        { name: 'search_coils', result: verified([{ schemeCode: 'COIL-A', cost: 166.7136 }]) },
    ], { includeQueries: true });
    assert.match(coilSummary, /166\.7136/, '来源精度不得被截断为 166.71');
    // 同一 fact 不得同时出现两种精度。
    const compareSummary = formatMoneySummary([{
        name: 'compare_recipes',
        result: { ...verified({}), recipe1: { name: 'A', cost: 272.60 }, recipe2: { name: 'B', cost: 292.24 }, costDiff: '19.64' },
    }], { includeQueries: true });
    assert.match(compareSummary, /272\.6/);
    assert.doesNotMatch(compareSummary, /272\.60/, '不得同时出现 272.6 与 272.60');
    // 口径标签不再由展示层全文字替换决定，而由事实投影按 entity type + predicate 给出（A06）。
    const coilLabelSummary = formatMoneySummary([
        { name: 'search_coils', result: verified([{ schemeCode: 'COIL-A', cost: 166.7136 }]) },
    ], { includeQueries: true });
    assert.match(coilLabelSummary, /线圈档案成本/, '线圈档案 cost 必须标成线圈档案成本');
    assert.match(coilLabelSummary, /166\.7136/, '金额数值与来源精度必须逐字不变');
    // NEGATIVE_CONTROL：展示层不再改写业务口径；也无法把未知主体的成本改写成线圈口径。
    const unknownEntity = '| 对象 | 项目 | 金额 |\n|---|---|---:|\n| V550整机 | 档案成本 | 268 |';
    assert.equal(normalize(unknownEntity), unknownEntity, '展示层不得把整机成本改写成线圈口径');
    // NEGATIVE_CONTROL：用户要求原始精度时同样不改数字。
    assert.match(normalize('| 对象 | 项目 | 金额 |\n|---|---|---:|\n| 线圈 | 档案成本 | 166.7136 |', '给我原始精度'), /166\.7136/);
});

// ── LEGACY-AI-ANSWER-005 ────────────────────────────────────────────
test('LEGACY-AI-ANSWER-005 已修：结论先行、长清单摘要、无未被请求的延伸邀约', () => {
    // ORIGINAL_SYMPTOM：回答以内部金额表开头以元话收尾；20+ 项零件连成一段；8/18 条以延伸邀约收尾。
    // ROOT_CAUSE：展示层缺失；精简逻辑只在本地模型分支生效。
    // FIX：确定性展示规范化层，本地与远端同一策略。
    // CONCLUSION_FIRST
    const reordered = normalize('本轮正式查询金额如下（元）：\n\n| 对象 | 项目 | 金额 |\n|---|---|---:|\n| 订单 | 总成本 | 100 |\n\n这两个配置的成本差异是 8.50 元。');
    assert.ok(reordered.startsWith('这两个配置的成本差异'));
    // UNSOLICITED_CONTINUATION_INVITATION = NO
    const trimmed = normalize('这两个配置的成本差异是 8.50 元。\n\n我可以继续帮你比较其他配置。');
    assert.doesNotMatch(trimmed, /我可以继续/);
    // LONG_LIST：决策关键行保留，中性行可摘要。
    const rows = [
        ...Array.from({ length: 10 }, (_, index) => `- 常规项 ${index + 1}`),
        '- 缺 300 个 6202 轴承',
        '- 常规项 12',
    ];
    const summarized = normalize(`库存检查如下。\n\n${rows.join('\n')}`);
    assert.match(summarized, /缺 300 个 6202 轴承/, '决策关键行必须保留');
    assert.match(summarized, /另有 \d+ 项未展开/);
    // NEGATIVE_CONTROL：显式明细请求保留全部。
    const full = `库存检查如下。\n\n${rows.join('\n')}`;
    assert.equal(normalize(full, '列全部明细'), full);
});

// ── 交叉不变量：五缺陷一起看 ────────────────────────────────────────
test('Part 3 交叉不变量：展示层不改变金额守卫判定，也不制造第二张表', () => {
    const answer = '换成 12-140 后，整机当前总成本 285.8，其中零件成本 264.8、人工成本 21。';
    const guarded = applyGuard(answer, BOM_TOOL_RESULTS(), COST_GOAL);
    const normalized = normalize(guarded);
    assert.equal(tableCount(normalized), 1, '规范化后仍只有一张金额表');
    assert.match(normalized, /285\.8/);
    assert.match(normalized, /116\.99/, '被补齐的正式金额不得因规范化丢失');
    // 幂等：规范化不逐次改变内容。
    assert.equal(normalize(normalized), normalized);
});

test('Part 3 交叉不变量：描述配置类目标不补金额表，但金额安全仍生效', () => {
    const partsOnly = applyGuard('这套配置使用 V750-大脚板-2寸泵壳与 12-120 线圈。', BOM_TOOL_RESULTS(), PARTS_ONLY_GOAL);
    assert.equal(tableCount(partsOnly), 0, '只问零件时不得补金额表');
    // 安全与补全分离：正文自己写无依据金额时仍被纠正。
    const unsafe = applyGuard('当前库存5套，价值 ¥9999。', [{ name: 'search_coils', result: verified([{ stock: 5, cost: 123 }]) }], PARTS_ONLY_GOAL);
    assert.doesNotMatch(unsafe, /9999/);
    assert.deepEqual(evaluateAnswerMoney('当前库存5套，价值 ¥9999。', [{ name: 'search_coils', result: verified([{ stock: 5, cost: 123 }]) }]).unsupportedClaims, [9999]);
});
