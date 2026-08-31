const DEFAULT_PROVIDER_ID = 'deepseek';
const MULTIMODAL_PROVIDER_ID = 'kimi';

const PROVIDER_RUNTIME_DEFINITIONS = Object.freeze({
    aiProvider: Object.freeze({
        env: 'AI_PROVIDER',
        type: 'enum',
        values: Object.freeze(['auto', DEFAULT_PROVIDER_ID, MULTIMODAL_PROVIDER_ID]),
        defaultValue: 'auto',
        hot: true,
    }),
    deepseekApiKey: Object.freeze({
        env: 'DEEPSEEK_API_KEY',
        type: 'secret',
        hot: true,
    }),
    deepseekModel: Object.freeze({
        env: 'DEEPSEEK_MODEL',
        type: 'model',
        defaultValue: 'deepseek-v4-flash',
        hot: true,
    }),
    deepseekBaseUrl: Object.freeze({
        env: 'DEEPSEEK_BASE_URL',
        type: 'url',
        defaultValue: 'https://api.deepseek.com',
        hot: true,
    }),
    kimiApiKey: Object.freeze({
        env: 'KIMI_API_KEY',
        type: 'secret',
        hot: true,
    }),
    kimiModel: Object.freeze({
        env: 'KIMI_MODEL',
        type: 'model',
        defaultValue: 'kimi-k3',
        hot: true,
    }),
    kimiReasoningEffort: Object.freeze({
        env: 'KIMI_REASONING_EFFORT',
        type: 'enum',
        values: Object.freeze(['low', 'high', 'max']),
        defaultValue: 'low',
        hot: true,
    }),
    kimiBaseUrl: Object.freeze({
        env: 'KIMI_BASE_URL',
        type: 'url',
        defaultValue: 'https://api.moonshot.cn/v1',
        hot: true,
    }),
    aiVisionEnabled: Object.freeze({
        env: 'AI_VISION_ENABLED',
        type: 'boolean',
        defaultValue: 'true',
        hot: true,
    }),
});
const AI_RUNTIME_FIELD_NAMES = Object.freeze(Object.keys(PROVIDER_RUNTIME_DEFINITIONS));

function text(value) {
    return String(value ?? '').trim();
}

function booleanEnv(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

const PROVIDER_REGISTRY = Object.freeze({
    deepseek: Object.freeze({
        provider: 'deepseek',
        displayName: 'DeepSeek',
        apiKeyField: 'deepseekApiKey',
        autoRequired: true,
        supportsFileExtraction: false,
        resolve(env) {
            return {
                apiKey: text(env[PROVIDER_RUNTIME_DEFINITIONS.deepseekApiKey.env]),
                baseUrl: (
                    text(env[PROVIDER_RUNTIME_DEFINITIONS.deepseekBaseUrl.env])
                    || PROVIDER_RUNTIME_DEFINITIONS.deepseekBaseUrl.defaultValue
                ).replace(/\/+$/, ''),
                model: text(env[PROVIDER_RUNTIME_DEFINITIONS.deepseekModel.env])
                    || PROVIDER_RUNTIME_DEFINITIONS.deepseekModel.defaultValue,
                supportsImages: false,
            };
        },
    }),
    kimi: Object.freeze({
        provider: 'kimi',
        displayName: 'Kimi 开放平台',
        apiKeyField: 'kimiApiKey',
        autoRequired: false,
        supportsFileExtraction: true,
        resolve(env) {
            const model = text(env[PROVIDER_RUNTIME_DEFINITIONS.kimiModel.env])
                || PROVIDER_RUNTIME_DEFINITIONS.kimiModel.defaultValue;
            const requestedEffort = text(env[PROVIDER_RUNTIME_DEFINITIONS.kimiReasoningEffort.env]);
            const reasoningEffort = PROVIDER_RUNTIME_DEFINITIONS.kimiReasoningEffort.values
                .includes(requestedEffort)
                ? requestedEffort
                : PROVIDER_RUNTIME_DEFINITIONS.kimiReasoningEffort.defaultValue;
            return {
                apiKey: text(env[PROVIDER_RUNTIME_DEFINITIONS.kimiApiKey.env] || env.MOONSHOT_API_KEY),
                baseUrl: (
                    text(env[PROVIDER_RUNTIME_DEFINITIONS.kimiBaseUrl.env])
                    || PROVIDER_RUNTIME_DEFINITIONS.kimiBaseUrl.defaultValue
                ).replace(/\/+$/, ''),
                model,
                reasoningEffort,
                supportsImages: booleanEnv(
                    env[PROVIDER_RUNTIME_DEFINITIONS.aiVisionEnabled.env],
                    /kimi-k2\.(?:5|6|7)|kimi-k3|vision/i.test(model)
                ),
            };
        },
    }),
});

function providerMode(env = process.env, fallback = DEFAULT_PROVIDER_ID) {
    return text(env.AI_PROVIDER).toLowerCase() || fallback;
}

function providerDefinition(provider) {
    const definition = PROVIDER_REGISTRY[provider];
    if (!definition) throw new Error(`不支持的 AI_PROVIDER: ${provider}`);
    return definition;
}

function resolveProviderConfig(provider, env = process.env) {
    const definition = providerDefinition(provider);
    return {
        provider: definition.provider,
        displayName: definition.displayName,
        apiKeyEnvName: PROVIDER_RUNTIME_DEFINITIONS[definition.apiKeyField].env,
        autoRequired: definition.autoRequired,
        supportsFileExtraction: definition.supportsFileExtraction,
        ...definition.resolve(env),
    };
}

function assertProviderModeConfigured(mode, values) {
    const provider = mode === 'auto' ? DEFAULT_PROVIDER_ID : mode;
    const definition = providerDefinition(provider);
    if (values?.[definition.apiKeyField]) return;
    if (mode === 'auto') throw new Error('启用智能路由前必须先配置 DeepSeek API Key');
    if (provider === MULTIMODAL_PROVIDER_ID) {
        throw new Error('切换 Kimi 前必须先配置 Kimi 开放平台 API Key');
    }
    throw new Error('切换 DeepSeek 前必须先配置 DeepSeek API Key');
}

function resolveAiProviderConfig(env = process.env) {
    const mode = providerMode(env);
    if (mode === 'auto') {
        return {
            ...resolveProviderConfig(DEFAULT_PROVIDER_ID, env),
            routingMode: 'auto',
            routeReason: 'default',
        };
    }
    return resolveProviderConfig(mode, env);
}

function resolveProviderConfigsForMode(env = process.env, options = {}) {
    const mode = providerMode(env, options.defaultMode || DEFAULT_PROVIDER_ID);
    if (mode !== 'auto') {
        return {
            mode,
            configs: [resolveProviderConfig(mode, env)],
        };
    }
    const includeUnconfigured = options.includeUnconfigured !== false;
    const configs = Object.keys(PROVIDER_REGISTRY)
        .map(provider => resolveProviderConfig(provider, env))
        .filter(config => includeUnconfigured || config.autoRequired || config.apiKey);
    return { mode, configs };
}

module.exports = {
    AI_RUNTIME_FIELD_NAMES,
    DEFAULT_PROVIDER_ID,
    MULTIMODAL_PROVIDER_ID,
    PROVIDER_REGISTRY,
    PROVIDER_RUNTIME_DEFINITIONS,
    assertProviderModeConfigured,
    providerDefinition,
    providerMode,
    resolveAiProviderConfig,
    resolveProviderConfig,
    resolveProviderConfigsForMode,
};
