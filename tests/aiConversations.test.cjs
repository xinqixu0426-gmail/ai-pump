const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    listAiConversations,
    createAiConversation,
    getAiConversation,
    appendAiConversationMessage,
    updateAiConversationMessage,
    deleteAiConversation,
} = require('../api/services/aiConversations.cjs');

function createMemoryAccessors() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE ai_conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_key TEXT NOT NULL,
            title TEXT NOT NULL,
            message_count INTEGER DEFAULT 0,
            last_message_preview TEXT DEFAULT '',
            created_at TEXT,
            updated_at TEXT,
            deleted_at TEXT
        );
        CREATE TABLE ai_conversation_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            metadata_json TEXT DEFAULT '{}',
            created_at TEXT,
            updated_at TEXT
        );
    `);
    const accessors = {
        db,
        safeInsert(table, values) {
            const columns = Object.keys(values);
            const placeholders = columns.map(() => '?').join(', ');
            return db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`).run(...columns.map(column => values[column]));
        },
        safeUpdate(table, id, values) {
            const entries = Object.entries(values);
            const sets = [...entries.map(([column]) => `${column} = ?`), 'updated_at = ?'];
            db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...entries.map(([, value]) => value), new Date().toISOString(), id);
        },
        aiConversationRow(row) {
            return row && {
                id: row.id,
                title: row.title,
                messageCount: Number(row.message_count || 0),
                lastMessagePreview: row.last_message_preview || '',
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            };
        },
        aiConversationMessageRow(row) {
            return row && {
                id: row.id,
                conversationId: row.conversation_id,
                role: row.role,
                content: row.content,
                metadataJson: row.metadata_json || '{}',
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            };
        },
    };
    return accessors;
}

test('AI 会话：创建、追加、读取和更新工具结果', () => {
    const dbAccessors = createMemoryAccessors();
    const conversation = createAiConversation('admin', '查询 V750 成本', { dbAccessors });
    const userMessage = appendAiConversationMessage('admin', conversation.id, { role: 'user', content: '查询 V750 成本' }, { dbAccessors });
    const assistantMessage = appendAiConversationMessage('admin', conversation.id, {
        role: 'assistant',
        content: '成本是 100 元',
        metadata: { toolResults: [{ name: 'query_recipe_cost_by_name', result: { cost: 100 } }] },
    }, { dbAccessors });

    assert.equal(userMessage.role, 'user');
    assert.equal(assistantMessage.metadata.toolResults[0].result.cost, 100);
    const detail = getAiConversation('admin', conversation.id, { dbAccessors });
    assert.equal(detail.messageCount, 2);
    assert.deepEqual(detail.messages.map(message => message.role), ['user', 'assistant']);
    assert.equal(detail.lastMessagePreview, '成本是 100 元');

    const updated = updateAiConversationMessage('admin', conversation.id, assistantMessage.id, {
        toolResults: [{ name: 'query_recipe_cost_by_name', result: { cost: 101 } }],
    }, { dbAccessors });
    assert.equal(updated.metadata.toolResults[0].result.cost, 101);
});

test('AI 会话：按所有者隔离并支持软删除', () => {
    const dbAccessors = createMemoryAccessors();
    const adminConversation = createAiConversation('admin', '管理员会话', { dbAccessors });
    createAiConversation('internal', '内部会话', { dbAccessors });

    assert.deepEqual(listAiConversations('admin', { dbAccessors }).map(row => row.title), ['管理员会话']);
    assert.equal(getAiConversation('internal', adminConversation.id, { dbAccessors }), null);
    assert.equal(deleteAiConversation('internal', adminConversation.id, { dbAccessors }), false);
    assert.equal(deleteAiConversation('admin', adminConversation.id, { dbAccessors }), true);
    assert.equal(listAiConversations('admin', { dbAccessors }).length, 0);
    assert.equal(getAiConversation('admin', adminConversation.id, { dbAccessors }), null);
});

test('AI 会话：拒绝空消息和非法角色', () => {
    const dbAccessors = createMemoryAccessors();
    const conversation = createAiConversation('admin', '输入校验', { dbAccessors });
    assert.throws(() => appendAiConversationMessage('admin', conversation.id, { role: 'tool', content: 'x' }, { dbAccessors }), /角色不合法/);
    assert.throws(() => appendAiConversationMessage('admin', conversation.id, { role: 'user', content: '   ' }, { dbAccessors }), /内容不能为空/);
});

test('AI 会话：摘要更新失败时不留下孤立消息', () => {
    const dbAccessors = createMemoryAccessors();
    const conversation = createAiConversation('admin', '事务校验', { dbAccessors });
    dbAccessors.safeUpdate = () => {
        throw new Error('模拟摘要更新失败');
    };

    assert.throws(() => appendAiConversationMessage('admin', conversation.id, {
        role: 'user',
        content: '这条消息应回滚',
    }, { dbAccessors }), /模拟摘要更新失败/);
    const count = dbAccessors.db.prepare('SELECT COUNT(*) AS count FROM ai_conversation_messages').get().count;
    assert.equal(count, 0);
});
