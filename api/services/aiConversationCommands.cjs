const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
} = require('./commandExecution.cjs');
const {
    appendAiConversationMessage,
    createAiConversation,
    deleteAiConversation,
    updateAiConversationMessage,
} = require('./aiConversations.cjs');
const {
    assertExpectedUpdatedAt,
    normalizeExpectedUpdatedAt,
} = require('./resourceVersion.cjs');

const CREATE_CAPABILITY_ID = requireBusinessCapability(
    'ai.conversations.create'
).capabilityId;
const APPEND_MESSAGE_CAPABILITY_ID = requireBusinessCapability(
    'ai.conversations.messages.append'
).capabilityId;
const UPDATE_MESSAGE_CAPABILITY_ID = requireBusinessCapability(
    'ai.conversations.messages.update_metadata'
).capabilityId;
const DELETE_CAPABILITY_ID = requireBusinessCapability(
    'ai.conversations.delete'
).capabilityId;
const BATCH_DELETE_CAPABILITY_ID = requireBusinessCapability(
    'ai.conversations.batch_delete'
).capabilityId;
const MAX_BATCH_DELETE_CONVERSATIONS = 50;

function conversationCommandError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function ownerKey(value) {
    return String(value || 'admin').trim().slice(0, 80) || 'admin';
}

function positiveId(value, label) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) {
        throw conversationCommandError(
            'ai_conversation_id_invalid',
            `${label}不合法`,
            400
        );
    }
    return id;
}

function mapConversationError(error, fallbackCode) {
    if (error instanceof CommandExecutionError) return error;
    return conversationCommandError(
        fallbackCode,
        error?.message || 'AI 会话操作失败',
        Number(error?.statusCode) || 400
    );
}

function conversationRow(dependencies, id, owner) {
    return dependencies.db.prepare(`
        SELECT id, updated_at
        FROM ai_conversations
        WHERE id = ? AND owner_key = ? AND deleted_at IS NULL
    `).get(id, ownerKey(owner));
}

function messageRow(dependencies, conversationId, messageId, owner) {
    return dependencies.db.prepare(`
        SELECT message.id, message.updated_at
        FROM ai_conversation_messages AS message
        JOIN ai_conversations AS conversation
          ON conversation.id = message.conversation_id
        WHERE message.id = ?
          AND message.conversation_id = ?
          AND conversation.owner_key = ?
          AND conversation.deleted_at IS NULL
    `).get(messageId, conversationId, ownerKey(owner));
}

function versionWarnings(commandContext, expectedUpdatedAt, label) {
    return [
        ...(commandContext.warnings || []),
        ...(!expectedUpdatedAt ? [{
            code: 'resource_version_missing_compatibility',
            message: `兼容调用未提供 ${label} expectedUpdatedAt；建议刷新后再执行`,
        }] : []),
    ];
}

function collectAudits() {
    const auditIds = [];
    return {
        auditIds,
        onWrite(write) {
            if (write?.auditId) auditIds.push(Number(write.auditId));
        },
    };
}

function executeCreateAiConversation(
    dependencies,
    owner,
    input = {},
    commandContext = {}
) {
    const title = String(input.title || '').replace(/\s+/g, ' ').trim();
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: CREATE_CAPABILITY_ID,
        input: { owner: ownerKey(owner), title },
        warnings: commandContext.warnings || [],
        execute: ({ auditContext }) => {
            const writes = collectAudits();
            let conversation;
            try {
                conversation = createAiConversation(owner, title, {
                    dbAccessors: dependencies,
                    auditContext,
                    onWrite: writes.onWrite,
                });
            } catch (error) {
                throw mapConversationError(error, 'ai_conversation_create_failed');
            }
            return {
                data: conversation,
                resource: { type: 'aiConversation', ids: [conversation.id] },
                changes: [{
                    resourceType: 'aiConversation',
                    resourceId: conversation.id,
                    field: 'created',
                    from: null,
                    to: true,
                }],
                auditIds: writes.auditIds,
                requiredAuditCount: 1,
            };
        },
    });
}

