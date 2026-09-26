const {
    hasVerifiedExecution,
    hasVerifiedWriteExecution,
} = require('./aiExecutionEvidence.cjs');

function loadDbAccessors() {
    return require('../db.cjs');
}

function parseMetadata(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function normalizeOwnerKey(value) {
    return String(value || 'admin').trim().slice(0, 80) || 'admin';
}

function normalizeTitle(value) {
    const title = String(value || '').replace(/\s+/g, ' ').trim();
    if (!title) throw new Error('会话标题不能为空');
    return title.slice(0, 80);
}

function normalizeContent(value) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('消息内容不能为空');
    if (value.length > 100000) throw new Error('消息内容不能超过 100000 个字符');
    return value;
}

function resolveMessageAttachments(db, role, metadata) {
    const requested = Array.isArray(metadata.attachments) ? metadata.attachments : [];
    if (requested.length === 0) return [];
    if (role !== 'user') throw new Error('只有用户消息可以包含附件');

    const ids = [];
    for (const attachment of requested) {
        const id = Number(attachment?.id ?? attachment?.fileId);
        if (!Number.isSafeInteger(id) || id <= 0) throw new Error('附件ID不合法');
        if (!ids.includes(id)) ids.push(id);
    }
    if (ids.length > 4) throw new Error('每条消息最多上传 4 个附件');

    const placeholders = ids.map(() => '?').join(', ');
    const rows = db.prepare(`
        SELECT id, original_name, detected_type, mime_type, file_size
        FROM factory_files
        WHERE id IN (${placeholders}) AND deleted_at IS NULL
    `).all(...ids);
    if (rows.length !== ids.length) throw new Error('附件不存在或已删除');
    const byId = new Map(rows.map(row => [Number(row.id), row]));
    return ids.map(id => {
        const row = byId.get(id);
        return {
            id,
            originalName: row.original_name,
            detectedType: row.detected_type,
            mimeType: row.mime_type,
            fileSize: Number(row.file_size || 0),
            downloadPath: `/api/files/${id}/download`,
        };
    });
}

function conversationForOwner(db, id, ownerKey) {
    return db.prepare(`
        SELECT * FROM ai_conversations
        WHERE id = ? AND owner_key = ? AND deleted_at IS NULL
    `).get(id, normalizeOwnerKey(ownerKey));
}

function conversationIdFromTransport(value) {
    const match = String(value || '').trim().match(/^chat-([1-9]\d*)$/);
    if (!match) return null;
    const id = Number(match[1]);
    return Number.isSafeInteger(id) ? id : null;
}

function loadAiConversationContinuation(ownerKey, transportId, options = {}) {
    const id = conversationIdFromTransport(transportId);
    if (!id) return null;
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db } = accessors;
    if (!conversationForOwner(db, id, ownerKey)) return null;
    const rows = db.prepare(`
        SELECT id, content, metadata_json
        FROM ai_conversation_messages
        WHERE conversation_id = ? AND role = 'assistant'
        ORDER BY id DESC
        LIMIT 20
    `).all(id);
    for (const row of rows) {
        const metadata = parseMetadata(row.metadata_json);
        const toolResults = (Array.isArray(metadata.toolResults) ? metadata.toolResults : [])
            .filter(item => (
                hasVerifiedExecution(item?.result)
                && item?.result?.requiresClarification === true
                && Array.isArray(item.result.candidates)
                && item.result.candidates.length > 0
            ));
        if (toolResults.length === 0) continue;
        const question = db.prepare(`
            SELECT content
            FROM ai_conversation_messages
            WHERE conversation_id = ? AND role = 'user' AND id < ?
            ORDER BY id DESC
            LIMIT 1
        `).get(id, row.id)?.content || '';
        return { question, answer: row.content, toolResults };
    }
    return null;
}

/**
 * NATIVE-W1.5：取当前会话最近一条**用户**消息（持久化事实）。
 * 聊天回合的写提案必须绑定到库里真实存在的用户消息（任务创建会校验来源归属与哈希），
 * 因此这里只从数据库读取，不接受请求体里自称的消息内容。
 */
function loadAiLatestUserMessage(ownerKey, transportId, options = {}) {
    const id = conversationIdFromTransport(transportId);
    if (!id) return null;
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db } = accessors;
    if (!conversationForOwner(db, id, ownerKey)) return null;
    const row = db.prepare(`
        SELECT id, content
        FROM ai_conversation_messages
        WHERE conversation_id = ? AND role = 'user'
        ORDER BY id DESC
        LIMIT 1
    `).get(id);
    if (!row) return null;
    return Object.freeze({ conversationId: id, userMessageId: Number(row.id), content: String(row.content || '') });
}

function loadAiRecentPartWrite(ownerKey, transportId, options = {}) {
    const id = conversationIdFromTransport(transportId);
    if (!id) return null;
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db } = accessors;
    if (!conversationForOwner(db, id, ownerKey)) return null;
    const rows = db.prepare(`
        SELECT id, metadata_json
        FROM ai_conversation_messages
        WHERE conversation_id = ? AND role = 'assistant'
        ORDER BY id DESC
        LIMIT 20
    `).all(id);
    for (const row of rows) {
        const metadata = parseMetadata(row.metadata_json);
        const resultItem = (Array.isArray(metadata.toolResults) ? metadata.toolResults : [])
            .find(item => (
                item?.name === 'create_part'
                && hasVerifiedWriteExecution(item?.result)
                && typeof item.result?.part?.model === 'string'
                && item.result.part.model.trim()
            ));
        if (!resultItem) continue;
        return {
            messageId: Number(row.id),
            toolName: resultItem.name,
            part: {
                id: Number(resultItem.result.part.id ?? resultItem.result.id) || null,
                model: resultItem.result.part.model.trim(),
                supplier: String(resultItem.result.part.supplier || '').trim(),
            },
        };
    }
    return null;
}

