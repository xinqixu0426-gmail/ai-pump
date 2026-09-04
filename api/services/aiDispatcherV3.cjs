const { runAiAgentRuntimeV3 } = require('./aiAgentRuntimeV3.cjs');
const { fetchAiProvider } = require('./aiProvider.cjs');
const {
    getActiveTraceContext,
    traceModelProvider,
    withAgentSpan,
} = require('./observability.cjs');
const { captureSafeV4ShadowFacts } = require('./ai-v5/shadowProjection.cjs');
const { scheduleV5ShadowMirror } = require('./ai-v5/shadowMirror.cjs');
const { collectV5ShadowFacts } = require('./ai-v5/shadowFacts.cjs');

async function runAiDispatcherV3(input = {}, dependencies = {}) {
    const runtime = dependencies.runAiAgentRuntimeV3 || runAiAgentRuntimeV3;
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
        const shadowEnv = dependencies.env || process.env;
        const shadowRate = Number(shadowEnv.AI_V5_SHADOW_SAMPLE_RATE);
        const collectShadowFacts = shadowEnv.AI_V5_SHADOW_ENABLED === 'true'
            && Number.isFinite(shadowRate) && shadowRate > 0 && shadowRate <= 1;
        const execution = collectShadowFacts
            ? await (dependencies.collectV5ShadowFacts || collectV5ShadowFacts)(() => runtime(runtimeInput))
            : { result: await runtime(runtimeInput), shadowFacts: null };
        const result = execution.result;
        try {
            if (shadowEnv.AI_V5_SHADOW_ENABLED === 'true') {
                const traceContext = (dependencies.getActiveTraceContext || getActiveTraceContext)();
                const facts = (dependencies.captureSafeV4ShadowFacts || captureSafeV4ShadowFacts)(
                    input,
                    result,
                    traceContext,
                    { shadowFacts: execution.shadowFacts }
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