function executeAppendAiConversationMessage(
    dependencies,
    owner,
    conversationIdValue,
    input = {},
    commandContext = {}
) {
    const conversationId = positiveId(conversationIdValue, '会话ID');
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const commandInput = {
        conversationId,
        role: input.role,
        content: input.content,
        metadata: input.metadata || {},
        expectedUpdatedAt,
    };
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: APPEND_MESSAGE_CAPABILITY_ID,
        input: commandInput,
        warnings: versionWarnings(
            commandContext,
            expectedUpdatedAt,
            '会话'
        ),
        execute: ({ auditContext }) => {
            const current = conversationRow(
                dependencies,
                conversationId,
                owner
            );
            if (!current) {
                throw conversationCommandError(
                    'ai_conversation_not_found',
                    '会话不存在',
                    404
                );
            }
            assertExpectedUpdatedAt(current, expectedUpdatedAt, 'AI 会话');
            const writes = collectAudits();
            let message;
            try {
                message = appendAiConversationMessage(
                    owner,
                    conversationId,
                    commandInput,
                    {
                        dbAccessors: dependencies,
                        auditContext,
                        onWrite: writes.onWrite,
                    }
                );
            } catch (error) {
                throw mapConversationError(error, 'ai_conversation_message_append_failed');
            }
            return {
                data: message,
                resource: {
                    type: 'aiConversationMessage',
                    ids: [message.id],
                },
                changes: [{
                    resourceType: 'aiConversationMessage',
                    resourceId: message.id,
                    field: 'created',
                    from: null,
                    to: true,
                }],
                auditIds: writes.auditIds,
                requiredAuditCount: 2,
            };
        },
    });
}

function executeUpdateAiConversationMessage(
    dependencies,
    owner,
    conversationIdValue,
    messageIdValue,
    input = {},
    commandContext = {}
) {
    const conversationId = positiveId(conversationIdValue, '会话ID');
    const messageId = positiveId(messageIdValue, '消息ID');
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const commandInput = {
        conversationId,
        messageId,
        metadata: input.metadata || {},
        expectedUpdatedAt,
    };
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: UPDATE_MESSAGE_CAPABILITY_ID,
        input: commandInput,
        warnings: versionWarnings(
            commandContext,
            expectedUpdatedAt,
            '消息'
        ),
        execute: ({ auditContext }) => {
            const current = messageRow(
                dependencies,
                conversationId,
                messageId,
                owner
            );
            if (!current) {
                throw conversationCommandError(
                    'ai_conversation_message_not_found',
                    '会话消息不存在',
                    404
                );
            }
            assertExpectedUpdatedAt(current, expectedUpdatedAt, 'AI 会话消息');
            const writes = collectAudits();
            let message;
            try {
                message = updateAiConversationMessage(
                    owner,
                    conversationId,
                    messageId,
                    commandInput.metadata,
                    {
                        dbAccessors: dependencies,
                        auditContext,
                        onWrite: writes.onWrite,
                    }
                );
            } catch (error) {
                throw mapConversationError(error, 'ai_conversation_message_update_failed');
            }
            return {
                data: message,
                resource: {
                    type: 'aiConversationMessage',
                    ids: [message.id],
                },
                changes: [{
                    resourceType: 'aiConversationMessage',
                    resourceId: message.id,
                    field: 'metadata',
                    from: 'previous',
                    to: 'updated',
                }],
                auditIds: writes.auditIds,
                requiredAuditCount: 1,
            };
        },
    });
}

function executeDeleteAiConversation(
    dependencies,
    owner,
    conversationIdValue,
    input = {},
    commandContext = {}
) {
    const conversationId = positiveId(conversationIdValue, '会话ID');
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: DELETE_CAPABILITY_ID,
        input: { conversationId, expectedUpdatedAt },
        warnings: versionWarnings(
            commandContext,
            expectedUpdatedAt,
            '会话'
        ),
        execute: ({ auditContext }) => {
            const current = conversationRow(
                dependencies,
                conversationId,
                owner
            );
            if (!current) {
                throw conversationCommandError(
                    'ai_conversation_not_found',
                    '会话不存在',
                    404
                );
            }
            assertExpectedUpdatedAt(current, expectedUpdatedAt, 'AI 会话');
            const writes = collectAudits();
            const deleted = deleteAiConversation(owner, conversationId, {
                dbAccessors: dependencies,
                auditContext,
                onWrite: writes.onWrite,
            });
            if (!deleted) {
                throw conversationCommandError(
                    'ai_conversation_not_found',
                    '会话不存在',
                    404
                );
            }
            return {
                data: { id: conversationId, deleted: true },
                resource: { type: 'aiConversation', ids: [conversationId] },
                changes: [{
                    resourceType: 'aiConversation',
                    resourceId: conversationId,
                    field: 'deletedAt',
                    from: null,
                    to: 'soft-deleted',
                }],
                auditIds: writes.auditIds,
                requiredAuditCount: 1,
            };
        },
    });
}

