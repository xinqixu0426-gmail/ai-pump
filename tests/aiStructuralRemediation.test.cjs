'use strict';
/**
 * AI-NATIVE STRUCTURAL REMEDIATION V1 —— 结构级回归。
 *
 * 每一项都对应审计报告 A01–A07 的一个根因，并且都写成「同一契约、多种表达」的形式：
 * 断言的是事实身份 / 口径 / 动作边界，不是某一句例句。换一种问法、换一个型号、
 * 换一种缺料写法、换一个金额，这些断言仍然成立。
 *
 * 同时给出 NEGATIVE_CONTROL：不能因为收紧了身份绑定就放宽金额安全。
 *
 * 这些是 **Function / Contract Test**。真实调用链回放见
 * tests/aiStructuralRemediationRuntime.test.cjs（两者分开报告，不得互相冒充）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
    formatMoneySummary,
    formatMoneyDisplay,
    unsupportedMoneyInAnswer,
    presentedMoneyClaims,
    misattributedMoneyClaims,
    markdownTableRows,
} = require('../api/services/aiAssistantAnswer.cjs');
const {
    moneyGuardDecision,
    moneyClaimValues,
    moneyClaimOccurrences,
    evaluateAnswerMoney,
    citesResultFact,
    nonMonetaryResultFacts,
} = require('../api/services/aiMoneyGuard.cjs');
const {
    projectMoneyFacts,
    moneyPredicateFamilyOfLabel,
    moneyPredicateLabel,
    moneyDisplayValue,
} = require('../api/services/moneyFactProjection.cjs');
const {
    normalizeAnswerPresentation,
    buildListCriticality,
    listRowTier,
    hideInternalIdColumns,
    hideInternalIds,
    presentationRequest,
    LIST_TIER,
} = require('../api/services/aiPresentationNormalizer.cjs');
const {
    CLARIFICATION_ACTION,
    classifyClarificationReply,
} = require('../api/services/aiTaskControllerV2.cjs');

const verified = data => ({ success: true, data, executionEvidence: { verified: true, kind: 'formal_api_query' } });
const COST_GOAL = Object.freeze({ monetary: true, kind: 'COST_QUERY', operation: 'READ_COST' });
const rowTokens = summary => markdownTableRows(summary).map(row => row.cells.slice(0, 2).join('/'));
const moneyTableRows = summary => markdownTableRows(summary).filter(row => row.header.includes('金额'));

// ── A01｜金额表去重丢失正式对象身份 ─────────────────────────────────
// ROOT_CAUSE：去重键是「对象显示名 + 项目」或「项目 + 金额」，都不是事实身份。
// FIX：金额表由**事实投影**渲染，去重键 = FactKey(entity, predicate, basis) + 金额。

test('A01 两个不同实体金额相同，两条都必须保留（同价不同实体）', () => {
    const summary = formatMoneySummary([{
        name: 'compare_recipes',
        result: verified({ recipe1: { name: '方案甲', cost: 100 }, recipe2: { name: '方案乙', cost: 100 }, costDiff: '0' }),
    }], { includeQueries: true });
    const objects = moneyTableRows(summary).map(row => row.cells[0]);
    assert.ok(objects.includes('方案甲'), `方案甲 不得因为金额相同被吞掉：${summary}`);
    assert.ok(objects.includes('方案乙'), `方案乙 不得因为金额相同被吞掉：${summary}`);
});

test('A01 同名但不同 canonical identity 的两个对象都保留（同名不同 ID）', () => {
    const summary = formatMoneySummary([{
        name: 'search_coils',
        result: verified([{ id: 9, name: '同名线圈', cost: 100 }, { id: 8, name: '同名线圈', cost: 200 }]),
    }], { includeQueries: true });
    const values = moneyTableRows(summary).map(row => Number(row.cells[2]));
    assert.deepEqual(values, [100, 200], `同名不同 ID 的两条都必须保留：${summary}`);
    // E1-C 契约：canonical identity = 主键优先，格式与 Native Task V2 FactKey 对齐（entityType:entityId）。
    assert.deepEqual(projectMoneyFacts([{
        name: 'search_coils',
        result: verified([{ id: 9, name: '同名线圈', cost: 100 }, { id: 8, name: '同名线圈', cost: 200 }]),
    }], { includeQueries: true }).map(fact => fact.entityId), ['coil:9', 'coil:8'], '身份必须来自 canonical 主键');
});

test('A01 同一实体同一 predicate 出现冲突金额时保留冲突，不得先到先得', () => {
    const facts = projectMoneyFacts([{
        name: 'search_coils',
        result: verified([{ schemeCode: 'COIL-X', cost: 100 }, { schemeCode: 'COIL-X', cost: 200 }]),
    }], { includeQueries: true });
    // E1-C：只有 schemeCode、没有主键 → 身份不完整，绝不用名称/编码合并两个来源位置。
    assert.equal(facts.length, 2, '金额冲突必须两条都在（保留冲突，不静默选第一条）');
    assert.deepEqual(facts.map(fact => fact.value).sort((a, b) => a - b), [100, 200]);
    assert.deepEqual([...new Set(facts.map(fact => fact.identityState))], ['IDENTITY_INCOMPLETE']);
    assert.deepEqual([...new Set(facts.map(fact => fact.identityReasonCode))], ['PRIMARY_KEY_ABSENT']);
});

test('A01 NEGATIVE_CONTROL：不同对象不同金额照常保留；信息被截断时必须报出条数', () => {
    const summary = formatMoneySummary([{
        name: 'compare_recipes',
        result: verified({ recipe1: { name: 'A', cost: 100 }, recipe2: { name: 'B', cost: 200 } }),
    }], { includeQueries: true });
    assert.deepEqual(rowTokens(summary), ['A/成本', 'B/成本']);
    const many = formatMoneySummary([{
        name: 'search_coils',
        result: verified(Array.from({ length: 15 }, (_, index) => ({ id: index + 1, name: `线圈-${index + 1}`, cost: 100 + index }))),
    }], { includeQueries: true });
    assert.match(many, /另有 3 条未展开/, '展示容量截断必须报出未展开条数，不得静默丢行');
});

// ── A02｜数字合法 ≠ 数字属于正确对象 ───────────────────────────────
// ROOT_CAUSE：金额校验只问「这个数字在不在正式数值集合里」，不问它属于哪一行。
// FIX：(1) 表格行的身份包含金额；(2) 解析出的 (对象, 项目, 金额) 声明按事实身份回验。

const COMPARE_RESULTS = () => [{
    name: 'compare_recipes',
    result: verified({ recipe1: { name: 'A', cost: 100 }, recipe2: { name: 'B', cost: 200 }, costDiff: '100' }),
}];
const canonicalTable = () => formatMoneySummary(COMPARE_RESULTS(), { includeQueries: true });

test('A02 金额交换（A=200 / B=100）必须被发现并纠正回正式关联', () => {
    const swapped = canonicalTable()
        .replace('| A | 成本 | 100 |', '| A | 成本 | 200 |')
        .replace('| B | 成本 | 200 |', '| B | 成本 | 100 |');
    assert.notEqual(swapped, canonicalTable(), '夹具必须真的交换了金额');
    // 两道检查都必须发现关联错误。
    assert.deepEqual(unsupportedMoneyInAnswer(swapped, COMPARE_RESULTS()).sort((a, b) => a - b), [100, 200]);
    const decision = moneyGuardDecision(swapped, COMPARE_RESULTS(), COST_GOAL);
    assert.equal(decision.action, 'replaceTable');
    assert.equal(decision.reason, 'money_claim_misattributed');
    assert.deepEqual(decision.unsupportedClaims.slice().sort((a, b) => a - b), [100, 200], '被纠正的金额必须上报给调用方');
    // 纠正后的表必须恢复正式关联。
    const corrected = decision.appendable || decision.summary;
    assert.match(corrected, /\| A \| 成本 \| 100 \|/);
    assert.match(corrected, /\| B \| 成本 \| 200 \|/);
});

test('A02 关联校验按事实身份，不依赖措辞：对象 + 项目名对得上就必须金额一致', () => {
    const claims = presentedMoneyClaims('| 对象 | 项目 | 金额 |\n|---|---|---:|\n| A | 成本 | 200 |');
    assert.deepEqual(claims.map(claim => [claim.object, claim.label, claim.value, claim.canonical]),
        [['A', '成本', 200, true]]);
    const bad = misattributedMoneyClaims('| 对象 | 项目 | 金额 |\n|---|---|---:|\n| A | 成本 | 200 |', COMPARE_RESULTS());
    assert.deepEqual(bad.map(claim => claim.value), [200]);
    // 同一张表的正确版本不得被误判。
    assert.deepEqual(misattributedMoneyClaims(canonicalTable(), COMPARE_RESULTS()), []);
});

test('A02 NEGATIVE_CONTROL：编造的金额仍然被拦下；找不到对应事实时不猜测关联', () => {
    assert.deepEqual(unsupportedMoneyInAnswer('| 对象 | 项目 | 金额 |\n|---|---|---:|\n| A | 成本 | 999 |', COMPARE_RESULTS()), [999]);
    // 对象名在正式事实里不存在 → 不做关联推断（交由数值集合校验兜底），不得凭空报错。
    assert.deepEqual(misattributedMoneyClaims('| 对象 | 项目 | 金额 |\n|---|---|---:|\n| 陌生主体 | 成本 | 999 |', COMPARE_RESULTS()), []);
});

// ── A03｜金额守卫内部谓词与其语义不一致 ─────────────────────────────
test('A03a citesResultFact 必须真的检查「正文数字出现在非金额结果字段里」', () => {
    const stockResults = [{ name: 'search_coils', result: verified({ stock: 5, cost: 123 }) }];
    assert.equal(citesResultFact('当前库存999套。', stockResults), false, '编造的库存 999 不是本轮核实过的事实');
    assert.equal(citesResultFact('当前库存5套。', stockResults), true, '正文写出正式库存 5 才算引用了事实');
    // 业务身份（型号/方案编码）同样是非金额事实。
    const coilResults = [{ name: 'search_coils', result: verified([{ schemeCode: 'COIL-77', cost: 10 }]) }];
    assert.equal(citesResultFact('已核实：方案 COIL-77 的档案成本。', coilResults), true);
    assert.equal(citesResultFact('已核实：方案不存在。', coilResults), false);
    assert.deepEqual([...nonMonetaryResultFacts(stockResults).numbers], [5], '非金额事实集合不含 cost 字段');
});

test('A03b 金额声明按「出现位置」保留：数量语境不得撤回同一数值的金额声明', () => {
    const formal = new Set([123]);
    // 单独一次金额声明 → 必须被认出。
    assert.deepEqual(moneyClaimValues('成本999。', formal), [999]);
    // 同一数值另有一次数量出现 → 金额词锚定的那一次仍然必须被认出。
    assert.deepEqual(moneyClaimValues('当前库存999套，成本999。', formal), [999]);
    assert.deepEqual(evaluateAnswerMoney('当前库存999套，成本999。', [{ name: 'search_coils', result: verified({ stock: 999, cost: 123 }) }]).unsupportedClaims, [999]);
    // 出现位置级结构：两次出现都保留各自的位置与依据类型。
    const occurrences = moneyClaimOccurrences('当前库存999套，成本999。');
    assert.deepEqual(occurrences.map(item => [item.value, item.kind]), [[999, 'money_word']]);
});

test('A03b NEGATIVE_CONTROL：数量不是金额（「当前库存5套」不构成金额声明）', () => {
    assert.deepEqual(moneyClaimValues('当前库存5套。', new Set([123])), []);
    assert.deepEqual(evaluateAnswerMoney('当前库存5套。', [{ name: 'search_coils', result: verified({ stock: 5, cost: 123 }) }]).unsupportedClaims, []);
    // 但带货币单位的金额声明依旧必须被校验。
    assert.deepEqual(moneyClaimValues('当前库存5套，价值 ¥9999。', new Set([123])), [9999]);
});

// ── A04｜隐藏内部 ID 时删除唯一可选择身份 ───────────────────────────
test('A04 表格 ID 列只有在「投影后仍能唯一区分每一行」时才可移除', () => {
    // 两行成本相同：ID 是唯一区分身份 → 必须保留整列。
    const ambiguous = '| 配方ID | 当前成本 |\n|---|---:|\n| 9 | 100 |\n| 8 | 100 |';
    assert.equal(hideInternalIdColumns(ambiguous, presentationRequest('')), ambiguous,
        '删掉 ID 后两行完全相同 ⇒ 用户失去区分候选的能力，必须保留 ID 列');
    // 两行成本不同：投影后仍可区分 → 可以移除 ID 列。
    const distinguishable = '| 配方ID | 当前成本 |\n|---|---:|\n| 9 | 100 |\n| 8 | 200 |';
    const projected = hideInternalIdColumns(distinguishable, presentationRequest(''));
    assert.doesNotMatch(projected, /配方ID/u);
    assert.match(projected, /100/);
    assert.match(projected, /200/);
});

test('A04 行内候选 ID 在每个候选都有自己的可读身份时才可隐藏', () => {
    const request = presentationRequest('');
    // 两个候选只有 ID 可区分 → 全部保留。
    const choice = '请选择配方ID 12或配方ID 13。';
    assert.equal(hideInternalIds(choice, request), choice);
    // 只有单个 ID，且同行另有可读身份 → 隐藏 ID。
    assert.doesNotMatch(hideInternalIds('配方ID 12（V750-大脚板-2寸）当前成本是 285.8 元。', request), /配方ID/u);
    // 每个候选各带自己的可读身份 → 隐藏 ID。
    const withIdentities = '请选择配方ID 12（V750-甲）或配方ID 13（V750-乙）。';
    const hidden = hideInternalIds(withIdentities, request);
    assert.doesNotMatch(hidden, /配方ID/u);
    assert.match(hidden, /V750-甲/);
    assert.match(hidden, /V750-乙/);
});

test('A04 NEGATIVE_CONTROL：显式要 ID / 调试模式时一律保留', () => {
    const idOnly = '| 配方ID | 当前成本 |\n|---|---:|\n| 9 | 100 |\n| 8 | 100 |';
    for (const question of ['这个配方的ID是多少', '给我看调试信息']) {
        assert.equal(normalizeAnswerPresentation(idOnly, question), idOnly, `${question}：ID 必须可见`);
    }
});

// ── A05｜长清单压缩依赖措辞 ─────────────────────────────────────────
test('A05 必须展示的判据来自结构化状态：换一种缺料写法同样保留', () => {
    // E1-A：producer 字段必须来自**真实 capability 输出**（preview_virtual_readiness 的
    // status/coverage/shortages），不再使用任何合成字段名。
    const toolResults = [{ name: 'preview_virtual_readiness', result: verified({
        recipeName: 'v550-tokoy', status: 'SHORTAGE', coverage: { shortageCount: 1, complete: true },
        shortages: [{ requirementKey: 'part:71', resourceType: 'PART', partId: 71, model: '6202轴承', shortageQty: 300 }],
        unresolvedRequirements: [], excludedRequirements: [], warnings: [],
    }) }];
    const criticality = buildListCriticality(toolResults);
    // mustShow 至少包含正式缺料对象的身份；同时 recipe 的 SHORTAGE 状态本身也是关键事实。
    assert.ok(criticality.mustShowTokens.includes('6202轴承'), '关键性必须来自正式结构化状态（shortages[].model）');
    // 结论行刻意使用**从未在词表里出现过的写法**。
    const rows = [
        ...Array.from({ length: 10 }, (_, index) => `- 常规件${index + 1}：需求400个，现存400个。`),
        '- 6202轴承：需求400个，现存100个，还差300个。',
        '- 常规件12：需求400个，现存400个。',
    ];
    const answer = `库存检查结果如下。\n\n${rows.join('\n')}`;
    const out = normalizeAnswerPresentation(answer, '查库存', { criticality });
    assert.match(out, /还差300个/, '结构化关键行必须保留，与其措辞无关');
    assert.match(out, /本轮正式结果中处于缺料\/未定价\/未完成\/待选择状态的条目已全部保留/);
    assert.notEqual(out, answer, '中性明细仍然可以压缩（展示容量只作用于中性层）');
});

test('A05 结构化分层：Tier 由结构化 token 决定，不由关键词决定', () => {
    const criticality = { mustShowTokens: ['6202轴承'], supportTokens: ['合计'] };
    assert.equal(listRowTier('- 6202轴承：还差300个。', criticality), LIST_TIER.DECISION_CRITICAL);
    // 同样的问题、不同的措辞，只要身份 token 在，就仍然是关键行。
    assert.equal(listRowTier('- 6202轴承 待补 300', criticality), LIST_TIER.DECISION_CRITICAL);
    // 措辞像结论、但没有结构化依据的行，在结构化模式下不再自动升级为关键行。
    assert.equal(listRowTier('- 缺 300 个 其它件', criticality), LIST_TIER.NEUTRAL_DETAIL);
    assert.equal(listRowTier('- 合计 100 元', criticality), LIST_TIER.DIRECT_SUPPORT);
});

test('A05 没有结构化依据时必须保守，且不得声称关键条目已保留', () => {
    const rows = [
        ...Array.from({ length: 10 }, (_, index) => `- 常规件${index + 1}`),
        '- 6202轴承：需求400个，现存100个，还差300个。',
        '- 常规件12',
    ];
    const out = normalizeAnswerPresentation(`库存检查结果如下。\n\n${rows.join('\n')}`, '查库存');
    assert.match(out, /本轮没有结构化关键性依据/, '没有结构化依据时不得声称关键条目已全部保留');
    assert.doesNotMatch(out, /已全部保留。/, '不得作出无法被结构化事实支持的保全声明');
});

test('A05 结构化保全声明必须可核对：未落地的关键对象要如实报告', () => {
    const rows = Array.from({ length: 12 }, (_, index) => `- 常规件${index + 1}：需求400个，现存400个。`);
    const answer = `库存检查结果如下。\n\n${rows.join('\n')}`;
    // 正式结果里有一个处于缺料状态的对象，但回答的清单里根本没有它 → 不得声称已全部保留。
    const out = normalizeAnswerPresentation(answer, '查库存', { criticality: { mustShowTokens: ['6202轴承'], supportTokens: [] } });
    assert.match(out, /有 1 个处于缺料\/未定价\/未完成\/待选择状态的对象没有出现在清单里/);
    assert.doesNotMatch(out, /已全部保留。/);
});

test('A05 NEGATIVE_CONTROL：显式要求全部明细时不压缩', () => {
    const rows = [...Array.from({ length: 12 }, (_, index) => `- 常规件${index + 1}`), '- 6202轴承：还差300个。'];
    const answer = `库存检查结果如下。\n\n${rows.join('\n')}`;
    const criticality = buildListCriticality([{ name: 'preview_virtual_readiness', result: verified({
        recipeName: 'v550-tokoy', status: 'SHORTAGE', coverage: { shortageCount: 1, complete: true },
        shortages: [{ resourceType: 'PART', partId: 71, model: '6202轴承', shortageQty: 300 }], warnings: [],
    }) }]);
    assert.equal(normalizeAnswerPresentation(answer, '列全部明细', { criticality }), answer);
});

// ── A06｜展示层改写成本口径 ─────────────────────────────────────────
test('A06 成本口径标签由 entity type + predicate 给出，展示层不做全文替换', () => {
    const coil = formatMoneySummary([{ name: 'search_coils', result: verified([{ schemeCode: 'COIL-A', cost: 166.7136 }]) }], { includeQueries: true });
    assert.match(coil, /\| COIL-A \| 线圈档案成本 \| 166\.7136 \|/);
    const machine = formatMoneySummary([{
        name: 'compare_recipes',
        result: verified({ recipe1: { name: 'V550整机', cost: 268 }, recipe2: { name: 'V550甲', spec: '定制', cost: 300 } }),
    }], { includeQueries: true });
    assert.match(machine, /\| V550整机 \| 成本 \| 268 \|/);
    assert.doesNotMatch(machine, /线圈档案成本/, '整机成本不得被改写成线圈口径');
    // 展示层保持不变（无法从文本推断实体类型时不得猜测口径）。
    assert.equal(normalizeAnswerPresentation('| 对象 | 项目 | 金额 |\n|---|---|---:|\n| V550整机 | 档案成本 | 268 |'), '| 对象 | 项目 | 金额 |\n|---|---|---:|\n| V550整机 | 档案成本 | 268 |');
});

test('A06 标签词表是集中的、可反解 predicate 的闭集', () => {
    assert.equal(moneyPredicateFamilyOfLabel('线圈档案成本'), 'cost');
    assert.equal(moneyPredicateFamilyOfLabel('零件目录单价'), 'price');
    assert.equal(moneyPredicateFamilyOfLabel('零件成本'), 'partsCost');
    assert.equal(moneyPredicateFamilyOfLabel('成本差额（后者减前者）'), 'costDiff');
    assert.equal(moneyPredicateFamilyOfLabel('毛利'), null, '未登记口径不得被推断');
    assert.equal(moneyPredicateLabel('cost', 'coil', null), '线圈档案成本');
    assert.equal(moneyPredicateLabel('cost', 'recipe', null), '档案成本');
    assert.equal(moneyPredicateLabel('cost', null, null), '档案成本');
});

test('A06 NEGATIVE_CONTROL：金额数值与来源精度在投影与展示两侧都不变', () => {
    for (const value of [166.7136, 195.84155, 0.96, 268, 1268.23]) {
        assert.equal(formatMoneyDisplay(value), moneyDisplayValue(value));
    }
    assert.equal(formatMoneyDisplay(null), null, '「没有金额」不得渲染成 0');
    const summary = formatMoneySummary([{ name: 'search_coils', result: verified([{ schemeCode: 'COIL-A', cost: 166.7136 }]) }], { includeQueries: true });
    assert.match(summary, /166\.7136/, '来源精度必须逐字保留');
    assert.doesNotMatch(summary, /166\.71(?!\d)/, '不得截断为两位小数');
});

// ── A07｜后续消息动作边界（闭集选择语法）────────────────────────────
const CHOICE_QUESTION = Object.freeze({
    choices: [
        { choiceId: 'choice_1', label: 'V750-大脚板-2寸', entity: { displayName: 'V750-大脚板-2寸' } },
        { choiceId: 'choice_2', label: 'v750-tokoy', entity: { displayName: 'v750-tokoy' } },
    ],
});
const actionOf = text => classifyClarificationReply(text, CHOICE_QUESTION);

test('A07 肯定选择：只接受闭集整句序号语法与候选名', () => {
    for (const text of ['第二个', '第2个', '2', '二', '选第二个', '就第二个', '第二个吧', '我要第二个', 'v750-tokoy']) {
        const classified = actionOf(text);
        assert.equal(classified.action, CLARIFICATION_ACTION.SELECT, `${text} 应当是一次选择`);
        assert.equal(classified.choice.choiceId, 'choice_2', `${text} 应当选中第二项`);
    }
    assert.equal(actionOf('第一个').choice.choiceId, 'choice_1');
});

test('A07 新问题与否定句绝不从句内抢数字当选择', () => {
    for (const text of ['先查2寸泵壳的价格', '不要第一个', '不是第二个', '2寸泵壳', '12-140 的成本是多少', '第2个方案的成本是多少', '算了']) {
        const classified = actionOf(text);
        assert.notEqual(classified.action, CLARIFICATION_ACTION.SELECT, `${text} 不得被当成候选选择`);
        assert.equal(classified.choice, null);
    }
    assert.equal(actionOf('先查2寸泵壳的价格').action, CLARIFICATION_ACTION.NEW_TASK);
    assert.equal(actionOf('不要第一个').action, CLARIFICATION_ACTION.NEGATE);
    assert.equal(actionOf('不是第二个').action, CLARIFICATION_ACTION.NEGATE);
    assert.equal(actionOf('算了').action, CLARIFICATION_ACTION.CANCEL);
});

test('A07 无候选的问题按补参数处理，不走选择通道', () => {
    const parameterQuestion = { choices: [] };
    const classified = classifyClarificationReply('300台', parameterQuestion);
    assert.equal(classified.action, CLARIFICATION_ACTION.PROVIDE_PARAMETER);
    assert.equal(classified.choice, null);
});

test('A07 NEGATIVE_CONTROL：序号越界仍是「无效选择」，不会被当成新问题', () => {
    const classified = actionOf('第五个');
    assert.equal(classified.action, CLARIFICATION_ACTION.SELECT);
    assert.equal(classified.choice, null);
});
