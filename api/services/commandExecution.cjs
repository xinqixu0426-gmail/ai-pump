const crypto = require('node:crypto');
const { getBusinessCapability } = require('../capabilities/registry.cjs');

const DEFAULT_OPERATION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const IDEMPOTENCY_KEY_RE = /^[a-zA-Z0-9._:/-]{8,200}$/;

class CommandExecutionError extends Error {
    constructor(code, message, statusCode = 409) {
        super(message);
        this.name = 'CommandExecutionError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function normalizeJson(value) {
    if (value === undefined) return null;
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(item => normalizeJson(item));
    const result = {};
    for (const key of Object.keys(value).sort()) {
        if (value[key] === undefined || typeof value[key] === 'function') continue;
        result[key] = normalizeJson(value[key]);
    }
    return result;
}

function canonicalJson(value) {
    return JSON.stringify(normalizeJson(value));
}

function requestHash(input) {
    return crypto.createHash('sha256').update(canonicalJson(input), 'utf8').digest('hex');
}

function parseStoredReceipt(value) {
    try {
        const parsed = JSON.parse(value || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        return parsed;
    } catch {
        throw new CommandExecutionError(
            'operation_receipt_corrupt',
            '命令已执行，但持久化回执损坏，请停止重试并核对业务数据',
            500
        );
    }
}

function executePersistentCommand({
    db,
    capabilityId,
    actorKey,
    idempotencyKey,
    operationId,
    requestId = null,
    input,
    execute,
    businessChange = null,
    requestKnowledgeSync = null,
    warnings = [],
    now = new Date(),
    retentionMs = DEFAULT_OPERATION_RETENTION_MS,
} = {}) {
    if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
        throw new Error('持久化命令缺少数据库依赖');
    }
    if (!String(capabilityId || '').trim()) throw new Error('持久化命令缺少 capabilityId');
    if (!String(actorKey || '').trim()) throw new Error('持久化命令缺少 actorKey');
    if (!IDEMPOTENCY_KEY_RE.test(String(idempotencyKey || ''))) {
        throw new CommandExecutionError(
            'idempotency_key_invalid',
            'idempotencyKey 必须为 8-200 位字母、数字或 . _ : / -',
            400
        );
    }
    if (typeof execute !== 'function') throw new Error('持久化命令缺少 execute');

    const normalizedCapabilityId = String(capabilityId).trim();
    const normalizedActorKey = String(actorKey).trim();
    const normalizedIdempotencyKey = String(idempotencyKey);
    const normalizedOperationId = String(operationId || crypto.randomUUID());
    const hash = requestHash(input);
    const startedAt = new Date(now).toISOString();
    const expiresAt = new Date(new Date(now).getTime() + retentionMs).toISOString();

    const run = db.transaction(() => {
        db.prepare('DELETE FROM api_operations WHERE expires_at <= ?').run(startedAt);
        const existing = db.prepare(`
            SELECT request_hash, status, response_json
            FROM api_operations
            WHERE actor_key = ? AND capability_id = ? AND idempotency_key = ?
        `).get(normalizedActorKey, normalizedCapabilityId, normalizedIdempotencyKey);
        if (existing) {
            if (existing.request_hash !== hash) {
                throw new CommandExecutionError(
                    'idempotency_key_conflict',
                    '同一 idempotencyKey 已用于不同请求，已拒绝执行',
                    409
                );
            }
            if (existing.status !== 'completed') {
                throw new CommandExecutionError(
                    'operation_in_progress',
                    '相同命令正在执行，请稍后使用同一 idempotencyKey 重试',
                    409
                );
            }
            return {
                ...parseStoredReceipt(existing.response_json),
                idempotentReplay: true,
            };
        }

        db.prepare(`
            INSERT INTO api_operations (
                operation_id, capability_id, actor_key, idempotency_key,
                request_hash, request_id, status, response_json,
                created_at, completed_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, NULL, ?)
        `).run(
            normalizedOperationId,
            normalizedCapabilityId,
            normalizedActorKey,
            normalizedIdempotencyKey,
            hash,
            requestId || null,
            startedAt,
            expiresAt
        );

        const auditContext = {
            requireAudit: true,
            user: normalizedActorKey,
            requestId: requestId || null,
            operationId: normalizedOperationId,
            capabilityId: normalizedCapabilityId,
        };
        const outcome = execute({
            auditContext,
            operationId: normalizedOperationId,
        }) || {};
        const auditIds = [...new Set(
            (outcome.auditIds || []).map(Number).filter(id => Number.isInteger(id) && id > 0)
        )];
        const changes = Array.isArray(outcome.changes) ? outcome.changes : [];
        const requiredAuditCount = Number.isInteger(outcome.requiredAuditCount)
            ? Math.max(0, outcome.requiredAuditCount)
            : (changes.length > 0 ? 1 : 0);
        if (auditIds.length < requiredAuditCount) {
            throw new CommandExecutionError(
                'strong_audit_required',
                '命令产生了业务变更但强审计记录不完整，已整体回滚',
                500
            );
        }
        const completedAt = new Date(now).toISOString();
        const businessChangeDescriptor = typeof businessChange === 'function'
            ? businessChange(outcome)
            : businessChange;
        const formalCapability = getBusinessCapability(normalizedCapabilityId);
        if (
            changes.length > 0
            && formalCapability?.recordsBusinessChange === true
            && !businessChangeDescriptor
        ) {
            throw new CommandExecutionError(
                'business_change_descriptor_required',
                '正式业务命令产生了变更但没有声明业务变更事件，已整体回滚',
                500
            );
        }
        let businessChangeEvent = null;
        if (changes.length > 0 && businessChangeDescriptor) {
            const { recordBusinessChangeEvent } = require('./businessChanges.cjs');
            businessChangeEvent = recordBusinessChangeEvent(db, {
                operationId: normalizedOperationId,
                capabilityId: normalizedCapabilityId,
                actorKey: normalizedActorKey,
                changes,
                auditIds,
                descriptor: businessChangeDescriptor,
                occurredAt: completedAt,
            });
        }
        const receipt = {
            ...(outcome.data && typeof outcome.data === 'object' ? outcome.data : {}),
            operationId: normalizedOperationId,
            capabilityId: normalizedCapabilityId,
            status: 'completed',
            resource: outcome.resource || null,
            changes,
            warnings: [...warnings, ...(Array.isArray(outcome.warnings) ? outcome.warnings : [])],
            auditId: auditIds[0] || null,
            auditIds,
            ...(businessChangeEvent ? { businessChangeEvent } : {}),
            idempotentReplay: false,
            completedAt,
        };
        db.prepare(`
            UPDATE api_operations
            SET status = 'completed', response_json = ?, completed_at = ?
            WHERE actor_key = ? AND capability_id = ? AND idempotency_key = ?
        `).run(
            JSON.stringify(receipt),
            completedAt,
            normalizedActorKey,
            normalizedCapabilityId,
            normalizedIdempotencyKey
        );
        return receipt;
    });

    const receipt = run.immediate();
    if (receipt?.businessChangeEvent && !receipt.idempotentReplay) {
        try {
            const requestSync = typeof requestKnowledgeSync === 'function'
                ? requestKnowledgeSync
                : require('./knowledgeAutoSync.cjs').requestAutoKnowledgeSync;
            requestSync({
                sourceTable: 'business_change_events',
                sourceId: receipt.businessChangeEvent.id,
                reason: 'command_completed',
            });
        } catch {
            // 业务事件已经原子提交；知识投影由后台健康检查和下次全量同步补偿。
        }
    }
    return receipt;
}

function beginPersistentExternalCommand({
    db,
    capabilityId,
    actorKey,
    idempotencyKey,
    operationId,
    requestId = null,
    input,
    execute,
    warnings = [],
    now = new Date(),
    retentionMs = DEFAULT_OPERATION_RETENTION_MS,
} = {}) {
    if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
        throw new Error('外部命令缺少数据库依赖');
    }
    if (!String(capabilityId || '').trim()) throw new Error('外部命令缺少 capabilityId');
    if (!String(actorKey || '').trim()) throw new Error('外部命令缺少 actorKey');
    if (!IDEMPOTENCY_KEY_RE.test(String(idempotencyKey || ''))) {
        throw new CommandExecutionError(
            'idempotency_key_invalid',
            'idempotencyKey 必须为 8-200 位字母、数字或 . _ : / -',
            400
        );
    }
    if (typeof execute !== 'function') throw new Error('外部命令缺少 execute');

