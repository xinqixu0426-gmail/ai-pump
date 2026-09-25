const { detectProtectedCommandRoute } = require('./aiProtectedCommandRoute.cjs');
const { fetchAiProvider } = require('./aiProvider.cjs');
const { runAiTaskControllerV2 } = require('./aiTaskControllerV2.cjs');
const {
    traceModelProvider,
    withAgentSpan,
} = require('./observability.cjs');

/**
 * NATIVE-HC1：Legacy AI orchestration 已从生产架构中退出。
 *
 * 本文件**不再**引用已退役的旧 AI 编排运行时 —— 生产请求图对它们的可达性为 0
 * （由静态架构测试锁定）。dispatcher 只做三件事：
 *   1) 未启用 Native 委派（非 owner / 未开启 AI-Native）→ 明确不可用，绝不回落；
 *   2) 写/命令意图 → Native 显式「AI 写入未开放」结果，绝不进入 Legacy 写运行时；
 *   3) 其余（只读）→ Native 任务运行时；准入不满足也留在 Native（R3 已确立）。
 */

/** Native 写未开放时的确定性结果（AI_NATIVE_WRITE_ENABLED=false）。 */
function nativeWriteDisabledOutcome(commandRoute, runtimeInput) {
    runtimeInput.emit?.('status', {
        stage: 'native_write_disabled',
        message: 'AI 写入当前未开放；本次没有执行任何业务写入。',
        legacyRuntimeEntered: false,
    });
    runtimeInput.emit?.('content', {
        content: `本次请求包含写操作意图（${commandRoute || 'command'}）。AI 写入当前未开放，因此没有执行任何修改；普通业务写接口不受影响，请通过正式页面或 API 完成操作。`,
    });
    runtimeInput.emit?.('detail', { state: 'WRITE_DISABLED', commandRoute: commandRoute || null, nativeWriteEnabled: false });
    runtimeInput.emit?.('done');
    return { finalContent: '', telemetry: { outcome: 'native_write_disabled', commandRoute: commandRoute || null, legacyRuntimeEntered: false } };
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
        // 2) 写/命令意图 → Native 显式写未开放结果（§5）；绝不进入 Legacy 写运行时。
        if (commandRoute) return nativeWriteDisabledOutcome(commandRoute, runtimeInput);
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
