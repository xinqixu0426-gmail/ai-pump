const crypto = require('node:crypto');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const { canonicalJson, CommandExecutionError } = require('./commandExecution.cjs');

const DEFAULT_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const MAX_CONFIRMATIONS = 2000;
const confirmations = new Map();

function hash(value) {
    return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function cloneJson(value) {
    return JSON.parse(canonicalJson(value));
}

function confirmationError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function confirmationSubjectHash(subject) {
    const normalized = String(subject || '').trim();
    if (!normalized) {
        throw confirmationError(
            'confirmation_subject_required',
            '无法绑定确认主体，请重新登录后再试',
            401
        );
    }
    return hash(normalized);
}

function cleanupConfirmations(now = Date.now()) {
    for (const [tokenHash, entry] of confirmations) {
        if (entry.expiresAtMs < now) confirmations.delete(tokenHash);
    }
    while (confirmations.size >= MAX_CONFIRMATIONS) {
        const oldest = confirmations.keys().next().value;
        if (!oldest) break;
        confirmations.delete(oldest);
    }
}

function issueBusinessConfirmation({
    capabilityId,
    input,
    subject,
    operationId = crypto.randomUUID(),
    ttlMs = DEFAULT_CONFIRMATION_TTL_MS,
    now = Date.now(),
} = {}) {
    const capability = requireBusinessCapability(capabilityId);
    if (!capability.requiresConfirmation || !capability.supportsPreview) {
        throw confirmationError(
            'confirmation_not_allowed',
            `能力未声明 Preview + Confirmation 协议: ${capabilityId}`,
            400
        );
    }
    cleanupConfirmations(now);
    const confirmationToken = crypto.randomBytes(32).toString('base64url');
    const inputSnapshot = cloneJson(input || {});
    const inputHash = hash(canonicalJson(inputSnapshot));
    const expiresAtMs = now + Math.max(
        30_000,
        Math.min(Number(ttlMs) || DEFAULT_CONFIRMATION_TTL_MS, 15 * 60 * 1000)
    );
    confirmations.set(hash(confirmationToken), {
        capabilityId: capability.capabilityId,
        input: inputSnapshot,
        inputHash,
        operationId: String(operationId),
        subjectHash: confirmationSubjectHash(subject),
        expiresAtMs,
        idempotencyKey: null,
    });
    return {
        confirmationToken,
        operationId: String(operationId),
        inputHash,
        expiresAt: new Date(expiresAtMs).toISOString(),
    };
}

function consumeBusinessConfirmation({
    confirmationToken,
    capabilityId,
    subject,
    idempotencyKey,
    now = Date.now(),
} = {}) {
    const token = String(confirmationToken || '').trim();
    if (!/^[A-Za-z0-9_-]{40,128}$/.test(token)) {
        throw confirmationError(
            'confirmation_token_invalid',
            '确认凭证无效，请先重新预览',
            400
        );
    }
    const tokenHash = hash(token);
    const entry = confirmations.get(tokenHash);
    if (!entry) {
        throw confirmationError(
            'confirmation_token_invalid',
            '确认凭证不存在、已过期或服务已重启，请重新预览',
            409
        );
    }
    if (entry.expiresAtMs < now) {
        confirmations.delete(tokenHash);
        throw confirmationError(
            'confirmation_token_expired',
            '确认凭证已过期，请重新预览',
            409
        );
    }
    if (entry.subjectHash !== confirmationSubjectHash(subject)) {
        throw confirmationError(
            'confirmation_subject_mismatch',
            '确认凭证不属于当前登录会话',
            403
        );
    }
    if (entry.capabilityId !== String(capabilityId || '')) {
        throw confirmationError(
            'confirmation_payload_mismatch',
            '确认能力与当前操作不一致，请重新预览',
            409
        );
    }
    const normalizedIdempotencyKey = String(idempotencyKey || '').trim();
    if (!normalizedIdempotencyKey) {
        throw confirmationError(
            'idempotency_key_required',
            '确认后的执行请求必须提供 idempotencyKey',
            400
        );
    }
    if (entry.idempotencyKey && entry.idempotencyKey !== normalizedIdempotencyKey) {
        throw confirmationError(
            'confirmation_already_bound',
            '确认凭证已绑定另一 idempotencyKey，已拒绝重复副作用',
            409
        );
    }
    entry.idempotencyKey = normalizedIdempotencyKey;
    return {
        capabilityId: entry.capabilityId,
        input: cloneJson(entry.input),
        inputHash: entry.inputHash,
        operationId: entry.operationId,
        idempotencyKey: entry.idempotencyKey,
        expiresAt: new Date(entry.expiresAtMs).toISOString(),
    };
}

function resetBusinessConfirmationsForTests() {
    confirmations.clear();
}

module.exports = {
    DEFAULT_CONFIRMATION_TTL_MS,
    consumeBusinessConfirmation,
    issueBusinessConfirmation,
    resetBusinessConfirmationsForTests,
};
