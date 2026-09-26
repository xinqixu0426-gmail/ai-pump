'use strict';
/**
 * E2 — NATIVE COVERAGE EXPANSION WAVE 1
 *
 * FAMILY-02 线圈成本（COIL_COST）与 FAMILY-03 线圈库存（INVENTORY_QUERY）的确定性契约。
 * 全部走真实 Native 控制器（无 provider ⇒ 确定性语义层），复用 Task V2 / FactKey /
 * canonicalEntityIdentity / capability 绑定与澄清机制，没有平行架构。
 *
 * FAMILY-01（配方成本比较）在本阶段未落地：这里只固定它的 **fail-closed** 契约
 * —— 绝不能用「其中一个配方的当前成本」冒充比较结果。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { runAiTaskControllerV2 } = require('../api/services/aiTaskControllerV2.cjs');
const { createTaskSessionStoreV2 } = require('../api/services/aiTaskSessionV2.cjs');
const { extractTaskSemanticsV2 } = require('../api/services/aiTaskSemanticsV2.cjs');
const { ownerTrialCoverageSummary, canaryAdmission, validateCoverageAgainstCapabilities, COVERAGE_STATUS, OWNER_TRIAL_COVERAGE } = require('../api/services/aiNativeOwnerTrialCoverage.cjs');

const queryReceipt = { authoritative: true, truncated: false, possiblyTruncated: false };
const verified = (data, extra = {}) => ({ success: true, data, ...extra, executionEvidence: { verified: true, calls: [{ method: 'GET', path: '/api/formal' }] } });
const input = (text, conversationId) => ({ ownerKey: 'e2-owner', requestId: crypto.randomUUID(), conversationId, messages: [{ role: 'user', content: text }] });

/** 线圈 fixture：spec 12-120 唯一；12-200 两个正式候选（同名不同主键）。 */
function coilExecutor(overrides = {}) {
    const calls = [];
    const rows = overrides.rows || [
        { id: 1, spec: '12', sheets: 120, material: '钢带', slotType: '小眼', schemeCode: 'COIL-0001', schemeName: '正式方案', schemeStatus: 'official', stock: 100, cost: 98.38753 },
        { id: 5, spec: '12', sheets: 200, material: '钢带', slotType: '小眼', schemeCode: 'COIL-0005', schemeName: '正式方案', schemeStatus: 'testing', stock: 0, cost: 143.82775 },
        { id: 12, spec: '12', sheets: 200, material: '钢带', slotType: '小眼', schemeCode: 'COIL-0012', schemeName: '240v 50hz 马来西亚客户', schemeStatus: 'official', stock: 7, cost: 144.90445 },
        { id: 2, spec: '12', sheets: 140, material: '钢带', slotType: '小眼', schemeCode: 'COIL-0002', schemeName: '正式方案', schemeStatus: 'official', stock: 3, cost: 115.29259 },
    ];
    const execute = async (toolName, args) => {
        calls.push({ toolName, args });
        if (toolName === 'search_coils') {
            const spec = String(args?.spec ?? '');
            const schemeCode = String(args?.schemeCode ?? '');
            // 精确线圈简写（spec-sheets）或方案编码；不做前缀/子串模糊匹配。
            const matched = schemeCode
                ? rows.filter(row => row.schemeCode === schemeCode)
                : rows.filter(row => spec === `${row.spec}-${row.sheets}` || spec === row.schemeCode);
            return verified(matched.length ? matched : rows, { queryReceipt });
        }
        throw new Error(`unexpected tool ${toolName}`);
    };
    return { calls, execute };
}
const factPredicates = task => task.facts.map(fact => fact.key.predicate);
const runTurn = (fixture, sessions, text, conversationId) => runAiTaskControllerV2(input(text, conversationId), { executeToolCall: fixture.execute, sessionStore: sessions });

