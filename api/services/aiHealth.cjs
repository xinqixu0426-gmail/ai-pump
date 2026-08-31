const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    providerTimeoutMs,
    resolveProviderConfig,
} = require('./aiProvider.cjs');
const { aiRuntimeTelemetry } = require('./aiRuntimeTelemetry.cjs');
const { getLatestAiEvaluationHealth } = require('./aiEvaluations.cjs');
const { runtimeDiagnostics } = require('./runtimeDiagnostics.cjs');

const AI_HEALTH_CAPABILITY_ID = requireBusinessCapability('ai.health.read').capabilityId;

function safeProvider(config, required) {
    return {
        provider: config.provider,
        displayName: config.displayName,
        model: config.model,
        configured: Boolean(config.apiKey),
        required,
        supportsImages: Boolean(config.supportsImages),
        supportsFileExtraction: Boolean(config.supportsFileExtraction),
    };
}

function aiProviderHealth(env = process.env) {
    const mode = String(env.AI_PROVIDER || 'deepseek').trim().toLowerCase() || 'deepseek';
    const deepseek = resolveProviderConfig('deepseek', env);
    const kimi = resolveProviderConfig('kimi', env);
    const providers = mode === 'auto'
        ? [safeProvider(deepseek, true), safeProvider(kimi, false)]
        : [safeProvider(resolveProviderConfig(mode, env), true)];
    return {
        mode,
        ready: providers.filter(item => item.required).every(item => item.configured),
        providers,
        requestTimeoutMs: providerTimeoutMs(env),
    };
}

function getAiHealth(options = {}) {
    const provider = aiProviderHealth(options.env || process.env);
    const releaseGate = options.releaseGateHealth || getLatestAiEvaluationHealth({
        dbAccessors: options.dbAccessors,
    });
    const runtime = (options.telemetry || aiRuntimeTelemetry).snapshot();
    const processRuntime = options.processRuntime || runtimeDiagnostics();
    const releaseGateReady = releaseGate.status === 'healthy';
    return {
        generatedAt: new Date().toISOString(),
        status: provider.ready && releaseGateReady ? 'healthy' : 'attention',
        capabilityId: AI_HEALTH_CAPABILITY_ID,
        provider,
        runtime,
        releaseGate: {
            ...releaseGate,
            ready: releaseGateReady,
        },
        process: {
            version: processRuntime.version,
            gitCommit: processRuntime.gitCommit,
            startedAt: processRuntime.startedAt,
            uptimeSeconds: processRuntime.uptimeSeconds,
        },
    };
}

module.exports = {
    AI_HEALTH_CAPABILITY_ID,
    aiProviderHealth,
    getAiHealth,
};
