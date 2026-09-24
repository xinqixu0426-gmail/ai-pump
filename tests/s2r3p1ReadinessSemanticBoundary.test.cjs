'use strict';
/**
 * S2-R3-P1 — READINESS SEMANTIC BOUNDARY CLOSURE
 *
 * 真实 Owner canary 暴露的缺陷家族（缺陷 2+3+4+5）：
 *   ① 数量抽取依赖词序：`按300台虚拟齐料预览` 在 WAITING_INPUT 死循环；
 *   ② `缺什么料？` / `缺料预览…100台` 进不了 readiness 目标，落到 Legacy 后用
 *      **成本域**的「没有取得可用金额」回答一个从未问过金额的问题；
 *   ③ 该 Legacy 回退还与自己本轮的成功回执相矛盾；
 *   ④ 内部证据码 `CROSS_CATALOG_CANDIDATES` 被渲染进用户可见正文。
 *
 * 本文件走**真实 canary 运行入口**（`runAiTaskControllerV2` = dispatcher 的 Native 权威入口，
 * `runAiAssistant` = Legacy 安全路径入口），不新造 harness。
 * 断言口径按 ticket `replayFocus`：family / subject / quantity / admission / tool-domain /
 * 最终业务措辞 —— 不是答案字符数。
 *
 * 缺陷 1（no-op 配置回答 / coilId=1 / 已正式应用的临时配置）属 S2-R3-P2，本文件不覆盖。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { runAiTaskControllerV2 } = require('../api/services/aiTaskControllerV2.cjs');
const { createTaskSessionStoreV2 } = require('../api/services/aiTaskSessionV2.cjs');
const { extractTaskSemanticsV2, VIRTUAL_READINESS_DESCRIPTION, READINESS_MULTI_SUBJECT_DESCRIPTION } = require('../api/services/aiTaskSemanticsV2.cjs');
const { ownerReadCanaryAdmission } = require('../api/services/aiNativeOwnerTrialCoverage.cjs');
const { readinessProfile, extractQuantitySlot, isReadinessRequest } = require('../api/business-semantics/readinessSemantics.cjs');
const { classifyQuestion } = require('../api/business-semantics/questionSemantics.cjs');
const { buildBusinessSemanticFrame } = require('../api/business-semantics/frameBuilder.cjs');
const { enforceSemanticAnswerBoundary, deterministicSemanticAnswer } = require('../api/business-semantics/answerBoundary.cjs');
const { validateBusinessSemanticFrame } = require('../api/business-semantics/validator.cjs');
const { semanticEligibility } = require('../api/business-semantics/eligibilityBoundary.cjs');
const { buildBusinessEvidencePlan } = require('../api/business-semantics/evidencePlanner.cjs');

// ── 生产形态 fixture（真实型号名，canonical 主键唯一）──────────────────────
const V750 = Object.freeze({ id: 13, name: 'V750大脚板-2寸-经典款', spec: '12-120', coilId: 1 });
const V550 = Object.freeze({ id: 21, name: 'V550大脚板-2寸-经典款', spec: '12-120', coilId: 1 });
const COILS = Object.freeze([{ id: 1, spec: '12', sheets: 120, material: '钢带', slotType: '小眼', schemeCode: 'COIL-0001', schemeName: '正式方案', schemeStatus: 'official', stock: 100, cost: 98.38 }]);

const evidence = { verified: true, kind: 'formal_api_query' };
const listReceipt = rows => ({
    success: true, count: rows.length, data: rows,
    queryReceipt: { appliedFilters: {}, totalCount: rows.length, returnedCount: rows.length, truncated: false, possiblyTruncated: false, authoritative: true },
    executionEvidence: evidence,
});
const objectReceipt = data => ({ success: true, data, executionEvidence: evidence });
const readinessReceipt = quantity => objectReceipt({
    version: 1, preview: true, readinessId: crypto.randomUUID(),
    recipe: { id: V750.id, name: V750.name }, scenarioKey: 'base', configurationHash: 'base-configuration',
    quantity, inventoryBasis: 'CURRENT_STOCK_AFTER_ACTIVE_ORDER_RESERVATIONS', status: 'SHORTAGE',
    readSetId: crypto.randomUUID(), readSetHash: 'r'.repeat(64), sourceVersions: [], sourceVersionsComplete: true,
    coverage: { requirementCount: 1, evaluatedCount: 1, shortageCount: 1, unresolvedCount: 0, excludedCount: 0, complete: true },
    requirements: [{ requirementKey: 'part:71', resourceType: 'PART', partId: 71, coilId: null, model: '电缆', supplier: '供应商', inventoryUnit: 'meter', quantityPerPump: 5, virtualRequiredQty: 1500, stockOnHandQty: 1200, reservedByActiveOrdersQty: 0, availableForVirtualQty: 1200, shortageQty: 300, complete: true }],
    shortages: [{ requirementKey: 'part:71', resourceType: 'PART', partId: 71, coilId: null, model: '电缆', supplier: '供应商', inventoryUnit: 'meter', quantityPerPump: 5, virtualRequiredQty: 1500, stockOnHandQty: 1200, reservedByActiveOrdersQty: 0, availableForVirtualQty: 1200, shortageQty: 300, complete: true }],
});

/** 生产形态 executor：正式配方目录 + 正式情景成本 + 正式齐料预览 + 正式线圈目录。 */
function productionShapeExecutor(options = {}) {
    const calls = [];
    const execute = async (toolName, args = {}) => {
        calls.push({ toolName, args });
        if (toolName === 'get_all_recipes') {
            const keyword = String(args.keyword ?? '').trim();
            return listReceipt([V750, V550].filter(row => !keyword || row.name.includes(keyword) || keyword.includes(row.name)));
        }
        if (toolName === 'compare_recipe_scenarios') {
            const scenario = args.scenarios[0];
            const currentTotalCost = options.costMap ? options.costMap[Number(args.recipeId)] : 285.8;
            return objectReceipt({
                readSetId: crypto.randomUUID(), recipe: { id: args.recipeId, name: V750.name },
                scenarios: [
                    { scenarioKey: 'base', configurationHash: 'base-configuration', cost: { complete: true, currentTotalCost }, appliedOverrides: {}, notApplied: [] },
                    { scenarioKey: scenario.scenarioKey, configurationHash: 'candidate-configuration', cost: { complete: true, currentTotalCost: currentTotalCost + 8 }, appliedOverrides: scenario.overrides, notApplied: [] },
                ],
                comparisons: [{ baseScenarioKey: 'base', candidateScenarioKey: scenario.scenarioKey, status: 'COMPARABLE', delta: 8, currency: 'CNY' }],
            });
        }
        if (toolName === 'preview_virtual_readiness') return readinessReceipt(args.quantity);
        if (toolName === 'search_coils') {
            const schemeCode = String(args.schemeCode ?? '').trim();
            const shorthand = String(args.spec ?? '').trim();
            const rows = schemeCode ? COILS.filter(row => row.schemeCode === schemeCode) : COILS.filter(row => `${row.spec}-${row.sheets}` === shorthand);
            return listReceipt(rows);
        }
        throw new Error(`UNEXPECTED_TOOL ${toolName}`);
    };
    return { calls, execute };
}

