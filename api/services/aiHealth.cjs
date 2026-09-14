const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const { providerTimeoutMs } = require('./aiProvider.cjs');
const { resolveProviderConfigsForMode } = require('./aiProviderRegistry.cjs');
const { aiRuntimeTelemetry } = require('./aiRuntimeTelemetry.cjs');
const { getLatestAiEvaluationHealth } = require('./aiEvaluations.cjs');
const { runtimeDiagnostics } = require('./runtimeDiagnostics.cjs');

const AI_HEALTH_CAPABILITY_ID = requireBusinessCapability('ai.health.read').capabilityId;

function safeProvider(config, required) {
    return {
        provider: config.provider,
        displayName: config.displayName,
        model: config.model,
        configured: config.apiKeyRequired === false || Boolean(config.apiKey),
        required,
        supportsImages: Boolean(config.supportsImages),
        supportsFileExtraction: Boolean(config.supportsFileExtraction),
    };
}

function aiProviderHealth(env = process.env) {
    const resolved = resolveProviderConfigsForMode(env, { includeUnconfigured: true });
    const providers = resolved.configs.map(config => safeProvider(
        config,
        resolved.mode === 'auto' ? config.autoRequired : true
    ));
    return {
        mode: resolved.mode,
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
