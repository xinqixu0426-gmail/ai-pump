const { runAiAssistant } = require('./aiAssistantRuntime.cjs');
const { runAiAgentRuntimeV3 } = require('./aiAgentRuntimeV3.cjs');
const { detectProtectedCommandRoute } = require('./aiProtectedCommandRoute.cjs');
const { fetchAiProvider } = require('./aiProvider.cjs');
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
        return runtime(runtimeInput);
    });
}

module.exports = { runAiDispatcherV3 };