const input = (text, requestId = crypto.randomUUID(), conversationId = 's2r3p1') => ({
    ownerKey: 's2r3p1-owner', requestId, conversationId, messages: [{ role: 'user', content: text }],
});
const turn = (fixture, sessions, text, conversationId = 's2r3p1') => runAiTaskControllerV2(
    input(text, crypto.randomUUID(), conversationId), { executeToolCall: fixture.execute, sessionStore: sessions, provider: null });

const goalKinds = result => result.task.goals.map(goal => goal.kind);
const toolNames = fixture => fixture.calls.map(call => call.toolName);
const readinessFacts = result => result.task.facts.filter(fact => fact.key.predicate === 'inventory.virtual_readiness');
/** 用户可见正文绝不出现内部码 / 金额口径（S2-R3-P1 §E §F 的统一断言）。 */
const INTERNAL_CODES = /CROSS_CATALOG_CANDIDATES|AI_RESOURCE_NOT_FOUND|RECIPE_CURRENT_FULL_COST|COIL_OFFICIAL_VARIANT_SET|VIRTUAL_READINESS_PREVIEW|FORMAL_RELATION_RESULT|NEEDS_EVIDENCE|PARTIAL_VERIFIED/u;
const MONEY_REFUSAL = /没有取得可用金额|不给当前完整成本|保存成本快照|当前完整成本/u;

