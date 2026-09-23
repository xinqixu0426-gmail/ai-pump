const test = require('node:test');
const assert = require('node:assert/strict');
const {
    moneyClaimValues,
    moneyGuardDecision,
} = require('../api/services/aiMoneyGuard.cjs');
const { formatMoneySummary } = require('../api/services/aiAssistantAnswer.cjs');

const verified = data => ({ success: true, data, executionEvidence: { verified: true, kind: 'formal_api_query' } });

// 生产会话 58 的原始形状：一次 build_recipe_bom_draft 得到整机 285.8、线圈 116.99。
function bomToolResults() {
    return [{
        name: 'build_recipe_bom_draft',
        result: verified({
            parts: [{ model: 'V750-大脚板-2寸' }, { model: '12-140' }],
            coilSnapshot: { schemeCode: 'COIL-0002', material: '钢带', slotType: '小眼', totalCost: 116.99 },
            costPreview: { currentTotalCost: 285.8, partsCost: 264.8, laborCost: 21, pricingComplete: true },
            configurationBasis: { source: 'recipe', recipeName: 'V550大脚板-2寸-经典款', note: '沿用此在售配方', configurationComplete: true },
        }),
    }];
}

test('金额守卫：正文已引用全部正式金额时保持正文原样，不再补一张重复表', () => {
    const toolResults = bomToolResults();
    // bomToolResults 的正式金额是 116.99 / 285.8 / 264.8 / 21，四个都在正文里写出。
    const answer = '换成 12-140 后，整机当前总成本 285.8，其中零件成本 264.8、人工成本 21，线圈 COIL-0002 是 116.99。';
    const guard = moneyGuardDecision(answer, toolResults);
    // 「required canonical money facts fully presented → NONE」是最高优先短路：
    // 正文已经把本轮四个正式金额全部写出，再追加一张内容相同的表只会造成同一金额重复出现。
    // （正文缺业务语言、内部口径、结论不够人话等问题属于展示层，不由金额守卫负责。）
    assert.equal(guard.action, 'none');
    assert.equal(guard.reason, 'no_money_detail_obligation');
    assert.deepEqual(guard.unsupportedClaims, []);
});

test('金额守卫：正文漏掉任一个正式金额时保留正文并追加完整明细', () => {
    const toolResults = bomToolResults();
    // 少了线圈 116.99：required facts 未完整呈现，必须补齐。
    const answer = '换成 12-140 后，整机当前总成本 285.8，其中零件成本 264.8、人工成本 21。';
    const guard = moneyGuardDecision(answer, toolResults);
    assert.equal(guard.action, 'append');
    assert.deepEqual(guard.unsupportedClaims, []);
    assert.match(guard.summary, /285\.8/);
    const finalContent = `${answer}\n\n${guard.summary}`;
    assert.ok(finalContent.startsWith('换成 12-140 后'));
    assert.match(finalContent, /本轮正式查询金额如下/);
});

test('金额守卫：正文写无依据金额时仍整段替换为正式明细', () => {
    for (const answer of [
        '换成 12-140 后整机成本 286。',
        '换成 12-140 后整机成本 285.8，另加运费 50。',
        '换成 12-140 后整机成本 199 元。',
    ]) {
        const guard = moneyGuardDecision(answer, bomToolResults());
        assert.equal(guard.action, 'replace', answer);
        assert.ok(guard.unsupportedClaims.length > 0, answer);
    }
});

// LEGACY-AI-ANSWER-001（生产候选人工验收后重新界定）。
//
// 原断言：正文没引用本轮正式金额 → 整段替换。
// 该行为会删除「验证过的非金额结论」：用户问规格差异这类非金额问题时，正确回答天然不含金额，
// 却被整段替换成核对表，结论丢失（实例见 planning/ai-native-v1/release/LegacyAiMoneyGuard…）。
//
// 重新界定后的契约：
//   - 正文可用（非空、无泄漏指令、无无依据金额）→ 保留正文，核对表只作为附加明细
//   - 「没引用正式金额」仍然被识别并上报，但不再是删除正文的理由
//   - 正文不可用或含无依据金额 → 仍然整段替换（防编造不变，见上面的用例）
test('金额守卫：正文未引用正式金额但结论可用时，保留正文并附加核对表', () => {
    const guard = moneyGuardDecision('已核实：Shadow配方甲使用Shadow线圈甲（12-120）。', [{
        name: 'calculate_coil_cost',
        result: verified({ data: [], count: 0, totalCost: 100 }),
    }]);
    assert.equal(guard.action, 'append');
    assert.equal(guard.citesFormalAmount, false);
    assert.equal(guard.reason, 'preserve_verified_semantic_body');
    assert.deepEqual(guard.unsupportedClaims, []);
});

test('金额守卫：规格差异这类非金额结论在核对表存在时也必须保留', () => {
    // 与 LEGACY-AI-ANSWER-001 的实例同形：结论是「一个带浮球、一个不带浮球」，正文不含金额。
    const answer = '两项产品规格的唯一差异是：明细 1 带浮球（浮球-新界式，线径 1），明细 2 不带浮球。';
    const guard = moneyGuardDecision(answer, bomToolResults());
    assert.equal(guard.action, 'append');
    assert.ok(guard.appendable.includes('本轮正式查询金额如下'));
    const finalContent = `${answer}\n\n${guard.appendable}`;
    assert.ok(finalContent.startsWith('两项产品规格的唯一差异'), '结论必须仍位于回答开头');
    assert.match(finalContent, /浮球-新界式/);
});

