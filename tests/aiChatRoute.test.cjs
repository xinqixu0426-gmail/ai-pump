const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { handleAiChat } = require('../api/routes/ai/chat.cjs');
const { createAiRuntimeTelemetry } = require('../api/services/aiRuntimeTelemetry.cjs');

function createRequestResponse() {
    const req = new EventEmitter();
    req.body = { messages: [{ role: 'user', content: '测试' }] };
    req.requestId = 'req-route-test';
    const res = new EventEmitter();
    res.headers = {};
    res.output = '';
    res.writableEnded = false;
    res.destroyed = false;
    res.setHeader = (name, value) => { res.headers[name] = value; };
    res.flushHeaders = () => {};
    res.flush = () => {};
    res.write = chunk => {
        res.output += String(chunk);
        return true;
    };
    res.end = () => { res.writableEnded = true; };
    return { req, res };
}

function waitForAbort(signal) {
    return new Promise((_resolve, reject) => {
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
}

test('AI SSE：长请求期间发送心跳并在完成后记录运行指标', async () => {
    const { req, res } = createRequestResponse();
    const telemetry = createAiRuntimeTelemetry();
    await handleAiChat(req, res, {
        heartbeatMs: 5,
        timeoutMs: 100,
        telemetry,
        runAiDispatcherV3: async ({ emit }) => {
            await new Promise(resolve => setTimeout(resolve, 16));
            emit('content', { content: '完成' });
            emit('done', {});
            return {
                telemetry: {
                    outcome: 'answered',
                    usage: { promptTokens: 50, completionTokens: 5, totalTokens: 55 },
                    stageLatencyMs: { domainPlanningMs: 3, capabilityPlanningMs: 4 },
                    toolSteps: [{ capabilityName: 'search_parts', durationMs: 2, success: true }],
                },
            };
        },
    });
    assert.match(res.output, /: heartbeat\n\n/);
    assert.match(res.output, /"type":"done"/);
    assert.equal(res.writableEnded, true);
    const snapshot = telemetry.snapshot();
    assert.equal(snapshot.totals.completed, 1);
    assert.equal(snapshot.ttftMs.sampleCount, 1);
    assert.equal(snapshot.usage.totalTokens, 55);
    assert.equal(snapshot.stages.domainPlanningMs.average, 3);
});

test('AI SSE：浏览器断开会取消完整调用链且不再写错误事件', async () => {
    const { req, res } = createRequestResponse();
    const telemetry = createAiRuntimeTelemetry();
    const pending = handleAiChat(req, res, {
        heartbeatMs: 100,
        timeoutMs: 100,
        telemetry,
        runAiDispatcherV3: async ({ signal }) => waitForAbort(signal),
    });
    res.emit('close');
    await pending;
    assert.doesNotMatch(res.output, /"type":"error"/);
    assert.equal(telemetry.snapshot().totals.cancelled, 1);
});

test('AI SSE：总请求超时返回稳定错误码并计入超时指标', async () => {
    const { req, res } = createRequestResponse();
    const telemetry = createAiRuntimeTelemetry();
    await handleAiChat(req, res, {
        heartbeatMs: 100,
        timeoutMs: 5,
        telemetry,
        runAiDispatcherV3: async ({ signal }) => waitForAbort(signal),
    });
    assert.match(res.output, /AI_REQUEST_TIMEOUT/);
    const snapshot = telemetry.snapshot();
    assert.equal(snapshot.totals.failed, 1);
    assert.equal(snapshot.totals.timeouts, 1);
});
