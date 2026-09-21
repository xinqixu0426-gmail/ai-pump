const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { buildAiTurnMetrics, handleAiChat } = require('../api/routes/ai/chat.cjs');
const { createAiRuntimeTelemetry } = require('../api/services/aiRuntimeTelemetry.cjs');
const { issueOwnerToken } = require('../api/services/ownerAuthentication.cjs');

function createRequestResponse() {
    const req = new EventEmitter();
    req.body = { messages: [{ role: 'user', content: '测试' }] };
    req.headers = {};
    req.cookies = {};
    req.requestId = 'req-route-test';
    const res = new EventEmitter();
    res.headers = {};
    res.output = '';
    res.writableEnded = false;
    res.destroyed = false;
    res.setHeader = (name, value) => { res.headers[name] = value; };
    res.flushHeaders = () => {};
    res.flush = () => {};
    res.statusCode = 200;
    res.status = code => {
        res.statusCode = code;
        return res;
    };
    res.json = body => {
        res.output = JSON.stringify(body);
        res.writableEnded = true;
        return res;
    };
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
                    providerDurationMs: 10,
                    modelRequestCount: 2,
                    executedTools: 1,
                    stageLatencyMs: { domainPlanningMs: 3, capabilityPlanningMs: 4 },
                    toolSteps: [{ capabilityName: 'search_parts', durationMs: 2, success: true }],
                },
            };
        },
    });
    assert.match(res.output, /: heartbeat\n\n/);
    assert.match(res.output, /"type":"done"/);
    assert.match(res.output, /"type":"metrics"/);
    assert.match(res.output, /"tokensPerSecond":null/);
    assert.match(res.output, /"tokensPerSecondSource":null/);
    assert.ok(res.output.indexOf('"type":"metrics"') < res.output.indexOf('"type":"done"'));
    assert.equal(res.writableEnded, true);
    const snapshot = telemetry.snapshot();
    assert.equal(snapshot.totals.completed, 1);
    assert.equal(snapshot.ttftMs.sampleCount, 1);
    assert.equal(snapshot.usage.totalTokens, 55);
    assert.equal(snapshot.stages.domainPlanningMs.average, 3);
});

test('AI SSE 运行统计：优先使用供应商原生生成速度', () => {
    assert.deepEqual(buildAiTurnMetrics({
        providerDurationMs: 2500,
        generationTiming: { tokensPerSecond: 36.2 },
        modelRequestCount: 1,
        usage: { promptTokens: 120, completionTokens: 25, totalTokens: 145 },
    }, { durationMs: 3100, firstContentMs: 2800 }), {
        durationMs: 3100,
        firstContentMs: 2800,
        modelDurationMs: 2500,
        toolDurationMs: 0,
        modelRequestCount: 1,
        toolCallCount: 0,
        tokensPerSecond: 36.2,
        tokensPerSecondSource: 'provider_timings',
        usage: { promptTokens: 120, completionTokens: 25, totalTokens: 145 },
    });
});

test('AI SSE 运行统计：无生成区间时不用整次请求耗时伪造速度', () => {
    assert.deepEqual(buildAiTurnMetrics({
        providerDurationMs: 2500,
        modelRequestCount: 2,
        executedTools: 1,
        usage: { promptTokens: 120, completionTokens: 25, totalTokens: 145 },
        toolSteps: [{ durationMs: 12 }, { durationMs: 8 }],
    }, { durationMs: 3100, firstContentMs: 2800 }), {
        durationMs: 3100,
        firstContentMs: 2800,
        modelDurationMs: 2500,
        toolDurationMs: 20,
        modelRequestCount: 2,
        toolCallCount: 1,
        tokensPerSecond: null,
        tokensPerSecondSource: null,
        usage: { promptTokens: 120, completionTokens: 25, totalTokens: 145 },
    });
    assert.equal(buildAiTurnMetrics({}, { durationMs: 10 }).tokensPerSecond, null);
});

test('AI SSE 运行统计：接收流式分片估算生成速度并明确标注', () => {
    const metrics = buildAiTurnMetrics({
        providerDurationMs: 2500,
        generationTiming: { tokensPerSecond: 42.6, source: 'stream_observed' },
        usage: { promptTokens: 120, completionTokens: 50, totalTokens: 170 },
    }, { durationMs: 3100, firstContentMs: 900 });
    assert.equal(metrics.tokensPerSecond, 42.6);
    assert.equal(metrics.tokensPerSecondSource, 'stream_observed');
});

