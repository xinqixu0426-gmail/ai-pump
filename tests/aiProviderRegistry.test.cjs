const test = require('node:test');
const assert = require('node:assert/strict');
const {
    PROVIDER_REGISTRY,
    normalizeProviderPreference,
    resolveAiProviderConfig,
    resolveProviderConfig,
    resolveProviderConfigsForMode,
    resolveProviderPreference,
} = require('../api/services/aiProviderRegistry.cjs');

test('AI Provider Registry：局域网、DeepSeek、Kimi 配置和能力由统一登记生成', () => {
    assert.deepEqual(Object.keys(PROVIDER_REGISTRY), ['local', 'deepseek', 'kimi']);
    const resolved = resolveProviderConfigsForMode({
        AI_PROVIDER: 'auto',
        DEEPSEEK_API_KEY: 'deepseek-key',
        KIMI_API_KEY: 'kimi-key',
        KIMI_MODEL: 'kimi-k3',
        AI_VISION_ENABLED: 'true',
    });
    assert.equal(resolved.mode, 'auto');
    assert.deepEqual(resolved.configs.map(item => item.provider), ['deepseek', 'kimi']);
    assert.equal(resolved.configs[0].autoRequired, true);
    assert.equal(resolved.configs[1].autoRequired, false);
    assert.equal(resolved.configs[1].supportsImages, true);
    assert.equal(resolved.configs[1].supportsFileExtraction, true);
});

test('AI Provider Registry：本地优先无需 API Key 并固定选择局域网模型', () => {
    const resolved = resolveAiProviderConfig({
        AI_PROVIDER: 'local-first',
        LOCAL_AI_BASE_URL: 'http://192.168.31.111:8080/v1/',
        LOCAL_AI_MODEL: 'local-apex',
        LOCAL_AI_VISION_ENABLED: 'true',
    });
    assert.equal(resolved.provider, 'local');
    assert.equal(resolved.routingMode, 'local-first');
    assert.equal(resolved.routeReason, 'local_primary');
    assert.equal(resolved.baseUrl, 'http://192.168.31.111:8080/v1');
    assert.equal(resolved.model, 'local-apex');
    assert.equal(resolved.apiKeyRequired, false);
    assert.equal(resolved.supportsImages, true);
    assert.equal(resolved.requiresLeadingSystemMessage, true);
    assert.deepEqual(
        resolveProviderConfigsForMode({ AI_PROVIDER: 'local-first' }).configs.map(item => item.provider),
        ['local']
    );
});

test('AI Provider Registry：局域网模型默认不支持图片理解，只有显式开启才声明视觉能力', () => {
    const resolved = resolveProviderConfig('local', {
        LOCAL_AI_MODEL: 'local-apex',
    });
    assert.equal(resolved.supportsImages, false);
    assert.equal(
        resolveProviderConfig('local', {
            LOCAL_AI_MODEL: 'local-apex',
            LOCAL_AI_VISION_ENABLED: 'true',
        }).supportsImages,
        true
    );
});

test('AI Provider Registry：仅本地模式不配置云端密钥且不建立回退路由', () => {
    const resolved = resolveAiProviderConfig({
        AI_PROVIDER: 'local',
        LOCAL_AI_BASE_URL: 'http://192.168.31.111:8080/v1',
        LOCAL_AI_MODEL: 'local-apex',
    });
    assert.equal(resolved.provider, 'local');
    assert.equal(resolved.routingMode, undefined);
    assert.equal(resolved.apiKeyRequired, false);
    assert.deepEqual(
        resolveProviderConfigsForMode({ AI_PROVIDER: 'local' }).configs.map(item => item.provider),
        ['local']
    );
});

test('AI Provider Registry：自动连接检查保留必需 Provider 并忽略未配置可选 Provider', () => {
    const resolved = resolveProviderConfigsForMode({
        AI_PROVIDER: 'auto',
        DEEPSEEK_API_KEY: 'deepseek-key',
        KIMI_API_KEY: '',
    }, { includeUnconfigured: false });
    assert.deepEqual(resolved.configs.map(item => item.provider), ['deepseek']);
});

test('AI Provider Registry：手动模式与未知 Provider 保持稳定行为', () => {
    const kimi = resolveAiProviderConfig({
        AI_PROVIDER: 'kimi',
        KIMI_API_KEY: 'kimi-key',
    });
    assert.equal(kimi.provider, 'kimi');
    assert.equal(kimi.routingMode, undefined);
    assert.throws(
        () => resolveProviderConfig('unsupported-provider', {}),
        /不支持的 AI_PROVIDER: unsupported-provider/
    );
});

test('AI Provider Registry：单轮模型选择只接受已登记且可用的 Provider', () => {
    assert.equal(normalizeProviderPreference('default'), null);
    assert.equal(normalizeProviderPreference(' LOCAL '), 'local');
    const deepseek = resolveProviderPreference('deepseek', { DEEPSEEK_API_KEY: 'deepseek-key' });
    assert.equal(deepseek.provider, 'deepseek');
    assert.equal(deepseek.routingMode, 'manual');
    assert.equal(deepseek.routeReason, 'manual');
    assert.throws(
        () => resolveProviderPreference('deepseek', { DEEPSEEK_API_KEY: '' }),
        error => error.code === 'AI_PROVIDER_NOT_CONFIGURED' && error.statusCode === 422
    );
    assert.throws(
        () => normalizeProviderPreference('other-model'),
        error => error.code === 'AI_PROVIDER_SELECTION_INVALID' && error.statusCode === 400
    );
});

test('AI Provider Registry：URL、兼容密钥和视觉开关边界集中生效', () => {
    const deepseek = resolveProviderConfig('deepseek', {
        DEEPSEEK_API_KEY: 'deepseek-key',
        DEEPSEEK_BASE_URL: 'https://deepseek.example/v1///',
    });
    assert.equal(deepseek.baseUrl, 'https://deepseek.example/v1');

    const kimi = resolveProviderConfig('kimi', {
        MOONSHOT_API_KEY: 'moonshot-compatible-key',
        KIMI_BASE_URL: 'https://kimi.example/v1/',
        KIMI_MODEL: 'kimi-k3',
        AI_VISION_ENABLED: 'false',
    });
    assert.equal(kimi.apiKey, 'moonshot-compatible-key');
    assert.equal(kimi.baseUrl, 'https://kimi.example/v1');
    assert.equal(kimi.supportsImages, false);
    assert.equal(kimi.supportsFileExtraction, true);
});
