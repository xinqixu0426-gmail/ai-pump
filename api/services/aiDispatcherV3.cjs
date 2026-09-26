const { detectProtectedCommandRoute, describeCommandRoute, latestUserText } = require('./aiProtectedCommandRoute.cjs');
const { fetchAiProvider } = require('./aiProvider.cjs');
const { runAiTaskControllerV2 } = require('./aiTaskControllerV2.cjs');
const { NATIVE_WRITE_V1_TOOL } = require('./aiNativeWriteScope.cjs');
const { createNativeWriteProposalChatBridge } = require('./aiNativeWriteChatBridgeV2.cjs');
const {
    traceModelProvider,
    withAgentSpan,
} = require('./observability.cjs');

/**
 * NATIVE-HC1：Legacy AI orchestration 已从生产架构中退出。
 *
 * 本文件**不再**引用已退役的旧 AI 编排运行时 —— 生产请求图对它们的可达性为 0
 * （由静态架构测试锁定）。dispatcher 只做四件事：
 *   1) 未启用 Native 委派（非 owner / 未开启 AI-Native）→ 明确不可用，绝不回落；
 *   2) 写/命令意图 + 写开关关闭 → Native 显式「AI 写入未开放」结果，绝不进入 Legacy 写运行时；
 *   3) 写/命令意图 + 写开关打开 + W1 白名单能力 → NATIVE-W1.5 同步提案（只准备，不执行）；
 *   4) 其余（只读）→ Native 任务运行时；准入不满足也留在 Native（R3 已确立）。
 *
 * NATIVE-W1.5：写判定必须读**服务端** rollout 快照（`nativeWriteAllowed`），
 * 且用户可见文案只使用稳定的能力描述，绝不拼接内部路由对象。
 */

let defaultNativeWriteBridge = null;
function resolveNativeWriteBridge(dependencies = {}) {
    if (typeof dependencies.prepareNativeWriteProposal === 'function') return dependencies.prepareNativeWriteProposal;
    if (!defaultNativeWriteBridge) defaultNativeWriteBridge = createNativeWriteProposalChatBridge({});
    return defaultNativeWriteBridge;
}

/** Native 写未开放时的确定性结果（AI_NATIVE_WRITE_ENABLED=false）。 */
function nativeWriteDisabledOutcome(commandRoute, runtimeInput) {
    const label = describeCommandRoute(commandRoute);
    runtimeInput.emit?.('status', {
        stage: 'native_write_disabled',
        message: 'AI 写入当前未开放；本次没有执行任何业务写入。',
        legacyRuntimeEntered: false,
    });
    runtimeInput.emit?.('content', {
        content: `本次请求包含写操作意图（${label}）。AI 写入当前未开放，因此没有执行任何修改；普通业务写接口不受影响，请通过正式页面或 API 完成操作。`,
    });
    runtimeInput.emit?.('detail', {
        state: 'WRITE_DISABLED',
        commandRoute: commandRoute || null,
        commandLabel: label,
        nativeWriteEnabled: false,
    });
    runtimeInput.emit?.('done');
    return { finalContent: '', telemetry: { outcome: 'native_write_disabled', commandRoute: commandRoute || null, legacyRuntimeEntered: false } };
}

/** 写开关已打开、但该写能力不在 W1 白名单内：明确不支持，绝不落入通用写规划。 */
function nativeWriteUnsupportedOutcome(commandRoute, runtimeInput, code, message) {
    const label = describeCommandRoute(commandRoute);
    runtimeInput.emit?.('status', {
        stage: 'native_write_unsupported',
        message: message || 'AI 写入当前只开放单个零件的库存调整。',
        legacyRuntimeEntered: false,
    });
    runtimeInput.emit?.('content', {
        content: message || `本次请求包含写操作意图（${label}），该操作当前未开放；本次没有执行任何修改。`,
    });
    runtimeInput.emit?.('detail', {
        state: 'WRITE_UNSUPPORTED',
        commandRoute: commandRoute || null,
        commandLabel: label,
        nativeWriteEnabled: true,
        ...(code ? { code } : {}),
    });
    runtimeInput.emit?.('done');
    return { finalContent: '', telemetry: { outcome: 'native_write_unsupported', commandRoute: commandRoute || null, legacyRuntimeEntered: false } };
}