// ══ §A 数量槽位：词序无关 ═══════════════════════════════════════════════
test('A1 五种语序的同一齐料请求都解析出正式 quantity=300（ticket 12 例中的 5 个 R1–R5 口径）', async () => {
    const phrasings = [
        'V750大脚板-2寸-经典款虚拟齐料预览300台',
        'V750大脚板-2寸-经典款按300台虚拟齐料预览',
        '按300台虚拟齐料 V750大脚板-2寸-经典款',
        '虚拟齐料：V750大脚板-2寸-经典款，数量300台',
        'V750大脚板-2寸-经典款 300台 齐料',
    ];
    for (const text of phrasings) {
        const fixture = productionShapeExecutor();
        const result = await turn(fixture, createTaskSessionStoreV2(), text);
        const semantics = await extractTaskSemanticsV2({ messageRef: 'm1', text, provider: null });
        const goal = semantics.proposal.goals.find(item => item.kind === 'INVENTORY_QUERY');
        assert.ok(goal, `${text} 必须产生齐料（INVENTORY_QUERY）目标`);
        assert.equal(goal.description, VIRTUAL_READINESS_DESCRIPTION, text);
        assert.equal(goal.quantity?.value, 300, `${text} 的正式数量必须是 300`);
        assert.equal(result.task.state, 'SUCCEEDED', `${text} → ${result.task.state} ${result.answer.content}`);
        assert.deepEqual(goalKinds(result), ['INVENTORY_QUERY'], text);
        const preview = fixture.calls.find(call => call.toolName === 'preview_virtual_readiness');
        assert.equal(preview?.args.quantity, 300, `${text} 必须用 300 调用正式齐料预览`);
        assert.equal(result.canaryAdmission.eligible, true, text);
        assert.match(result.answer.content, /^按当前库存并扣除现有活动订单占用，300台/, result.answer.content);
        assert.doesNotMatch(result.answer.content, INTERNAL_CODES, text);
    }
});

test('A2 首轮确实没有数量时 → WAITING_INPUT；只回「300台」必须恢复待办齐料任务而不是重新追问', async () => {
    const fixture = productionShapeExecutor();
    const sessions = createTaskSessionStoreV2();
    const first = await turn(fixture, sessions, 'V750大脚板-2寸-经典款齐料情况怎么样？', 's2r3p1-resume');
    assert.equal(first.task.state, 'WAITING_INPUT');
    assert.deepEqual(goalKinds(first), ['INVENTORY_QUERY']);
    assert.equal(first.task.questions[0].reasonCode, 'VIRTUAL_READINESS_QUANTITY_REQUIRED');
    assert.match(first.answer.content, /请确认本次要按多少台/u);
    assert.deepEqual(readinessFacts(first), [], '缺数量时不得产出任何齐料事实');
    assert.equal(toolNames(fixture).includes('preview_virtual_readiness'), false, '缺数量时不得调用齐料预览');
    const toolsAfterFirst = fixture.calls.length;

    const second = await turn(fixture, sessions, '300台', 's2r3p1-resume');
    assert.equal(second.task.taskId, first.task.taskId, '第二轮必须是同一任务的续接');
    assert.equal(second.task.state, 'SUCCEEDED', `第二轮不得再次追问：${second.answer.content}`);
    assert.match(second.answer.content, /^按当前库存并扣除现有活动订单占用，300台/, second.answer.content);
    assert.equal(fixture.calls.slice(toolsAfterFirst).find(call => call.toolName === 'preview_virtual_readiness')?.args.quantity, 300);
    assert.equal(second.task.questions.filter(question => question.reasonCode === 'VIRTUAL_READINESS_QUANTITY_REQUIRED' && question.answeredAt === null).length, 0);
});

