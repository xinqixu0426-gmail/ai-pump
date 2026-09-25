'use strict';
/**
 * NATIVE-R3 — Eliminate Remaining Owner Read F1 and Establish Native-Only Read Runtime.
 *
 * 核心不变量（§14）：
 *   OWNER + AI_NATIVE_MODE=owner + READ  →  Legacy runtime 调用次数 = 0
 *
 * 三层证明：
 *  1) 结构性：isNativeOwnedOwnerRead 只依据已落定的写策略；读 → Native 独家，写意图 → 不属本阶段。
 *  2) 逐 kind：对**当前全部只读 goal kind**（含 OTHER / IMPACT 这类未支持读与未知读）用真实
 *     dispatcher + Legacy 入口计数器，断言 aiAssistantRuntime / aiAgentRuntimeV3 调用为 0，
 *     且必然产出 Native 结果。
 *  3) 端到端：真实 runAiTaskControllerV2（正式回执夹具）产出真实计划与准入结论，再送进真实
 *     dispatcher，验证成功与失败模式（空结果 / 歧义 / 未验证回执 / 工具异常）都留在 Native。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
    isNativeOwnedOwnerRead, ownerReadCanaryAdmission, ownerTrialCoverageSummary,
    familyById, COVERAGE_STATUS,
} = require('../api/services/aiNativeOwnerTrialCoverage.cjs');
const { runAiTaskControllerV2 } = require('../api/services/aiTaskControllerV2.cjs');
const { createTaskSessionStoreV2 } = require('../api/services/aiTaskSessionV2.cjs');
const { runAiDispatcherV3 } = require('../api/services/aiDispatcherV3.cjs');

const evidence = { verified: true, kind: 'formal_api_query' };
const listReceipt = rows => ({ success: true, count: rows.length, queryReceipt: { appliedFilters: {}, totalCount: rows.length, returnedCount: rows.length, truncated: false, possiblyTruncated: false, authoritative: true }, data: rows, executionEvidence: evidence });
const objectReceipt = data => ({ success: true, data, executionEvidence: evidence });

/** 当前全部只读 goal kind（写意图不在内）。 */
const READ_KIND_LIST = Object.freeze([
    'CURRENT_COST', 'CONFIGURATION_COMPARE', 'PROFITABILITY', 'INVENTORY_QUERY', 'COIL_COST',
    'RECIPE_COST_COMPARISON', 'MANAGEMENT_OVERVIEW', 'QUOTATION_QUERY', 'BUSINESS_CHANGES',
    'COIL_QUERY', 'CUSTOMER_HISTORY', 'ORDER_READINESS', 'IMPACT_INVESTIGATION', 'OTHER',
]);

/** 真实问法（其 plan kind 由确定性 planner 产出）。 */
const REAL_QUESTIONS = Object.freeze([
    ['management overview', '现在的管理待办和风险有哪些'],
    ['quotation query', '当前报价有哪些'],
    ['business change', '最近有什么业务变更'],
    ['coil catalog', '12-120 有哪些线圈方案'],
    ['unknown / other', '设计安全是否安全、曲线是否合理'],
    ['impact investigation', '这个变更影响哪些对象'],
]);

const GENERIC_DATA = Object.freeze({ items: [], actionCenter: [], readiness: { state: 'READY' }, customer: { id: 1 }, order: { id: 1 } });

function realControllerTurn(question, mode = 'success') {
    const execute = async () => {
        if (mode === 'tool_error') throw new Error('FORMAL_API_UNAVAILABLE');
        if (mode === 'verification_failure') return { success: true, data: {} };
        if (mode === 'empty_result') return listReceipt([]);
        if (mode === 'ambiguity') return listReceipt([
            { id: 1, spec: '12', sheets: 120, schemeCode: 'COIL-0001', schemeStatus: 'official', stock: 1 },
            { id: 2, spec: '12', sheets: 120, schemeCode: 'COIL-0002', schemeStatus: 'official', stock: 2 },
        ]);
        return objectReceipt(GENERIC_DATA);
    };
    const input = { ownerKey: 'native-r3-owner', requestId: crypto.randomUUID(), messages: [{ role: 'user', content: question }] };
    return runAiTaskControllerV2(input, { executeToolCall: execute, sessionStore: createTaskSessionStoreV2(), provider: null });
}

