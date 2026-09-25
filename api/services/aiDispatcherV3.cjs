const { runAiAssistant } = require('./aiAssistantRuntime.cjs');
const { runAiAgentRuntimeV3 } = require('./aiAgentRuntimeV3.cjs');
const { detectProtectedCommandRoute } = require('./aiProtectedCommandRoute.cjs');
const { fetchAiProvider } = require('./aiProvider.cjs');
const { runAiTaskControllerV2 } = require('./aiTaskControllerV2.cjs');
const {
    traceModelProvider,
    withAgentSpan,
} = require('./observability.cjs');

/**
 * NATIVE-R1：Native 独家负责的问法族不得进入 Legacy。
 * 只消费 controller 已经产出的确定性答案；没有答案时给 Native 显式安全失败。
 * 本函数不新增任何答案逻辑，也不引用任何 Legacy runtime。
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
    const compatibilityRuntime = !dependencies.runAiAssistant && dependencies.runAiAgentRuntimeV3;
    const readRuntime = dependencies.runAiAssistant || compatibilityRuntime || runAiAssistant;
    const commandRuntime = dependencies.runAiAgentRuntimeV3 || runAiAgentRuntimeV3;
    const runtime = commandRoute ? commandRuntime : readRuntime;
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
        // Native delegation is intentionally an injected server dependency.
        // It is never selected from an HTTP payload, header, page context, or
        // environment flag, so ordinary traffic remains on the frozen runtime.
        if (dependencies.nativeTaskDelegation === true && !commandRoute) {
            const controller = dependencies.runAiTaskControllerV2 || runAiTaskControllerV2;
            runtimeInput.emit?.('status', { stage: 'task_v2', message: '正在建立只读任务证据。' });
            const result = await controller({ ...runtimeInput, fetchAiProvider: provider }, {
                ownerKey: dependencies.ownerKey || input.ownerKey,
                executeToolCall: dependencies.executeToolCall,
                sessionStore: dependencies.sessionStore,
                provider: dependencies.provider,
            });
            // S1：只有 canary admission 允许的问法族才由 Native 作答。计划落在
            // SUPPORTED 范围之外（PARTIAL/UNSUPPORTED/未知族/写请求）时，本轮不作为答案，
            // 交回既有正式路径（legacy 仍是权威，默认路由不变）。
            if (result.canaryAdmission && result.canaryAdmission.eligible === false) {
                // NATIVE-R1：已声明 nativeOwned 的族由 Native 独家负责 —— 即使准入不满足
                // （混合未覆盖目标等），也不得回落 Legacy；失败语义留在 Native 内部。
                if (result.canaryAdmission.nativeOwned === true) return nativeOwnedOutcome(result, runtimeInput);
                runtimeInput.emit?.('status', { stage: 'canary_ineligible', message: '该问法不在 Native 只读 canary 范围内，使用既有正式路径。', legacyRuntimeEntered: true });
                return runtime(runtimeInput);
            }
            // Task V2 owns the native answer.  It emits only the boundary's
            // fully validated deterministic content after controller work is
            // complete; no provider draft or legacy postprocessor runs here.
            if (typeof result.answer?.content === 'string' && result.answer.content) runtimeInput.emit?.('content', { content: result.answer.content });
            runtimeInput.emit?.('detail', result.detail);
            runtimeInput.emit?.('done');
            return result;
        }
        return runtime(runtimeInput);
    });
}

module.exports = { runAiDispatcherV3 };
