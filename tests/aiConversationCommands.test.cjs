const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../api/database/migrations.cjs');
const {
    executeAppendAiConversationMessage,
    executeBatchDeleteAiConversations,
    executeCreateAiConversation,
    executeDeleteAiConversation,
    executeUpdateAiConversationMessage,
} = require('../api/services/aiConversationCommands.cjs');

function createFixture(overrides = {}) {
    const db = new Database(':memory:');
    runMigrations(db, { now: '2026-08-03T11:00:00.000Z' });
    let tick = 0;
    const nextTime = () => `2026-08-03T11:00:${String(++tick).padStart(2, '0')}.000Z`;
    const audit = (action, table, id, context) => Number(db.prepare(`
        INSERT INTO audit_log (
            action, table_name, record_id, user, request_id,
            operation_id, capability_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        action,
        table,
        id,
        context?.user || 'test',
        context?.requestId || null,
        context?.operationId || null,
        context?.capabilityId || null,
        nextTime()
    ).lastInsertRowid);
    const dependencies = {
        db,
        safeInsert(table, values, context) {
            const columns = Object.keys(values).filter(key => values[key] !== undefined);
            const info = db.prepare(`
                INSERT INTO ${table} (${columns.join(', ')})
                VALUES (${columns.map(() => '?').join(', ')})
            `).run(...columns.map(key => values[key]));
            return {
                ...info,
                auditId: audit('INSERT', table, Number(info.lastInsertRowid), context),
            };
        },
        safeUpdate(table, id, values, context) {
            const normalized = {
                ...values,
                updated_at: values.updated_at || nextTime(),
            };
            const columns = Object.keys(normalized).filter(
                key => normalized[key] !== undefined
            );
            const info = db.prepare(`
                UPDATE ${table}
                SET ${columns.map(key => `${key} = ?`).join(', ')}
                WHERE id = ?
            `).run(...columns.map(key => normalized[key]), id);
            return {
                ...info,
                auditId: audit('UPDATE', table, id, context),
            };
        },
        aiConversationRow(row) {
            return row && {
                id: Number(row.id),
                title: row.title,
                messageCount: Number(row.message_count || 0),
                lastMessagePreview: row.last_message_preview || '',
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            };
        },
        aiConversationMessageRow(row) {
            return row && {
                id: Number(row.id),
                conversationId: Number(row.conversation_id),
                role: row.role,
                content: row.content,
                metadataJson: row.metadata_json || '{}',
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            };
        },
        ...overrides,
    };
    return { db, dependencies };
}

function context(key) {
    return {
        actorKey: 'user:ai-conversation-test',
        idempotencyKey: key,
        operationId: `operation:${key}`,
        requestId: `request:${key}`,
        warnings: [],
    };
}

test('AI 会话命令：创建会话持久幂等且强审计与回执原子提交', () => {
    const fixture = createFixture();
    try {
        const first = executeCreateAiConversation(
            fixture.dependencies,
            'admin',
            { title: '查询 V750 成本' },
            context('ai-conversation-create-0001')
        );
        const replay = executeCreateAiConversation(
            fixture.dependencies,
            'admin',
            { title: '查询 V750 成本' },
            context('ai-conversation-create-0001')
        );
        assert.equal(first.capabilityId, 'ai.conversations.create');
        assert.equal(first.auditIds.length, 1);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) count FROM ai_conversations').get().count,
            1
        );
    } finally {
        fixture.db.close();
    }
});

test('AI 会话命令：追加消息、摘要、双审计和重放保持一致', () => {
    const fixture = createFixture();
    try {
        const conversation = executeCreateAiConversation(
            fixture.dependencies,
            'admin',
            { title: '追问成本' },
            context('ai-conversation-create-0002')
        );
        const first = executeAppendAiConversationMessage(
            fixture.dependencies,
            'admin',
            conversation.id,
            {
                role: 'user',
                content: 'V750 当前成本是多少？',
                expectedUpdatedAt: conversation.updatedAt,
            },
            context('ai-conversation-append-0001')
        );
        const replay = executeAppendAiConversationMessage(
            fixture.dependencies,
            'admin',
            conversation.id,
            {
                role: 'user',
                content: 'V750 当前成本是多少？',
                expectedUpdatedAt: conversation.updatedAt,
            },
            context('ai-conversation-append-0001')
        );
        assert.equal(first.capabilityId, 'ai.conversations.messages.append');
        assert.equal(first.auditIds.length, 2);
        assert.ok(first.conversationUpdatedAt);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(
            fixture.db.prepare(
                'SELECT COUNT(*) count FROM ai_conversation_messages'
            ).get().count,
            1
        );
        assert.equal(
            fixture.db.prepare(
                'SELECT message_count count FROM ai_conversations WHERE id = ?'
            ).get(conversation.id).count,
            1
        );
    } finally {
        fixture.db.close();
    }
});

test('AI 会话命令：消息元数据绑定版本并拒绝旧页面覆盖', () => {
    const fixture = createFixture();
    try {
        const conversation = executeCreateAiConversation(
            fixture.dependencies,
            'admin',
            { title: '工具结果' },
            context('ai-conversation-create-0003')
        );
        const message = executeAppendAiConversationMessage(
            fixture.dependencies,
            'admin',
            conversation.id,
            {
                role: 'assistant',
                content: '成本结果',
                expectedUpdatedAt: conversation.updatedAt,
            },
            context('ai-conversation-append-0002')
        );
        const updated = executeUpdateAiConversationMessage(
            fixture.dependencies,
            'admin',
            conversation.id,
            message.id,
            {
                metadata: { provider: { provider: 'deepseek' } },
                expectedUpdatedAt: message.updatedAt,
            },
            context('ai-conversation-update-0001')
        );
        assert.equal(
            updated.metadata.provider.provider,
            'deepseek'
        );
        assert.throws(() => executeUpdateAiConversationMessage(
            fixture.dependencies,
            'admin',
            conversation.id,
            message.id,
            {
                metadata: { provider: { provider: 'kimi' } },
                expectedUpdatedAt: message.updatedAt,
            },
            context('ai-conversation-update-0002')
        ), /已被其他操作修改/);
        assert.equal(
            fixture.db.prepare(`
                SELECT COUNT(*) count
                FROM api_operations
                WHERE capability_id = 'ai.conversations.messages.update_metadata'
            `).get().count,
            1
        );
    } finally {
        fixture.db.close();
    }
});

test('AI 会话命令：删除按 owner 和版本隔离且缺少强审计时整体回滚', () => {
    const fixture = createFixture();
    try {
        const conversation = executeCreateAiConversation(
            fixture.dependencies,
            'admin',
            { title: '待删除会话' },
            context('ai-conversation-create-0004')
        );
        assert.throws(() => executeDeleteAiConversation(
            fixture.dependencies,
            'internal',
            conversation.id,
            { expectedUpdatedAt: conversation.updatedAt },
            context('ai-conversation-delete-0001')
        ), /会话不存在/);
        const missingAuditDependencies = {
            ...fixture.dependencies,
            safeUpdate(table, id, values) {
                const normalized = {
                    ...values,
                    updated_at: '2026-08-03T11:30:00.000Z',
                };
                const columns = Object.keys(normalized);
                return fixture.db.prepare(`
                    UPDATE ${table}
                    SET ${columns.map(key => `${key} = ?`).join(', ')}
                    WHERE id = ?
                `).run(...columns.map(key => normalized[key]), id);
            },
        };
        assert.throws(() => executeDeleteAiConversation(
            missingAuditDependencies,
            'admin',
            conversation.id,
            { expectedUpdatedAt: conversation.updatedAt },
            context('ai-conversation-delete-0002')
        ), /强审计记录不完整/);
        assert.equal(
            fixture.db.prepare(
                'SELECT deleted_at FROM ai_conversations WHERE id = ?'
            ).get(conversation.id).deleted_at,
            null
        );
        const deleted = executeDeleteAiConversation(
            fixture.dependencies,
            'admin',
            conversation.id,
            { expectedUpdatedAt: conversation.updatedAt },
            context('ai-conversation-delete-0003')
        );
        assert.equal(deleted.deleted, true);
        assert.equal(deleted.auditIds.length, 1);
    } finally {
        fixture.db.close();
    }
});

test('AI 会话命令：批量删除逐项审计并支持持久幂等重放', () => {
    const fixture = createFixture();
    try {
        const first = executeCreateAiConversation(
            fixture.dependencies,
            'admin',
            { title: '批量删除一' },
            context('ai-conversation-create-batch-0001')
        );
        const second = executeCreateAiConversation(
            fixture.dependencies,
            'admin',
            { title: '批量删除二' },
            context('ai-conversation-create-batch-0002')
        );
        const input = { items: [
            { id: first.id, expectedUpdatedAt: first.updatedAt },
            { id: second.id, expectedUpdatedAt: second.updatedAt },
        ] };
        const deleted = executeBatchDeleteAiConversations(
            fixture.dependencies,
            'admin',
            input,
            context('ai-conversation-batch-delete-0001')
        );
        const replay = executeBatchDeleteAiConversations(
            fixture.dependencies,
            'admin',
            input,
            context('ai-conversation-batch-delete-0001')
        );
        assert.equal(deleted.capabilityId, 'ai.conversations.batch_delete');
        assert.deepEqual(deleted.ids, [first.id, second.id]);
        assert.equal(deleted.deletedCount, 2);
        assert.equal(deleted.auditIds.length, 2);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(
            fixture.db.prepare(
                'SELECT COUNT(*) count FROM ai_conversations WHERE deleted_at IS NULL'
            ).get().count,
            0
        );
    } finally {
        fixture.db.close();
    }
});

test('AI 会话命令：批量删除遇到越权或版本漂移时整批回滚', () => {
    const fixture = createFixture();
    try {
        const first = executeCreateAiConversation(
            fixture.dependencies,
            'admin',
            { title: '保留会话一' },
            context('ai-conversation-create-batch-0003')
        );
        const second = executeCreateAiConversation(
            fixture.dependencies,
            'admin',
            { title: '保留会话二' },
            context('ai-conversation-create-batch-0004')
        );
        const foreign = executeCreateAiConversation(
            fixture.dependencies,
            'internal',
            { title: '其他用户会话' },
            context('ai-conversation-create-batch-0005')
        );
        assert.throws(() => executeBatchDeleteAiConversations(
            fixture.dependencies,
            'admin',
            { items: [
                { id: first.id, expectedUpdatedAt: first.updatedAt },
                { id: foreign.id, expectedUpdatedAt: foreign.updatedAt },
            ] },
            context('ai-conversation-batch-delete-0002')
        ), /不存在/);
        assert.throws(() => executeBatchDeleteAiConversations(
            fixture.dependencies,
            'admin',
            { items: [
                { id: first.id, expectedUpdatedAt: first.updatedAt },
                { id: second.id, expectedUpdatedAt: '2020-01-01T00:00:00.000Z' },
            ] },
            context('ai-conversation-batch-delete-0003')
        ), /已被其他操作修改/);
        assert.equal(
            fixture.db.prepare(
                'SELECT COUNT(*) count FROM ai_conversations WHERE owner_key = ? AND deleted_at IS NULL'
            ).get('admin').count,
            2
        );
    } finally {
        fixture.db.close();
    }
});

test('AI 会话命令：批量删除拒绝空列表、重复目标和超过 50 条', () => {
    const fixture = createFixture();
    try {
        assert.throws(() => executeBatchDeleteAiConversations(
            fixture.dependencies,
            'admin',
            { items: [] },
            context('ai-conversation-batch-delete-0004')
        ), /至少选择一个会话/);
        assert.throws(() => executeBatchDeleteAiConversations(
            fixture.dependencies,
            'admin',
            { items: [
                { id: 1, expectedUpdatedAt: '2026-08-03T11:00:00.000Z' },
                { id: 1, expectedUpdatedAt: '2026-08-03T11:00:00.000Z' },
            ] },
            context('ai-conversation-batch-delete-0005')
        ), /重复会话/);
        assert.throws(() => executeBatchDeleteAiConversations(
            fixture.dependencies,
            'admin',
            { items: Array.from({ length: 51 }, (_, index) => ({
                id: index + 1,
                expectedUpdatedAt: '2026-08-03T11:00:00.000Z',
            })) },
            context('ai-conversation-batch-delete-0006')
        ), /最多删除 50 个会话/);
    } finally {
        fixture.db.close();
    }
});