    const normalizedCapabilityId = String(capabilityId).trim();
    const normalizedActorKey = String(actorKey).trim();
    const normalizedIdempotencyKey = String(idempotencyKey);
    const normalizedOperationId = String(operationId || crypto.randomUUID());
    const hash = requestHash(input);
    const startedAt = new Date(now).toISOString();
    const expiresAt = new Date(new Date(now).getTime() + retentionMs).toISOString();

    const run = db.transaction(() => {
        db.prepare('DELETE FROM api_operations WHERE expires_at <= ?').run(startedAt);
        const existing = db.prepare(`
            SELECT request_hash, response_json
            FROM api_operations
            WHERE actor_key = ? AND capability_id = ? AND idempotency_key = ?
        `).get(normalizedActorKey, normalizedCapabilityId, normalizedIdempotencyKey);
        if (existing) {
            if (existing.request_hash !== hash) {
                throw new CommandExecutionError(
                    'idempotency_key_conflict',
                    '同一 idempotencyKey 已用于不同请求，已拒绝执行',
                    409
                );
            }
            if (!existing.response_json) {
                throw new CommandExecutionError(
                    'operation_in_progress',
                    '相同外部命令正在登记，请稍后使用同一 idempotencyKey 重试',
                    409
                );
            }
            return {
                shouldExecute: false,
                receipt: {
                    ...parseStoredReceipt(existing.response_json),
                    idempotentReplay: true,
                },
            };
        }

        db.prepare(`
            INSERT INTO api_operations (
                operation_id, capability_id, actor_key, idempotency_key,
                request_hash, request_id, status, response_json,
                created_at, completed_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, NULL, ?)
        `).run(
            normalizedOperationId,
            normalizedCapabilityId,
            normalizedActorKey,
            normalizedIdempotencyKey,
            hash,
            requestId || null,
            startedAt,
            expiresAt
        );

        const auditContext = {
            requireAudit: true,
            user: normalizedActorKey,
            requestId: requestId || null,
            operationId: normalizedOperationId,
            capabilityId: normalizedCapabilityId,
        };
        const outcome = execute({
            auditContext,
            operationId: normalizedOperationId,
        }) || {};
        const auditIds = [...new Set(
            (outcome.auditIds || []).map(Number).filter(id => Number.isInteger(id) && id > 0)
        )];
        const changes = Array.isArray(outcome.changes) ? outcome.changes : [];
        const requiredAuditCount = Number.isInteger(outcome.requiredAuditCount)
            ? Math.max(0, outcome.requiredAuditCount)
            : (changes.length > 0 ? 1 : 0);
        if (auditIds.length < requiredAuditCount) {
            throw new CommandExecutionError(
                'strong_audit_required',
                '外部命令登记产生了业务变更但强审计记录不完整，已整体回滚',
                500
            );
        }
        const receipt = {
            ...(outcome.data && typeof outcome.data === 'object' ? outcome.data : {}),
            operationId: normalizedOperationId,
            capabilityId: normalizedCapabilityId,
            status: 'accepted',
            resource: outcome.resource || null,
            changes,
            warnings: [...warnings, ...(Array.isArray(outcome.warnings) ? outcome.warnings : [])],
            auditId: auditIds[0] || null,
            auditIds,
            idempotentReplay: false,
            acceptedAt: startedAt,
            completedAt: null,
        };
        db.prepare(`
            UPDATE api_operations
            SET response_json = ?
            WHERE operation_id = ?
        `).run(JSON.stringify(receipt), normalizedOperationId);
        return { shouldExecute: true, receipt };
    });