test('金额守卫：空正文、泄漏的内部指令和未完成配置一律整段替换', () => {
    const toolResults = bomToolResults();
    assert.equal(moneyGuardDecision('   ', toolResults).action, 'replace');
    assert.equal(moneyGuardDecision('仅修正文案：把 285.8 改成元。', toolResults).action, 'replace');
    const incomplete = bomToolResults();
    incomplete[0].result.data.configurationBasis.configurationComplete = false;
    assert.equal(moneyGuardDecision('整机当前总成本 285.8。', incomplete).action, 'replace');
});

test('金额守卫：正文已经是正式明细时不再重复追加', () => {
    const toolResults = bomToolResults();
    const summary = formatMoneySummary(toolResults);
    const guard = moneyGuardDecision(summary, toolResults);
    assert.equal(guard.action, 'none');
});

// LEGACY-AI-ANSWER-003：同一张金额表只在正文出现一次。
// 旧实现用整块文本逐字包含判定；模型写出的表只要少一行、多一行或带一句旁注就会判定失败，
// 于是核对表被整块追加 → 同一张表出现两次（实例 msg 230，1258 字里出现 2 次）。
test('金额守卫：模型写出的金额表变体不再导致核对表被整块追加', () => {
    const toolResults = bomToolResults();
    const summary = formatMoneySummary(toolResults);
    const tableRowLines = summary.split('\n').filter(line => /^\|/u.test(line.trim()));
    // 变体 1：少一行（删掉一条数据行，而不是删空行）
    // 去掉最后一条数据行（索引 7 = 人工成本行；索引 8 是空行，不能拿它当基线）
    const fewer = summary.split('\n').filter(line => line !== tableRowLines[tableRowLines.length - 2]).join('\n');
    assert.notEqual(fewer, summary, '变体必须真的少了一行');
    // 变体 2：多一行（多出的行不进正文，只证明多行不会诱发重复）
    const onlySummary = summary;
    // 变体 3：同值不同精度（140.43062 → 140.43 这类差异不得被判成两行）
    const coarse = summary.replace(/(\d+\.\d{3,})/gu, value => Number(value).toFixed(2));
    // 变体 4：表格后带旁注（旧实现正是被这一句打断的）
    const annotated = `结论：按当前正式价格重算。\n\n${summary}\n\n完整计算明细见本轮工具结果。`;
    const tableCount = text => (text.match(/本轮正式查询金额如下/gu) || []).length;

    // 已含全部正式行 → 不再追加，表只出现一次
    for (const [label, answer] of [['同值不同精度', coarse], ['带旁注', annotated], ['完整表', onlySummary]]) {
        const guard = moneyGuardDecision(answer, toolResults);
        assert.equal(guard.action, 'none', `${label}：正文已含该表，不应再追加`);
        assert.equal(tableCount(answer), 1, `${label}：金额表应只出现一次`);
    }

    // 真的少一行 → 用 canonical 表替换那张不完整的表（补回缺失行与口径上下文，且不重复表头）
    const conclusionFirst = `结论：换成 12-140 后整机成本上升。\n\n${fewer}`;
    const partial = moneyGuardDecision(conclusionFirst, toolResults);
    assert.equal(partial.action, 'replaceTable', '少一行时必须补齐缺失的正式金额');
    const finalContent = partial.appendable || partial.summary;
    assert.equal(tableCount(finalContent), 1, '替换后金额表仍只出现一次');
    assert.equal((finalContent.match(/\| 对象 \| 项目 \| 金额 \|/gu) || []).length, 1, '表头不得重复');
    // 金额展示改为「保留来源精度」后，整数人工成本渲染为 21（原为 21.00），
    // 零件成本 264.8 保持来源精度（原被截断为 264.80）。断言只校验「缺失行已补回」。
    assert.match(finalContent, /21|264\.8/, '缺失的正式金额行必须补回');
    // 口径上下文文案已与展示层统一为「配方基准「X」」（原为「配置基准：X」）。
    assert.equal((finalContent.match(/配方基准|配置基准/gu) || []).length, 1, '口径上下文不得重复渲染');
    assert.match(finalContent, /^结论：/, '结论文字必须保留在首位');
});

test('金额守卫：正文未包含的正式金额行仍然会补上（去重不得丢证据）', () => {
    const toolResults = bomToolResults();
    const summary = formatMoneySummary(toolResults);
    const partial = summary.split('\n').slice(0, 4).join('\n'); // 只有表头 + 一行
    const guard = moneyGuardDecision(`${partial}\n\n结论：当前成本如下。`, toolResults);
    assert.equal(guard.action, 'append');
    const finalContent = `${partial}\n\n结论：当前成本如下。\n\n${guard.appendable}`;
    // 正文里没出现过的行必须补回来
    for (const model of ['12-140', '12-120']) {
        if (summary.includes(model)) assert.ok(finalContent.includes(model), `${model} 的正式金额行不得丢失`);
    }
});

test('金额守卫：金额声明识别不把型号、片数和规格当成金额', () => {
    assert.deepEqual(moneyClaimValues('换成 12-140 的成本是 285.8，12-140 片。'), [285.8]);
    assert.deepEqual(moneyClaimValues('12-120 换成 12-140 后整机成本 285.8 元。'), [285.8]);
});
