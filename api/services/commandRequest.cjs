const crypto = require('node:crypto');
const {
    CommandExecutionError,
    IDEMPOTENCY_KEY_RE,
} = require('./commandExecution.cjs');

function firstHeader(value) {
    return String(Array.isArray(value) ? value[0] : value || '').trim();
}

function credentialFingerprint(value) {
    return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function commandActorKey(req) {
    const internalSecret = firstHeader(req.headers?.['x-internal-secret']);
    if (process.env.INTERNAL_SECRET && internalSecret === process.env.INTERNAL_SECRET) {
        return `internal:${credentialFingerprint(internalSecret)}`;
    }
    const sessionToken = String(req.cookies?.token || '');
    if (sessionToken) return `jwt:${credentialFingerprint(sessionToken)}`;
    const role = String(req.user?.role || 'authenticated').trim() || 'authenticated';
    const sessionIssuedAt = Number(req.user?.iat);
    return `user:${role}:${Number.isInteger(sessionIssuedAt) ? sessionIssuedAt : 'shared'}`;
}

function commandContextFromRequest(req, capabilityId) {
    const headerKey = firstHeader(req.headers?.['idempotency-key']);
    const bodyKey = String(req.body?.idempotencyKey || '').trim();
    const clientOperationId = firstHeader(req.headers?.['x-operation-id']);
    const providedKey = headerKey || bodyKey || clientOperationId;
    if (providedKey && !IDEMPOTENCY_KEY_RE.test(providedKey)) {
        throw new CommandExecutionError(
            'idempotency_key_invalid',
            'idempotencyKey 必须为 8-200 位字母、数字或 . _ : / -',
            400
        );
    }
    if (clientOperationId && !IDEMPOTENCY_KEY_RE.test(clientOperationId)) {
        throw new CommandExecutionError(
            'operation_id_invalid',
            'X-Operation-ID 格式无效',
            400
        );
    }

    const operationId = clientOperationId || crypto.randomUUID();
    const idempotencyKey = providedKey || `request:${req.requestId || crypto.randomUUID()}`;
    return {
        actorKey: commandActorKey(req),
        capabilityId,
        idempotencyKey,
        operationId,
        requestId: req.requestId || null,
        warnings: providedKey
            ? []
            : [{
                code: 'idempotency_key_missing_compatibility',
                message: '兼容调用未提供 idempotencyKey；本次请求安全执行，但跨请求重试不受保护',
            }],
    };
}

function sendCommandError(res, error) {
    const statusCode = Number(error?.statusCode) || 500;
    return res.status(statusCode).json({
        success: false,
        code: error?.code || 'command_failed',
        error: error?.message || '命令执行失败',
        requestId: res.req?.requestId || null,
    });
}

module.exports = {
    commandActorKey,
    commandContextFromRequest,
    credentialFingerprint,
    sendCommandError,
};