test('A3 中文数量与显式「数量」标签同样是正式数量槽位；无关数字不得被当成数量', () => {
    const cases = [
        ['V750大脚板-2寸-经典款三百台 齐料', 300],
        ['虚拟齐料 V750大脚板-2寸-经典款 数量 100', 100],
        ['缺料预览 V750大脚板-2寸-经典款 100台', 100],
        // 以下都**不是**数量：线圈简写、寸数、铜价、线重
        ['12-200还有货吗', null],
        ['12-220的成本', null],
        ['按铜价95算，V550的成本是多少', null],
        ['假如线重按0.8算，12-140的成本是多少', null],
        ['2寸泵壳的价格', null],
    ];
    for (const [text, expected] of cases) {
        assert.equal(extractQuantitySlot(text)?.value ?? null, expected, text);
    }
});

// ══ §B 语义准入：同义问法进同一 readiness 目标 ════════════════════════════
test('B1 四种缺料/齐料问法都进同一个 readiness 目标，且不要求字面 token 生产…台', async () => {
    const phrasings = [
        'V750大脚板-2寸-经典款生产100台缺什么料？',
        '缺料预览 V750大脚板-2寸-经典款 100台',
        'V750大脚板-2寸-经典款100台齐料怎么样？',
        'V750大脚板-2寸-经典款按100台看缺料',
    ];
    for (const text of phrasings) {
        const fixture = productionShapeExecutor();
        const result = await turn(fixture, createTaskSessionStoreV2(), text);
        assert.deepEqual(goalKinds(result), ['INVENTORY_QUERY'], `${text} → ${JSON.stringify(goalKinds(result))}`);
        assert.equal(result.task.state, 'SUCCEEDED', `${text} → ${result.task.state} ${result.answer.content}`);
        const preview = fixture.calls.find(call => call.toolName === 'preview_virtual_readiness');
        assert.equal(preview?.args.quantity, 100, text);
        assert.equal(result.canaryAdmission.eligible, true, `${text} 必须进入 Native canary`);
        assert.match(result.answer.content, /^按当前库存并扣除现有活动订单占用，100台/u, result.answer.content);
        assert.doesNotMatch(result.answer.content, INTERNAL_CODES, text);
    }
});

test('B2 业务语义层的 readiness 判据是「含义」而不是句式：齐备 / 缺口 / 数量+物料三种形态', () => {
    for (const text of ['V750大脚板-2寸-经典款缺什么料？', 'V750大脚板-2寸-经典款还缺料吗',
        'V750大脚板-2寸-经典款齐料情况怎么样？', 'V750大脚板-2寸-经典款物料够不够',
        '缺料预览 V750大脚板-2寸-经典款 100台', 'V750大脚板-2寸-经典款按100台看缺料']) {
        assert.equal(isReadinessRequest(text), true, text);
        assert.equal(classifyQuestion(text).kind, 'INVENTORY_QUERY', text);
        assert.equal(semanticEligibility({ userText: text }).reason, 'SUPPORTED_INVENTORY_INTENT', text);
    }
    // 线圈域 / 成本域绝不并入配方齐料
    for (const text of ['12-200还有货吗', '12-220的成本', 'V750大脚板-2寸-经典款当前成本是多少',
        'V750大脚板-2寸-经典款，线圈用12-200的', 'V750大脚板-2寸-经典款成本是多少']) {
        assert.equal(isReadinessRequest(text), false, text);
    }
    assert.equal(readinessProfile('V750大脚板-2寸-经典款缺什么料？').ask, 'SHORTAGE');
    assert.equal(readinessProfile('V750大脚板-2寸-经典款齐料情况怎么样？').ask, 'SUFFICIENCY');
});

