const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    submitAiAnswerFeedback,
    listAiAnswerFeedback,
    reviewAiAnswerFeedback,
    diagnoseAiAnswerFeedback,
    recordAiAnswerFeedbackRetest,
} = require('../api/services/aiAnswerFeedback.cjs');

function createFixture() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE ai_conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_key TEXT NOT NULL,
            deleted_at TEXT
        );
        CREATE TABLE ai_conversation_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            metadata_json TEXT DEFAULT '{}'
        );
        CREATE TABLE ai_answer_feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL,
            message_id INTEGER NOT NULL UNIQUE,
            rating TEXT NOT NULL,
            note TEXT DEFAULT '',
            question_text TEXT DEFAULT '',
            answer_text TEXT DEFAULT '',
            sources_json TEXT DEFAULT '[]',
            diagnosis_json TEXT DEFAULT '{}',
            diagnosed_at TEXT,
            retest_answer_text TEXT DEFAULT '',
            retest_sources_json TEXT DEFAULT '[]',
            retested_at TEXT,
            status TEXT NOT NULL DEFAULT 'open',
            resolution_note TEXT DEFAULT '',
            resolved_at TEXT,
            created_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE factory_ai_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_feedback_id INTEGER UNIQUE,
            title TEXT NOT NULL,
            trigger_text TEXT NOT NULL DEFAULT '',
            instruction TEXT NOT NULL,
            scope_type TEXT NOT NULL DEFAULT 'global',
            priority INTEGER NOT NULL DEFAULT 100,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT,
            updated_at TEXT
        );
    `);
    const now = new Date().toISOString();
    const safeInsert = (table, values) => {
        const columns = Object.keys(values);
        return db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
            .run(...columns.map(column => values[column]));
    };
    const safeUpdate = (table, id, values) => {
        const entries = Object.entries(values);
        db.prepare(`UPDATE ${table} SET ${entries.map(([column]) => `${column} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
            .run(...entries.map(([, value]) => value), now, id);
    };
    const aiAnswerFeedbackRow = row => row && ({
        id: row.id,
        conversationId: row.conversation_id,
        messageId: row.message_id,
        rating: row.rating,
        note: row.note || '',
        questionText: row.question_text || '',
        answerText: row.answer_text || '',
        sourcesJson: row.sources_json || '[]',
        diagnosisJson: row.diagnosis_json || '{}',
        diagnosedAt: row.diagnosed_at,
        retestAnswerText: row.retest_answer_text || '',
        retestSourcesJson: row.retest_sources_json || '[]',
        retestedAt: row.retested_at,
        status: row.status,
        resolutionNote: row.resolution_note || '',
        resolvedAt: row.resolved_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    });
    const ownerConversation = Number(safeInsert('ai_conversations', { owner_key: 'admin', deleted_at: null }).lastInsertRowid);
    const otherConversation = Number(safeInsert('ai_conversations', { owner_key: 'operator', deleted_at: null }).lastInsertRowid);
    safeInsert('ai_conversation_messages', {
        conversation_id: ownerConversation,
        role: 'user',
        content: 'V750 配方详情是什么？',
        metadata_json: '{}',
    });
    const assistantMessage = Number(safeInsert('ai_conversation_messages', {
        conversation_id: ownerConversation,
        role: 'assistant',
        content: '这是 V750 的配方详情。',
        metadata_json: JSON.stringify({
            toolResults: [{
                name: 'get_factory_knowledge_detail',
                result: {
                    sources: [{
                        kind: 'knowledge_snapshot',
                        knowledgeEntryId: 70,
                        entryType: 'recipe',
                        title: 'V750',
                        sourceTable: 'recipes',
                        sourceId: '12',
                        freshness: 'fresh',
                        knowledgePath: '/dashboard?view=knowledge&entry=70',
                        sourcePath: '/recipes',
                    }],
                },
            }],
        }),
    }).lastInsertRowid);
    const otherMessage = Number(safeInsert('ai_conversation_messages', {
        conversation_id: otherConversation,
        role: 'assistant',
        content: '其他用户回答',
        metadata_json: '{}',
    }).lastInsertRowid);
    return {
        db,
        ownerConversation,
        assistantMessage,
        otherMessage,
        accessors: { db, safeInsert, safeUpdate, aiAnswerFeedbackRow },
    };
}

test('AI 回答反馈：问题反馈保存问答和知识来源快照', () => {
    const fixture = createFixture();
    const result = submitAiAnswerFeedback('admin', {
        messageId: fixture.assistantMessage,
        rating: 'outdated',
        note: '业务数据已经更新',
    }, { dbAccessors: fixture.accessors });

    assert.equal(result.status, 'open');
    assert.equal(result.questionText, 'V750 配方详情是什么？');
    assert.equal(result.answerText, '这是 V750 的配方详情。');
    assert.equal(result.sources[0].knowledgeEntryId, 70);
    assert.equal(result.sources[0].sourceTable, 'recipes');
    fixture.db.close();
});

test('AI 回答反馈：同一回答改判时更新原记录且准确反馈自动归档', () => {
    const fixture = createFixture();
    const first = submitAiAnswerFeedback('admin', {
        messageId: fixture.assistantMessage,
        rating: 'incorrect',
    }, { dbAccessors: fixture.accessors });
    const updated = submitAiAnswerFeedback('admin', {
        messageId: fixture.assistantMessage,
        rating: 'helpful',
    }, { dbAccessors: fixture.accessors });

    assert.equal(updated.id, first.id);
    assert.equal(updated.rating, 'helpful');
    assert.equal(updated.status, 'resolved');
    assert.ok(updated.resolvedAt);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM ai_answer_feedback').get().count, 1);
    fixture.db.close();
});

test('AI 回答反馈：明确正确做法后生成通用长期纠正规则', () => {
    const fixture = createFixture();
    const result = submitAiAnswerFeedback('admin', {
        messageId: fixture.assistantMessage,
        rating: 'incorrect',
        note: '以后查询配方详情必须先读取当前业务数据，不要复述历史回答。',
        learnFromCorrection: true,
    }, { dbAccessors: fixture.accessors });

    assert.equal(result.learningRule.status, 'active');
    assert.equal(result.learningRule.triggerText, 'V750 配方详情是什么？');
    assert.equal(result.learningRule.instruction, '以后查询配方详情必须先读取当前业务数据，不要复述历史回答。');
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM factory_ai_rules').get().count, 1);

    const updated = submitAiAnswerFeedback('admin', {
        messageId: fixture.assistantMessage,
        rating: 'incorrect',
        note: '配方详情必须以本轮实时工具结果为准。',
        learnFromCorrection: true,
    }, { dbAccessors: fixture.accessors });
    assert.equal(updated.learningRule.id, result.learningRule.id);
    assert.equal(updated.learningRule.instruction, '配方详情必须以本轮实时工具结果为准。');
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM factory_ai_rules').get().count, 1);
    fixture.db.close();
});

test('AI 回答反馈：没有正确做法时不伪造学习规则', () => {
    const fixture = createFixture();
    assert.throws(
        () => submitAiAnswerFeedback('admin', {
            messageId: fixture.assistantMessage,
            rating: 'incorrect',
            learnFromCorrection: true,
        }, { dbAccessors: fixture.accessors }),
        /必须填写正确做法/
    );
    const result = submitAiAnswerFeedback('admin', {
        messageId: fixture.assistantMessage,
        rating: 'outdated',
        note: '数据已经更新',
    }, { dbAccessors: fixture.accessors });
    assert.equal(result.learningRule, null);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM factory_ai_rules').get().count, 0);
    fixture.db.close();
});

test('AI 回答反馈：列表统计按 owner 隔离并可处理问题', () => {
    const fixture = createFixture();
    assert.equal(submitAiAnswerFeedback('admin', {
        messageId: fixture.otherMessage,
        rating: 'incorrect',
    }, { dbAccessors: fixture.accessors }), null);

    const feedback = submitAiAnswerFeedback('admin', {
        messageId: fixture.assistantMessage,
        rating: 'missing_source',
    }, { dbAccessors: fixture.accessors });
    const listed = listAiAnswerFeedback('admin', { status: 'open' }, { dbAccessors: fixture.accessors });
    assert.equal(listed.items.length, 1);
    assert.equal(listed.stats.open, 1);
    assert.equal(listed.stats.missingSource, 1);

    const resolved = reviewAiAnswerFeedback('admin', feedback.id, {
        status: 'resolved',
        resolutionNote: '已补充来源并验证',
    }, { dbAccessors: fixture.accessors });
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.resolutionNote, '已补充来源并验证');
    const afterResolution = listAiAnswerFeedback('admin', { status: 'open' }, { dbAccessors: fixture.accessors });
    assert.equal(afterResolution.items.length, 0);
    assert.equal(afterResolution.stats.open, 0);
    assert.equal(afterResolution.stats.missingSource, 0);
    fixture.db.close();
});

test('AI 回答反馈：诊断识别待同步来源并保存建议动作', () => {
    const fixture = createFixture();
    const feedback = submitAiAnswerFeedback('admin', {
        messageId: fixture.assistantMessage,
        rating: 'outdated',
    }, { dbAccessors: fixture.accessors });
    const diagnosed = diagnoseAiAnswerFeedback('admin', feedback.id, {
        dbAccessors: fixture.accessors,
        knowledgeService: {
            inspectKnowledgeOverview() {
                return {
                    stats: { pendingTotal: 1 },
                    changes: [{
                        status: 'pending_update',
                        sourceTable: 'recipes',
                        sourceId: '12',
                        title: 'V750 新数据',
                        summary: '成本已更新',
                    }],
                };
            },
            searchKnowledgeEntries() {
                return [];
            },
        },
    });

    assert.equal(diagnosed.diagnosis.type, 'knowledge_outdated');
    assert.equal(diagnosed.diagnosis.checkedSources[0].currentStatus, 'pending_update');
    assert.equal(diagnosed.diagnosis.actions[0].type, 'sync_knowledge');
    assert.ok(diagnosed.diagnosedAt);
    fixture.db.close();
});

test('AI 回答反馈：复测保存新回答和新来源且保持待人工归档', () => {
    const fixture = createFixture();
    const feedback = submitAiAnswerFeedback('admin', {
        messageId: fixture.assistantMessage,
        rating: 'incorrect',
    }, { dbAccessors: fixture.accessors });
    const retested = recordAiAnswerFeedbackRetest('admin', feedback.id, {
        answerText: '复测后的 V750 回答。',
        toolResults: [{
            name: 'get_factory_knowledge_detail',
            result: {
                sources: [{
                    knowledgeEntryId: 71,
                    title: 'V750 新知识',
                    sourceTable: 'recipes',
                    sourceId: '12',
                    freshness: 'fresh',
                }],
            },
        }],
    }, { dbAccessors: fixture.accessors });

    assert.equal(retested.retestAnswerText, '复测后的 V750 回答。');
    assert.equal(retested.retestSources[0].knowledgeEntryId, 71);
    assert.equal(retested.status, 'open');
    assert.ok(retested.retestedAt);
    fixture.db.close();
});