/** 意图不完整/目标不确定：给出可执行的澄清，不生成提案、不写任何数据。 */
function nativeWriteClarificationOutcome(runtimeInput, { code, message, commandRoute = null }) {
    runtimeInput.emit?.('status', {
        stage: 'native_write_clarification',
        message,
        legacyRuntimeEntered: false,
    });
    runtimeInput.emit?.('content', { content: message });
    runtimeInput.emit?.('detail', { state: 'WRITE_CLARIFICATION_REQUIRED', code, commandRoute, nativeWriteEnabled: true });
    runtimeInput.emit?.('done');
    return { finalContent: '', telemetry: { outcome: 'native_write_clarification', code, commandRoute, legacyRuntimeEntered: false } };
}

/**
 * NATIVE-W1.5：同步准备 W1 提案并在聊天流里下发结构化事件。
 * 只准备、不执行；提案事实全部来自既有 W1 正式预览。
 */
async function nativeWriteProposalOutcome(commandRoute, runtimeInput, dependencies) {
    const bridge = resolveNativeWriteBridge(dependencies);
    let result = null;
    try {
        result = await bridge({
            ownerKey: runtimeInput.ownerKey,
            confirmationSubject: runtimeInput.confirmationSubject,
            conversationTransportId: runtimeInput.conversationId,
            requestedText: latestUserText(runtimeInput.messages),
            sourceMessage: typeof dependencies.resolveNativeWriteSource === 'function'
                ? dependencies.resolveNativeWriteSource(runtimeInput)
                : null,
        });
    } catch (error) {
        result = { ok: false, kind: 'preview_rejected', code: error?.code || 'NATIVE_WRITE_PREVIEW_FAILED', message: '本次库存调整方案没有生成，也未执行任何修改。请稍后重试。' };
    }
    if (!result?.ok) {
        if (result?.kind === 'unsupported') return nativeWriteUnsupportedOutcome(commandRoute, runtimeInput, result.code, result.message);
        return nativeWriteClarificationOutcome(runtimeInput, {
            code: result?.code || 'NATIVE_WRITE_PREVIEW_REJECTED',
            message: result?.message || '本次库存调整方案没有生成，也未执行任何修改。',
            commandRoute,
        });
    }
    const transport = result.transport;
    runtimeInput.emit?.('status', {
        stage: 'native_write_proposal',
        message: '已生成零件库存调整方案，需要你确认后才会执行。',
        legacyRuntimeEntered: false,
    });
    runtimeInput.emit?.('content', {
        content: `已生成零件库存调整方案：${transport.proposal.items[0].model}，调整 ${transport.proposal.items[0].delta > 0 ? '+' : '−'}${Math.abs(transport.proposal.items[0].delta)}，调整后库存 ${transport.proposal.items[0].nextStock}。请在确认卡片中核对后确认执行。`,
    });
    // 结构化提案事件（type/stage = NATIVE_WRITE_PROPOSAL）：只含展示事实 + 不透明服务端身份。
    runtimeInput.emit?.('write_proposal', transport);
    runtimeInput.emit?.('detail', {
        state: 'WRITE_PROPOSAL_READY',
        commandRoute,
        commandLabel: describeCommandRoute(commandRoute),
        nativeWriteEnabled: true,
        stage: 'NATIVE_WRITE_PROPOSAL',
    });
    runtimeInput.emit?.('done');
    return {
        finalContent: '',
        telemetry: { outcome: 'native_write_proposal', commandRoute: commandRoute || null, legacyRuntimeEntered: false },
    };
}