test('B3 readiness 请求的语义帧要求正式齐料事实，绝不借用线圈方案集合', () => {
    const plan = buildBusinessEvidencePlan({ userText: 'V750大脚板-2寸-经典款缺什么料？', eligibility: semanticEligibility({ userText: 'V750大脚板-2寸-经典款缺什么料？' }) });
    assert.deepEqual(plan.requirements.map(item => item.factType), ['VIRTUAL_READINESS_PREVIEW']);
    const frame = buildBusinessSemanticFrame({ userText: 'V750大脚板-2寸-经典款缺什么料？', toolResults: [], stage: 'POST_EVIDENCE' });
    validateBusinessSemanticFrame(frame);
    assert.equal(frame.question.kind, 'INVENTORY_QUERY');
    assert.deepEqual(frame.evidence.requiredFacts, ['VIRTUAL_READINESS_PREVIEW']);
    // 没有齐料回执 → 缺失，不是「已核实线圈磁盘方案」
    assert.deepEqual(frame.evidence.missingFacts, ['VIRTUAL_READINESS_PREVIEW']);
});

// ══ §C 无数量的缺料问题不得进入成本域 ═════════════════════════════════════
test('C1 无数量的缺料问题绝不落到成本域：WAITING_INPUT 追问台数，且一分钱都不提', async () => {
    const fixture = productionShapeExecutor();
    const result = await turn(fixture, createTaskSessionStoreV2(), 'V750大脚板-2寸-经典款缺什么料？', 's2r3p1-noqty');
    assert.equal(result.task.state, 'WAITING_INPUT');
    assert.deepEqual(goalKinds(result), ['INVENTORY_QUERY'], '缺料问题只能是齐料目标，不得变成成本目标');
    assert.equal(result.task.goals[0].state, 'NEEDS_INPUT');
    assert.match(result.answer.content, /请确认本次要按多少台/u);
    assert.doesNotMatch(result.answer.content, MONEY_REFUSAL, result.answer.content);
    assert.doesNotMatch(result.answer.content, INTERNAL_CODES, result.answer.content);
    assert.deepEqual(fixture.calls.filter(call => ['compare_recipe_scenarios', 'preview_recipe_cost', 'full_calculate', 'get_recipe_detail'].includes(call.toolName)), [], '不得为了齐料问题去读成本');
    assert.equal(extractQuantitySlot('V750大脚板-2寸-经典款缺什么料？'), null, '绝不猜数量');
});

test('C2 语义层对无数量缺料问题给出齐料域结论，不产生任何成本目标', async () => {
    const text = 'V750大脚板-2寸-经典款缺什么料？';
    const semantics = await extractTaskSemanticsV2({ messageRef: 'm1', text, provider: null });
    assert.deepEqual(semantics.proposal.goals.map(goal => goal.kind), ['INVENTORY_QUERY']);
    assert.equal(semantics.proposal.goals[0].description, VIRTUAL_READINESS_DESCRIPTION);
    assert.equal(semantics.proposal.goals[0].quantity, null);
    assert.equal(classifyQuestion(text).kind, 'INVENTORY_QUERY');
});

// ══ §D 多配方：有界澄清，不加新能力 ═══════════════════════════════════════
test('D1 多配方齐料请求给有界澄清：不新增能力、不选第一个、不整句当配方名', async () => {
    const text = 'V750大脚板-2寸-经典款和V550大脚板-2寸-经典款各100台，缺什么料？';
    const fixture = productionShapeExecutor();
    const result = await turn(fixture, createTaskSessionStoreV2(), text, 's2r3p1-multi');
    assert.equal(result.task.state, 'WAITING_INPUT', result.answer.content);
    assert.match(result.answer.content, /当前一次按一个配方做齐料预览。请先选择 V750 或 V550/u, result.answer.content);
    assert.deepEqual(toolNames(fixture), [], '澄清前不得执行任何正式读取');
    assert.deepEqual(readinessFacts(result), []);
    // 不得整句当配方名：澄清轮没有建立任何 canonical 主体绑定，也没有公开主体身份
    assert.deepEqual(result.task.facts, [], '澄清不得产出任何事实');
    assert.equal(fixture.calls.some(call => String(call.args?.keyword || '').includes('缺什么料')), false, '不得把整句当配方名去查目录');

    const semantics = await extractTaskSemanticsV2({ messageRef: 'm1', text, provider: null });
    assert.deepEqual(semantics.proposal.goals.map(goal => goal.kind), ['INVENTORY_QUERY']);
    assert.equal(semantics.proposal.goals[0].description, READINESS_MULTI_SUBJECT_DESCRIPTION);
    assert.equal(semantics.proposal.goals.length, 1, '不得新增多配方齐料目标');
    assert.deepEqual(semantics.proposal.subjects.map(subject => subject.mention), ['V750', 'V550']);
    assert.equal(semantics.proposal.subjects.some(subject => subject.mention.includes('缺什么料')), false, '不得把整句当配方名');
    assert.doesNotMatch(result.answer.content, INTERNAL_CODES);
    assert.doesNotMatch(result.answer.content, MONEY_REFUSAL);
});

