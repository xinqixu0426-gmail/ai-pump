'use strict';
// 结构性整改的可执行 oracle。只用两个树都存在的公开接口，
// 因此可以在「审计基线」与「整改后」两棵树上跑同一份断言：
//   审计基线 → 必须 RED（缺陷复现）
//   整改后   → 必须 GREEN
const path = process.argv[2];
const req = name => require(`${path}/${name}`);
const { formatMoneySummary, unsupportedMoneyInAnswer, monetaryValues } = req('api/services/aiAssistantAnswer.cjs');
const guard = req('api/services/aiMoneyGuard.cjs');
const pres = req('api/services/aiPresentationNormalizer.cjs');

const verified = data => ({ success: true, data, executionEvidence: { verified: true, kind: 'formal_api_query' } });
const COST_GOAL = Object.freeze({ monetary: true, kind: 'COST_QUERY', operation: 'READ_COST' });
const checks = [];
const check = (id, label, fn) => {
    try { fn(); checks.push([id, label, 'GREEN']); }
    catch (error) { checks.push([id, label, `RED: ${error.message.split('\n')[0]}`]); }
};
const eq = (actual, expected, message) => {
    const a = JSON.stringify(actual); const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${message} (actual=${a} expected=${b})`);
};
const ok = (value, message) => { if (!value) throw new Error(message); };

// ── A01 ─────────────────────────────────────────────────────────────
check('A01a', '两个不同实体金额相同，两条都保留', () => {
    const summary = formatMoneySummary([{ name: 'compare_recipes', result: verified({ recipe1: { name: '方案甲', cost: 100 }, recipe2: { name: '方案乙', cost: 100 }, costDiff: '0' }) }], { includeQueries: true });
    ok(summary.includes('方案甲') && summary.includes('方案乙'), '同价不同实体被吞掉');
});
check('A01b', '同名不同 ID、金额不同，两条都保留', () => {
    const summary = formatMoneySummary([{ name: 'search_coils', result: verified([{ id: 9, name: '同名线圈', cost: 100 }, { id: 8, name: '同名线圈', cost: 200 }]) }], { includeQueries: true });
    const values = [...summary.matchAll(/\|\s*(\d+)\s*\|/gu)].map(match => Number(match[1]));
    ok(values.includes(100) && values.includes(200), '同名不同身份被吞掉');
});

// ── A02 ─────────────────────────────────────────────────────────────
check('A02', '金额交换（A=200/B=100）被发现并纠正', () => {
    const results = [{ name: 'compare_recipes', result: verified({ recipe1: { name: 'A', cost: 100 }, recipe2: { name: 'B', cost: 200 }, costDiff: '100' }) }];
    const canonical = formatMoneySummary(results, { includeQueries: true });
    // 与标签措辞无关地交换两个实体的金额：只改每行末尾的金额单元格。
    const cellsOf = line => line.trim().replace(/^\|/u, '').replace(/\|$/u, '').split('|').map(cell => cell.trim());
    const dataRows = canonical.split('\n').filter(line => /^\|/u.test(line) && !/对象|:?-{3,}/u.test(line));
    const left = cellsOf(dataRows[0]); const right = cellsOf(dataRows[1]); const diff = cellsOf(dataRows[2]);
    left[left.length - 1] = '200'; right[right.length - 1] = '100';
    const swapped = `| 对象 | 项目 | 金额 |\n|---|---|---:|\n| ${left.join(' | ')} |\n| ${right.join(' | ')} |\n| ${diff.join(' | ')} |`;
    ok(swapped !== canonical, '夹具未生效');
    const reported = unsupportedMoneyInAnswer(swapped, results).slice().sort((a, b) => a - b);
    eq(reported, [100, 200], '关联错误未被上报');
    const decision = guard.moneyGuardDecision(swapped, results, COST_GOAL);
    ok(decision.action !== 'none', '关联错误未触发纠正');
});

// ── A03 ─────────────────────────────────────────────────────────────
check('A03a', "citesResultFact('当前库存999套。') 不得为 true", () => {
    const results = [{ name: 'search_coils', result: verified({ stock: 5, cost: 123 }) }];
    eq(guard.citesResultFact('当前库存999套。', results), false, '编造的库存被当成已核实事实');
    eq(guard.citesResultFact('当前库存5套。', results), true, '真实的库存未被识别');
});
check('A03b', '数量语境不得撤回同值的金额声明', () => {
    const formal = new Set([123]);
    eq(guard.moneyClaimValues('成本999。', formal), [999], '单独的金额声明未被识别');
    eq(guard.moneyClaimValues('当前库存999套，成本999。', formal), [999], '金额词锚定的声明被数量语境撤回');
});

// ── A04 ─────────────────────────────────────────────────────────────
check('A04a', '删掉 ID 列后两行无法区分时必须保留 ID 列', () => {
    const table = '| 配方ID | 当前成本 |\n|---|---:|\n| 9 | 100 |\n| 8 | 100 |';
    eq(pres.hideInternalIdColumns(table, pres.presentationRequest('')), table, 'ID 列被删除，用户失去区分候选的能力');
});
check('A04b', '「请选择配方ID 12或配方ID 13。」不得变成「请选择或。」', () => {
    const sentence = '请选择配方ID 12或配方ID 13。';
    eq(pres.hideInternalIds(sentence, pres.presentationRequest('')), sentence, '候选唯一身份被删除');
});

// ── A05 ─────────────────────────────────────────────────────────────
check('A05', '结构化缺料项换写法后仍必须保留', () => {
    const toolResults = [{ name: 'search_parts', result: verified([
        ...Array.from({ length: 10 }, (_, index) => ({ model: `常规件${index + 1}`, required: 400, stock: 400 })),
        { model: '6202轴承', required: 400, stock: 100, shortage: 300 },
        { model: '常规件12', required: 400, stock: 400 },
    ]) }];
    if (typeof pres.buildListCriticality !== 'function') throw new Error('缺少结构化关键性输入构造');
    const rows = [
        ...Array.from({ length: 10 }, (_, index) => `- 常规件${index + 1}：需求400个，现存400个。`),
        '- 6202轴承：需求400个，现存100个，缺口300个（新写法）。',
        '- 常规件12：需求400个，现存400个。',
    ];
    const out = pres.normalizeAnswerPresentation(`库存检查结果如下。\n\n${rows.join('\n')}`, '查库存', { criticality: pres.buildListCriticality(toolResults) });
    ok(out.includes('缺口300个'), '结构化关键行被隐藏');
});

// ── A06 ─────────────────────────────────────────────────────────────
check('A06', '整机成本不得被改写成线圈口径；线圈成本必须带线圈口径', () => {
    const machine = formatMoneySummary([{ name: 'compare_recipes', result: verified({ recipe1: { name: 'V550整机', cost: 268 }, recipe2: { name: 'V550甲', spec: '定制', cost: 300 } }) }], { includeQueries: true });
    ok(!machine.includes('线圈档案成本'), '整机成本被改写成线圈口径');
    const coil = formatMoneySummary([{ name: 'search_coils', result: verified([{ schemeCode: 'COIL-A', cost: 166.7136 }]) }], { includeQueries: true });
    ok(coil.includes('线圈档案成本'), '线圈档案成本缺少线圈口径');
    eq(pres.normalizeAnswerPresentation('| 对象 | 项目 | 金额 |\n|---|---|---:|\n| V550整机 | 档案成本 | 268 |'), '| 对象 | 项目 | 金额 |\n|---|---|---:|\n| V550整机 | 档案成本 | 268 |', '展示层仍在改写口径');
});

// ── A07 ─────────────────────────────────────────────────────────────
check('A07', '澄清回复的动作边界：否定/新问题不得从句内抢数字当选择', () => {
    const controller = req('api/services/aiTaskControllerV2.cjs');
    if (typeof controller.classifyClarificationReply !== 'function') {
        throw new Error('旧实现没有澄清动作分类：句内第一个数字会被当成肯定选择（「不要第一个」→choice_1）');
    }
    const question = { choices: [{ choiceId: 'choice_1', label: '甲', entity: { displayName: '甲' } }, { choiceId: 'choice_2', label: '乙', entity: { displayName: '乙' } }] };
    for (const text of ['先查2寸泵壳的价格', '不要第一个', '不是第二个']) {
        ok(controller.classifyClarificationReply(text, question).action !== 'SELECT', `${text} 被当成候选选择`);
    }
    eq(controller.classifyClarificationReply('第二个', question).choice.choiceId, 'choice_2', '肯定选择未被识别');
});

console.log(`\n=== oracle @ ${path} ===`);
for (const [id, label, status] of checks) console.log(`${status.startsWith('RED') ? 'RED  ' : 'GREEN'} ${id.padEnd(5)} ${label}${status.startsWith('RED') ? `\n      ${status}` : ''}`);
const red = checks.filter(item => item[2].startsWith('RED')).length;
console.log(`\nsummary: ${checks.length - red}/${checks.length} GREEN, ${red} RED`);
process.exitCode = red ? 1 : 0;
