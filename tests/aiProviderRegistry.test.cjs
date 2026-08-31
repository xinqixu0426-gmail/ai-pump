const test = require('node:test');
const assert = require('node:assert/strict');
const {
    PROVIDER_REGISTRY,
    resolveAiProviderConfig,
    resolveProviderConfig,
    resolveProviderConfigsForMode,
} = require('../api/services/aiProviderRegistry.cjs');

test('AI Provider Registry：DeepSeek/Kimi 配置和能力由统一登记生成', () => {
    assert.deepEqual(Object.keys(PROVIDER_REGISTRY), ['deepseek', 'kimi']);
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
        () => resolveProviderConfig('qwen', {}),
        /不支持的 AI_PROVIDER: qwen/
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
