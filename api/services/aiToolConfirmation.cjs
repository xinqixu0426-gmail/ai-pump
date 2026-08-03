const crypto = require('crypto');
const { getAiCapability } = require('../capabilities/registry.cjs');

const DEFAULT_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const MAX_CONFIRMATIONS = 2000;
const confirmations = new Map();

class AiToolConfirmationError extends Error {
    constructor(code, message, statusCode = 409) {
        super(message);
        this.name = 'AiToolConfirmationError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function hash(value) {
    return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function normalizeJson(value) {
    if (value === undefined) return null;
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(item => normalizeJson(item));

    const normalized = {};
    for (const key of Object.keys(value).sort()) {
        if (value[key] === undefined || typeof value[key] === 'function') continue;
        normalized[key] = normalizeJson(value[key]);
    }
    return normalized;
}

function canonicalJson(value) {
    return JSON.stringify(normalizeJson(value));
}

function cloneJson(value) {
    return JSON.parse(canonicalJson(value));
}

function argsHash(value) {
    return hash(canonicalJson(value));
}

function subjectHash(subject) {
    const normalized = String(subject || '').trim();
    if (!normalized) {
        throw new AiToolConfirmationError(
            'confirmation_subject_required',
            '无法绑定确认主体，请重新登录后再试',
            401
        );
    }
    return hash(normalized);
}

function cleanupConfirmations(now = Date.now()) {
    for (const [tokenHash, entry] of confirmations) {
        const retentionDeadline = entry.status === 'executing'
            ? entry.expiresAtMs + (15 * 60 * 1000)
            : entry.expiresAtMs;
        if (retentionDeadline < now) confirmations.delete(tokenHash);
    }
    while (confirmations.size >= MAX_CONFIRMATIONS) {
        const oldest = [...confirmations.entries()]
            .find(([, entry]) => entry.status !== 'executing')?.[0];
        if (!oldest) break;
        confirmations.delete(oldest);
    }
}

function issueAiToolConfirmation({
    toolName,
    args = {},
    subject,
    ttlMs = DEFAULT_CONFIRMATION_TTL_MS,
    now = Date.now(),
}) {
    const capability = getAiCapability(toolName);
    if (!capability || capability.access !== 'write' || !capability.requiresConfirmation) {
        throw new AiToolConfirmationError(
            'confirmation_not_allowed',
            `能力不允许签发写操作确认: ${toolName}`,
            400
        );
    }

    cleanupConfirmations(now);
    const confirmationToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hash(confirmationToken);
    const argsSnapshot = cloneJson(args || {});
    const expiresAtMs = now + Math.max(30_000, Math.min(Number(ttlMs) || DEFAULT_CONFIRMATION_TTL_MS, 15 * 60 * 1000));
    const resourceVersion = argsSnapshot.expectedVersion ?? argsSnapshot.expectedUpdatedAt ?? null;
    const entry = {
        tokenHash,
        capabilityId: capability.capabilityId,
        toolName,
        args: argsSnapshot,
        argsHash: argsHash(argsSnapshot),
        subjectHash: subjectHash(subject),
        resourceVersion,
        operationId: crypto.randomUUID(),
        issuedAtMs: now,
        expiresAtMs,
        status: 'pending',
        consumedAtMs: null,
        completedAtMs: null,
        receipt: null,
        failure: null,
    };
    confirmations.set(tokenHash, entry);

    return {
        confirmationToken,
        operationId: entry.operationId,
        argsHash: entry.argsHash,
        resourceVersion,
        expiresAt: new Date(expiresAtMs).toISOString(),
    };
}

function getBoundEntry(confirmationToken, subject, now = Date.now(), options = {}) {
    const token = String(confirmationToken || '').trim();
    if (!/^[A-Za-z0-9_-]{40,128}$/.test(token)) {
        throw new AiToolConfirmationError(
            'confirmation_token_invalid',
            '确认凭证无效，请重新发起操作',
            400
        );
    }

    const entry = confirmations.get(hash(token));
    if (!entry) {
        throw new AiToolConfirmationError(
            'confirmation_token_invalid',
            '确认凭证不存在、已过期或服务已重启，请重新发起操作',
            409
        );
    }
    if (entry.expiresAtMs < now && !(options.allowExpiredExecuting && entry.status === 'executing')) {
        confirmations.delete(entry.tokenHash);
        throw new AiToolConfirmationError(
            'confirmation_token_expired',
            '确认凭证已过期，请重新核对并发起操作',
            409
        );
    }
    if (entry.subjectHash !== subjectHash(subject)) {
        throw new AiToolConfirmationError(
            'confirmation_subject_mismatch',
            '确认凭证不属于当前登录会话',
            403
        );
    }
    return entry;
}

function consumeAiToolConfirmation({
    confirmationToken,
    subject,
    expectedToolName,
    expectedArgs,
    now = Date.now(),
}) {
    const entry = getBoundEntry(confirmationToken, subject, now, { allowExpiredExecuting: true });
    if (expectedToolName !== undefined && String(expectedToolName) !== entry.toolName) {
        throw new AiToolConfirmationError(
            'confirmation_payload_mismatch',
            '确认能力与预览内容不一致，请重新发起操作',
            409
        );
    }
    if (expectedArgs !== undefined && argsHash(expectedArgs) !== entry.argsHash) {
        throw new AiToolConfirmationError(
            'confirmation_payload_mismatch',
            '确认参数与预览内容不一致，请重新发起操作',
            409
        );
    }
    if (entry.status === 'completed') {
        return { replay: true, receipt: cloneJson(entry.receipt) };
    }
    if (entry.status === 'failed') {
        throw new AiToolConfirmationError(
            'confirmation_execution_failed',
            entry.failure || '该确认操作已经执行失败，请重新发起',
            409
        );
    }
    if (entry.status === 'executing') {
        throw new AiToolConfirmationError(
            'confirmation_in_progress',
            '该确认操作正在执行，请勿重复提交',
            409
        );
    }

    entry.status = 'executing';
    entry.consumedAtMs = now;
    return {
        replay: false,
        confirmationToken,
        capabilityId: entry.capabilityId,
        toolName: entry.toolName,
        args: cloneJson(entry.args),
        argsHash: entry.argsHash,
        resourceVersion: entry.resourceVersion,
        operationId: entry.operationId,
        issuedAt: new Date(entry.issuedAtMs).toISOString(),
        expiresAt: new Date(entry.expiresAtMs).toISOString(),
    };
}

function completeAiToolConfirmation({
    confirmationToken,
    subject,
    receipt,
    now = Date.now(),
}) {
    const entry = getBoundEntry(confirmationToken, subject, now, { allowExpiredExecuting: true });
    if (entry.status !== 'executing') {
        throw new AiToolConfirmationError(
            'confirmation_state_invalid',
            '确认操作状态无效',
            409
        );
    }
    entry.status = 'completed';
    entry.completedAtMs = now;
    entry.receipt = cloneJson(receipt);
    return cloneJson(entry.receipt);
}

function failAiToolConfirmation({
    confirmationToken,
    subject,
    error,
    now = Date.now(),
}) {
    const entry = getBoundEntry(confirmationToken, subject, now, { allowExpiredExecuting: true });
    if (entry.status === 'executing') {
        entry.status = 'failed';
        entry.completedAtMs = now;
        entry.failure = String(error?.message || error || '确认操作执行失败').slice(0, 500);
    }
}

function confirmationSubjectForRequest(req) {
    const configuredInternalSecret = String(process.env.INTERNAL_SECRET || '');
    const suppliedInternalSecret = String(req?.headers?.['x-internal-secret'] || '');
    if (configuredInternalSecret && suppliedInternalSecret === configuredInternalSecret) {
        return `internal:${hash(configuredInternalSecret)}`;
    }
    const sessionToken = String(req?.cookies?.token || '');
    if (sessionToken) return `jwt:${hash(sessionToken)}`;
    const role = String(req?.user?.role || 'unknown');
    const issuedAt = String(req?.user?.iat || 'unknown');
    return `authenticated:${role}:${issuedAt}`;
}

function confirmationSubjectForChannel(channel, credential = '') {
    return `channel:${String(channel || 'unknown')}:${hash(String(credential || 'development'))}`;
}

function resetAiToolConfirmationsForTests() {
    confirmations.clear();
}

module.exports = {
    AiToolConfirmationError,
    DEFAULT_CONFIRMATION_TTL_MS,
    argsHash,
    completeAiToolConfirmation,
    confirmationSubjectForChannel,
    confirmationSubjectForRequest,
    consumeAiToolConfirmation,
    failAiToolConfirmation,
    issueAiToolConfirmation,
    resetAiToolConfirmationsForTests,
};
