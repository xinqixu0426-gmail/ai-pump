const test = require('node:test');
const assert = require('node:assert/strict');
const { format, safeMeta } = require('../api/logger.cjs');

test('logger serializes metadata to one line and redacts sensitive fields', () => {
    const serialized = safeMeta({
        requestId: 'request-123',
        password: 'plain',
        nested: { apiKey: 'secret-value', count: 2 },
    });
    assert.doesNotMatch(serialized, /plain|secret-value/);
    assert.match(serialized, /request-123/);
    assert.match(serialized, /\[REDACTED\]/);
    assert.doesNotMatch(serialized, /\r|\n/);
});

test('logger safely records errors and circular metadata', () => {
    const meta = { error: Object.assign(new Error('boom'), { code: 'E_TEST' }) };
    meta.self = meta;
    const serialized = safeMeta(meta);
    assert.match(serialized, /boom/);
    assert.match(serialized, /E_TEST/);
    assert.match(serialized, /\[Circular\]/);
});

test('logger format keeps stable timestamp, scope, level and JSON suffix', () => {
    const line = format('api', 'warn', 'request failed', { requestId: 'request-123' });
    assert.match(line, /^\[[^\]]+\] \[api\] \[WARN\] request failed \{/);
    assert.doesNotMatch(line, /\r|\n/);
});

test('logger keeps oversized metadata as valid bounded JSON', () => {
    const serialized = safeMeta({ value: 'x'.repeat(10000) });
    const parsed = JSON.parse(serialized);
    assert.equal(parsed.truncated, true);
    assert.ok(serialized.length <= 8000);
});
