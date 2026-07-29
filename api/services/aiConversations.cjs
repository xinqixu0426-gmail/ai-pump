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
    });
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
        });
        const count = db.prepare('SELECT COUNT(*) AS count FROM ai_conversation_messages WHERE conversation_id = ?').get(id).count;
        safeUpdate('ai_conversations', id, {
            message_count: count,
            last_message_preview: content.replace(/\s+/g, ' ').trim().slice(0, 120),
        });
        return aiConversationMessageRow(db.prepare('SELECT * FROM ai_conversation_messages WHERE id = ?').get(Number(info.lastInsertRowid)));
    });
    const message = append();
    return { ...message, metadata };
}

function updateAiConversationMessage(ownerKey, conversationId, messageId, metadata, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, safeUpdate, aiConversationMessageRow } = accessors;
    if (!conversationForOwner(db, conversationId, ownerKey)) return null;
    const row = db.prepare('SELECT * FROM ai_conversation_messages WHERE id = ? AND conversation_id = ?').get(messageId, conversationId);
    if (!row) return null;
    const metadataJson = JSON.stringify(parseMetadata(metadata));
    if (metadataJson.length > 200000) throw new Error('消息附加数据过大');
    safeUpdate('ai_conversation_messages', messageId, { metadata_json: metadataJson });
    const updated = aiConversationMessageRow(db.prepare('SELECT * FROM ai_conversation_messages WHERE id = ?').get(messageId));
    return { ...updated, metadata: parseMetadata(updated.metadataJson) };
}

function deleteAiConversation(ownerKey, id, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, safeUpdate } = accessors;
    if (!conversationForOwner(db, id, ownerKey)) return false;
    safeUpdate('ai_conversations', id, { deleted_at: new Date().toISOString() });
    return true;
}

module.exports = {
    listAiConversations,
    createAiConversation,
    getAiConversation,
    appendAiConversationMessage,
    updateAiConversationMessage,
    deleteAiConversation,
};