test('E2-COIL-COST-1 唯一候选 → COIL_COST VERIFIED，且回答直接说出该方案自己的成本', async () => {
    const fixture = coilExecutor();
    const result = await runTurn(fixture, (require('../api/services/aiTaskSessionV2.cjs')).createTaskSessionStoreV2(), '12-120成本多少？', 'e2-cost-unique');
    assert.equal(result.task.state, 'SUCCEEDED');
    assert.deepEqual(result.task.goals.map(goal => goal.kind), ['COIL_COST']);
    assert.equal(result.task.goals[0].state, 'VERIFIED');
    assert.deepEqual(factPredicates(result.task), ['coil.current_cost']);
    // 事实身份来自 canonical 主键，而不是名称/数组位置。
    assert.equal(result.task.facts[0].key.entityType, 'coil');
    assert.equal(result.task.facts[0].key.entityId, '1');
    assert.equal(result.task.facts[0].key.qualifiers.basis, 'FORMAL_COIL_COST_QUERY');
    // 用户可见回答必须包含正式成本数值（来自回执指针，不是拼字符串）。
    assert.match(result.answer.content, /98\.39/, `回答必须给出正式成本：${result.answer.content}`);
});

test('E2-COIL-COST-2 多候选 → 澄清，且不得给出任何成本事实', async () => {
    const fixture = coilExecutor();
    const result = await runTurn(fixture, createTaskSessionStoreV2(), '12-200多少钱？', 'e2-cost-multi');
    assert.equal(result.task.state, 'WAITING_INPUT');
    assert.equal(result.task.questions[0].reasonCode, 'COIL_COST_AMBIGUOUS');
    assert.equal(result.task.questions[0].choices.length, 2);
    assert.deepEqual(factPredicates(result.task), [], '多候选时不得产出任何成本事实');
    assert.doesNotMatch(result.answer.content, /143\.8|144\.9/, '未消歧前不得给出任何候选的金额');
});

test('E2-COIL-COST-3 同名不同主键不得合并；候选标签必须可区分', async () => {
    const fixture = coilExecutor({ rows: [
        { id: 5, spec: '12', sheets: 200, material: '钢带', slotType: '小眼', schemeCode: 'COIL-0005', schemeName: '正式方案', schemeStatus: 'official', stock: 0, cost: 143.82775 },
        { id: 12, spec: '12', sheets: 200, material: '钢带', slotType: '小眼', schemeCode: 'COIL-0012', schemeName: '正式方案', schemeStatus: 'official', stock: 7, cost: 144.90445 },
    ] });
    const result = await runTurn(fixture, createTaskSessionStoreV2(), '12-200成本多少？', 'e2-cost-same-name');
    assert.equal(result.task.state, 'WAITING_INPUT');
    const choices = result.task.questions[0].choices;
    assert.equal(new Set(choices.map(choice => choice.label)).size, choices.length, `候选标签必须唯一：${JSON.stringify(choices.map(choice => choice.label))}`);
    assert.deepEqual(choices.map(choice => choice.entity.entityId), ['5', '12']);
});

test('E2-COIL-COST-4 显式选择 → 绑定被选候选自己的主键（不按数组顺序、不按最低价）', async () => {
    const fixture = coilExecutor();
    const sessions = createTaskSessionStoreV2();
    const first = await runTurn(fixture, sessions, '12-200成本多少？', 'e2-cost-select');
    assert.equal(first.task.state, 'WAITING_INPUT');
    const second = await runTurn(fixture, sessions, '第二个', 'e2-cost-select');
    assert.equal(second.task.taskId, first.task.taskId);
    assert.equal(second.task.planRevision, 2);
    assert.equal(second.task.state, 'SUCCEEDED');
    assert.equal(second.task.facts[0].key.entityId, '12', '必须绑定第二个候选（COIL-0012），而不是第一个/最便宜的');
    assert.match(second.answer.content, /144\.9/, second.answer.content);
});

test('E2-COIL-COST-5 不问成本就不得输出成本（goal 决定回答范围）', async () => {
    const semantics = await extractTaskSemanticsV2({ messageRef: 'm1', text: '12-120是什么线圈？', provider: null });
    assert.deepEqual(semantics.proposal.goals.map(goal => goal.kind), ['OTHER']);
    const fixture = coilExecutor();
    const result = await runTurn(fixture, createTaskSessionStoreV2(), '12-120是什么线圈？', 'e2-cost-negative');
    assert.equal(result.task.state, 'UNSUPPORTED');
    assert.deepEqual(factPredicates(result.task), [], '没有成本目标时不得产出成本事实');
});

