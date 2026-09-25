'use strict';
/**
 * NATIVE-R1 — Native Read Cutover（F1 收缩）专项测试。
 *
 * 目的：证明被声明 nativeOwned 的只读族在**成功与全部失败条件下**都不会进入
 * aiAssistantRuntime / aiAgentRuntimeV3 / Legacy tool loop。
 *
 * 证明方式分两层：
 *  1) 真实 controller：用正式形态的 verified 回执跑 runAiTaskControllerV2，断言
 *     admission 准入、所有权成立、答案由 Native 证据渲染（MANAGEMENT_V1）。
 *  2) dispatcher 注入式：把 Legacy runtime 换成计数器 spy，断言调用次数为 0
 *     —— 不是靠路由标签，而是靠真实函数调用缺席。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
    ownerReadCanaryAdmission, nativeOwnershipDecision, ownerTrialCoverageSummary,
    validateCoverageAgainstCapabilities, familyById, suspendFamily, reinstateFamily, COVERAGE_STATUS,
} = require('../api/services/aiNativeOwnerTrialCoverage.cjs');
const { runAiTaskControllerV2 } = require('../api/services/aiTaskControllerV2.cjs');
const { createTaskSessionStoreV2 } = require('../api/services/aiTaskSessionV2.cjs');
const { runAiDispatcherV3 } = require('../api/services/aiDispatcherV3.cjs');

const CUTOVER_FAMILIES = Object.freeze([
    'management-overview', 'quotation-read', 'business-change-read', 'coil-catalogue-query',
]);
const CUTOVER_GOAL_KINDS = Object.freeze([
    'MANAGEMENT_OVERVIEW', 'QUOTATION_QUERY', 'BUSINESS_CHANGES', 'COIL_QUERY',
]);
const FORBIDDEN = 'FORBIDDEN';
const evidence = { verified: true, kind: 'formal_api_query' };
const objectReceipt = data => ({ success: true, data, executionEvidence: evidence });

// ══ 1. 覆盖表与所有权 ══════════════════════════════════════════════════
test('R1-COV-1 四个 cutover 族均为 SUPPORTED + nativeOwned，且登记字段完整', () => {
    const summary = ownerTrialCoverageSummary();
    for (const familyId of CUTOVER_FAMILIES) {
        const entry = familyById(familyId);
        assert.ok(entry, `${familyId} 必须登记`);
        assert.equal(entry.nativeSupport, COVERAGE_STATUS.SUPPORTED, familyId);
        assert.equal(entry.nativeOwned, true, `${familyId} 必须显式声明 nativeOwned`);
        assert.ok(Array.isArray(entry.requiredCapabilities) && entry.requiredCapabilities.length > 0, `${familyId} capabilities`);
        assert.ok(Array.isArray(entry.requiredFacts) && entry.requiredFacts.length > 0, `${familyId} requiredFacts`);
        assert.ok(entry.answerContract, `${familyId} answerContract`);
        assert.ok(summary.supported.some(item => item.familyId === familyId), `${familyId} 必须计入 SUPPORTED`);
    }
    assert.deepEqual(validateCoverageAgainstCapabilities().problems, [], 'coverage 必须与真实能力登记一致');
});

test('R1-COV-2 每个 cutover goal kind 都准入且所有权成立', () => {
    for (const kind of CUTOVER_GOAL_KINDS) {
        const admission = ownerReadCanaryAdmission({ goalKinds: [kind], businessWritePolicy: FORBIDDEN });
        assert.equal(admission.eligible, true, `${kind} 应准入`);
        const ownership = nativeOwnershipDecision({ goalKinds: [kind], businessWritePolicy: FORBIDDEN });
        assert.equal(ownership.owned, true, `${kind} 应属于 Native 独家负责`);
    }
});

test('R1-COV-3 所有权闸门对写意图 / 空计划 / 未覆盖族 fail closed', () => {
    // 写意图永不进入只读 cutover
    assert.equal(nativeOwnershipDecision({ goalKinds: ['MANAGEMENT_OVERVIEW'], businessWritePolicy: 'CONFIRMATION_REQUIRED' }).owned, false);
    assert.equal(nativeOwnershipDecision({ goalKinds: ['MANAGEMENT_OVERVIEW'], businessWritePolicy: 'CONFIRMATION_REQUIRED' }).reason, 'WRITE_BEARING_REQUEST');
    // 空计划
    assert.equal(nativeOwnershipDecision({ goalKinds: [], businessWritePolicy: FORBIDDEN }).owned, false);
    assert.equal(nativeOwnershipDecision({ goalKinds: [], businessWritePolicy: FORBIDDEN }).reason, 'EMPTY_PLAN');
    // 未声明所有权的族（OTHER 是 catch-all，任何族都不得覆盖它）
    assert.equal(nativeOwnershipDecision({ goalKinds: ['OTHER'], businessWritePolicy: FORBIDDEN }).owned, false);
    assert.equal(nativeOwnershipDecision({ goalKinds: ['CURRENT_COST'], businessWritePolicy: FORBIDDEN }).owned, false);
    // 混合计划：含未覆盖目标仍属 Native 独家负责（禁止回落 Legacy）
    const mixed = nativeOwnershipDecision({ goalKinds: ['MANAGEMENT_OVERVIEW', 'OTHER'], businessWritePolicy: FORBIDDEN });
    assert.equal(mixed.owned, true);
    assert.equal(mixed.reason, 'OWNED_FAMILY_WITH_UNOWNED_GOALS');
    assert.deepEqual(mixed.unownedGoalKinds, ['OTHER']);
});

test('R1-COV-4 停用族立即失去所有权（安全阀仍然有效）', () => {
    assert.equal(suspendFamily('management-overview', 'NATIVE-R1 测试：停用后必须退回既有路径'), COVERAGE_STATUS.SUSPENDED);
    try {
        assert.equal(nativeOwnershipDecision({ goalKinds: ['MANAGEMENT_OVERVIEW'], businessWritePolicy: FORBIDDEN }).owned, false);
    } finally {
        assert.equal(reinstateFamily('management-overview'), COVERAGE_STATUS.SUPPORTED);
    }
    assert.equal(nativeOwnershipDecision({ goalKinds: ['MANAGEMENT_OVERVIEW'], businessWritePolicy: FORBIDDEN }).owned, true);
});

// ══ 2. 真实 controller：经营概况族由 Native 独立作答 ═══════════════════
function managementTurn(options = {}) {
    const calls = [];
    const execute = async (toolName, args = {}) => {
        calls.push({ toolName, args });
        if (toolName !== 'get_management_action_center') throw new Error(`UNEXPECTED_TOOL ${toolName}`);
        if (options.unverifiedReceipt) return { success: true, data: {} };
        if (options.apiFailure) throw new Error('FORMAL_API_UNAVAILABLE');
        return objectReceipt({ actionCenter: [{ id: 1, title: '待复核单据', priority: 'P1' }] });
    };
    const input = {
        ownerKey: 'native-r1-owner',
        requestId: crypto.randomUUID(),
        conversationId: options.conversationId,
        messages: [{ role: 'user', content: options.text || '现在的管理待办和风险有哪些' }],
    };
    return { calls, run: () => runAiTaskControllerV2(input, { executeToolCall: execute, sessionStore: createTaskSessionV2(), provider: null }) };
}

function createTaskSessionV2() { return createTaskSessionStoreV2(); }

test('R1-CTRL-1 经营概况：admission 准入 + 所有权成立 + 答案来自 Native 正式回执', async () => {
    const turn = managementTurn();
    const result = await turn.run();
    assert.equal(result.canaryAdmission.eligible, true, '经营概况必须已准入 Native');
    assert.equal(result.canaryAdmission.nativeOwned, true, '经营概况必须由 Native 独家负责');
    assert.equal(result.answer.answerMode, 'DETERMINISTIC');
    assert.match(result.answer.content, /管理行动中心/u, '答案必须由 MANAGEMENT_V1 模板渲染');
    assert.deepEqual(turn.calls.map(call => call.toolName), ['get_management_action_center'], '必须只调用正式管理读取能力');
});

test('R1-CTRL-2 经营概况失败注入：未验证回执 → Native 结构化结果；正式 API 抛错 → fail-closed 抛出', async () => {
    // 未验证回执：不产生 VERIFIED fact，但仍是 Native 的结构化结果（族仍归 Native 所有）
    const unverified = managementTurn({ unverifiedReceipt: true });
    const result = await unverified.run();
    assert.equal(result.canaryAdmission.nativeOwned, true);
    assert.equal(result.canaryAdmission.eligible, true);
    assert.equal(typeof result.answer.content, 'string');

    // 正式 API 抛错：controller 直接抛出（fail closed），绝不返回「交给 Legacy」的结果
    await assert.rejects(() => managementTurn({ apiFailure: true }).run(), /FORMAL_API_UNAVAILABLE/u);
});

// ══ 3. dispatcher：真实调用缺席证明 ════════════════════════════════════
function dispatcherSpies(controllerResult) {
    const calls = { native: 0, legacyRead: 0, legacyCommand: 0 };
    return {
        calls,
        runAiTaskControllerV2: async () => { calls.native += 1; return controllerResult; },
        runAiAssistant: async () => { calls.legacyRead += 1; return { telemetry: { legacy: true } }; },
        runAiAgentRuntimeV3: async () => { calls.legacyCommand += 1; return { telemetry: { legacy: true } }; },
    };
}

function controllerResult({ goalKinds, eligible, nativeOwned, content = 'Native 答案' }) {
    return {
        task: { goals: goalKinds.map((kind, index) => ({ goalKey: `goal_${index + 1}`, kind })) },
        detail: { state: 'SUCCEEDED' },
        answer: { content },
        canaryAdmission: { eligible, nativeOwned, reason: eligible ? 'SUPPORTED_AND_READ_ONLY' : 'FAMILY_NOT_SUPPORTED' },
        telemetry: {},
    };
}

function runDispatcher(controllerValue, messages = [{ role: 'user', content: '现在的管理待办有哪些' }]) {
    const spies = dispatcherSpies(controllerValue);
    const emitted = [];
    return (async () => {
        await runAiDispatcherV3(
            { messages, ownerKey: 'native-r1-owner', stream: true, emit: (type, payload) => emitted.push({ type, payload }) },
            { nativeTaskDelegation: true, runAiTaskControllerV2: spies.runAiTaskControllerV2, runAiAssistant: spies.runAiAssistant, runAiAgentRuntimeV3: spies.runAiAgentRuntimeV3 },
        );
        return { spies, emitted };
    })();
}

test('R1-DISP-1 拥有所有权的族：admission 不满足时也不进入 Legacy（成功路径）', async () => {
    const { spies, emitted } = await runDispatcher(controllerResult({ goalKinds: ['MANAGEMENT_OVERVIEW', 'OTHER'], eligible: false, nativeOwned: true, content: 'Native 已验证答案' }));
    assert.equal(spies.calls.native, 1);
    assert.equal(spies.calls.legacyRead, 0, 'aiAssistantRuntime 调用次数必须为 0');
    assert.equal(spies.calls.legacyCommand, 0, 'aiAgentRuntimeV3 调用次数必须为 0');
    const content = emitted.find(event => event.type === 'content');
    assert.equal(content.payload.content, 'Native 已验证答案');
    assert.equal(emitted.find(event => event.type === 'status' && event.payload.stage === 'native_owned').payload.legacyRuntimeEntered, false);
});

test('R1-DISP-2 拥有所有权的族：Native 无答案时给 Native 显式安全失败，Legacy 调用仍为 0', async () => {
    const { spies, emitted } = await runDispatcher(controllerResult({ goalKinds: ['QUOTATION_QUERY'], eligible: false, nativeOwned: true, content: '' }));
    assert.equal(spies.calls.legacyRead, 0);
    assert.equal(spies.calls.legacyCommand, 0);
    assert.match(emitted.find(event => event.type === 'content').payload.content, /未完成/u, '必须给 Native 显式安全失败');
});

test('R1-DISP-3 未拥有所有权的族 / 写意图：行为不变（仍走既有路径）', async () => {
    // OTHER：未被任何族声明拥有
    const unowned = await runDispatcher(controllerResult({ goalKinds: ['OTHER'], eligible: false, nativeOwned: false }));
    assert.equal(unowned.spies.calls.legacyRead, 1, '未拥有的族仍应回落既有路径');
    assert.equal(unowned.spies.calls.legacyCommand, 0);

    // 写意图：所有权 fail closed，必须交回既有命令路径
    const writeOwnership = nativeOwnershipDecision({ goalKinds: ['MANAGEMENT_OVERVIEW'], businessWritePolicy: 'CONFIRMATION_REQUIRED' });
    assert.equal(writeOwnership.owned, false);
    const write = await runDispatcher(
        controllerResult({ goalKinds: ['MANAGEMENT_OVERVIEW'], eligible: false, nativeOwned: writeOwnership.owned }),
        [{ role: 'user', content: '帮我新增零件' }],
    );
    assert.equal(write.spies.calls.legacyCommand, 1, '写请求必须仍走命令路径');
});

test('R1-DISP-4 拥有所有权的族准入成功时：Native 答案直接成为最终答案，Legacy 为 0', async () => {
    const { spies, emitted } = await runDispatcher(controllerResult({ goalKinds: ['MANAGEMENT_OVERVIEW'], eligible: true, nativeOwned: true, content: '已读取正式管理行动中心。' }));
    assert.equal(spies.calls.native, 1);
    assert.equal(spies.calls.legacyRead, 0);
    assert.equal(spies.calls.legacyCommand, 0);
    assert.equal(emitted.find(event => event.type === 'content').payload.content, '已读取正式管理行动中心。');
});

test('R1-DISP-5 controller 抛错时 dispatcher 不落 Legacy：错误向上抛，Legacy 调用为 0', async () => {
    const calls = { native: 0, legacyRead: 0, legacyCommand: 0 };
    await assert.rejects(
        () => runAiDispatcherV3(
            { messages: [{ role: 'user', content: '现在的管理待办有哪些' }], ownerKey: 'native-r1-owner', stream: true, emit: () => {} },
            {
                nativeTaskDelegation: true,
                runAiTaskControllerV2: async () => { calls.native += 1; throw Object.assign(new Error('FORMAL_API_UNAVAILABLE'), { code: 'FORMAL_API_UNAVAILABLE' }); },
                runAiAssistant: async () => { calls.legacyRead += 1; return {}; },
                runAiAgentRuntimeV3: async () => { calls.legacyCommand += 1; return {}; },
            },
        ),
        /FORMAL_API_UNAVAILABLE/u,
    );
    assert.equal(calls.native, 1);
    assert.equal(calls.legacyRead, 0, 'aiAssistantRuntime 调用次数必须为 0');
    assert.equal(calls.legacyCommand, 0, 'aiAgentRuntimeV3 调用次数必须为 0');
});
