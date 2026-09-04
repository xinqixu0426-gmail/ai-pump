const { runAiAgentRuntimeV3 } = require('./aiAgentRuntimeV3.cjs');
const { fetchAiProvider } = require('./aiProvider.cjs');
const {
    traceModelProvider,
    withAgentSpan,
} = require('./observability.cjs');

async function runAiDispatcherV3(input = {}, dependencies = {}) {
    const runtime = dependencies.runAiAgentRuntimeV3 || runAiAgentRuntimeV3;
    const provider = traceModelProvider(input.fetchAiProvider || fetchAiProvider);
    return withAgentSpan({
        streaming: Boolean(input.stream),
        route: 'ai_dispatcher_v3',
        requestId: input.requestId,
    }, () => runtime({
        ...input,
        fetchAiProvider: provider,
        agentVersion: 3,
    }));
}

module.exports = { runAiDispatcherV3 };
