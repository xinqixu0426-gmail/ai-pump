'use strict';
/**
 * PHASE D 真实验收暴露的 defect（两处）。
 *
 * 两处都不是「新功能」，而是真实验收下暴露的**明确缺陷**：
 *   PHASE-D-DEFECT-01  Native 澄清候选的可见身份不唯一（同名线圈 → 两个一样的选项）
 *   PHASE-D-DEFECT-02  结构化关键性来源为空时，展示层丢掉保守兜底并作出无法支持的保全声明
 *                      （上一阶段结构性整改引入的**保护回退**，本阶段修复）
 *
 * 判据全部由正式结果推导，不写死业务期望值。
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const crypto = require('node:crypto');
const {
    normalizeAnswerPresentation,
    buildListCriticality,
    listRowTier,
    LIST_TIER,
} = require('../api/services/aiPresentationNormalizer.cjs');
const { runAiAssistant } = require('../api/services/aiAssistantRuntime.cjs');

const verified = data => ({ success: true, data, executionEvidence: { verified: true, kind: 'formal_api_query' } });

// ── PHASE-D-DEFECT-02 ───────────────────────────────────────────────
// REPRODUCE：真实读面（search_parts / 订单就绪 / 采购总览 / 数据质量）在真实数据下
// 都不产生 shortage/unpriced/incomplete 之类的结构化关键状态，于是
// buildListCriticality 返回空 mustShow。运行时仍然把该空对象传进展示层，
// 展示层便以「结构化优先」为由不再咨询保守兜底：
//   · 结论性行（「还差300个」）被压缩隐藏；
//   · 结尾却声明「本轮正式结果中处于缺料/未定价/未完成/待选择状态的条目已全部保留」，
//     而本轮**没有任何**此类结构化状态可供核对。
//
// ROOT CAUSE：把「结构化来源为空」当成了「结构化已确认没有关键条目」。
//
// 契约：结构化 token 存在时以结构化状态为准；结构化来源为空时**不得**据此认定没有关键条目 ——
// 必须保留保守兜底（TIER1/TIER2 在本阶段保留且仍是承重结构），且不得作出无法支持的保全声明。

const EMPTY_STRUCTURED_RECEIPTS = () => [{ name: 'search_parts', result: verified([
    ...Array.from({ length: 10 }, (_, index) => ({ id: index + 1, model: `常规件${index + 1}`, required: 400, stock: 400 })),
    { id: 71, model: '常规件11', required: 400, stock: 400 },
    { id: 72, model: '常规件12', required: 400, stock: 400 },
]) }];
const LIST_ANSWER = () => {
    const rows = [
        ...Array.from({ length: 10 }, (_, index) => `- 常规件${index + 1}：需求400个，现存400个。`),
        '- 6202轴承：需求400个，现存100个，还差300个。',
        '- 常规件12：需求400个，现存400个。',
    ];
    return `库存检查结果如下。\n\n${rows.join('\n')}`;
};

test('PHASE-D-DEFECT-02 结构化来源为空时不得比既有保守兜底更差，也不得声明已全部保留', () => {
    const toolResults = EMPTY_STRUCTURED_RECEIPTS();
    const criticality = buildListCriticality(toolResults);
    assert.deepEqual(criticality.mustShowTokens, [], '前提：真实读面在真实数据下确实不产生结构化关键状态');
    // 保守兜底认得出来的结论性行必须与修复前的行为一致（不得回退保护）。
    const rows = [
        ...Array.from({ length: 10 }, (_, index) => `- 常规件${index + 1}：需求400个，现存400个。`),
        '- 缺 300 个 6202 轴承',
        '- 常规件12：需求400个，现存400个。',
    ];
    const answer = `库存检查结果如下。\n\n${rows.join('\n')}`;
    const out = normalizeAnswerPresentation(answer, '查库存', { criticality });
    assert.match(out, /缺 300 个 6202 轴承/, '结构化来源为空时不得比既有兜底更差');
    assert.doesNotMatch(out, /已全部保留/, '没有结构化关键状态时不得声明「已全部保留」');
    assert.match(out, /没有出现结构化的缺料/, '必须如实说明本轮没有结构化关键状态');
    assert.notEqual(out, answer, '中性明细仍然允许被压缩');
});

test('PHASE-D-DEFECT-02 RESIDUAL：关键词兜底不认识的缺料写法，在无结构化来源时仍会被压缩', () => {
    // 这是**已知残留**，不是本阶段修复目标：该分支的唯一保护是既有 TIER1/TIER2 兜底，
    // 而本阶段禁止扩充关键词表。它必须在 MANDATORY 报告中作为 REMAINING_BLOCKER 出现，
    // 并靠「为结构化关键性提供真实生产者」来消除。
    const criticality = buildListCriticality(EMPTY_STRUCTURED_RECEIPTS());
    const out = normalizeAnswerPresentation(LIST_ANSWER(), '查库存', { criticality });
    assert.doesNotMatch(out, /还差300个/, '当前行为：该写法在本分支仍被压缩（待结构化生产者补齐后应翻转）');
    assert.match(out, /没有出现结构化的缺料/, '但不得因此声称已全部保留');
});

test('PHASE-D-DEFECT-02 结构化 token 存在时仍以结构化状态为准（不回退为关键词猜测）', () => {
    const informed = { mustShowTokens: ['6202轴承'], supportTokens: [] };
    assert.equal(listRowTier('- 6202轴承：还差300个。', informed), LIST_TIER.DECISION_CRITICAL);
    assert.equal(listRowTier('- 缺 300 个 其它件', informed), LIST_TIER.NEUTRAL_DETAIL,
        '结构化已确认关键对象时，措辞不得再升级为关键行');
    const toolResults = [{ name: 'preview_virtual_readiness', result: verified({
        recipeName: 'v550-tokoy', status: 'SHORTAGE', coverage: { shortageCount: 1, complete: true },
        shortages: [{ resourceType: 'PART', partId: 71, model: '6202轴承', shortageQty: 300 }],
        unresolvedRequirements: [], excludedRequirements: [], warnings: [],
    }) }];
    const criticality = buildListCriticality(toolResults);
    assert.ok(criticality.mustShowTokens.includes('6202轴承'));
    const rows = [
        ...Array.from({ length: 10 }, (_, index) => `- 常规件${index + 1}：库存充足。`),
        '- 6202轴承：需求400个，现存100个，缺口300个（从未出现过的写法）。',
        '- 常规件12：库存充足。',
    ];
    const out = normalizeAnswerPresentation(`库存检查结果如下。\n\n${rows.join('\n')}`, '查库存', { criticality });
    assert.match(out, /缺口300个/);
    assert.match(out, /已全部保留/);
});

test('PHASE-D-DEFECT-02 没有结构化输入时（旧调用方）保持既有契约且不作出保全声明', () => {
    const out = normalizeAnswerPresentation(LIST_ANSWER(), '查库存');
    // 旧调用方仍走关键词兜底：TIER1 能识别的结论性行必须保留。
    assert.match(out, /本轮没有结构化关键性依据/);
    assert.doesNotMatch(out, /已全部保留/);
    const keywordRows = [
        ...Array.from({ length: 10 }, (_, index) => `- 常规件${index + 1}：库存充足。`),
        '- 缺 300 个 6202 轴承',
        '- 常规件12：库存充足。',
    ];
    const keywordOut = normalizeAnswerPresentation(`库存检查结果如下。\n\n${keywordRows.join('\n')}`, '查库存');
    assert.match(keywordOut, /缺 300 个 6202 轴承/, '关键词兜底必须保留它认得的结论性行');
});

// ── PHASE-D-DEFECT-03 ───────────────────────────────────────────────
// REPRODUCE（真实数据）：`preview_virtual_readiness` 在真实副本上给出 21 条缺料
// （data.status='SHORTAGE'、data.coverage.shortageCount=21、data.shortages[].shortageQty），
// 但 buildListCriticality 返回 mustShow=[] —— 结构化关键性词表写的是 `shortQty`，
// 漏了正式服务真正输出的 `shortages` / `shortageQty` / `shortageCount` / `status`。
// 后果：真实缺料状态对展示层完全不可见，唯一的保护又退回关键词兜底。
//
// ROOT CAUSE：结构化状态词表与正式服务输出不一致（词表权威应是服务输出，不是猜的字段名）。
// FIX：按真实 schema 校正词表 + 状态枚举。

test('PHASE-D-DEFECT-03 必须识别正式服务真正输出的缺料字段与状态', () => {
    const receipts = [{ name: 'preview_virtual_readiness', result: verified({
        status: 'SHORTAGE',
        coverage: { requirementCount: 2, shortageCount: 2, complete: true },
        shortages: [
            { requirementKey: 'coil:1', model: '12-120', shortageQty: 300, virtualRequiredQty: 300, availableForVirtualQty: 0 },
            { requirementKey: 'part:71', model: '珍珠棉', shortageQty: 300, virtualRequiredQty: 300, availableForVirtualQty: 0 },
        ],
        warnings: [],
    }) }];
    const criticality = buildListCriticality(receipts);
    assert.deepEqual([...criticality.mustShowTokens].sort(), ['12-120', '珍珠棉']);
});

test('PHASE-D-DEFECT-03 三个从未出现过的缺料写法必须靠结构化通道保留（不依赖关键词）', () => {
    const { TIER1_PATTERN, TIER2_PATTERN } = require('../api/services/aiPresentationNormalizer.cjs');
    const receipts = [{ name: 'preview_virtual_readiness', result: verified({
        status: 'SHORTAGE',
        coverage: { shortageCount: 1, complete: true },
        shortages: [{ requirementKey: 'part:71', model: '珍珠棉', shortageQty: 300 }],
        warnings: [],
    }) }];
    const wordings = [
        '现货只能凑 100 件，另有 300 件暂时没有着落',
        '已到 100 件，余下 300 件须等下一批',
        '手上 100 件，剩下的 300 件暂无来源',
    ];
    for (const wording of wordings) {
        assert.equal(TIER1_PATTERN.test(wording), false, `写法不得命中 TIER1（否则不能证明是结构化通道在起作用）：${wording}`);
        assert.equal(TIER2_PATTERN.test(wording), false, `写法不得命中 TIER2：${wording}`);
        const rows = [
            ...Array.from({ length: 10 }, (_, index) => `- 常规件${index + 1}：库存充足。`),
            `- 珍珠棉：${wording}。`,
            '- 常规件12：库存充足。',
        ];
        const out = normalizeAnswerPresentation(`库存检查结果如下。\n\n${rows.join('\n')}`, '查库存', { criticality: buildListCriticality(receipts) });
        assert.match(out, /珍珠棉：/, `结构化缺料行必须保留：${wording}`);
        assert.match(out, /已全部保留/, '本轮确实有结构化关键状态且已保留，应如实声明');
    }
});

// ── PHASE-D-DEFECT-04 ───────────────────────────────────────────────
// REPRODUCE（真实数据）：真实线圈档案成本是高精度值（COIL-0005 = 143.82775、
// COIL-0012 = 144.90445）。展示层渲染出的核对表因此带 5 位小数。
// 但 presentedMoneyClaims 通过 markdownTableRows 读单元格，而后者会把数值单元格
// 归一化到两位小数 —— 于是「正确答案」被读成 143.83，与正式事实 143.82775 不等，
// 被判为金额挂错对象（misattributed），运行时进而把正确回答判成 failed_answer 并替换。
//
// 真实影响（Phase D 验收）：ACCEPT_线圈 / ACCEPT_配置变更假设 / ACCEPT_不完整数据
// 三轮真实对话被误判并降级为兜底回答。
//
// ROOT CAUSE：关联校验读的是**显示归一化后**的数字，而不是原始数字。
// FIX：金额声明按原始单元格解析，比较用严格数值相等（不引入显示四舍五入）。

test('PHASE-D-DEFECT-04 高精度正式金额不得被误判为挂错对象', () => {
    const { misattributedMoneyClaims, presentedMoneyClaims, unsupportedMoneyInAnswer } = require('../api/services/aiAssistantAnswer.cjs');
    const results = [{ name: 'search_coils', result: verified([
        { id: 5, schemeCode: 'COIL-0005', cost: 143.82775 },
        { id: 12, schemeCode: 'COIL-0012', cost: 144.90445 },
    ]) }];
    const answer = '本轮正式查询金额如下（元）：\n\n| 对象 | 项目 | 金额 |\n|---|---|---:|\n'
        + '| COIL-0005 | 线圈档案成本 | 143.82775 |\n| COIL-0012 | 线圈档案成本 | 144.90445 |';
    const claims = presentedMoneyClaims(answer);
    assert.deepEqual(claims.map(claim => claim.value), [143.82775, 144.90445], '金额声明必须保留来源精度');
    assert.deepEqual(misattributedMoneyClaims(answer, results), [], '正确的正式金额不得被判为挂错对象');
    assert.deepEqual(unsupportedMoneyInAnswer(answer, results), [], '正确的正式金额不得被上报为未支撑金额');
});

test('PHASE-D-DEFECT-04 高精度金额交换仍然必须被发现', () => {
    const { misattributedMoneyClaims } = require('../api/services/aiAssistantAnswer.cjs');
    const results = [{ name: 'search_coils', result: verified([
        { id: 5, schemeCode: 'COIL-0005', cost: 143.82775 },
        { id: 12, schemeCode: 'COIL-0012', cost: 144.90445 },
    ]) }];
    const swapped = '| 对象 | 项目 | 金额 |\n|---|---|---:|\n'
        + '| COIL-0005 | 线圈档案成本 | 144.90445 |\n| COIL-0012 | 线圈档案成本 | 143.82775 |';
    assert.deepEqual(misattributedMoneyClaims(swapped, results).map(claim => claim.value).sort((a, b) => a - b), [143.82775, 144.90445], '交换必须被发现');
});

// ── PHASE-D-DEFECT-05 ───────────────────────────────────────────────
// REPRODUCE（真实验收）：用户问「这两项配置有什么不同，差多少钱」时，模型没有调用正式对比，
// 而是自己相减写出差额 → Money Guard 正确拒绝（金额无正式依据），最终走 failed_answer 分支。
// 该分支只回一张内部金额表：用户既不知道结论为何消失，也拿不到任何说明 ——
// 这正是 LEGACY-AI-ANSWER-001 的原始症状（回答只剩一张内部金额表）在另一个触发条件下的复现。
//
// ROOT CAUSE：failed_answer 分支把「解释」与「正式明细」当成互斥的两件事
// （`summary || 解释文案`），于是只要 summary 非空，解释就被丢掉。
//
// 契约：被拒绝的草稿必须告知用户为什么没有结论；正式明细是补充，不是替代。

const scriptedFixture = (turns, receipt) => {
    let index = 0;
    return {
        loadMemory: async () => ({ items: [] }),
        loadCorrections: () => '',
        fetchAiProvider: async () => ({ json: async () => ({ choices: [{ message: turns[Math.min(index++, turns.length - 1)] }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) }),
        executeToolCall: async () => receipt,
    };
};

test('PHASE-D-DEFECT-05 草稿因无依据金额被拒时，必须解释原因而不是只回一张内部表', async () => {
    const receipt = {
        ...verified({}),
        recipe1: { name: 'PHASED-浮球-有', cost: 271.98 },
        recipe2: { name: 'PHASED-浮球-无', cost: 263.98 },
        costDiff: '8.00',
    };
    const toolCall = { id: 'compare_recipes', type: 'function', function: { name: 'compare_recipes', arguments: JSON.stringify({ recipe1: 'PHASED-浮球-有', recipe2: 'PHASED-浮球-无' }) } };
    const result = await runAiAssistant(
        { messages: [{ role: 'user', content: '对比 PHASED-浮球-有 和 PHASED-浮球-无 的成本' }], confirmationSubject: 'phase-d-defect-05', conversationId: `defect-05-${crypto.randomUUID()}`, env: { AI_PROVIDER: 'local' } },
        scriptedFixture([
            { tool_calls: [toolCall] },
            { content: '差额是 99.99 元。' },
            { content: '差额是 99.99 元。' },
        ], receipt),
    );
    assert.equal(result.telemetry.outcome, 'failed_answer');
    assert.doesNotMatch(result.finalContent, /99\.99/, '无依据金额不得交付');
    // 用户必须被告知结论为何不可用；正式明细仍然要给出。
    assert.match(result.finalContent, /无法核对|已停止展示/u, '必须解释被拒原因，不能只回一张内部金额表');
    assert.match(result.finalContent, /271\.98/u, '正式明细仍必须给出');
    assert.match(result.finalContent, /本轮正式查询金额如下/u);
});