test('E2-COIL-INV-1 唯一候选 → INVENTORY_QUERY VERIFIED，且回答说出该方案自己的库存', async () => {
    const fixture = coilExecutor();
    const result = await runTurn(fixture, createTaskSessionStoreV2(), '12-120还有多少？', 'e2-inv-unique');
    assert.equal(result.task.state, 'SUCCEEDED');
    assert.deepEqual(result.task.goals.map(goal => goal.kind), ['INVENTORY_QUERY']);
    assert.deepEqual(factPredicates(result.task), ['inventory.coil']);
    assert.equal(result.task.facts[0].key.entityId, '1');
    assert.match(result.answer.content, /100/, `回答必须给出正式库存：${result.answer.content}`);
});

test('E2-COIL-INV-2 库存与成本数值相同时不得混淆口径', async () => {
    const fixture = coilExecutor({ rows: [
        { id: 9, spec: '12', sheets: 120, material: '钢带', slotType: '小眼', schemeCode: 'COIL-0009', schemeName: '同值件', schemeStatus: 'official', stock: 123, cost: 123 },
    ] });
    const inventory = await runTurn(fixture, createTaskSessionStoreV2(), '12-120还有多少？', 'e2-inv-same');
    assert.deepEqual(factPredicates(inventory.task), ['inventory.coil'], '库存问法只能产出库存事实');
    assert.match(inventory.answer.content, /123/, inventory.answer.content);
    assert.doesNotMatch(inventory.answer.content, /成本/u, '库存回答不得混入成本口径');
    const cost = await runTurn(fixture, createTaskSessionStoreV2(), '12-120成本多少？', 'e2-cost-same');
    assert.deepEqual(factPredicates(cost.task), ['coil.current_cost'], '成本问法只能产出成本事实');
    assert.doesNotMatch(cost.answer.content, /库存/u, '成本回答不得混入库存口径');
});

test('E2-COIL-INV-3 多方案库存 → 澄清（不汇总、不默认第一套）', async () => {
    const fixture = coilExecutor();
    const result = await runTurn(fixture, createTaskSessionStoreV2(), '12-200有库存吗？', 'e2-inv-multi');
    assert.equal(result.task.state, 'WAITING_INPUT');
    assert.equal(result.task.questions[0].reasonCode, 'INVENTORY_COIL_AMBIGUOUS');
    assert.deepEqual(factPredicates(result.task), []);
});

test('E2-CONTINUATION-1 成本 → 库存连续追问：goal 必须切换，且绝不复用上一轮的成本事实', async () => {
    const fixture = coilExecutor();
    const sessions = createTaskSessionStoreV2();
    const cost = await runTurn(fixture, sessions, '12-120成本多少？', 'e2-cont');
    assert.deepEqual(factPredicates(cost.task), ['coil.current_cost']);
    // 追问带明确线圈主体时：goal 切换为库存，事实只能来自本轮的正式库存读取。
    const followed = await runTurn(fixture, sessions, '12-120还有库存吗？', 'e2-cont');
    assert.equal(followed.task.state, 'SUCCEEDED');
    assert.deepEqual(followed.task.goals.map(goal => goal.kind), ['INVENTORY_QUERY'], '追问必须切换到库存目标');
    assert.deepEqual(factPredicates(followed.task), ['inventory.coil'], '库存回答只能由本轮库存事实支撑');
    assert.doesNotMatch(followed.answer.content, /成本/u, '不得复用上一轮成本口径');
    // E2-R1：只带指代（「这个」）时**继承身份**（canonical coil），但目标与事实必须重新建立。
    const anaphor = await runTurn(fixture, sessions, '这个还有库存吗？', 'e2-cont');
    assert.equal(anaphor.task.state, 'SUCCEEDED');
    assert.deepEqual(anaphor.task.goals.map(goal => goal.kind), ['INVENTORY_QUERY'], '继承的是身份，不是目标');
    assert.deepEqual(factPredicates(anaphor.task), ['inventory.coil'], '不得用上一轮的成本事实回答本轮库存问题');
    assert.doesNotMatch(anaphor.answer.content, /成本/u);
});

test('E2-FAMILY-01-R1 比较问法进入正式双主体比较目标（E2-R1 已落地；绝不允许单主体成本冒充）', async () => {
    for (const question of ['v550-tokoy和v750-tokoy成本差多少？', 'v550-tokoy比v750-tokoy成本高多少？']) {
        const semantics = await extractTaskSemanticsV2({ messageRef: 'm1', text: question, provider: null });
        assert.deepEqual(semantics.proposal.goals.map(goal => goal.kind), ['RECIPE_COST_COMPARISON'], `${question} 必须是双主体比较目标`);
        assert.equal(semantics.proposal.goals[0].subjectKeys.length, 2, '比较目标必须绑定两个正式主体');
    }
});

