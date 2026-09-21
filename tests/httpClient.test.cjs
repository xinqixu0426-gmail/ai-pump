const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchWithPolicy } = require('../api/services/httpClient.cjs');

test('HTTP client returns successful response', async () => {
    const response = { status: 200, ok: true };
    const actual = await fetchWithPolicy('https://example.test', {}, {
        fetchImpl: async () => response,
        timeoutMs: 100,
    });
    assert.equal(actual, response);
});

test('HTTP client times out a hung request', async () => {
    const fetchImpl = (url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
    await assert.rejects(
        fetchWithPolicy('https://example.test', {}, {
            fetchImpl,
            timeoutMs: 10,
            label: '测试服务',
        }),
        error => error.code === 'REQUEST_TIMEOUT' && /测试服务请求超时/.test(error.message)
    );
});

test('HTTP client timeout also covers a hung response body', async () => {
    const fetchImpl = async (url, options) => new Response(new ReadableStream({
        start(controller) {
            options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true });
        },
    }), { status: 200 });

    await assert.rejects(
        fetchWithPolicy('https://example.test', {}, {
            fetchImpl,
            timeoutMs: 10,
            label: '响应体测试',
        }),
        error => error.code === 'REQUEST_TIMEOUT'
    );
});

test('HTTP client retries idempotent GET after server error', async () => {
    let calls = 0;
    const response = await fetchWithPolicy('https://example.test', {}, {
        fetchImpl: async () => ({ status: ++calls === 1 ? 503 : 200 }),
        timeoutMs: 100,
        retries: 1,
        retryDelayMs: 0,
        label: '重试测试',
    });
    assert.equal(response.status, 200);
    assert.equal(calls, 2);
});

test('HTTP client does not retry POST', async () => {
    let calls = 0;
    const response = await fetchWithPolicy('https://example.test', { method: 'POST' }, {
        fetchImpl: async () => {
            calls += 1;
            return { status: 503 };
        },
        timeoutMs: 100,
        retries: 2,
    });
    assert.equal(response.status, 503);
    assert.equal(calls, 1);
});