// ══ §E Legacy 安全路径：保域、不自相矛盾、不吐内部码 ═══════════════════════
const FORMAL_RECIPE_ROWS = [
    { id: 13, name: 'V750大脚板-2寸-经典款', spec: '12-120', coilId: 1 },
];
function legacyExecutor() {
    const calls = [];
    const execute = async (name, args = {}) => {
        calls.push({ name, args });
        if (name === 'get_all_recipes') {
            const keyword = String(args.keyword ?? '').trim();
            return listReceipt(FORMAL_RECIPE_ROWS.filter(row => !keyword || row.name.includes(keyword) || keyword.includes(row.name)));
        }
        if (name === 'get_recipe_detail') return objectReceipt({ id: 13, name: 'V750大脚板-2寸-经典款' });
        if (name === 'search_templates') return listReceipt([]);
        if (name === 'search_parts') return { success: true, parts: [], data: [], queryReceipt: { authoritative: true, totalCount: 0, returnedCount: 0, truncated: false, possiblyTruncated: false }, executionEvidence: evidence };
        if (name === 'search_coils') return listReceipt([]);
        throw new Error(`unexpected ${name}`);
    };
    return { calls, execute };
}
async function legacyTurn(text) {
    const { runAiAssistant } = require('../api/services/aiAssistantRuntime.cjs');
    const fixture = legacyExecutor();
    const response = await runAiAssistant({
        messages: [{ role: 'user', content: text }],
        env: { AI_BUSINESS_SEMANTIC_ENFORCEMENT_CANARY_ENABLED: 'true' },
    }, {
        loadMemory: async () => ({ items: [] }), loadCorrections: () => '',
        executeToolCall: fixture.execute,
        fetchAiProvider: async () => ({ json: async () => ({ choices: [{ message: { content: '模型草稿' } }] }) }),
    });
    return { response, fixture };
}

test('E1 缺什么料在 Legacy 安全路径保持齐料域：绝不输出金额缺失模板', async () => {
    for (const text of ['V750大脚板-2寸-经典款缺什么料？', '缺料预览 V750大脚板-2寸-经典款 100台']) {
        const { response } = await legacyTurn(text);
        assert.doesNotMatch(response.finalContent, MONEY_REFUSAL, `${text} → ${response.finalContent}`);
        assert.doesNotMatch(response.finalContent, /当前重算没有取得可用金额/u, response.finalContent);
        assert.doesNotMatch(response.finalContent, INTERNAL_CODES, response.finalContent);
    }
});

test('E2 齐料回执在手时答案必须复述回执数值，绝不与自己本轮的工具结果矛盾', () => {
    const results = [{ name: 'preview_virtual_readiness', result: readinessReceipt(300) }];
    const frame = buildBusinessSemanticFrame({ userText: 'V750大脚板-2寸-经典款按300台虚拟齐料预览', toolResults: results, stage: 'POST_EVIDENCE' });
    validateBusinessSemanticFrame(frame);
    assert.equal(frame.evidence.facts.find(item => item.factType === 'VIRTUAL_READINESS_PREVIEW').state, 'VERIFIED');
    const answer = deterministicSemanticAnswer(frame, results, 'V750大脚板-2寸-经典款按300台虚拟齐料预览');
    assert.match(answer, /300台/, answer);
    assert.match(answer, /短缺300m/, answer);
    assert.doesNotMatch(answer, MONEY_REFUSAL, answer);
    assert.doesNotMatch(answer, INTERNAL_CODES, answer);
    // 缺失事实模板也必须说业务语言，不得回显内部证据码
    const missingFrame = buildBusinessSemanticFrame({ userText: 'V750大脚板-2寸-经典款和 V550大脚板-2寸-经典款成本差多少？', toolResults: [], stage: 'POST_EVIDENCE' });
    const boundary = enforceSemanticAnswerBoundary({ frame: missingFrame, answer: '仍缺少正式证据：CROSS_CATALOG_CANDIDATES，本轮不能给出完整结论。', toolResults: [], userText: 'V750大脚板-2寸-经典款和 V550大脚板-2寸-经典款成本差多少？' });
    assert.doesNotMatch(boundary.answer, INTERNAL_CODES, boundary.answer);
});

