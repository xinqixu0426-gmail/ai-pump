const { runAiAssistant } = require('./aiAssistantRuntime.cjs');
const { runAiAgentRuntimeV3 } = require('./aiAgentRuntimeV3.cjs');
const { detectProtectedCommandRoute } = require('./aiProtectedCommandRoute.cjs');
const { fetchAiProvider } = require('./aiProvider.cjs');
const { runAiTaskControllerV2 } = require('./aiTaskControllerV2.cjs');
const {
    traceModelProvider,
    withAgentSpan,
} = require('./observability.cjs');

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
                runtimeInput.emit?.('status', { stage: 'canary_ineligible', message: '该问法不在 Native 只读 canary 范围内，使用既有正式路径。' });
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
