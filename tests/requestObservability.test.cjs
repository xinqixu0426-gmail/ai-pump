const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
    createRequestObservability,
    normalizeRequestId,
} = require('../api/services/requestObservability.cjs');

function responseFixture(statusCode = 200) {
    const response = new EventEmitter();
    response.statusCode = statusCode;
    response.headers = {};
    response.setHeader = (name, value) => {
        response.headers[name] = value;
    };
    return response;
}

test('request observability accepts safe caller ID and rejects malformed values', () => {
    assert.equal(normalizeRequestId('caller-request-123'), 'caller-request-123');
    assert.match(normalizeRequestId('bad id with spaces'), /^[0-9a-f-]{36}$/);
});

test('request observability returns request ID and logs duration without query/body', () => {
    const calls = [];
    const logger = {
        info: (message, meta) => calls.push({ level: 'info', message, meta }),
        warn: (message, meta) => calls.push({ level: 'warn', message, meta }),
        error: (message, meta) => calls.push({ level: 'error', message, meta }),
    };
    const times = [1000000n, 6500000n];
    const middleware = createRequestObservability({
        logger,
        now: () => times.shift(),
    });
    const req = {
        headers: { 'x-request-id': 'caller-request-123' },
        method: 'GET',
        path: '/api/orders',
        originalUrl: '/api/orders?customer=private',
        body: { password: 'private' },
    };
    const res = responseFixture(200);
    let nextCalled = false;

    middleware(req, res, () => {
        nextCalled = true;
    });
    res.emit('finish');

    assert.equal(nextCalled, true);
    assert.equal(req.requestId, 'caller-request-123');
    assert.equal(res.headers['X-Request-ID'], 'caller-request-123');
    assert.deepEqual(calls, [{
        level: 'info',
        message: '请求完成',
        meta: {
            requestId: 'caller-request-123',
            method: 'GET',
            path: '/api/orders',
            statusCode: 200,
            durationMs: 5.5,
        },
    }]);
});

test('request observability raises log level and skips liveness noise', () => {
    const levels = [];
    const logger = {
        info: () => levels.push('info'),
        warn: () => levels.push('warn'),
        error: () => levels.push('error'),
    };
    const middleware = createRequestObservability({ logger, now: () => 1n });

    const failed = { headers: {}, method: 'GET', path: '/api/fail' };
    const failedRes = responseFixture(503);
    middleware(failed, failedRes, () => {});
    failedRes.emit('finish');

    const live = { headers: {}, method: 'GET', path: '/api/health/live' };
    const liveRes = responseFixture(200);
    middleware(live, liveRes, () => {});
    liveRes.emit('finish');

    assert.deepEqual(levels, ['error']);
});

test('request observability treats expected startup readiness 503 as warning', () => {
    const levels = [];
    const middleware = createRequestObservability({
        logger: {
            info: () => levels.push('info'),
            warn: () => levels.push('warn'),
            error: () => levels.push('error'),
        },
        now: () => 1n,
    });
    const req = {
        headers: {},
        method: 'GET',
        path: '/api/health/ready',
        originalUrl: '/api/health/ready',
    };
    const res = responseFixture(503);
    middleware(req, res, () => {});
    res.emit('finish');
    assert.deepEqual(levels, ['warn']);
});