/** 真实 dispatcher + Legacy 入口计数器（真实函数调用缺席证明）。 */
async function dispatchWithCounters(controllerResult) {
    const calls = { native: 0, legacyRead: 0, legacyCommand: 0 };
    const emitted = [];
    await runAiDispatcherV3(
        { messages: [{ role: 'user', content: '审计问法' }], ownerKey: 'native-r3-owner', stream: true, emit: (type, payload) => emitted.push({ type, payload }) },
        {
            nativeTaskDelegation: true,
            runAiTaskControllerV2: async () => { calls.native += 1; return controllerResult; },
            runAiAssistant: async () => { calls.legacyRead += 1; return { finalContent: 'LEGACY' }; },
            runAiAgentRuntimeV3: async () => { calls.legacyCommand += 1; return { finalContent: 'LEGACY' }; },
        },
    );
    return { calls, emitted };
}

const settledPlan = (kind, { content = 'Native 结论' } = {}) => {
    const admission = ownerReadCanaryAdmission({ goalKinds: [kind], businessWritePolicy: 'FORBIDDEN' });
    return {
        task: { goals: [{ goalKey: 'goal_1', kind }] },
        detail: {},
        answer: { content },
        canaryAdmission: { ...admission, nativeReadOwned: isNativeOwnedOwnerRead({ businessWritePolicy: 'FORBIDDEN' }) },
        telemetry: {},
    };
};

// ══ 结构性契约 ════════════════════════════════════════════════════════
test('R3-RULE-1 只读计划一律 Native 独家负责；写意图不属本阶段', () => {
    assert.equal(isNativeOwnedOwnerRead({ businessWritePolicy: 'FORBIDDEN' }), true);
    assert.equal(isNativeOwnedOwnerRead({ businessWritePolicy: 'CONFIRMATION_REQUIRED' }), false);
    assert.equal(isNativeOwnedOwnerRead({}), true);
    assert.equal(isNativeOwnedOwnerRead({ businessWritePolicy: '' }), false);
});

test('R3-RULE-2 两个真实只读族（客户历史 / 订单 readiness）已声明为 SUPPORTED + nativeOwned', () => {
    for (const familyId of ['customer-history', 'order-readiness']) {
        const entry = familyById(familyId);
        assert.ok(entry, familyId);
        assert.equal(entry.nativeSupport, COVERAGE_STATUS.SUPPORTED, familyId);
        assert.equal(entry.nativeOwned, true, familyId);
    }
    const summary = ownerTrialCoverageSummary();
    assert.ok(summary.supported.some(item => item.familyId === 'customer-history'));
    assert.ok(summary.supported.some(item => item.familyId === 'order-readiness'));
});

test('R3-RULE-3 未支持/未知读不被伪装成 SUPPORTED，而是靠读取路径所有权留在 Native', () => {
    for (const kind of ['OTHER', 'IMPACT_INVESTIGATION']) {
        const admission = ownerReadCanaryAdmission({ goalKinds: [kind], businessWritePolicy: 'FORBIDDEN' });
        assert.equal(admission.eligible, false, `${kind} 不应被伪装成 SUPPORTED`);
        assert.equal(admission.reason, 'FAMILY_NOT_SUPPORTED', kind);
        assert.equal(isNativeOwnedOwnerRead({ businessWritePolicy: 'FORBIDDEN' }), true, kind);
    }
});

// ══ 逐 kind：Legacy 调用必须为 0 ══════════════════════════════════════
test('R3-READ-1 每个只读 goal kind（含未支持读与未知读）在真实 dispatcher 下 Legacy 调用为 0', async () => {
    let legacyRead = 0; let legacyCommand = 0; let nativeResults = 0;
    for (const kind of READ_KIND_LIST) {
        const { calls, emitted } = await dispatchWithCounters(settledPlan(kind));
        legacyRead += calls.legacyRead;
        legacyCommand += calls.legacyCommand;
        assert.equal(calls.native, 1, `${kind}: Native 必须被进入一次`);
        assert.equal(calls.legacyRead, 0, `${kind}: aiAssistantRuntime 调用必须为 0`);
        assert.equal(calls.legacyCommand, 0, `${kind}: aiAgentRuntimeV3 调用必须为 0`);
        assert.equal(emitted.some(event => event.type === 'content' && typeof event.payload.content === 'string' && event.payload.content.length > 0), true, `${kind}: 必须产出 Native 结果`);
        assert.equal(emitted.some(event => event.type === 'status' && event.payload?.stage === 'canary_ineligible'), false, `${kind}: 不得出现 Legacy 回落标记`);
        nativeResults += 1;
    }
    assert.equal(legacyRead, 0);
    assert.equal(legacyCommand, 0);
    assert.equal(nativeResults, READ_KIND_LIST.length);
});

