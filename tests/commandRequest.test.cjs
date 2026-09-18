const test = require('node:test');
const assert = require('node:assert/strict');
const {
    commandContextFromRequest,
    credentialFingerprint,
    sendCommandError,
} = require('../api/services/commandRequest.cjs');
const { CommandExecutionError } = require('../api/services/commandExecution.cjs');

test('命令请求：显式幂等键和 operationId 原样进入命令上下文', () => {
    const context = commandContextFromRequest({
        headers: {
            'idempotency-key': 'inventory:test:request-1',
            'x-operation-id': 'operation:test:request-1',
        },
        body: {},
        requestId: 'request-1',
        user: { role: 'admin', iat: 123 },
    }, 'inventory.parts.batch_adjust_stock');

    assert.equal(context.idempotencyKey, 'inventory:test:request-1');
    assert.equal(context.operationId, 'operation:test:request-1');
    assert.equal(context.actorKey, 'user:admin:123');
    assert.deepEqual(context.warnings, []);
});

test('命令请求：旧调用仍可执行但明确返回跨请求重试未保护警告', () => {
    const context = commandContextFromRequest({
        headers: {},
        body: {},
        requestId: 'request-legacy',
        user: { role: 'admin', iat: 123 },
    }, 'inventory.coils.adjust_stock');

    assert.equal(context.idempotencyKey, 'request:request-legacy');
    assert.equal(context.warnings[0].code, 'idempotency_key_missing_compatibility');
});

test('命令请求：浏览器主体使用 JWT 指纹且不保存原始凭据', () => {
    const context = commandContextFromRequest({
        headers: { 'idempotency-key': 'inventory:test:jwt-session' },
        cookies: { token: 'signed.jwt.value' },
        body: {},
        requestId: 'request-jwt',
        user: { role: 'admin', iat: 123 },
    }, 'inventory.parts.batch_adjust_stock');

    assert.equal(context.actorKey, `jwt:${credentialFingerprint('signed.jwt.value')}`);
    assert.doesNotMatch(context.actorKey, /signed\.jwt\.value/);
});

test('命令错误：已分类的业务错误保留状态码，未知异常返回 500', () => {
    function response() {
        return {
            req: { requestId: 'request-error' },
            statusCode: null,
            body: null,
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(body) {
                this.body = body;
                return this;
            },
        };
    }

    const businessResponse = response();
    sendCommandError(
        businessResponse,
        new CommandExecutionError('resource_version_conflict', '版本冲突', 409)
    );
    assert.equal(businessResponse.statusCode, 409);
    assert.equal(businessResponse.body.code, 'resource_version_conflict');
    assert.equal(businessResponse.body.requestId, 'request-error');

    const unexpectedResponse = response();
    sendCommandError(unexpectedResponse, new Error('database failed'));
    assert.equal(unexpectedResponse.statusCode, 500);
    assert.equal(unexpectedResponse.body.code, 'command_failed');
});