// ══ §F 内部码只进证据，不进正文 ═══════════════════════════════════════════
test('F1 内部证据码映射到业务语言，未知码退化为通用措辞', () => {
    const frame = buildBusinessSemanticFrame({ userText: 'V800 的成本是多少', toolResults: [], stage: 'POST_EVIDENCE' });
    const answer = deterministicSemanticAnswer(frame, [], 'V800 的成本是多少');
    assert.doesNotMatch(answer, INTERNAL_CODES, answer);
});

// ══ Owner 已验收用例不得回归（6 项）════════════════════════════════════════════
test('OWNER-1 单配方当前成本：goal / 事实 / 金额口径不变', async () => {
    const fixture = productionShapeExecutor();
    const result = await turn(fixture, createTaskSessionStoreV2(), 'V750大脚板-2寸-经典款当前成本是多少', 's2r3p1-owner-cost');
    assert.equal(result.task.state, 'SUCCEEDED');
    assert.deepEqual(goalKinds(result), ['CURRENT_COST']);
    assert.deepEqual(result.task.facts.map(fact => fact.key.predicate), ['recipe.current_cost']);
    assert.equal(result.canaryAdmission.eligible, true);
    assert.match(result.answer.content, /V750大脚板-2寸-经典款当前完整成本为 ¥285\.80/u, result.answer.content);
});

test('OWNER-2 双方案成本比较：两个主体 + 正式差额，不被齐料语义影响', async () => {
    const { runAiTaskControllerV2: run } = require('../api/services/aiTaskControllerV2.cjs');
    const calls = [];
    const execute = async (toolName, args = {}) => {
        calls.push({ toolName, args });
        if (toolName === 'get_all_recipes') {
            const keyword = String(args.keyword ?? '').trim();
            return listReceipt([V550, V750].filter(row => !keyword || row.name.includes(keyword) || keyword.includes(row.name)));
        }
        if (toolName === 'compare_recipes') return objectReceipt({ recipe1: { name: V550.name, cost: 271.98 }, recipe2: { name: V750.name, cost: 286.51 }, costDiff: '14.53', costBasis: 'currentFullCost' });
        throw new Error(`UNEXPECTED_TOOL ${toolName}`);
    };
    const result = await run(input('V550大脚板-2寸-经典款和V750大脚板-2寸-经典款成本差多少？', crypto.randomUUID(), 's2r3p1-owner-cmp'), { executeToolCall: execute, sessionStore: createTaskSessionStoreV2(), provider: null });
    assert.equal(result.task.state, 'SUCCEEDED', result.answer.content);
    assert.deepEqual(goalKinds(result), ['RECIPE_COST_COMPARISON']);
    assert.match(result.answer.content, /¥14\.53/u, result.answer.content);
});

test('OWNER-3 线圈成本：单一 canonical 线圈输出该方案自己的成本，且回答不得混入库存口径', async () => {
    const calls = [];
    const execute = async (toolName, args = {}) => {
        calls.push({ toolName, args });
        if (toolName === 'search_coils') return listReceipt(COILS.filter(row => `${row.spec}-${row.sheets}` === String(args.spec ?? '')));
        throw new Error(`UNEXPECTED_TOOL ${toolName}`);
    };
    const result = await runAiTaskControllerV2(input('12-120成本多少？', crypto.randomUUID(), 's2r3p1-owner-coilcost'), { executeToolCall: execute, sessionStore: createTaskSessionStoreV2(), provider: null });
    assert.equal(result.task.state, 'SUCCEEDED', result.answer.content);
    assert.deepEqual(goalKinds(result), ['COIL_COST']);
    assert.match(result.answer.content, /98\.38/u, result.answer.content);
    assert.doesNotMatch(result.answer.content, /库存/u, result.answer.content);
});

