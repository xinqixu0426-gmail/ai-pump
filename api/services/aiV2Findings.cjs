const CATEGORIES = new Set([
    'intent_understanding', 'api_capability_design', 'over_investigation',
    'missing_capability', 'data_model', 'answer_presentation', 'performance',
    'stability', 'other',
]);
const STATUSES = new Set(['open', 'reviewed', 'promoted', 'dismissed']);
const SNAPSHOT_MAX_BYTES = 24_000;
const FORBIDDEN_KEY = /(authorization|cookie|api.?key|secret|password|credential|token)/i;

function loadDbAccessors() {
    return require('../db.cjs');
}

function normalizeOwnerKey(value) {
    return String(value || 'admin').trim().slice(0, 80) || 'admin';
}

function positiveId(value, label) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${label}不合法`);
    return id;
}

function boundedText(value, max, label, { optional = false } = {}) {
    if (value === undefined && optional) return undefined;
    if (value === null && optional) return null;
    if (typeof value !== 'string') throw new Error(`${label}必须是文本`);
    const text = value.trim();
    if (text.length > max) throw new Error(`${label}不能超过 ${max} 个字符`);
    return text;
}

function parseMetadata(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        throw new Error('AI 运行元数据格式无效，无法安全保存 V2 证据');
    }
}

function copyScalar(value, maxString = 240) {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') return value.slice(0, maxString);
    return undefined;
}

function pickScalars(source, keys) {
    const result = {};
    if (!source || typeof source !== 'object' || Array.isArray(source)) return result;
    for (const key of keys) {
        if (!Object.hasOwn(source, key) || FORBIDDEN_KEY.test(key)) continue;
        const value = copyScalar(source[key]);
        if (value !== undefined) result[key] = value;
    }
    return result;
}

function safeStringList(value, limit = 30) {
    return (Array.isArray(value) ? value : [])
        .filter(item => typeof item === 'string')
        .slice(0, limit)
        .map(item => item.slice(0, 160));
}

function safePlan(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return {
        summary: typeof value.summary === 'string' ? value.summary.slice(0, 500) : '',
        steps: (Array.isArray(value.steps) ? value.steps : []).slice(0, 30).map(step => ({
            capabilityId: typeof step?.capabilityId === 'string' ? step.capabilityId.slice(0, 120) : undefined,
            name: typeof step?.name === 'string' ? step.name.slice(0, 120) : undefined,
            status: typeof step?.status === 'string' ? step.status.slice(0, 60) : undefined,
        })),
    };
}

function safeToolCalls(value) {
    return (Array.isArray(value) ? value : []).slice(0, 40).map(call => {
        const args = call?.args && typeof call.args === 'object' && !Array.isArray(call.args) ? call.args : {};
        return {
            name: typeof call?.name === 'string' ? call.name.slice(0, 120) : '',
            argumentNames: Object.keys(args).filter(key => !FORBIDDEN_KEY.test(key)).slice(0, 30),
        };
    });
}

function safeProvenance(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return pickScalars(value, [
        'kind', 'label', 'fetchedAt', 'checkedAt', 'hasPendingSources', 'sourceTable',
        'sourceId', 'sourceUpdatedAt', 'freshness',
    ]);
}

function safeToolResults(value) {
    return (Array.isArray(value) ? value : []).slice(0, 40).map(item => {
        const result = item?.result && typeof item.result === 'object' && !Array.isArray(item.result)
            ? item.result
            : {};
        const projected = pickScalars(result, [
            'success', 'verified', 'capabilityId', 'status', 'operationStatus',
            'returnedCount', 'totalCount', 'count', 'truncated', 'possiblyTruncated',
            'complete', 'isComplete', 'resultCount', 'errorCode',
        ]);
        const provenance = safeProvenance(result.provenance);
        if (provenance) projected.provenance = provenance;
        const data = result.data && typeof result.data === 'object' && !Array.isArray(result.data)
            ? result.data
            : null;
        if (data) {
            projected.dataKeys = Object.keys(data).filter(key => !FORBIDDEN_KEY.test(key)).slice(0, 50);
            for (const key of ['returnedCount', 'totalCount', 'count', 'truncated', 'possiblyTruncated', 'complete']) {
                const scalar = copyScalar(data[key]);
                if (scalar !== undefined && projected[key] === undefined) projected[key] = scalar;
            }
        }
        return {
            name: typeof item?.name === 'string' ? item.name.slice(0, 120) : '',
            result: projected,
        };
    });
}

function assertNoSensitiveKeys(value, path = 'runtimeSnapshot') {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
        if (FORBIDDEN_KEY.test(key)) throw new Error(`运行快照含有禁止字段: ${path}.${key}`);
        if (typeof item === 'string' && /(?:Bearer\s+[A-Za-z0-9._~+/-]{12,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/i.test(item)) {
            throw new Error(`运行快照含有疑似凭据: ${path}.${key}`);
        }
        assertNoSensitiveKeys(item, `${path}.${key}`);
    }
}

function sanitizeRuntimeSnapshot(metadataJson) {
    const metadata = parseMetadata(metadataJson);
    const metricsSource = metadata.metrics && typeof metadata.metrics === 'object' ? metadata.metrics : {};
    const metrics = pickScalars(metricsSource, [
        'durationMs', 'firstContentMs', 'modelDurationMs', 'toolDurationMs',
        'modelRequestCount', 'toolCallCount', 'tokensPerSecond', 'exposedToolCount',
        'ontologyResolutionCount', 'factCount', 'goalCount', 'validatorResult',
        'policyVersion', 'routeClass', 'judgeUsed', 'writeProposalCreated', 'writeExecuted',
    ]);
    if (metricsSource.usage && typeof metricsSource.usage === 'object') {
        metrics.usage = pickScalars(metricsSource.usage, ['promptTokens', 'completionTokens', 'totalTokens']);
    }
    const selectedDomains = safeStringList(metadata.selectedDomains || metricsSource.selectedDomains);
    const selectedCapabilities = safeStringList(metadata.selectedCapabilities || metricsSource.selectedCapabilities);
    const snapshot = {
        schemaVersion: 1,
        provider: pickScalars(metadata.provider, ['provider', 'displayName', 'model', 'routeReason', 'fallback', 'fallbackFrom']),
        metrics,
        selectedDomains,
        selectedCapabilities,
        toolPlan: safePlan(metadata.toolPlan),
        toolCalls: safeToolCalls(metadata.toolCalls),
        toolResults: safeToolResults(metadata.toolResults),
        validatorResult: copyScalar(metadata.validatorResult ?? metricsSource.validatorResult),
        referenceEntities: (Array.isArray(metadata.referenceEntities) ? metadata.referenceEntities : [])
            .slice(0, 30)
            .map(entity => pickScalars(entity, ['entityType', 'canonicalName'])),
        goalStatuses: safeStringList(metadata.goalStatuses || metricsSource.goalStatuses),
        policyVersion: copyScalar(metadata.policyVersion ?? metricsSource.policyVersion),
        runtimeVersion: copyScalar(metadata.runtimeVersion),
        runtimeId: copyScalar(metadata.runtimeId),
    };
    assertNoSensitiveKeys(snapshot);
    const serialized = JSON.stringify(snapshot);
    if (Buffer.byteLength(serialized, 'utf8') > SNAPSHOT_MAX_BYTES) {
        throw new Error('脱敏后的 AI 运行快照超过安全上限');
    }
    return snapshot;
}

function toView(row) {
    if (!row) return null;
    const runtimeSnapshot = typeof row.runtime_snapshot_json === 'string'
        ? JSON.parse(row.runtime_snapshot_json)
        : row.runtime_snapshot_json;
    return {
        id: Number(row.id),
        ownerKey: row.owner_key,
        conversationId: Number(row.conversation_id),
        userMessageId: Number(row.user_message_id),
        assistantMessageId: Number(row.assistant_message_id),
        category: row.category || null,
        note: row.note || '',
        questionText: row.question_text,
        answerText: row.answer_text,
        runtimeSnapshot,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        conversationDeleted: Boolean(row.conversation_deleted_at),
    };
}

function messageForOwner(db, ownerKey, messageId) {
    return db.prepare(`
        SELECT message.*, conversation.owner_key, conversation.deleted_at
        FROM ai_conversation_messages AS message
        JOIN ai_conversations AS conversation ON conversation.id = message.conversation_id
        WHERE message.id = ? AND message.role = 'assistant'
          AND conversation.owner_key = ? AND conversation.deleted_at IS NULL
    `).get(messageId, normalizeOwnerKey(ownerKey));
}

function saveV2Finding(ownerKey, input = {}, options = {}) {
    const dbAccessors = options.dbAccessors || loadDbAccessors();
    const { db, safeInsert, safeUpdate } = dbAccessors;
    const allowed = new Set(['assistantMessageId', 'category', 'note']);
    if (Object.keys(input).some(key => !allowed.has(key))) throw new Error('V2 记录只接受 assistantMessageId、category、note');
    const messageId = positiveId(input.assistantMessageId, '助手消息ID');
    const category = Object.hasOwn(input, 'category') && input.category !== null
        ? String(input.category)
        : undefined;
    if (category !== undefined && !CATEGORIES.has(category)) throw new Error('V2 记录分类不合法');
    const note = Object.hasOwn(input, 'note') ? boundedText(input.note, 2000, '补充说明') : undefined;
    const message = messageForOwner(db, ownerKey, messageId);
    if (!message) return null;
    const question = db.prepare(`
        SELECT id, content FROM ai_conversation_messages
        WHERE conversation_id = ? AND role = 'user' AND id < ?
        ORDER BY id DESC LIMIT 1
    `).get(message.conversation_id, message.id);
    if (!question) throw new Error('找不到这条回答对应的用户问题');
    const questionText = String(question.content || '').slice(0, 100000);
    const answerText = String(message.content || '').slice(0, 100000);
    if (!answerText.trim()) throw new Error('空回答不能记录给 V2');
    const runtimeSnapshot = sanitizeRuntimeSnapshot(message.metadata_json);
    const now = new Date().toISOString();
    const owner = normalizeOwnerKey(ownerKey);
    const save = db.transaction(() => {
        const existing = db.prepare(`
            SELECT * FROM ai_v2_findings
            WHERE owner_key = ? AND assistant_message_id = ?
        `).get(owner, message.id);
        let id;
        if (existing) {
            const updates = {
                category: category === undefined ? existing.category : category,
                note: note === undefined ? existing.note : note,
                question_text: questionText,
                answer_text: answerText,
                runtime_snapshot_json: JSON.stringify(runtimeSnapshot),
                updated_at: now,
            };
            const write = safeUpdate('ai_v2_findings', existing.id, updates, options.auditContext || {});
            options.onWrite?.(write);
            id = existing.id;
        } else {
            const write = safeInsert('ai_v2_findings', {
                owner_key: owner,
                conversation_id: message.conversation_id,
                user_message_id: question.id,
                assistant_message_id: message.id,
                category: category ?? null,
                note: note ?? '',
                question_text: questionText,
                answer_text: answerText,
                runtime_snapshot_json: JSON.stringify(runtimeSnapshot),
                status: 'open',
                created_at: now,
                updated_at: now,
            }, options.auditContext || {});
            options.onWrite?.(write);
            id = Number(write.lastInsertRowid);
        }
        return toView(db.prepare(`
            SELECT finding.*, conversation.deleted_at AS conversation_deleted_at
            FROM ai_v2_findings AS finding
            LEFT JOIN ai_conversations AS conversation ON conversation.id = finding.conversation_id
            WHERE finding.id = ? AND finding.owner_key = ?
        `).get(id, owner));
    });
    return save();
}

function listV2Findings(ownerKey, filters = {}, options = {}) {
    const { db } = options.dbAccessors || loadDbAccessors();
    const clauses = ['finding.owner_key = ?'];
    const params = [normalizeOwnerKey(ownerKey)];
    if (filters.status) {
        if (!STATUSES.has(String(filters.status))) throw new Error('V2 记录状态不合法');
        clauses.push('finding.status = ?');
        params.push(String(filters.status));
    }
    if (filters.category) {
        if (!CATEGORIES.has(String(filters.category))) throw new Error('V2 记录分类不合法');
        clauses.push('finding.category = ?');
        params.push(String(filters.category));
    }
    if (filters.conversationId !== undefined && filters.conversationId !== '') {
        clauses.push('finding.conversation_id = ?');
        params.push(positiveId(filters.conversationId, '会话ID'));
    }
    const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 100);
    const rows = db.prepare(`
        SELECT finding.*, conversation.deleted_at AS conversation_deleted_at
        FROM ai_v2_findings AS finding
        LEFT JOIN ai_conversations AS conversation ON conversation.id = finding.conversation_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY finding.created_at DESC, finding.id DESC
        LIMIT ?
    `).all(...params, limit);
    return { items: rows.map(toView), limit };
}

function getV2FindingDetail(ownerKey, id, options = {}) {
    const { db } = options.dbAccessors || loadDbAccessors();
    const findingId = positiveId(id, 'V2 记录ID');
    const row = db.prepare(`
        SELECT finding.*, conversation.deleted_at AS conversation_deleted_at
        FROM ai_v2_findings AS finding
        LEFT JOIN ai_conversations AS conversation ON conversation.id = finding.conversation_id
        WHERE finding.id = ? AND finding.owner_key = ?
    `).get(findingId, normalizeOwnerKey(ownerKey));
    return toView(row);
}

function updateV2Finding(ownerKey, id, input = {}, options = {}) {
    const dbAccessors = options.dbAccessors || loadDbAccessors();
    const { db, safeUpdate } = dbAccessors;
    const allowed = new Set(['category', 'note', 'status', 'expectedUpdatedAt']);
    if (Object.keys(input).some(key => !allowed.has(key))) throw new Error('V2 记录更新字段不合法');
    const findingId = positiveId(id, 'V2 记录ID');
    const owner = normalizeOwnerKey(ownerKey);
    const existing = db.prepare('SELECT * FROM ai_v2_findings WHERE id = ? AND owner_key = ?').get(findingId, owner);
    if (!existing) return null;
    if (input.expectedUpdatedAt && input.expectedUpdatedAt !== existing.updated_at) {
        const error = new Error('V2 记录已被其他操作更新，请刷新后重试');
        error.code = 'VERSION_CONFLICT';
        throw error;
    }
    const updates = {};
    if (Object.hasOwn(input, 'category')) {
        if (input.category !== null && !CATEGORIES.has(String(input.category))) throw new Error('V2 记录分类不合法');
        updates.category = input.category === null ? null : String(input.category);
    }
    if (Object.hasOwn(input, 'note')) updates.note = boundedText(input.note, 2000, '补充说明');
    if (Object.hasOwn(input, 'status')) {
        if (!STATUSES.has(String(input.status))) throw new Error('V2 记录状态不合法');
        updates.status = String(input.status);
    }
    if (!Object.keys(updates).length) throw new Error('请至少提供一个可更新字段');
    updates.updated_at = new Date().toISOString();
    const write = safeUpdate('ai_v2_findings', findingId, updates, options.auditContext || {});
    options.onWrite?.(write);
    return getV2FindingDetail(owner, findingId, { dbAccessors });
}

module.exports = {
    CATEGORIES: Object.freeze([...CATEGORIES]),
    STATUSES: Object.freeze([...STATUSES]),
    sanitizeRuntimeSnapshot,
    saveV2Finding,
    listV2Findings,
    getV2FindingDetail,
    updateV2Finding,
};
