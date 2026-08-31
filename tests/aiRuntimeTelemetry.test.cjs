const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiRuntimeTelemetry } = require('../api/services/aiRuntimeTelemetry.cjs');

test('AI 运行遥测：只保留有界安全指标并统计重试、降级与超时', () => {
    const telemetry = createAiRuntimeTelemetry({ windowSize: 10, startedAt: '2026-08-31T00:00:00.000Z' });
    telemetry.record({
        requestId: 'req-success',
        status: 'completed',
        durationMs: 120,
        providerEvents: [
            { provider: 'kimi', model: 'kimi-k3', retry: true },
            { provider: 'kimi', model: 'kimi-k3', failed: true, status: 503 },
            { provider: 'deepseek', model: 'deepseek-v4-flash', fallback: true },
        ],
        messages: [{ content: '不得进入遥测的用户问题' }],
    });
    telemetry.record({
        requestId: 'req-timeout',
        status: 'failed',
        durationMs: 300,
        errorCode: 'AI_REQUEST_TIMEOUT',
        providerEvents: [{ provider: 'kimi', failed: true, status: 503 }],
    });

    const snapshot = telemetry.snapshot();
    assert.deepEqual(snapshot.totals, {
        requests: 2,
        completed: 1,
        failed: 1,
        cancelled: 0,
        timeouts: 1,
        fallbacks: 1,
        retries: 1,
    });
    assert.equal(snapshot.latencyMs.average, 210);
    assert.equal(snapshot.lastError.code, 'AI_REQUEST_TIMEOUT');
    assert.equal(snapshot.providers.find(item => item.provider === 'kimi').failures, 1);
    assert.equal(snapshot.providers.find(item => item.provider === 'deepseek').fallbacks, 1);
    assert.equal(JSON.stringify(snapshot).includes('不得进入遥测'), false);
});

test('AI 运行遥测：明细窗口有界但进程累计计数不丢失', () => {
    const telemetry = createAiRuntimeTelemetry({ windowSize: 10 });
    for (let index = 0; index < 12; index += 1) {
        telemetry.record({ status: 'completed', durationMs: index });
    }
    const snapshot = telemetry.snapshot();
    assert.equal(snapshot.sampleCount, 10);
    assert.equal(snapshot.totals.requests, 12);
    assert.equal(snapshot.totals.completed, 12);
});
