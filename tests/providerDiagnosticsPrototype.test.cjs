'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchProviderWithRetry } = require('../api/services/aiProvider.cjs');
const { classifyFailure, sanitizeValue, serializeError } = require('../scripts/ai-experiments/business-policy-intent/providerDiagnostics.cjs');

test('provider diagnostics preserves nested network code, syscall, hostname, and redacts secrets', () => {
    const root = new Error('fetch failed');
    root.name = 'TypeError';
    root.cause = Object.assign(new Error('getaddrinfo ENOTFOUND api.deepseek.com'), { code: 'ENOTFOUND', errno: 'ENOTFOUND', syscall: 'getaddrinfo', hostname: 'api.deepseek.com' });
    const wrapped = Object.assign(new Error('DeepSeek network failed Bearer secret-value'), { code: 'AI_PROVIDER_NETWORK_ERROR', details: { provider: 'deepseek', causeCode: 'ENOTFOUND', apiKey: 'secret-value' }, cause: root });
    const output = serializeError(wrapped);
    assert.equal(output.code, 'AI_PROVIDER_NETWORK_ERROR');
    assert.equal(output.details.causeCode, 'ENOTFOUND');
    assert.equal(output.cause.cause.hostname, 'api.deepseek.com');
    assert.equal(output.cause.cause.syscall, 'getaddrinfo');
    assert.doesNotMatch(JSON.stringify(output), /secret-value/);
    assert.match(sanitizeValue('http://user:password@proxy.example:8080'), /REDACTED/);
});

test('provider retry evidence observes all retry attempts without changing retry behavior', async () => {
    const retries = [];
    const failure = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('DNS'), { code: 'ENOTFOUND' }) });
    await assert.rejects(() => fetchProviderWithRetry('https://api.deepseek.com/test', {}, {
        config: { provider: 'deepseek', displayName: 'DeepSeek' }, maxAttempts: 3, retryDelayMs: 0,
        fetchImpl: async () => { throw failure; }, onRetry: item => retries.push(item),
    }), error => error.code === 'AI_PROVIDER_NETWORK_ERROR');
    assert.deepEqual(retries.map(item => item.attempt), [1, 2]);
    assert.equal(retries[0].causeCode, 'ENOTFOUND');
});

test('failure classification identifies DNS evidence before application semantics', () => {
    assert.equal(classifyFailure({ dns: { lookup: { status: 'FAIL', error: { code: 'ENOTFOUND' } } }, https: {}, minimalCall: {} }), 'DNS_RESOLUTION_FAILURE');
});