function normalizeBatchDeleteItems(value) {
    if (!Array.isArray(value) || value.length === 0) {
        throw conversationCommandError(
            'ai_conversation_batch_empty',
            '请至少选择一个会话',
            400
        );
    }
    if (value.length > MAX_BATCH_DELETE_CONVERSATIONS) {
        throw conversationCommandError(
            'ai_conversation_batch_too_large',
            `一次最多删除 ${MAX_BATCH_DELETE_CONVERSATIONS} 个会话`,
            400
        );
    }
    const seen = new Set();
    return value.map((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw conversationCommandError(
                'ai_conversation_batch_item_invalid',
                `第 ${index + 1} 个会话参数不合法`,
                400
            );
        }
        const id = positiveId(item.id, `第 ${index + 1} 个会话ID`);
        if (seen.has(id)) {
            throw conversationCommandError(
                'ai_conversation_batch_duplicate',
                '批量删除中包含重复会话',
                400
            );
        }
        seen.add(id);
        const expectedUpdatedAt = normalizeExpectedUpdatedAt(
            item.expectedUpdatedAt,
            `items[${index}].expectedUpdatedAt`
        );
        if (!expectedUpdatedAt) {
            throw conversationCommandError(
                'ai_conversation_batch_version_required',
                '会话版本缺失，请刷新列表后重试',
                400
            );
        }
        return { id, expectedUpdatedAt };
    });
}

function executeBatchDeleteAiConversations(
    dependencies,
    owner,
    input = {},
    commandContext = {}
) {
    const items = normalizeBatchDeleteItems(input.items);
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: BATCH_DELETE_CAPABILITY_ID,
        input: { items },
        warnings: commandContext.warnings || [],
        execute: ({ auditContext }) => {
            const rows = items.map(item => {
                const current = conversationRow(dependencies, item.id, owner);
                if (!current) {
                    throw conversationCommandError(
                        'ai_conversation_not_found',
                        `会话 ${item.id} 不存在`,
                        404
                    );
                }
                assertExpectedUpdatedAt(
                    current,
                    item.expectedUpdatedAt,
                    `AI 会话 ${item.id}`
                );
                return current;
            });
            const writes = collectAudits();
            for (const row of rows) {
                const deleted = deleteAiConversation(owner, row.id, {
                    dbAccessors: dependencies,
                    auditContext,
                    onWrite: writes.onWrite,
                });
                if (!deleted) {
                    throw conversationCommandError(
                        'ai_conversation_not_found',
                        `会话 ${row.id} 不存在`,
                        404
                    );
                }
            }
            const ids = rows.map(row => Number(row.id));
            return {
                data: { ids, deletedCount: ids.length },
                resource: { type: 'aiConversation', ids },
                changes: ids.map(id => ({
                    resourceType: 'aiConversation',
                    resourceId: id,
                    field: 'deletedAt',
                    from: null,
                    to: 'soft-deleted',
                })),
                auditIds: writes.auditIds,
                requiredAuditCount: ids.length,
            };
        },
    });
}

module.exports = {
    APPEND_MESSAGE_CAPABILITY_ID,
    BATCH_DELETE_CAPABILITY_ID,
    CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID,
    UPDATE_MESSAGE_CAPABILITY_ID,
    executeAppendAiConversationMessage,
    executeBatchDeleteAiConversations,
    executeCreateAiConversation,
    executeDeleteAiConversation,
    executeUpdateAiConversationMessage,
};