/** Native 未启用时的确定性结果（AI 不可用；不再有 Legacy 兜底）。 */
function aiUnavailableOutcome(runtimeInput) {
    runtimeInput.emit?.('status', {
        stage: 'ai_unavailable',
        message: 'AI 助手当前不可用。',
        legacyRuntimeEntered: false,
    });
    runtimeInput.emit?.('content', { content: 'AI 助手当前不可用：本部署未启用 AI-Native 只读运行时。' });
    runtimeInput.emit?.('detail', { state: 'AI_UNAVAILABLE' });
    runtimeInput.emit?.('done');
    return { finalContent: '', telemetry: { outcome: 'ai_unavailable', legacyRuntimeEntered: false } };
}

/**
 * NATIVE-R1/R3：Native 独家负责的结果。
 * 只消费 controller 已经产出的确定性答案；没有答案时给 Native 显式安全失败。
 */
function nativeOwnedOutcome(result, runtimeInput) {
    const content = typeof result?.answer?.content === 'string' ? result.answer.content.trim() : '';
    runtimeInput.emit?.('status', {
        stage: 'native_owned',
        message: '该问法族由 AI-Native 独家负责，不进入既有路径。',
        legacyRuntimeEntered: false,
    });
    runtimeInput.emit?.('content', {
        content: content || '本轮正式证据核验未完成，因此不提供业务结论。',
    });
    runtimeInput.emit?.('detail', result?.detail);
    runtimeInput.emit?.('done');
    return result;
}

async function runAiDispatcherV3(input = {}, dependencies = {}) {
    const commandRoute = detectProtectedCommandRoute(input.messages, {
        recentPartWrite: input.recentPartWrite,
    });
    const provider = traceModelProvider(input.fetchAiProvider || fetchAiProvider);
    return withAgentSpan({
        streaming: Boolean(input.stream),
        route: 'ai_dispatcher_v3',
        requestId: input.requestId,
    }, async () => {
        const runtimeInput = {
            ...input,
            fetchAiProvider: provider,
            agentVersion: 3,
            commandRoute,
        };
        // 1) Native 委派是注入式的服务端依赖，请求方无法选择；未启用即 AI 不可用（无 Legacy 兜底）。
        if (dependencies.nativeTaskDelegation !== true) return aiUnavailableOutcome(runtimeInput);
        // 2) 写/命令意图：由**服务端** rollout 快照决定走向，请求体不能影响该判定。
        if (commandRoute) {
            if (dependencies.nativeWriteAllowed !== true) return nativeWriteDisabledOutcome(commandRoute, runtimeInput);
            // W1 白名单是唯一权威：只有 adjust_part_stock 能进入提案，其余写意图明确不支持。
            if (commandRoute.preferredCapability !== NATIVE_WRITE_V1_TOOL) {
                return nativeWriteUnsupportedOutcome(commandRoute, runtimeInput);
            }
            return nativeWriteProposalOutcome(commandRoute, runtimeInput, dependencies);
        }
        // 3) 只读 → Native 任务运行时独占回答。
        const controller = dependencies.runAiTaskControllerV2 || runAiTaskControllerV2;
        runtimeInput.emit?.('status', { stage: 'task_v2', message: '正在建立只读任务证据。' });
        const result = await controller({ ...runtimeInput, fetchAiProvider: provider }, {
            ownerKey: dependencies.ownerKey || input.ownerKey,
            executeToolCall: dependencies.executeToolCall,
            sessionStore: dependencies.sessionStore,
            provider: dependencies.provider,
        });
        // 只读请求一律由 Native 负责；即使准入不满足（未支持族 / OTHER / 空计划）也留在 Native。
        if (result.canaryAdmission && result.canaryAdmission.eligible === false) return nativeOwnedOutcome(result, runtimeInput);
        if (typeof result.answer?.content === 'string' && result.answer.content) runtimeInput.emit?.('content', { content: result.answer.content });
        runtimeInput.emit?.('detail', result.detail);
        runtimeInput.emit?.('done');
        return result;
    });
}

module.exports = { runAiDispatcherV3 };