function listAiConversations(ownerKey, options = {}) {
    const { db, aiConversationRow } = options.dbAccessors || loadDbAccessors();
    const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 100);
    return db.prepare(`
        SELECT * FROM ai_conversations
        WHERE owner_key = ? AND deleted_at IS NULL
        ORDER BY updated_at DESC, id DESC
        LIMIT ?
    `).all(normalizeOwnerKey(ownerKey), limit).map(aiConversationRow);
}

function createAiConversation(ownerKey, title, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, safeInsert, aiConversationRow } = accessors;
    const now = new Date().toISOString();
    const info = safeInsert('ai_conversations', {
        owner_key: normalizeOwnerKey(ownerKey),
        title: normalizeTitle(title),
        message_count: 0,
        last_message_preview: '',
        created_at: now,
        updated_at: now,
    }, options.auditContext);
    options.onWrite?.(info);
    return aiConversationRow(db.prepare('SELECT * FROM ai_conversations WHERE id = ?').get(Number(info.lastInsertRowid)));
}

function getAiConversation(ownerKey, id, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, aiConversationRow, aiConversationMessageRow } = accessors;
    const row = conversationForOwner(db, id, ownerKey);
    if (!row) return null;
    const messages = db.prepare(`
        SELECT * FROM ai_conversation_messages
        WHERE conversation_id = ?
        ORDER BY id
    `).all(id).map(aiConversationMessageRow).map(message => ({
        ...message,
        metadata: parseMetadata(message.metadataJson),
    }));
    return { ...aiConversationRow(row), messages };
}

function appendAiConversationMessage(ownerKey, id, input, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, safeInsert, safeUpdate, aiConversationMessageRow } = accessors;
    const conversation = conversationForOwner(db, id, ownerKey);
    if (!conversation) return null;
    const role = input?.role;
    if (role !== 'user' && role !== 'assistant') throw new Error('消息角色不合法');
    const content = normalizeContent(input.content);
    const metadata = parseMetadata(input.metadata);
    const attachments = resolveMessageAttachments(db, role, metadata);
    if (attachments.length > 0) metadata.attachments = attachments;
    else delete metadata.attachments;
    const metadataJson = JSON.stringify(metadata);
    if (metadataJson.length > 200000) throw new Error('消息附加数据过大');
    const now = new Date().toISOString();
    const append = db.transaction(() => {
        const info = safeInsert('ai_conversation_messages', {
            conversation_id: id,
            role,
            content,
            metadata_json: metadataJson,
            created_at: now,
            updated_at: now,
        }, options.auditContext);
        options.onWrite?.(info);
        const count = db.prepare('SELECT COUNT(*) AS count FROM ai_conversation_messages WHERE conversation_id = ?').get(id).count;
        const conversationWrite = safeUpdate('ai_conversations', id, {
            message_count: count,
            last_message_preview: content.replace(/\s+/g, ' ').trim().slice(0, 120),
        }, options.auditContext);
        options.onWrite?.(conversationWrite);
        return {
            message: aiConversationMessageRow(
                db.prepare('SELECT * FROM ai_conversation_messages WHERE id = ?')
                    .get(Number(info.lastInsertRowid))
            ),
            conversationUpdatedAt: db.prepare(
                'SELECT updated_at updatedAt FROM ai_conversations WHERE id = ?'
            ).get(id)?.updatedAt || now,
        };
    });
    const appended = append();
    return {
        ...appended.message,
        metadata,
        conversationUpdatedAt: appended.conversationUpdatedAt,
    };
}

function updateAiConversationMessage(ownerKey, conversationId, messageId, metadata, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, safeUpdate, aiConversationMessageRow } = accessors;
    if (!conversationForOwner(db, conversationId, ownerKey)) return null;
    const row = db.prepare('SELECT * FROM ai_conversation_messages WHERE id = ? AND conversation_id = ?').get(messageId, conversationId);
    if (!row) return null;
    const metadataJson = JSON.stringify(parseMetadata(metadata));
    if (metadataJson.length > 200000) throw new Error('消息附加数据过大');
    const write = safeUpdate(
        'ai_conversation_messages',
        messageId,
        { metadata_json: metadataJson },
        options.auditContext
    );
    options.onWrite?.(write);
    const updated = aiConversationMessageRow(db.prepare('SELECT * FROM ai_conversation_messages WHERE id = ?').get(messageId));
    return { ...updated, metadata: parseMetadata(updated.metadataJson) };
}

function deleteAiConversation(ownerKey, id, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, safeUpdate } = accessors;
    if (!conversationForOwner(db, id, ownerKey)) return false;
    const write = safeUpdate(
        'ai_conversations',
        id,
        { deleted_at: new Date().toISOString() },
        options.auditContext
    );
    options.onWrite?.(write);
    return true;
}

module.exports = {
    listAiConversations,
    createAiConversation,
    getAiConversation,
    loadAiConversationContinuation,
    loadAiLatestUserMessage,
    loadAiRecentPartWrite,
    appendAiConversationMessage,
    updateAiConversationMessage,
    deleteAiConversation,
};