test('AI SSE：按登录所有者恢复持久会话候选并传给执行器', async () => {
    const { req, res } = createRequestResponse();
    req.user = { role: 'admin' };
    req.body.conversationId = 'chat-28';
    const persisted = { question: 'V750 的成本是多少', toolResults: [{ name: 'preview_recipe_cost' }] };
    const recentPartWrite = { toolName: 'create_part', part: { id: 142, model: '测试件' } };
    let received;
    await handleAiChat(req, res, {
        loadAiConversationContinuation: (owner, conversationId) => {
            assert.equal(owner, 'admin');
            assert.equal(conversationId, 'chat-28');
            return persisted;
        },
        loadAiRecentPartWrite: (owner, conversationId) => {
            assert.equal(owner, 'admin');
            assert.equal(conversationId, 'chat-28');
            return recentPartWrite;
        },
        runAiDispatcherV3: async input => {
            received = {
                persisted: input.persistedConversationContext,
                recentPartWrite: input.recentPartWrite,
            };
            input.emit('content', { content: '完成' });
            input.emit('done', {});
            return { telemetry: { outcome: 'answered' } };
        },
    });
    assert.equal(received.persisted, persisted);
    assert.equal(received.recentPartWrite, recentPartWrite);
    assert.match(res.output, /"type":"done"/);
});

test('AI SSE：已配置的单轮模型选择传入执行器', async () => {
    const { req, res } = createRequestResponse();
    req.body.providerPreference = 'deepseek';
    let receivedPreference;
    await handleAiChat(req, res, {
        env: { DEEPSEEK_API_KEY: 'deepseek-key' },
        runAiDispatcherV3: async input => {
            receivedPreference = input.providerPreference;
            input.emit('content', { content: '完成' });
            input.emit('done', {});
            return { telemetry: { outcome: 'answered' } };
        },
    });
    assert.equal(receivedPreference, 'deepseek');
    assert.match(res.output, /"type":"done"/);
});

test('AI SSE：Ontology 与 Impact Canary 仅把可信 Owner/Internal 资格传入运行时', async () => {
    const env = {
        ACCESS_PASSWORD: 'synthetic-shared-password',
        JWT_SECRET: 'synthetic-jwt-test-secret',
        INTERNAL_SECRET: 'synthetic-internal-secret',
        PUMP_OWNER_ACCESS_PASSWORD: 'synthetic-owner-credential-only-for-unit-test',
        PUMP_OWNER_SUBJECT: 'synthetic_owner_subject_001',
        AI_V5_OWNER_SUBJECTS: '["synthetic_owner_subject_001"]',
        AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED: 'true',
    };
    const dispatch = async input => {
        input.emit('content', { content: '完成' });
        input.emit('done', {});
        return { telemetry: { outcome: 'answered' }, eligible: input.ontologyRelationCanaryEligible };
    };
    async function eligibilityFor(configure) {
        const { req, res } = createRequestResponse();
        configure(req);
        let received = null;
        await handleAiChat(req, res, { env, runAiDispatcherV3: async input => {
            received = {
                ontology: input.ontologyRelationCanaryEligible,
                impact: input.impactEnforcementCanaryEligible,
            };
            return dispatch(input);
        } });
        return received;
    }
    const ownerToken = issueOwnerToken(env.PUMP_OWNER_ACCESS_PASSWORD, env);
    const sharedToken = require('jsonwebtoken').sign({ role: 'admin' }, env.JWT_SECRET, { expiresIn: '1h' });
    assert.deepEqual(await eligibilityFor(req => { req.cookies.token = ownerToken; req.user = { role: 'admin' }; }), { ontology: true, impact: true });
    assert.deepEqual(await eligibilityFor(req => { req.headers['x-internal-secret'] = env.INTERNAL_SECRET; }), { ontology: true, impact: true });
    assert.deepEqual(await eligibilityFor(req => { req.cookies.token = sharedToken; req.user = { role: 'admin' }; }), { ontology: false, impact: false });
    assert.deepEqual(await eligibilityFor(req => { req.user = { role: 'admin', owner: true }; req.headers['x-owner'] = 'true'; }), { ontology: false, impact: false });
});

test('AI SSE：非法或未配置的单轮模型选择在路由边界拒绝', async () => {
    const invalid = createRequestResponse();
    invalid.req.body.providerPreference = 'other-model';
    await handleAiChat(invalid.req, invalid.res, { env: {} });
    assert.equal(invalid.res.statusCode, 400);
    assert.match(invalid.res.output, /AI_PROVIDER_SELECTION_INVALID/);

    const unavailable = createRequestResponse();
    unavailable.req.body.providerPreference = 'deepseek';
    await handleAiChat(unavailable.req, unavailable.res, { env: { DEEPSEEK_API_KEY: '' } });
    assert.equal(unavailable.res.statusCode, 422);
    assert.match(unavailable.res.output, /AI_PROVIDER_NOT_CONFIGURED/);
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
