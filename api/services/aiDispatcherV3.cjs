const { runAiAssistant } = require('./aiAssistantRuntime.cjs');
const { fetchAiProvider } = require('./aiProvider.cjs');
const {
    traceModelProvider,
    withAgentSpan,
} = require('./observability.cjs');

async function runAiDispatcherV3(input = {}, dependencies = {}) {
    const runtime = dependencies.runAiAssistant || dependencies.runAiAgentRuntimeV3 || runAiAssistant;
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
        };
        return runtime(runtimeInput);
    });
}

module.exports = { runAiDispatcherV3 };
