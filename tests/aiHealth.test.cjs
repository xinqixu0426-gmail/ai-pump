const test = require('node:test');
const assert = require('node:assert/strict');
const { aiProviderHealth, getAiHealth } = require('../api/services/aiHealth.cjs');
const { createAiRuntimeTelemetry } = require('../api/services/aiRuntimeTelemetry.cjs');

test('AI 健康快照：自动路由要求文本与多模态提供商都已配置且不泄漏密钥', () => {
    const env = {
        AI_PROVIDER: 'auto',
        DEEPSEEK_API_KEY: 'deepseek-secret',
        DEEPSEEK_MODEL: 'deepseek-v4-flash',
        KIMI_API_KEY: 'kimi-secret',
        KIMI_MODEL: 'kimi-k3',
    };
    const provider = aiProviderHealth(env);
    assert.equal(provider.ready, true);
    assert.equal(provider.providers.length, 2);
    assert.equal(provider.providers.find(item => item.provider === 'deepseek').required, true);
    assert.equal(provider.providers.find(item => item.provider === 'kimi').required, false);
    assert.equal(provider.providers.every(item => item.configured), true);
    assert.equal(JSON.stringify(provider).includes('deepseek-secret'), false);
    assert.equal(JSON.stringify(provider).includes('kimi-secret'), false);
});

test('AI 健康快照：聚合提供商、运行遥测、发布门禁与进程身份', () => {
    const telemetry = createAiRuntimeTelemetry();
    telemetry.record({ status: 'completed', durationMs: 80 });
    const health = getAiHealth({
        env: { AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'secret' },
        telemetry,
        releaseGateHealth: { status: 'healthy', healthy: true, activeCaseCount: 8 },
        processRuntime: {
            version: '1.0.0',
            gitCommit: 'abc123',
            startedAt: '2026-08-31T00:00:00.000Z',
            uptimeSeconds: 12,
        },
    });
    assert.equal(health.status, 'healthy');
    assert.equal(health.capabilityId, 'ai.health.read');
    assert.equal(health.releaseGate.ready, true);
    assert.equal(health.runtime.totals.completed, 1);
    assert.equal(health.process.gitCommit, 'abc123');
    assert.equal(JSON.stringify(health).includes('secret'), false);
});

test('AI 健康快照：自动路由缺少可选 Kimi 时普通 DeepSeek 对话仍可用', () => {
    const provider = aiProviderHealth({
        AI_PROVIDER: 'auto',
        DEEPSEEK_API_KEY: 'deepseek-key',
        KIMI_API_KEY: '',
    });
    assert.equal(provider.ready, true);
    assert.equal(provider.providers.find(item => item.provider === 'kimi').configured, false);
});

test('AI 健康快照：本地优先无需 API Key 即可就绪', () => {
    const provider = aiProviderHealth({
        AI_PROVIDER: 'local-first',
        LOCAL_AI_BASE_URL: 'http://192.168.31.111:8080/v1',
        LOCAL_AI_MODEL: 'local-apex',
    });
    assert.equal(provider.mode, 'local-first');
    assert.equal(provider.ready, true);
    assert.deepEqual(provider.providers.map(item => item.provider), ['local']);
    assert.equal(provider.providers[0].configured, true);
    assert.equal(provider.providers[0].required, true);
});
