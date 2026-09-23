'use strict';
/**
 * AI Answer Presentation Remediation V1 — Part 1 幂等性证据。
 *
 * 断言 Supervisor 要求的 GUARD(GUARD(x)) == GUARD(x)：
 * 金额守卫对同一输入连续作用多次，结果必须逐字节稳定，且同一逻辑金额表最多出现一次。
 *
 * 同时覆盖 Part 1 的四类动作：append / none（查询无义务）/ none（required facts 已呈现）/
 * replace（无依据金额），并回归缺陷 001（非金额结论不得被删除）。
 *
 * 运行：node planning/ai-native-v1/release/_money-guard-idempotence.cjs
 * 失败时以非零退出码结束，可直接作为门禁证据。
 */
const assert = require('node:assert/strict');
const { moneyGuardDecision, evaluateAnswerMoney } = require('../../../api/services/aiMoneyGuard.cjs');
const { formatMoneySummary } = require('../../../api/services/aiAssistantAnswer.cjs');

const verified = data => ({ success: true, data, executionEvidence: { verified: true, kind: 'formal_api_query' } });

// 一次守卫作用：与 aiAssistantRuntime 第 879-906 段的动作映射保持一致。
function applyGuard(answer, toolResults) {
    const decision = moneyGuardDecision(answer, toolResults);
    if (decision.action === 'append') return `${answer}\n\n${decision.appendable || decision.summary}`;
    if (decision.action === 'replaceTable') return decision.appendable || decision.summary;
    if (decision.action === 'replace') return decision.summary;
    return answer;
}

const tableCount = text => (String(text).match(/本轮正式查询金额如下/gu) || []).length;

const bomResults = () => [{
    name: 'build_recipe_bom_draft',
    result: verified({
        coilSnapshot: { schemeCode: 'COIL-0002', material: '钢带', slotType: '小眼', totalCost: 116.99 },
        costPreview: { currentTotalCost: 285.8, partsCost: 264.8, laborCost: 21, pricingComplete: true },
    }),
}];

const compareResults = () => [{
    name: 'compare_recipes',
    result: { ...verified({}), recipe1: { name: 'A', cost: 272.60 }, recipe2: { name: 'B', cost: 292.24 }, costDiff: '19.64' },
}];

const queryResults = () => [{ name: 'search_coils', result: verified([{ stock: 5, cost: 123 }]) }];

const cases = [
    // 缺陷 001 / 005：非金额结论必须保留，不能因为金额问题被删除。
    { label: '非金额结论（库存）不被金额守卫删除', answer: '当前库存5套。', toolResults: queryResults(), final: '当前库存5套。', tables: 0 },
    // 缺陷 003：模型只写客套话时，正式金额必须补上。
    { label: '客套话补正式金额', answer: '两套方案的成本已给出，供你参考。', toolResults: compareResults(), tables: 1, includes: ['272.6', '292.24', '19.64'] },
    // required facts 只写一半 → 追加完整明细。
    { label: '漏一个正式金额则追加明细', answer: '换成 12-140 后，整机当前总成本 285.8，其中零件成本 264.8、人工成本 21。', toolResults: bomResults(), tables: 1, includes: ['285.8'] },
    // required facts 全部写出 → 不再追加（同一金额不得重复出现）。
    { label: '全部正式金额已呈现则不再追加', answer: '换成 12-140 后，整机当前总成本 285.8，其中零件成本 264.8、人工成本 21，线圈 COIL-0002 是 116.99。', toolResults: bomResults(), tables: 0 },
    // 无依据金额仍被阻止。
    { label: '无依据金额仍被替换', answer: '999元', toolResults: queryResults(), tables: 1, excludes: ['999'] },
];

let failed = 0;
for (const item of cases) {
    const once = applyGuard(item.answer, item.toolResults);
    const twice = applyGuard(once, item.toolResults);
    const thrice = applyGuard(twice, item.toolResults);
    try {
        assert.equal(once, twice, `${item.label}：第二次作用改变了结果`);
        assert.equal(twice, thrice, `${item.label}：第三次作用改变了结果`);
        if (item.final !== undefined) assert.equal(once, item.final, `${item.label}：正文被改动`);
        if (item.tables !== undefined) assert.ok(tableCount(once) <= item.tables, `${item.label}：金额表出现 ${tableCount(once)} 次，上限 ${item.tables}`);
        for (const value of item.includes || []) assert.ok(once.includes(value), `${item.label}：缺少正式金额 ${value}`);
        for (const value of item.excludes || []) assert.ok(!once.includes(value), `${item.label}：仍包含无依据金额 ${value}`);
        console.log(`PASS  ${item.label}  (tables=${tableCount(once)}, idempotent)`);
    } catch (error) {
        failed += 1;
        console.error(`FAIL  ${error.message}`);
    }
}

// 缺陷 005 的根因断言：数量不是金额声明。
const stockClaim = evaluateAnswerMoney('当前库存5套。', queryResults());
assert.deepEqual(stockClaim.unsupportedClaims, [], '「库存5套」不得被判成无依据金额');
console.log('PASS  数量量词不被当作金额声明  (unsupportedClaims=[])');

if (failed) {
    console.error(`\n幂等性证据失败：${failed}/${cases.length} 例未通过`);
    process.exit(1);
}
console.log(`\nGUARD(GUARD(x)) == GUARD(x)：${cases.length}/${cases.length} 例通过，同一逻辑金额表最多出现 1 次。`);
