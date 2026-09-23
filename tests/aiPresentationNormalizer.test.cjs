'use strict';
/**
 * Part 2 展示层规范化测试（LEGACY-AI-ANSWER-002 / 005）。
 *
 * 覆盖 Supervisor 要求的全部策略与负向对照：
 *   机器词汇策略、默认隐藏内部 ID、显式 ID 请求、调试模式、结论先行、
 *   决策相关 proposition 保全、长清单默认摘要、显式明细请求、
 *   未被请求的延伸邀约清理、必需澄清保留、原文精度请求、金额表不受损、幂等。
 *
 * 语料取自 defect 记录里实测到的真实文本。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeAnswerPresentation,
    presentationRequest,
    businessVocabulary,
    summarizeLongLists,
    trimUnsolicitedInvitations,
    conclusionFirst,
    listRowTier,
    TOOL_LABEL_TO_BUSINESS,
    LIST_TIER,
    NEUTRAL_DETAIL_LIMIT,
} = require('../api/services/aiPresentationNormalizer.cjs');
const { moneyGuardDecision } = require('../api/services/aiMoneyGuard.cjs');

const normalize = (answer, userText = '') => normalizeAnswerPresentation(answer, userText);

// defect 记录里的真实片段（LegacyAiMachineVocabulary…DefectV1.json）。
const MONEY_TABLE_WITH_TOOL_NAME = '本轮正式查询金额如下（元）：\n\n'
    + '| 对象 | 项目 | 金额 |\n|---|---|---:|\n'
    + '| 读取订单知识包 | 总成本 | 32225 |\n| 生成 BOM 草稿 | 当前总成本 | 285.8 |\n\n'
    + '完整计算明细见本轮工具结果。';

test('展示层：工具显示名不再作为用户可见回答的对象主体（LEGACY-AI-ANSWER-002）', () => {
    const out = normalize(MONEY_TABLE_WITH_TOOL_NAME);
    assert.doesNotMatch(out, /读取订单知识包/, '工具显示名不得出现在对象位置');
    assert.doesNotMatch(out, /生成 BOM 草稿/, '工具显示名不得出现在对象位置');
    assert.match(out, /\| 订单 \| 总成本 \| 32225 \|/);
    assert.match(out, /\| 配置成本 \| 当前总成本 \| 285\.8 \|/);
    // 金额表本身必须完好：表头与数值都不动。
    assert.match(out, /\| 对象 \| 项目 \| 金额 \|/);
    assert.equal((out.match(/本轮正式查询金额如下/gu) || []).length, 1);
});

test('展示层：映射表是有界且集中的，全部键来自 registry 的真实显示名', () => {
    const { getAiCapability } = require('../api/capabilities/registry.cjs');
    // 抽查若干键确实是 registry 里存在的 displayName。
    for (const displayName of ['读取订单知识包', '生成 BOM 草稿', '配方成本试算', '查询线圈库存']) {
        assert.ok(Object.prototype.hasOwnProperty.call(TOOL_LABEL_TO_BUSINESS, displayName),
            `${displayName} 必须在集中映射表里`);
    }
    assert.equal(getAiCapability('get_order_knowledge_package').displayName, '读取订单知识包');
    assert.equal(getAiCapability('build_recipe_bom_draft').displayName, '生成 BOM 草稿');
    assert.equal(getAiCapability('preview_recipe_cost').displayName, '配方成本试算');
});

test('展示层：默认隐藏内部 ID 代号，但对象仍有可读身份时不留空壳', () => {
    const answer = '配方ID 12（V750-大脚板-2寸）当前成本是 285.8 元。';
    const out = normalize(answer);
    assert.doesNotMatch(out, /配方ID/, '内部 ID 代号默认不得出现');
    assert.match(out, /V750-大脚板-2寸/, '业务可读身份必须保留');
});

test('展示层：显式要求 ID 时可见（负向对照）', () => {
    const answer = '配方ID 12（V750-大脚板-2寸）当前成本是 285.8 元。';
    const out = normalize(answer, '这个配方的ID是多少');
    assert.match(out, /配方ID 12/, '用户显式询问 ID 时必须可见');
    assert.equal(presentationRequest('这个配方的ID是多少').wantsIds, true);
});

test('展示层：调试模式保留机器词汇（负向对照）', () => {
    const out = normalize(MONEY_TABLE_WITH_TOOL_NAME, '给我看调试信息和工具调用');
    assert.match(out, /读取订单知识包/, '调试模式下机器语言按请求保留');
    assert.equal(presentationRequest('给我看调试信息和工具调用').wantsMachineLanguage, true);
});

test('展示层：结论先行 —— 正文以机器形态开头时把业务结论提到最前', () => {
    const answer = '本轮正式查询金额如下（元）：\n\n| 对象 | 项目 | 金额 |\n|---|---|---:|\n| 订单 | 总成本 | 100 |\n\n'
        + '这两个配置的成本差异是 8.50 元。';
    const out = normalize(answer);
    assert.ok(out.startsWith('这两个配置的成本差异'), `结论必须位于开头，实际：${out.slice(0, 40)}`);
    assert.match(out, /\| 订单 \| 总成本 \| 100 \|/, '金额表必须完整保留');
});

test('展示层：已有业务结论开头时不做任何重排', () => {
    const answer = '一个配置有浮球，另一个没有。\n\n| 对象 | 项目 | 金额 |\n|---|---|---:|\n| 订单 | 总成本 | 100 |';
    assert.equal(normalize(answer), answer);
});

test('展示层：决策相关 proposition 不得被压缩掉（缺 3 个 6202 轴承）', () => {
    const shortage = '- 缺 3 个 6202 轴承';
    const noise = Array.from({ length: 15 }, (_, index) => `- 常规项 ${index + 1}`);
    const answer = `库存检查结论如下。\n\n${[shortage, ...noise].join('\n')}`;
    const out = normalize(answer);
    assert.match(out, /缺 3 个 6202 轴承/, '已核实的精确缺料必须逐字保留');
    assert.match(out, /另有 \d+ 项未展开/, '长清单必须给出明确的未展开条数');
    assert.ok(out.split('\n').length < answer.split('\n').length, '长清单必须真的被摘要');
});

test('展示层：长清单摘要保留缺失/不完整/歧义/策略拒绝等信息', () => {
    const lines = [
        '- 常规项 A', '- 常规项 B', '- 常规项 C', '- 常规项 D', '- 常规项 E',
        '- 常规项 F', '- 常规项 G', '- 常规项 H', '- 常规项 I', '- 常规项 J',
        '- 配置尚未全部定价，当前金额不是完整报价',
        '- 两个候选需要你确认选哪一个',
    ];
    const out = summarizeLongLists(`明细如下。\n\n${lines.join('\n')}`, presentationRequest(''));
    assert.match(out, /配置尚未全部定价/, '不完整状态必须保留');
    assert.match(out, /需要你确认选哪一个/, '歧义必须保留');
});

test('展示层：显式要求全部明细时不做摘要（负向对照）', () => {
    const lines = Array.from({ length: 15 }, (_, index) => `- 常规项 ${index + 1}`);
    const answer = `明细如下。\n\n${lines.join('\n')}`;
    const out = normalize(answer, '把全部零件明细列出来');
    assert.equal(out, answer, '用户要求全部明细时必须完整保留');
    assert.equal(presentationRequest('把全部零件明细列出来').wantsDetail, true);
    assert.ok(NEUTRAL_DETAIL_LIMIT > 0);
});

// ── Part 2-R1：长清单展示相关性契约 ────────────────────────────────
test('展示层：层级契约 —— 只有中性明细可压缩，Tier1/Tier2 不受展示容量限制', () => {
    assert.equal(listRowTier('- 缺 300 个 6202 轴承'), LIST_TIER.DECISION_CRITICAL);
    assert.equal(listRowTier('- 配置尚未全部定价'), LIST_TIER.DECISION_CRITICAL);
    assert.equal(listRowTier('- 两个候选需要确认选哪一个'), LIST_TIER.DECISION_CRITICAL);
    assert.equal(listRowTier('- 未定价的电缆'), LIST_TIER.DECISION_CRITICAL);
    assert.equal(listRowTier('- 合计 100 元'), LIST_TIER.DIRECT_SUPPORT);
    assert.equal(listRowTier('- 与上一版相差 8.50 元'), LIST_TIER.DIRECT_SUPPORT);
    assert.equal(listRowTier('- 6202 轴承 x 12'), LIST_TIER.NEUTRAL_DETAIL);
    assert.equal(listRowTier('- 常规项 3'), LIST_TIER.NEUTRAL_DETAIL);
});

test('展示层R1：第 11 行的缺料行必须保留（不得按前 N 项隐藏）', () => {
    const rows = Array.from({ length: 10 }, (_, index) => `- 常规项 ${index + 1}（库存充足）`);
    rows.push('- 缺 300 个 6202 轴承');
    rows.push('- 常规项 12（库存充足）');
    const answer = `库存检查结果如下。\n\n${rows.join('\n')}`;
    const out = normalize(answer);
    assert.match(out, /缺 300 个 6202 轴承/, '第 11 行的缺料行位于展示容量之后，仍必须可见');
    assert.match(out, /另有 \d+ 项未展开/, '必须报出未展开条数');
    assert.doesNotMatch(out, /最重要|优先展示/, '不得声称前 N 项是「最重要」的');
    // 中性行可以被省略（这才是允许压缩的那一层）。
    assert.ok(!out.includes('- 常规项 10（库存充足）') || !out.includes('- 常规项 12（库存充足）'),
        '至少有一个中性行被省略，证明压缩确实只作用于中性层');
});

test('展示层R1：唯一有差异的行位于展示容量之后时仍必须保留', () => {
    const rows = Array.from({ length: 10 }, (_, index) => `- 配置项 ${index + 1}：一致`);
    rows.push('- 配置项 11：与基准不同 —— 多了浮球');
    const answer = `两套配置对比结果。\n\n${rows.join('\n')}`;
    const out = normalize(answer);
    assert.match(out, /配置项 11：与基准不同/, '唯一差异行必须保留');
    assert.match(out, /多了浮球/, '差异的具体内容不得被压成笼统表述');
});

test('展示层R1：位于容量之后的未定价项与其警告必须保留', () => {
    const rows = Array.from({ length: 10 }, (_, index) => `- 零件 ${index + 1}：已定价`);
    rows.push('- 零件 11：未定价的电缆，当前金额不是完整报价');
    const answer = `配置明细如下。\n\n${rows.join('\n')}`;
    const out = normalize(answer);
    assert.match(out, /未定价的电缆/, '未定价项必须保留');
    assert.match(out, /当前金额不是完整报价/, '关联警告必须完整保留');
});

test('展示层R1：带浮球差异不得被压成笼统摘要（即使源行靠后）', () => {
    const rows = Array.from({ length: 10 }, (_, index) => `- 明细 ${index + 1}：规格相同`);
    rows.push('- 明细 11：一个带浮球，一个不带');
    const answer = `两项产品规格对比。\n\n${rows.join('\n')}`;
    const out = normalize(answer);
    assert.match(out, /一个带浮球，一个不带/, '浮球差异必须逐字保留');
});

test('展示层R1：Tier1 很多时可见条数可以超过展示容量（容量不是相关性排序）', () => {
    const rows = [
        ...Array.from({ length: 12 }, (_, index) => `- 缺 ${index + 1} 个零件-${index + 1}`),
        ...Array.from({ length: 12 }, (_, index) => `- 常规项 ${index + 1}`),
    ];
    const answer = `库存检查如下。\n\n${rows.join('\n')}`;
    const out = normalize(answer);
    const visibleListRows = out.split('\n').filter(line => /^\s*[-*•]/u.test(line)).length;
    assert.ok(visibleListRows > NEUTRAL_DETAIL_LIMIT,
        `12 条缺料必须全部可见，可见条数 ${visibleListRows} 应超过容量 ${NEUTRAL_DETAIL_LIMIT}`);
    for (let index = 1; index <= 12; index += 1) {
        assert.ok(out.includes(`缺 ${index} 个零件-${index}`), `缺料行 ${index} 必须保留`);
    }
});

test('展示层R1：相关性压缩不得逐次继续删除', () => {
    const rows = [
        ...Array.from({ length: 10 }, (_, index) => `- 常规项 ${index + 1}`),
        '- 缺 300 个 6202 轴承',
        '- 常规项 12',
    ];
    const answer = `库存检查如下。\n\n${rows.join('\n')}`;
    const once = summarizeLongLists(answer, presentationRequest(''));
    const twice = summarizeLongLists(once, presentationRequest(''));
    const thrice = summarizeLongLists(twice, presentationRequest(''));
    assert.equal(once, twice, '第二次压缩不得继续删除');
    assert.equal(twice, thrice, '第三次压缩不得继续删除');
    assert.match(once, /缺 300 个 6202 轴承/);
});

test('展示层：表格里的内部 ID 列默认移除，但决策信息必须全保留（缺陷 002 未覆盖形态）', () => {
    // 真实复现：问「查询V750配方当前名称」时回答带出 | 配方ID | 名称 | 规格摘要 |。
    // 原先只匹配「配方ID 12」这种带值形式，匹配不到表头，于是内部 ID 整列默认可见。
    const answer = [
        'V750 相关配方当前有 3 个名称（未唯一匹配）：',
        '',
        '| 配方ID | 名称 | 规格摘要 |',
        '|---|---|---|',
        '| 9 | V750-大脚板-2寸 | 机筒 210mm |',
        '| 8 | v750-tokoy- | 12-140，带浮球，木箱，8米线（机筒 160mm） |',
        '| 2 | v750-tokoy | 12-140，带浮球，木箱，8米线（机筒 175mm） |',
        '',
        '其中配方 2 与 8 名称仅差一个尾随“-”，配置也不同（机筒 160/175mm、叶轮 450/400）。请告知你要看哪一个（或指定配方ID），我再读取其明细。',
    ].join('\n');
    const out = normalize(answer, '查询V750配方当前名称');
    // 内部 ID 表头必须消失（这是本次修复的目标）
    assert.doesNotMatch(out, /\|\s*配方ID\s*\|/u, 'ID 表头不得出现');
    // 决策信息必须全保留
    for (const must of ['V750-大脚板-2寸', 'v750-tokoy-', 'v750-tokoy', '机筒 210mm', '机筒 160mm',
        '名称仅差一个尾随', '请告知你要看哪一个']) {
        assert.ok(out.includes(must), `必须保留：${must}`);
    }
    assert.match(out, /\| 名称 \| 规格摘要 \|/, '可读表头必须保留');
    // 不得把正常计数误删（「当前有 3 个名称」里的 3 不是 ID）
    assert.match(out, /当前有 3 个名称/, '正常计数不得被当成 ID 删除');
    // 幂等
    assert.equal(normalize(out, '查询V750配方当前名称'), out);
});

test('展示层：本函数只处理表格列，不碰行内 ID（行内由 hideInternalIds 按既有规则负责）', () => {
    // 既有回归保护：跨目录候选的「（泵壳模板 ID 3）」是消歧必需信息，必须原样保留。
    const answer = '已核实：正式目录中的相近型号：模板-V750大脚板-2寸-经典款（泵壳模板 ID 3）。';
    assert.equal(normalize(answer, 'V750 是什么'), answer, '行内 ID 不得被本函数删除');
});

test('展示层：显式要 ID / 调试 / 明细时，表格 ID 列必须保留（负向对照）', () => {
    const answer = '| 配方ID | 名称 |\n|---|---|\n| 9 | V750-大脚板-2寸 |';
    for (const question of ['把配方ID列出来', '给我看调试信息', '列全部明细']) {
        const out = normalize(answer, question);
        assert.match(out, /\|\s*配方ID\s*\|/u, `${question}：ID 列必须可见`);
    }
});

test('展示层：ID 是唯一身份时不得移除（保守分支）', () => {
    const idOnly = '| 配方ID |\n|---|\n| 9 |\n| 8 |';
    assert.equal(normalize(idOnly, '看看'), idOnly, '没有可读身份时必须保留 ID');
});

test('展示层：不含 ID 的表格不得被动，也不得新增第二张表', () => {
    const plain = '| 名称 | 规格 |\n|---|---|\n| A | 1 |';
    assert.equal(normalize(plain, '看看'), plain);
});

test('展示层R1：显式明细请求对中性明细同样不压缩（不得回归）', () => {    const rows = [
        ...Array.from({ length: 10 }, (_, index) => `- 常规项 ${index + 1}`),
        '- 缺 300 个 6202 轴承',
        '- 常规项 12',
    ];
    const answer = `库存检查如下。\n\n${rows.join('\n')}`;
    for (const request of ['列全部明细', '全部零件', '详细一点']) {
        assert.equal(normalize(answer, request), answer, `${request}：必须完整保留，不得压缩中性明细`);
    }
});

test('展示层：清理未被请求的延伸邀约（LEGACY-AI-ANSWER-005）', () => {
    const answer = '这两个配置的成本差异是 8.50 元。\n\n我可以继续帮你比较其他配置。';
    const out = normalize(answer);
    assert.doesNotMatch(out, /我可以继续/, '未被请求的延伸邀约必须移除');
    assert.match(out, /成本差异是 8\.50 元/, '业务结论必须保留');
});

test('展示层：清理邀约时不得连带删除决策相关信息（真实回归）', () => {
    // defect 记录里的真实末句：整句删除会抹掉「按在售配方为基准重新核算」。
    const answer = '12-140 钢带小眼的当前成本是 116.99 元。\n\n'
        + '口径说明：上面的金额是**线圈方案成本**。整机（成品）成本要按在售配方为基准重新核算，'
        + '包含泵壳、零件、人工、包装等；需要的话我按你指定的配方继续算。';
    const out = normalize(answer, 'V550 配方的成本是多少（配 12-140 那套线圈）');
    assert.match(out, /整机（成品）成本要按在售配方为基准重新核算/, '决策相关的口径说明必须保留');
    assert.doesNotMatch(out, /需要的话我按你指定的配方继续算/, '邀约分句应被移除');
});

test('展示层：必需的澄清与下一步动作必须保留', () => {
    for (const required of [
        '需要你确认具体型号后我再试算。',
        '请选择两个候选之一。',
        '缺少铜价，无法继续正式计算。',
        '该配置尚未全部定价，请先补充缺项。',
    ]) {
        const answer = `已核实当前配置。\n\n${required}`;
        assert.match(normalize(answer), new RegExp(required.slice(0, 6)), `必须保留：${required}`);
    }
});

test('展示层：不承担成本口径判断 —— 口径标签由事实投影按实体类型给出（A06）', () => {
    // 旧实现：展示层把表格里的「档案成本」**全文无条件**替换成「线圈档案成本」。
    // 那不是换个更友好的词，而是把**整机**成本改写成**线圈**口径。
    // 现在口径标签在事实投影（moneyFactProjection）里按 entity type + predicate 生成，
    // 展示层不再改写业务口径，也无法替上游决定口径。
    const verifiedResult = data => ({ success: true, data, executionEvidence: { verified: true, kind: 'formal_api_query' } });
    const { formatMoneySummary } = require('../api/services/aiAssistantAnswer.cjs');
    const coil = formatMoneySummary([
        { name: 'search_coils', result: verifiedResult([{ schemeCode: 'COIL-A', cost: 166.7136 }]) },
    ], { includeQueries: true });
    assert.match(coil, /线圈档案成本/, '线圈档案 cost 必须标成线圈档案成本');
    assert.match(coil, /166\.7136/, '金额数值与来源精度必须逐字不变');
    const machine = formatMoneySummary([
        { name: 'compare_recipes', result: verifiedResult({ recipe1: { name: 'V550整机', cost: 268 }, recipe2: { name: 'V550甲', spec: '定制', cost: 300 } }) },
    ], { includeQueries: true });
    assert.match(machine, /V550整机 \| 成本 \| 268 \|/, '整机成本必须保留自己的口径标签');
    assert.doesNotMatch(machine, /线圈档案成本/, '整机成本不得被改写成线圈口径');
    // 展示层对无法归属实体类型的表格保持原样（保守，不推断口径）。
    const unknown = '| 对象 | 项目 | 金额 |\n|---|---|---:|\n| 未知主体 | 档案成本 | 268 |';
    assert.equal(normalize(unknown), unknown, '展示层不得猜测未知主体的成本口径');
});

test('展示层：原文精度请求下不改变任何数字（负向对照）', () => {
    const answer = '| 对象 | 项目 | 金额 |\n|---|---|---:|\n| 线圈 | 档案成本 | 166.7136 |';
    const out = normalize(answer, '给我原始精度，不要四舍五入');
    assert.equal(presentationRequest('给我原始精度，不要四舍五入').wantsRawPrecision, true);
    assert.match(out, /166\.7136/);
});

test('展示层：幂等 NORMALIZE(NORMALIZE(x)) == NORMALIZE(x)', () => {
    const samples = [
        [MONEY_TABLE_WITH_TOOL_NAME, ''],
        ['这两个配置的成本差异是 8.50 元。\n\n我可以继续帮你比较其他配置。', ''],
        ['一个配置有浮球，另一个没有。\n\n| 对象 | 项目 | 金额 |\n|---|---|---:|\n| 订单 | 总成本 | 100 |', ''],
        ['配方ID 12（V750-大脚板-2寸）当前成本是 285.8 元。', ''],
        ['12-140 钢带小眼的当前成本是 116.99 元。\n\n口径说明：上面的金额是**线圈方案成本**。'
            + '整机（成品）成本要按在售配方为基准重新核算，包含泵壳、零件、人工、包装等；需要的话我按你指定的配方继续算。', 'V550 配方的成本是多少'],
        [`明细如下。\n\n${Array.from({ length: 15 }, (_, i) => `- 常规项 ${i + 1}`).join('\n')}`, ''],
    ];
    for (const [answer, userText] of samples) {
        const once = normalize(answer, userText);
        const twice = normalize(once, userText);
        const thrice = normalize(twice, userText);
        assert.equal(once, twice, `第二次规范化改变了结果：${answer.slice(0, 24)}`);
        assert.equal(twice, thrice, `第三次规范化改变了结果：${answer.slice(0, 24)}`);
    }
});

test('展示层：不制造第二张金额表，也不改动金额数值', () => {
    const answer = '换成 12-140 后整机当前总成本 285.8。\n\n'
        + '| 对象 | 项目 | 金额 |\n|---|---|---:|\n| 生成 BOM 草稿 | 当前总成本 | 285.8 |';
    const out = normalize(answer);
    assert.equal((out.match(/本轮正式查询金额如下/gu) || []).length, 0, '不得新增金额表标题');
    assert.equal((out.match(/\| 对象 \| 项目 \| 金额 \|/gu) || []).length, 1, '金额表只能有一张');
    assert.match(out, /285\.8/);
    assert.doesNotMatch(out, /285\.80/, '不得改变金额精度');
});

test('展示层：不影响金额守卫的判定（Part 1 行为保持）', () => {
    const verified = data => ({ success: true, data, executionEvidence: { verified: true, kind: 'formal_api_query' } });
    const costPreview = { currentTotalCost: 285.8, partsCost: 264.8, laborCost: 21, pricingComplete: true };
    const toolResults = [{ name: 'build_recipe_bom_draft', result: verified({ costPreview }) }];
    const turn = require('../api/capabilities/monetaryPresentationContract.cjs')
        .turnMonetaryPresentation({ kind: 'CONFIGURATION_OVERRIDE', operation: 'PREVIEW_CONFIGURATION_COST' });
    const answer = '当前总成本 285.8 元。';
    const decision = moneyGuardDecision(answer, toolResults, turn);
    // 正文只写了总成本，零件/人工两个正式事实仍缺失 → 守卫正确判定为 append。
    assert.equal(decision.action, 'append');
    assert.match(decision.summary, /264\.8/);
    assert.match(decision.summary, /21/);
    // 本层在守卫**之后**运行，因此不可能改变守卫的判定；规范化后的金额必须与守卫产出一致。
    const normalized = normalize(`${answer}\n\n${decision.appendable}`);
    assert.match(normalized, /285\.8/);
    assert.match(normalized, /264\.8/);
    assert.equal((normalized.match(/本轮正式查询金额如下/gu) || []).length, 1, '规范化不得制造第二张金额表');
});

test('展示层：machine vocabulary replacement 不重复生效', () => {
    const answer = '| 对象 | 项目 | 金额 |\n|---|---|---:|\n| 计算线圈成本 | 总成本 | 100 |';
    const once = businessVocabulary(answer);
    const twice = businessVocabulary(once);
    assert.equal(once, twice);
    assert.match(once, /\| 线圈成本 \| 总成本 \| 100 \|/);
});

test('展示层：continuation cleanup 不会逐次删除内容', () => {
    const answer = '结论：差 8.50 元。\n\n需要你确认具体型号，我再继续。我可以继续帮你查别的。';
    const once = trimUnsolicitedInvitations(answer, presentationRequest(''));
    const twice = trimUnsolicitedInvitations(once, presentationRequest(''));
    assert.equal(once, twice);
    assert.match(once, /需要你确认具体型号/, '必需澄清必须保留');
});

test('展示层：list summarization 不会逐次缩小', () => {
    const answer = `明细如下。\n\n${Array.from({ length: 15 }, (_, i) => `- 常规项 ${i + 1}`).join('\n')}`;
    const once = summarizeLongLists(answer, presentationRequest(''));
    const twice = summarizeLongLists(once, presentationRequest(''));
    assert.equal(once, twice);
});

test('展示层：conclusionFirst 不会反复重排', () => {
    const answer = '| 对象 | 项目 | 金额 |\n|---|---|---:|\n| 订单 | 总成本 | 100 |\n\n结论：差异 8.50 元。';
    const once = conclusionFirst(answer, presentationRequest(''));
    const twice = conclusionFirst(once, presentationRequest(''));
    assert.equal(once, twice);
});