    return run.immediate();
}

function updatePersistentExternalCommand({
    db,
    operationId,
    status,
    data = {},
    terminal = false,
    now = new Date(),
} = {}) {
    const normalizedOperationId = String(operationId || '').trim();
    if (!normalizedOperationId) throw new Error('更新外部命令缺少 operationId');
    const row = db.prepare(
        'SELECT response_json FROM api_operations WHERE operation_id = ?'
    ).get(normalizedOperationId);
    if (!row) {
        throw new CommandExecutionError(
            'operation_not_found',
            '找不到外部命令执行记录',
            404
        );
    }
    const stored = parseStoredReceipt(row.response_json);
    const completedAt = terminal ? new Date(now).toISOString() : null;
    const receipt = {
        ...stored,
        ...(data && typeof data === 'object' ? data : {}),
        status: String(status || stored.status || 'processing'),
        completedAt: completedAt || stored.completedAt || null,
    };
    db.prepare(`
        UPDATE api_operations
        SET status = ?, response_json = ?, completed_at = ?
        WHERE operation_id = ?
    `).run(
        terminal ? 'completed' : 'pending',
        JSON.stringify(receipt),
        completedAt,
        normalizedOperationId
    );
    return receipt;
}

module.exports = {
    CommandExecutionError,
    DEFAULT_OPERATION_RETENTION_MS,
    IDEMPOTENCY_KEY_RE,
    beginPersistentExternalCommand,
    canonicalJson,
    executePersistentCommand,
    requestHash,
    updatePersistentExternalCommand,
};