test('E2-CANARY-1 SUPPORTED 才具备 canary 资格，PARTIAL / UNSUPPORTED 一律阻断', () => {
    assert.equal(canaryAdmission({ questionFamily: '线圈档案成本' }).eligible, true);
    assert.equal(canaryAdmission({ questionFamily: '线圈库存' }).eligible, true);
    const partial = ownerTrialCoverageSummary().partial[0];
    assert.equal(canaryAdmission({ questionFamily: partial.questionFamily }).eligible, false);
    assert.equal(canaryAdmission({ questionFamily: partial.questionFamily }).reason, 'FAMILY_NOT_SUPPORTED');
    const unsupported = ownerTrialCoverageSummary().unsupported[0];
    assert.equal(canaryAdmission({ questionFamily: unsupported.questionFamily }).eligible, false);
    assert.equal(canaryAdmission({ questionFamily: '不存在的问法族' }).eligible, false);
    assert.equal(canaryAdmission({ questionFamily: '线圈库存' }).status, COVERAGE_STATUS.SUPPORTED);
});

test('E2-COVERAGE-1 SUPPORTED 族必须声明真实登记的能力 / 事实 / 回答模板', () => {
    const report = validateCoverageAgainstCapabilities();
    assert.deepEqual(report.problems, [], `coverage 与真实能力不一致：${JSON.stringify(report.problems)}`);
    const summary = ownerTrialCoverageSummary();
    // NATIVE-R1：在 E2-R1 的 6 个族之上新增 4 个 Native 独家负责的只读族
    // （经营概况 / 报价查询 / 业务变更 / 线圈目录查询），故 SUPPORTED = 10。
    // NATIVE-R3：再纳入 customer-history / order-readiness，故为 12。
    assert.equal(summary.supported.length, 12, 'NATIVE-R3 后支持族应为 12（E2-R1 的 6 + R1 的 4 + R3 的 2）');
    assert.equal(summary.partial.length, 1);
    assert.equal(summary.unsupported.length, 1, '仍不支持：仅剩规格/配置差异（经营概况已由 NATIVE-R1 接管）');
});

test('E2-MONEY-NO-SELF-SUBTRACT 没有正式比较回执时不得输出任何金额（控制器不相减、不猜测方向）', async () => {
    const result = await runAiTaskControllerV2(input('v550-tokoy和v750-tokoy成本差多少？', 'e2-compare-no-subtract'), {
        executeToolCall: async toolName => toolName === 'get_all_recipes'
            ? verified([{ id: 13, name: 'v550-tokoy' }, { id: 2, name: 'v750-tokoy' }], { queryReceipt })
            : { success: true, data: {} },
        sessionStore: createTaskSessionStoreV2(),
    });
    assert.notEqual(result.task.state, 'SUCCEEDED');
    assert.doesNotMatch(result.answer.content, /[¥￥]\s*\d|\d+\.\d{2}/u, `不得输出任何金额：${result.answer.content}`);
    assert.deepEqual(factPredicates(result.task), []);
});

test('E2-CANARY-2 admission 与 canaryEligible 同源：合格集合完全一致，未支持族一律不进 canary', () => {
    const summary = ownerTrialCoverageSummary();
    const admitted = OWNER_TRIAL_COVERAGE
        .filter(entry => canaryAdmission({ questionFamily: entry.questionFamily }).eligible)
        .map(entry => entry.questionFamily);
    assert.deepEqual([...admitted].sort(), [...summary.canaryEligible].sort(), 'admission 与 canaryEligible 必须同源');
    assert.equal(summary.canaryEligible.length, summary.supported.length);
    for (const entry of [...summary.partial, ...summary.unsupported]) {
        assert.equal(canaryAdmission({ questionFamily: entry.questionFamily }).eligible, false, `${entry.questionFamily} 不得进入 canary`);
        assert.equal(summary.canaryEligible.includes(entry.questionFamily), false);
    }
    // 结构未就绪时，即使是 SUPPORTED 族也不得放行。
    assert.equal(canaryAdmission({ questionFamily: '线圈库存', structuralReady: false }).eligible, false);
    assert.equal(canaryAdmission({ questionFamily: '线圈库存', structuralReady: false }).reason, 'STRUCTURAL_NOT_READY');
});