// ══ 端到端：真实 controller + 真实 dispatcher ═════════════════════════
test('R3-READ-2 真实问法端到端：计划与准入由真实 controller 产出，Legacy 调用为 0 且产出 Native 结果', async () => {
    for (const [label, question] of REAL_QUESTIONS) {
        const result = await realControllerTurn(question);
        assert.equal(result.canaryAdmission.nativeReadOwned, true, `${label}: 只读计划必须 Native 独家负责`);
        const { calls, emitted } = await dispatchWithCounters(result);
        assert.equal(calls.legacyRead, 0, `${label}: aiAssistantRuntime 调用必须为 0`);
        assert.equal(calls.legacyCommand, 0, `${label}: aiAgentRuntimeV3 调用必须为 0`);
        assert.equal(emitted.some(event => event.type === 'content' && event.payload.content.length > 0), true, `${label}: 必须产出 Native 结果`);
    }
});

// ══ 失败语义（§8） ════════════════════════════════════════════════════
test('R3-FAIL-1 空结果 / 未验证回执 / 歧义：真实 controller 下仍是 Native 结果（或 Native fail-closed 抛出），Legacy 为 0', async () => {
    let resolved = 0; let failClosed = 0;
    for (const mode of ['empty_result', 'verification_failure', 'ambiguity']) {
        for (const [label, question] of REAL_QUESTIONS) {
            let result = null;
            try {
                result = await realControllerTurn(question, mode);
            } catch (error) {
                // 夹具无法满足该能力的 canonical 投影时的抛错，属 Native fail-closed 语义
                // （dispatcher 不会因此回落 Legacy，见 R3-FAIL-2 的计数器证明）。
                assert.ok(error.code || /UNAVAILABLE|SHAPE/u.test(error.message), `${label}/${mode}: 必须是可识别的 Native 错误`);
                failClosed += 1;
                continue;
            }
            assert.equal(result.canaryAdmission.nativeReadOwned, true, `${label}/${mode}`);
            const { calls, emitted } = await dispatchWithCounters(result);
            assert.equal(calls.legacyRead, 0, `${label}/${mode}: legacy 读取必须为 0`);
            assert.equal(calls.legacyCommand, 0, `${label}/${mode}`);
            assert.equal(emitted.some(event => event.type === 'content' && event.payload.content.length > 0), true, `${label}/${mode}: 必须给 Native 结果`);
            resolved += 1;
        }
    }
    assert.ok(resolved > 0, '必须至少有一批失败模式产出 Native 结果');
    assert.equal(resolved + failClosed, 18, '三种模式 × 六个问法都要被覆盖');
});

test('R3-FAIL-2 工具异常：Native fail-closed 抛出，Legacy 调用为 0', async () => {
    await assert.rejects(() => realControllerTurn('现在的管理待办和风险有哪些', 'tool_error'), /FORMAL_API_UNAVAILABLE/u);
    const calls = { legacyRead: 0, legacyCommand: 0 };
    await assert.rejects(() => runAiDispatcherV3(
        { messages: [{ role: 'user', content: '管理待办' }], stream: true, emit: () => {} },
        {
            nativeTaskDelegation: true,
            runAiTaskControllerV2: async () => { throw Object.assign(new Error('FORMAL_API_UNAVAILABLE'), { code: 'FORMAL_API_UNAVAILABLE' }); },
            runAiAssistant: async () => { calls.legacyRead += 1; return {}; },
            runAiAgentRuntimeV3: async () => { calls.legacyCommand += 1; return {}; },
        },
    ), /FORMAL_API_UNAVAILABLE/u);
    assert.equal(calls.legacyRead, 0);
    assert.equal(calls.legacyCommand, 0);
});

test('R3-FAIL-3 无计划 / 结构未就绪 / 未支持：dispatcher 仍留 Native（Native 显式安全失败）', async () => {
    for (const reason of ['EMPTY_PLAN', 'STRUCTURAL_NOT_READY', 'FAMILY_NOT_SUPPORTED']) {
        const { calls, emitted } = await dispatchWithCounters({
            task: { goals: [] }, detail: {}, answer: { content: '' },
            canaryAdmission: { eligible: false, reason, nativeReadOwned: true }, telemetry: {},
        });
        assert.equal(calls.legacyRead, 0, `${reason}: legacy 读取必须为 0`);
        assert.equal(calls.legacyCommand, 0, `${reason}`);
        assert.equal(emitted.some(event => event.type === 'content' && event.payload.content.length > 0), true, `${reason}: 必须给 Native 显式安全失败`);
        assert.equal(emitted.some(event => event.type === 'done'), true, `${reason}`);
    }
});

