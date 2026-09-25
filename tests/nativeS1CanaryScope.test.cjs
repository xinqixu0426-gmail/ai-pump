'use strict';
/**
 * S1 — SUPPORTED SCOPE STABILITY CLOSURE
 *
 * 覆盖：
 *   B. S1 baseline 冻结当前 6 个 SUPPORTED family（含全部登记字段 + 显式停用机制）
 *   C/D. Owner Read Canary admission 是唯一准入闸门（SUPPORTED 外的族一律 LEGACY_SAFE_PATH）
 *   E. Canary 运行模式：只读、owner-only、可立即关闭、默认路由不变
 *   I. 失败注入：provider 失败 / 正式 API 失败 / 歧义 / 空结果 / 不完整定价 / 会话过期
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
    ownerReadCanaryAdmission, ownerTrialCoverageBaseline, ownerTrialCoverageSummary, ownerTrialCoverageReadiness,
    canaryAdmission, validateCoverageAgainstCapabilities, suspendFamily, reinstateFamily, coverageStatusOf, COVERAGE_STATUS,
} = require('../api/services/aiNativeOwnerTrialCoverage.cjs');
const { resolveAiNativeRollout, readAiNativeRolloutConfig } = require('../api/services/aiNativeRolloutPolicy.cjs');
const { runAiDispatcherV3 } = require('../api/services/aiDispatcherV3.cjs');
const { runAiTaskControllerV2 } = require('../api/services/aiTaskControllerV2.cjs');
const { createTaskSessionStoreV2 } = require('../api/services/aiTaskSessionV2.cjs');
const { extractTaskSemanticsV2, recipeCostComparisonIntent } = require('../api/services/aiTaskSemanticsV2.cjs');

const evidence = { verified: true, kind: 'formal_api_query' };
const listReceipt = rows => ({ success: true, count: rows.length, queryReceipt: { appliedFilters: {}, totalCount: rows.length, returnedCount: rows.length, truncated: false, possiblyTruncated: false, authoritative: true }, data: rows, executionEvidence: evidence });
const objectReceipt = data => ({ success: true, data, executionEvidence: evidence });
const unverified = data => ({ success: true, data });
const MONEY_RE = /[¥￥]\s*\d+(?:\.\d+)?|\d+\.\d{2}/gu;
const moneyIn = text => [...String(text).matchAll(MONEY_RE)].map(match => match[0].replace(/[¥￥\s]/gu, ''));

const RECIPES = Object.freeze([{ id: 13, name: 'v550-tokoy', spec: '12-120' }, { id: 2, name: 'v750-tokoy', spec: '12-140' }]);
const COILS = Object.freeze([
    { id: 1, spec: '12', sheets: 120, schemeCode: 'COIL-0001', schemeName: '正式方案', schemeStatus: 'official', stock: 100, cost: 98.38 },
    { id: 5, spec: '12', sheets: 200, schemeCode: 'COIL-0005', schemeName: '正式方案', schemeStatus: 'testing', stock: 0, cost: 143.82 },
    { id: 6, spec: '12', sheets: 200, schemeCode: 'COIL-0006', schemeName: '正式方案', schemeStatus: 'official', stock: 7, cost: 144.9 },
]);
function fixture(options = {}) {
    const calls = [];
    const execute = async (toolName, args = {}) => {
        calls.push({ toolName, args });
        if (toolName === 'get_all_recipes') {
            const keyword = String(args.keyword ?? '').trim();
            return listReceipt(RECIPES.filter(row => !keyword || row.name.includes(keyword)));
        }
        if (toolName === 'compare_recipes') {
            if (options.compareUnverified) return unverified({});
            return objectReceipt({ recipe1: { name: 'v550-tokoy', cost: 271.98 }, recipe2: { name: 'v750-tokoy', cost: 286.51 }, costDiff: '14.53', costBasis: 'currentFullCost' });
        }
        if (toolName === 'compare_recipe_scenarios') {
            if (options.costUnverified) return unverified({});
            const current = options.costMap ? options.costMap[Number(args.recipeId)] : 271.98;
            return objectReceipt({ scenarios: [{ cost: { currentTotalCost: options.incompletePricing ? null : current, complete: options.incompletePricing !== true } }] });
        }
        if (toolName === 'search_coils') {
            const schemeCode = String(args.schemeCode ?? '').trim();
            const shorthand = String(args.spec ?? '').trim();
            const rows = schemeCode ? COILS.filter(row => row.schemeCode === schemeCode) : COILS.filter(row => `${row.spec}-${row.sheets}` === shorthand);
            return listReceipt(options.emptyCoil ? [] : rows);
        }
        throw new Error(`UNEXPECTED_TOOL ${toolName}`);
    };
    return { calls, execute };
}
const input = (text, conversationId) => ({ ownerKey: 's1-owner', requestId: crypto.randomUUID(), conversationId, messages: [{ role: 'user', content: text }] });
const turn = (f, sessions, text, conversationId, extra = {}) => runAiTaskControllerV2(input(text, conversationId), { executeToolCall: f.execute, sessionStore: sessions, provider: null, ...extra });

// ══ B. S1 baseline ════════════════════════════════════════════════════
test('S1-B1 S1 baseline 冻结 SUPPORTED family（NATIVE-R1 后为 10 个），且每个族登记全部 S1 字段', () => {
    const baseline = ownerTrialCoverageBaseline();
    assert.equal(baseline.version, 'S1');
    // NATIVE-R1：在 S1 的 6 个族之上新增 4 个 Native 独家负责的只读族。
    // NATIVE-R3：在 R1 的 10 族之上新增 customer-history / order-readiness 两个真实只读族。
    assert.equal(baseline.families.length, 12);
    assert.deepEqual(baseline.families.map(family => family.familyId).sort(), [
        'business-change-read', 'coil-catalogue-cost', 'coil-catalogue-query', 'coil-inventory',
        'customer-history', 'management-overview', 'multi-goal-config-profit-readiness', 'order-readiness',
        'quotation-read', 'recipe-cost-comparison', 'single-recipe-current-cost', 'virtual-readiness-preview',
    ]);
    for (const family of baseline.families) {
        assert.ok(family.questionFamily, family.familyId);
        assert.ok(family.goalKind, `${family.familyId} goalKind`);
        assert.ok(Array.isArray(family.goalKinds) && family.goalKinds.length > 0, `${family.familyId} goalKinds`);
        assert.ok(Array.isArray(family.subjectTypes) && family.subjectTypes.length > 0, `${family.familyId} subjectTypes`);
        assert.ok(Array.isArray(family.requiredCapabilities) && family.requiredCapabilities.length > 0, `${family.familyId} capabilities`);
        assert.ok(Array.isArray(family.requiredFacts) && family.requiredFacts.length > 0, `${family.familyId} facts`);
        assert.ok(family.ambiguityPolicy, `${family.familyId} ambiguityPolicy`);
        assert.ok(family.answerContract, `${family.familyId} answerContract`);
        assert.equal(family.canaryEligible, true);
    }
    assert.deepEqual(baseline.suspendedFamilies, []);
    assert.deepEqual(validateCoverageAgainstCapabilities().problems, []);
});

test('S1-B2 停用是显式且可恢复的：SUPPORTED → SUSPENDED 记录原因，绝不静默删除', () => {
    const summary = ownerTrialCoverageSummary();
    assert.equal(summary.total, 14, '总族数不因停用而减少');
    assert.equal(suspendFamily('coil-catalogue-cost', 'S1 dry-run：该项在真实 canary 中暴露缺陷（示例记录）'), COVERAGE_STATUS.SUSPENDED);
    try {
        const after = ownerTrialCoverageSummary();
        assert.equal(after.total, 14);
        assert.equal(after.supported.length, 11, '停用族不再计入 SUPPORTED');
        assert.equal(after.suspended.length, 1);
        assert.equal(after.canaryEligible.includes('线圈档案成本'), false);
        const admission = canaryAdmission({ questionFamily: '线圈档案成本' });
        assert.equal(admission.eligible, false);
        assert.equal(admission.reason, 'FAMILY_SUSPENDED');
        assert.match(admission.suspension.reason, /真实 canary/u, '停用必须带原因');
        assert.equal(ownerTrialCoverageBaseline().suspendedFamilies.length, 1);
        assert.equal(COVERAGE_STATUS.SUSPENDED, coverageStatusOf(require('../api/services/aiNativeOwnerTrialCoverage.cjs').familyById('coil-catalogue-cost')));
        assert.equal(ownerTrialCoverageReadiness({ structuralReady: true }).status, 'READY_WITHIN_SUPPORTED_SCOPE');
        assert.deepEqual(validateCoverageAgainstCapabilities().problems, []);
    } finally {
        assert.equal(reinstateFamily('coil-catalogue-cost'), COVERAGE_STATUS.SUPPORTED);
    }
    // NATIVE-R1：经营概况 / 报价查询 / 业务变更 / 线圈目录查询 四个族由 Native 接管，
    // SUPPORTED 由 6 变为 10（不是放宽断言，而是架构变更后的新边界）。
    // NATIVE-R3：customer-history / order-readiness 已声明为 SUPPORTED，故为 12。
    assert.equal(ownerTrialCoverageSummary().supported.length, 12);
});

// ══ C/D. Admission gate ═══════════════════════════════════════════════
test('S1-C1 六个 SUPPORTED 族的计划一律 NATIVE_CANARY', () => {
    const single = ['CURRENT_COST', 'COIL_COST', 'RECIPE_COST_COMPARISON', 'INVENTORY_QUERY'];
    for (const kind of single) {
        const admission = ownerReadCanaryAdmission({ goalKinds: [kind] });
        assert.equal(admission.eligible, true, kind);
        assert.equal(admission.decision, 'NATIVE_CANARY');
        assert.equal(admission.reason, 'SUPPORTED_AND_READ_ONLY');
    }
    const multi = ownerReadCanaryAdmission({ goalKinds: ['CURRENT_COST', 'CONFIGURATION_COMPARE', 'PROFITABILITY', 'INVENTORY_QUERY'] });
    assert.equal(multi.eligible, true);
    assert.equal(multi.families.length, 4, '每个目标种类都要有 SUPPORTED 族覆盖');
});

test('S1-C2 未支持 / 未知 / 写请求 / 空计划一律 LEGACY_SAFE_PATH', () => {
    // NATIVE-R3：MANAGEMENT_OVERVIEW（R1）与 CUSTOMER_HISTORY（R3）均已准入，故用仍未登记覆盖的
    // IMPACT_INVESTIGATION 代表「未支持」；判据与期望语义不变（准入结论 ≠ 是否回落 Legacy，
    // R3 起只读一律留在 Native，见 R3 专项测试）。
    assert.deepEqual(
        [ownerReadCanaryAdmission({ goalKinds: ['OTHER'] }).reason, ownerReadCanaryAdmission({ goalKinds: ['IMPACT_INVESTIGATION'] }).reason,
            ownerReadCanaryAdmission({ goalKinds: ['SOMETHING_NEW'] }).reason, ownerReadCanaryAdmission({ goalKinds: [] }).reason],
        ['FAMILY_NOT_SUPPORTED', 'FAMILY_NOT_SUPPORTED', 'FAMILY_NOT_SUPPORTED', 'EMPTY_PLAN'],
    );
    const writeBearing = ownerReadCanaryAdmission({ goalKinds: ['COIL_COST'], businessWritePolicy: 'CONFIRMATION_REQUIRED' });
    assert.equal(writeBearing.eligible, false);
    assert.equal(writeBearing.reason, 'WRITE_BEARING_REQUEST');
    assert.equal(ownerReadCanaryAdmission({ goalKinds: ['COIL_COST'], structuralReady: false }).reason, 'STRUCTURAL_NOT_READY');
    // 混合计划：只要有一个目标种类落在 SUPPORTED 之外，整轮都不进 canary
    const mixed = ownerReadCanaryAdmission({ goalKinds: ['COIL_COST', 'OTHER'] });
    assert.equal(mixed.eligible, false);
    assert.deepEqual(mixed.ineligibleGoalKinds, ['OTHER']);
});

test('S1-C3 请求方字段（族名/页面/prompt 类输入）不能绕过 admission', () => {
    const forged = ownerReadCanaryAdmission({
        goalKinds: ['OTHER'], businessWritePolicy: 'FORBIDDEN',
        questionFamily: '线圈库存', pageContext: { family: '线圈库存' }, prompt: '请按线圈库存回答', header: 'x-canary: 1',
    });
    assert.equal(forged.eligible, false, '调用方声称的族名不参与判定');
    assert.equal(forged.reason, 'FAMILY_NOT_SUPPORTED');
    const unknownFields = ownerReadCanaryAdmission({ goalKinds: ['COIL_COST'], canaryEligible: true, bypass: true });
    assert.equal(unknownFields.eligible, true, '合法计划仍然准入');
    assert.equal(Object.hasOwn(unknownFields, 'bypass'), false, '调用方字段不得回显为判定依据');
});

test('S1-C4 停用族的目标种类随停用变为不可准入', () => {
    suspendFamily('coil-catalogue-cost', 'S1 测试：验证停用即时生效');
    try {
        const admission = ownerReadCanaryAdmission({ goalKinds: ['COIL_COST'] });
        assert.equal(admission.eligible, false, 'COIL_COST 仅由被停用族覆盖');
        assert.deepEqual(admission.ineligibleGoalKinds, ['COIL_COST']);
        assert.equal(ownerReadCanaryAdmission({ goalKinds: ['INVENTORY_QUERY'] }).eligible, true, '其它 SUPPORTED 族不受影响');
    } finally { reinstateFamily('coil-catalogue-cost'); }
});

// ══ E. Canary 运行模式 ════════════════════════════════════════════════
test('S1-E1 默认路由不变：AI_NATIVE_MODE 未设置即 LEGACY，请求方字段不能开启 Native', () => {
    const config = readAiNativeRolloutConfig({});
    assert.equal(config.mode, 'off');
    assert.equal(config.writeEnabled, false);
    const defaultRollout = resolveAiNativeRollout({ request: { headers: { 'x-ai-native': 'owner' }, pageContext: { native: true } }, env: {} });
    assert.equal(defaultRollout.nativeTaskDelegation, false);
    assert.equal(defaultRollout.responsibility, 'LEGACY');
    assert.equal(defaultRollout.reason, 'AI_NATIVE_OFF_LEGACY_AUTHORITATIVE');
    // 非 owner 请求即使在 owner 模式下也不委派
    const notOwner = resolveAiNativeRollout({ request: {}, env: { AI_NATIVE_MODE: 'owner' }, isOwner: () => false });
    assert.equal(notOwner.nativeTaskDelegation, false);
    assert.equal(notOwner.reason, 'AI_NATIVE_OWNER_REQUIRED');
});

test('S1-E2（NATIVE-R3 改写）dispatcher：Owner 只读即使 admission 不合格也留在 Native；仅写意图计划回到既有路径', async () => {
    // R3 前：admission 不合格 → 交回 Legacy。R3 后：Owner 只读一律 Native-owned，
    // unknown / no-plan / 未支持读都只能产出 Native 结果。此处按新契约显式改写。
    const emitted = [];
    let legacyCalls = 0;
    await runAiDispatcherV3(
        { messages: [{ role: 'user', content: '今天的经营情况是什么' }], conversationId: 's1-e2', emit: (...args) => emitted.push(args) },
        {
            nativeTaskDelegation: true,
            runAiTaskControllerV2: async () => ({
                task: { state: 'SUPPORTED' }, detail: { state: 'SUPPORTED' }, answer: { content: 'Native 的确定性结论' },
                canaryAdmission: { eligible: false, decision: 'LEGACY_SAFE_PATH', reason: 'FAMILY_NOT_SUPPORTED', nativeReadOwned: true }, telemetry: {},
            }),
            runAiAssistant: async () => { legacyCalls += 1; return { finalContent: '既有正式路径的答案' }; },
        },
    );
    assert.equal(legacyCalls, 0, 'Owner 只读不得回到既有路径');
    assert.equal(emitted.some(([type, payload]) => type === 'content' && payload.content === 'Native 的确定性结论'), true, '必须输出 Native 结果');
    assert.equal(emitted.some(([type, payload]) => type === 'status' && payload.stage === 'canary_ineligible'), false);

    // NATIVE-HC1：写意图请求由 Native 给出确定性「写未开放」结果，Legacy 与 Native 只读运行时都不参与。
    const writeEmitted = [];
    let writeCommandCalls = 0;
    let writeReadCalls = 0;
    await runAiDispatcherV3(
        { messages: [{ role: 'user', content: '帮我新增零件' }], conversationId: 's1-e2-write', emit: (...args) => writeEmitted.push(args) },
        {
            nativeTaskDelegation: true,
            runAiTaskControllerV2: async () => { throw new Error('MUST_NOT_RUN_FOR_WRITE'); },
            runAiAssistant: async () => { writeReadCalls += 1; return { finalContent: '既有只读路径' }; },
            runAiAgentRuntimeV3: async () => { writeCommandCalls += 1; return { finalContent: '既有命令路径的答案' }; },
        },
    );
    assert.equal(writeCommandCalls, 0, '写请求不得进入 Legacy 写运行时');
    assert.equal(writeReadCalls, 0, '写请求不得被重分类为 Native 只读');
    assert.equal(writeEmitted.some(([type, payload]) => type === 'status' && payload.stage === 'native_write_disabled'), true);
    assert.equal(writeEmitted.some(([type, payload]) => type === 'content' && /写入当前未开放/u.test(payload.content)), true);
});

test('S1-E3 dispatcher：admission 合格 → Native 作为权威答案，legacy 不参与', async () => {
    const emitted = [];
    let legacyCalls = 0;
    const result = await runAiDispatcherV3(
        { messages: [{ role: 'user', content: '12-120成本多少？' }], conversationId: 's1-e3', emit: (...args) => emitted.push(args) },
        {
            nativeTaskDelegation: true,
            runAiTaskControllerV2: async () => ({
                task: { state: 'SUCCEEDED' }, detail: { state: 'SUCCEEDED' }, answer: { content: '正式方案的当前线圈成本为 ¥98.38。' },
                canaryAdmission: { eligible: true, decision: 'NATIVE_CANARY', reason: 'SUPPORTED_AND_READ_ONLY' }, telemetry: {},
            }),
            runAiAssistant: async () => { legacyCalls += 1; return { finalContent: 'legacy' }; },
        },
    );
    assert.equal(legacyCalls, 0);
    assert.equal(result.answer.content, '正式方案的当前线圈成本为 ¥98.38。');
    assert.equal(emitted.some(([type, payload]) => type === 'content' && payload.content === '正式方案的当前线圈成本为 ¥98.38。'), true);
});

test('S1-E4 canary 关闭即回到默认路径（可立即关闭、无需回滚数据）', () => {
    const on = resolveAiNativeRollout({ request: {}, env: { AI_NATIVE_MODE: 'owner' }, isOwner: () => true });
    assert.equal(on.nativeTaskDelegation, true);
    const off = resolveAiNativeRollout({ request: {}, env: { AI_NATIVE_MODE: 'off' }, isOwner: () => true });
    assert.equal(off.nativeTaskDelegation, false);
    assert.equal(off.responsibility, 'LEGACY');
    const invalid = resolveAiNativeRollout({ request: {}, env: { AI_NATIVE_MODE: 'yolo' }, isOwner: () => true });
    assert.equal(invalid.nativeTaskDelegation, false, '非法模式必须 fail-closed 到 LEGACY');
    assert.equal(invalid.reason, 'AI_NATIVE_MODE_INVALID');
});

// ══ G. 连续会话稳定性（§G 序数指代链）═══════════════════════════════════
test('S1-G1 比较 → 「第二个现在完整成本呢」→「那第一个呢」：焦点顺序稳定且事实每轮重读', async () => {
    const costMap = { 13: 271.98, 2: 286.51 };
    const f = fixture({ costMap });
    const sessions = createTaskSessionStoreV2();
    const first = await turn(f, sessions, 'v550-tokoy和v750-tokoy差多少钱？', 's1-g1');
    assert.equal(first.task.state, 'SUCCEEDED');
    const second = await turn(f, sessions, '第二个现在完整成本呢？', 's1-g1');
    assert.deepEqual(second.task.goals.map(goal => goal.kind), ['CURRENT_COST'], '目标每轮重新解析');
    assert.match(second.answer.content, /v750-tokoy当前完整成本为 ¥286\.51/u, '第二个 = 比较里的第二个主体');
    costMap[13] = 371.98; // 正式成本变化：必须重读，不得沿用上一轮
    const third = await turn(f, sessions, '那第一个呢？', 's1-g1');
    assert.deepEqual(third.task.goals.map(goal => goal.kind), ['CURRENT_COST']);
    assert.match(third.answer.content, /v550-tokoy当前完整成本为 ¥371\.98/u, '第一个 = 比较里的第一个主体，且数值来自本轮重读');
    assert.doesNotMatch(third.answer.content, /¥271\.98/u, '不得复用上一轮事实');
    const reads = f.calls.filter(call => call.toolName === 'compare_recipe_scenarios');
    assert.equal(reads.length >= 2, true, '每一次追问都必须重新正式读取');
    assert.equal(new Set(reads.map(call => call.args.recipeId)).size, 2, '两次读取分别是两个主体');
});

test('S1-G2 配置变更 + 盈利问法不得被误判成纯成本比较（S1 实测发现的误路由）', async () => {
    const question = 'v550-tokoy 换电缆到8米，成本差多少，卖360能赚吗';
    assert.equal(recipeCostComparisonIntent(question), null);
    const semantics = await extractTaskSemanticsV2({ messageRef: 'm1', text: question, provider: null });
    assert.equal(semantics.proposal.goals.some(goal => goal.kind === 'RECIPE_COST_COMPARISON'), false, '必须走配置变更路径');
    assert.equal(semantics.proposal.goals.some(goal => goal.kind === 'CONFIGURATION_COMPARE'), true);
});

// ══ I. 失败注入 ═══════════════════════════════════════════════════════
test('S1-I1 provider 失败：不得产生未经验证结论（正式事实仍只来自回执）', async () => {
    const f = fixture();
    const provider = async () => { throw Object.assign(new Error('provider timeout'), { code: 'PROVIDER_TIMEOUT' }); };
    const result = await turn(f, createTaskSessionStoreV2(), 'v550-tokoy和v750-tokoy成本差多少？', 's1-i1', { provider });
    assert.equal(result.task.state, 'SUCCEEDED');
    assert.deepEqual(result.task.facts.map(fact => fact.key.predicate), ['recipe.current_cost', 'recipe.current_cost', 'recipe.cost_difference']);
    assert.deepEqual(moneyIn(result.answer.content).sort(), ['14.53', '271.98', '286.51'], '只允许正式回执金额');
});

test('S1-I2 正式 API 失败：不得用历史事实替代（本轮无金额）', async () => {
    const f = fixture({ costUnverified: true });
    const result = await turn(f, createTaskSessionStoreV2(), 'v550-tokoy成本多少？', 's1-i2');
    assert.notEqual(result.task.state, 'SUCCEEDED');
    assert.deepEqual(moneyIn(result.answer.content), []);
    assert.deepEqual(result.task.facts, []);
});

test('S1-I3 歧义身份：必须澄清（不默认、不汇总）', async () => {
    const f = fixture();
    const result = await turn(f, createTaskSessionStoreV2(), '12-200有库存吗？', 's1-i3');
    assert.equal(result.task.state, 'WAITING_INPUT');
    assert.equal(result.task.questions[0].reasonCode, 'INVENTORY_COIL_AMBIGUOUS');
    assert.deepEqual(result.task.facts, []);
    assert.deepEqual(moneyIn(result.answer.content), []);
});

test('S1-I4 空正式结果：不得编造不存在的数据', async () => {
    const f = fixture({ emptyCoil: true });
    const result = await turn(f, createTaskSessionStoreV2(), '12-140还有多少？', 's1-i4');
    assert.notEqual(result.task.state, 'SUCCEEDED');
    assert.deepEqual(result.task.facts, []);
    assert.deepEqual(moneyIn(result.answer.content), []);
    assert.doesNotMatch(result.answer.content, /库存为\s*\d/u, '没有正式记录时不得给出库存数值');
});

test('S1-I5 不完整定价：不得声称完整成本', async () => {
    const f = fixture({ incompletePricing: true });
    const result = await turn(f, createTaskSessionStoreV2(), 'v550-tokoy成本多少？', 's1-i5');
    assert.notEqual(result.task.state, 'SUCCEEDED');
    assert.doesNotMatch(result.answer.content, /完整成本为/u, '定价不完整时不得说完整成本');
    assert.deepEqual(moneyIn(result.answer.content), []);
});

test('S1-I6 会话过期：不得继承旧 canonical 主体', async () => {
    const f = fixture();
    let now = 5_000_000;
    const sessions = createTaskSessionStoreV2({ now: () => now, ttlMs: 1000 });
    await turn(f, sessions, '12-120成本多少？', 's1-i6');
    now += 120_000;
    const stale = await turn(f, sessions, '这个还有库存吗？', 's1-i6');
    assert.deepEqual(stale.task.facts, []);
    assert.deepEqual(moneyIn(stale.answer.content), []);
    assert.notEqual(stale.task.state, 'SUCCEEDED');
});
