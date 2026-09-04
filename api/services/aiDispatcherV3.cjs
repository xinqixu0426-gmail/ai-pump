const { runAiAgentRuntimeV3 } = require('./aiAgentRuntimeV3.cjs');
const { fetchAiProvider } = require('./aiProvider.cjs');
const {
    getActiveTraceContext,
    traceModelProvider,
    withAgentSpan,
} = require('./observability.cjs');
const { captureSafeV4ShadowFacts } = require('./ai-v5/shadowProjection.cjs');
const { scheduleV5ShadowMirror } = require('./ai-v5/shadowMirror.cjs');

async function runAiDispatcherV3(input = {}, dependencies = {}) {
    const runtime = dependencies.runAiAgentRuntimeV3 || runAiAgentRuntimeV3;
    const provider = traceModelProvider(input.fetchAiProvider || fetchAiProvider);
    return withAgentSpan({
        streaming: Boolean(input.stream),
        route: 'ai_dispatcher_v3',
        requestId: input.requestId,
    }, async () => {
        const result = await runtime({
            ...input,
            fetchAiProvider: provider,
            agentVersion: 3,
        });
        try {
            const shadowEnv = dependencies.env || process.env;
            if (shadowEnv.AI_V5_SHADOW_ENABLED === 'true') {
                const traceContext = (dependencies.getActiveTraceContext || getActiveTraceContext)();
                const facts = (dependencies.captureSafeV4ShadowFacts || captureSafeV4ShadowFacts)(
                    input,
                    result,
                    traceContext
                );
                const scheduled = (dependencies.scheduleV5ShadowMirror || scheduleV5ShadowMirror)(facts, {
                    env: shadowEnv,
                });
                scheduled?.completion?.catch?.(() => {});
            }
        } catch {
            // V5 shadow is observational and can never change the V4 result.
        }
        return result;
    });
}

module.exports = { runAiDispatcherV3 };