test('OWNER-4 线圈库存：库存问法只产出库存事实', async () => {
    const execute = async (toolName, args = {}) => {
        if (toolName === 'search_coils') return listReceipt(COILS.filter(row => `${row.spec}-${row.sheets}` === String(args.spec ?? '')));
        throw new Error(`UNEXPECTED_TOOL ${toolName}`);
    };
    const result = await runAiTaskControllerV2(input('12-120还有多少？', crypto.randomUUID(), 's2r3p1-owner-coilinv'), { executeToolCall: execute, sessionStore: createTaskSessionStoreV2(), provider: null });
    assert.equal(result.task.state, 'SUCCEEDED', result.answer.content);
    assert.deepEqual(goalKinds(result), ['INVENTORY_QUERY']);
    assert.deepEqual(result.task.facts.map(fact => fact.key.predicate), ['inventory.coil']);
    assert.match(result.answer.content, /100/u, result.answer.content);
});

test('OWNER-5 配置变更：候选情景 + 成本比较目标结构不变（缺陷 1 属 S2-R3-P2，本用例只锁结构）', async () => {
    const fixture = productionShapeExecutor();
    const result = await turn(fixture, createTaskSessionStoreV2(), 'V750大脚板-2寸-经典款电缆改成5米，其他不变，和现在成本比一下，先不要保存', 's2r3p1-owner-config');
    assert.equal(result.task.state, 'SUCCEEDED', result.answer.content);
    // 显式同时问了「现在的成本」和「改后的比较」：两个目标都要保留（既有契约）
    assert.deepEqual([...goalKinds(result)].sort(), ['CONFIGURATION_COMPARE', 'CURRENT_COST']);
    const compared = fixture.calls.find(call => call.toolName === 'compare_recipe_scenarios');
    assert.equal(compared.args.scenarios[0].overrides.cableLength, 5, '候选情景必须携带用户明确的电缆覆盖');
    assert.equal(result.canaryAdmission.eligible, true);
});

test('OWNER-6 300台缺料预览：正式齐料事实 + 短缺数值全部来自回执', async () => {
    const fixture = productionShapeExecutor();
    const result = await turn(fixture, createTaskSessionStoreV2(), 'V750大脚板-2寸-经典款虚拟齐料预览300台', 's2r3p1-owner-readiness');
    assert.equal(result.task.state, 'SUCCEEDED');
    assert.deepEqual(goalKinds(result), ['INVENTORY_QUERY']);
    assert.deepEqual(result.task.facts.map(fact => fact.key.predicate), ['inventory.virtual_readiness']);
    assert.equal(result.task.facts[0].key.qualifiers.basis, 'CURRENT_STOCK_AFTER_ACTIVE_ORDER_RESERVATIONS');
    assert.equal(result.canaryAdmission.eligible, true);
    assert.equal(result.canaryAdmission.decision, 'NATIVE_CANARY');
    assert.match(result.answer.content, /短缺300m/u, result.answer.content);
    assert.doesNotMatch(result.answer.content, /可以生产|能交货|产能够/u);
});

// ══ Admission 闸门与安全门 ═════════════════════════════════════════════════
test('GATE 齐料目标种类仍在已登记 SUPPORTED 族内，多主体澄清也是只读准入', () => {
    const admission = ownerReadCanaryAdmission({ goalKinds: ['INVENTORY_QUERY'] });
    assert.equal(admission.eligible, true);
    assert.equal(admission.decision, 'NATIVE_CANARY');
    assert.equal(ownerReadCanaryAdmission({ goalKinds: ['INVENTORY_QUERY'], businessWritePolicy: 'CONFIRMATION_REQUIRED' }).eligible, false);
});