test('R3-FAIL-4（HC1 改写）Nature 写意图：Native 显式写未开放，Legacy 调用为 0', async () => {
    // HC1：命令路由不再进入 aiAgentRuntimeV3，而是由 Native 给出确定性「写未开放」结果。
    const calls = { legacyRead: 0, legacyCommand: 0, native: 0 };
    const emitted = [];
    await runAiDispatcherV3(
        { messages: [{ role: 'user', content: '帮我新增零件' }], stream: true, emit: (type, payload) => emitted.push({ type, payload }) },
        {
            nativeTaskDelegation: true,
            runAiTaskControllerV2: async () => { calls.native += 1; throw new Error('MUST_NOT_RUN_FOR_WRITE'); },
            runAiAssistant: async () => { calls.legacyRead += 1; return {}; },
            runAiAgentRuntimeV3: async () => { calls.legacyCommand += 1; return {}; },
        },
    );
    assert.equal(calls.legacyRead, 0, '写意图不得进入 Legacy 只读运行时');
    assert.equal(calls.legacyCommand, 0, '写意图不得进入 Legacy 写运行时');
    assert.equal(calls.native, 0, '写意图不进入 Native 只读任务运行时');
    assert.equal(emitted.some(event => event.type === 'status' && event.payload?.stage === 'native_write_disabled'), true);
    assert.equal(emitted.some(event => event.type === 'content' && /写入当前未开放/u.test(event.payload.content)), true);
    assert.equal(emitted.some(event => event.type === 'done'), true);
});

test('R3-FAIL-5（HC1 改写）未启用 Native 委派 → AI 不可用，Legacy 调用为 0', async () => {
    const calls = { legacyRead: 0, legacyCommand: 0 };
    const emitted = [];
    await runAiDispatcherV3(
        { messages: [{ role: 'user', content: '当前成本' }], stream: true, emit: (type, payload) => emitted.push({ type, payload }) },
        {
            nativeTaskDelegation: false,
            runAiAssistant: async () => { calls.legacyRead += 1; return { finalContent: 'LEGACY' }; },
            runAiAgentRuntimeV3: async () => { calls.legacyCommand += 1; return { finalContent: 'LEGACY' }; },
        },
    );
    assert.equal(calls.legacyRead, 0, 'AI_NATIVE_MODE≠owner 不得回落到 Legacy 回答');
    assert.equal(calls.legacyCommand, 0);
    assert.equal(emitted.some(event => event.type === 'status' && event.payload?.stage === 'ai_unavailable'), true);
    assert.equal(emitted.some(event => event.type === 'content'), true);
});

// ══ 不可达性静态证明（§9 STRUCTURAL_NOT_READY / §10 F3） ══════════════
test('R3-STRUCT-1 生产不可达状态与 Legacy 引用面：STRUCTURAL_NOT_READY 无生产调用点，Legacy runtime 仅 dispatcher 引用', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const { execFileSync } = require('node:child_process');
    const root = path.resolve(__dirname, '..');

    // 1) ownerReadCanaryAdmission 的唯一生产调用点不传 structuralReady → 取默认 true，
    //    因此 STRUCTURAL_NOT_READY 在生产配置下不可达（仅为直接调用方/测试保留）。
    const controllerSource = fs.readFileSync(path.join(root, 'api/services/aiTaskControllerV2.cjs'), 'utf8');
    const callIndex = controllerSource.indexOf('ownerReadCanaryAdmission({');
    assert.ok(callIndex > 0, '必须存在生产调用点');
    const callSite = controllerSource.slice(callIndex, controllerSource.indexOf('});', callIndex));
    assert.equal(/structuralReady/u.test(callSite), false, '生产调用点不得传 structuralReady');

    // 2) Legacy runtime 的生产引用面（F3 只存在于 aiAssistantRuntime 内部）：
    //    仅 dispatcher（V3 生产调度壳 + V2 转发 stub）引用它们。
    const files = execFileSync('git', ['-C', root, 'ls-files', 'api'], { encoding: 'utf8' })
        .split('\n').filter(file => file.endsWith('.cjs'));
    const referencing = files.filter(file => {
        const text = fs.readFileSync(path.join(root, file), 'utf8');
        return /require\(['"]\.\/aiAssistantRuntime\.cjs['"]\)|require\(['"]\.\/aiAgentRuntimeV3\.cjs['"]\)/u.test(text);
    });
    // NATIVE-HC1：生产请求图对 Legacy runtime 的可达性为 0 —— 不再有任何生产 importer。
    assert.deepEqual(referencing.sort(), []);
});
