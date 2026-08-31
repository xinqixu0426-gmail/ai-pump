const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../api/database/migrations.cjs');
const {
    executeDiagnoseAiAnswerFeedback,
    executeRetestAiAnswerFeedback,
    executeReviewAiAnswerFeedback,
    executeSubmitAiAnswerFeedback,
    executeUpdateFactoryAiRule,
} = require('../api/services/aiFeedbackCommands.cjs');

function createFixture(overrides = {}) {
    const db = new Database(':memory:');
    runMigrations(db, { now: '2026-08-03T13:00:00.000Z' });
    let tick = 0;
    const nextTime = () => (
        `2026-08-03T13:00:${String(++tick).padStart(2, '0')}.000Z`
    );
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
            const columns = Object.keys(values).filter(
                key => values[key] !== undefined
            );
            const info = db.prepare(`
                INSERT INTO ${table} (${columns.join(', ')})
                VALUES (${columns.map(() => '?').join(', ')})
            `).run(...columns.map(key => values[key]));
            return {
                ...info,
                auditId: audit(
                    'INSERT',
                    table,
                    Number(info.lastInsertRowid),
                    context
                ),
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
        aiAnswerFeedbackRow(row) {
            return row && {
                id: Number(row.id),
                conversationId: Number(row.conversation_id),
                messageId: Number(row.message_id),
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
            };
        },
        aiEvaluationCaseRow(row) {
            return row && {
                id: Number(row.id),
                caseKey: row.case_key,
                title: row.title,
                category: row.category,
                question: row.question,
                evaluatorType: row.evaluator_type,
                configJson: row.config_json || '{}',
                enabled: Boolean(row.enabled),
                sortOrder: Number(row.sort_order || 0),
                sourceType: row.source_type || 'system',
                sourceFeedbackId: row.source_feedback_id || null,
                reviewStatus: row.review_status || 'approved',
                confidenceScore: Number(row.confidence_score ?? 100),
                generationNote: row.generation_note || '',
                proposalHash: row.proposal_hash || '',
                reviewNote: row.review_note || '',
                reviewedAt: row.reviewed_at,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            };
        },
        knowledgeService: {
            inspectKnowledgeOverview() {
                return { stats: { pendingTotal: 0 }, changes: [] };
            },
            searchKnowledgeEntries() {
                return [];
            },
        },
        ...overrides,
    };
    const now = '2026-08-03T13:00:00.000Z';
    const conversation = db.prepare(`
        INSERT INTO ai_conversations (
            owner_key, title, message_count, created_at, updated_at
        ) VALUES ('admin', '纠错测试', 2, ?, ?)
    `).run(now, now);
    const conversationId = Number(conversation.lastInsertRowid);
    db.prepare(`
        INSERT INTO ai_conversation_messages (
            conversation_id, role, content, metadata_json,
            created_at, updated_at
        ) VALUES (?, 'user', '附件是什么？', '{}', ?, ?)
    `).run(conversationId, now, now);
    const message = db.prepare(`
        INSERT INTO ai_conversation_messages (
            conversation_id, role, content, metadata_json,
            created_at, updated_at
        ) VALUES (?, 'assistant', '这是参考图纸。', '{}', ?, ?)
    `).run(conversationId, now, now);
    return {
        db,
        dependencies,
        messageId: Number(message.lastInsertRowid),
    };
}

function context(key) {
    return {
        actorKey: 'user:ai-feedback-test',
        idempotencyKey: key,
        operationId: `operation:${key}`,
        requestId: `request:${key}`,
        warnings: [],
    };
}

test('AI 反馈命令：提交纠错与派生规则/回归用例原子审计且可重放', () => {
    const fixture = createFixture();
    try {
        const input = {
            messageId: fixture.messageId,
            rating: 'incorrect',
            note: '附件不是参考图纸，正确分类是性能测试报告。',
            learnFromCorrection: true,
        };
        const first = executeSubmitAiAnswerFeedback(
            fixture.dependencies,
            'admin',
            input,
            context('ai-feedback-submit-0001')
        );
        const replay = executeSubmitAiAnswerFeedback(
            fixture.dependencies,
            'admin',
            input,
            context('ai-feedback-submit-0001')
        );
        assert.equal(first.capabilityId, 'ai.feedback.submit');
        assert.equal(first.auditIds.length, 4);
        assert.equal(first.feedback.learningRule.status, 'active');
        assert.equal(first.feedback.regressionCase.reviewStatus, 'pending');
        assert.equal(first.feedback.regressionCase.enabled, false);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(
            fixture.db.prepare(
                'SELECT COUNT(*) count FROM ai_answer_feedback'
            ).get().count,
            1
        );
    } finally {
        fixture.db.close();
    }
});

test('AI 反馈命令：改判、诊断和复测依次绑定最新版本', () => {
    const fixture = createFixture();
    try {
        const submitted = executeSubmitAiAnswerFeedback(
            fixture.dependencies,
            'admin',
            {
                messageId: fixture.messageId,
                rating: 'outdated',
            },
            context('ai-feedback-submit-0002')
        ).feedback;
        const diagnosed = executeDiagnoseAiAnswerFeedback(
            fixture.dependencies,
            'admin',
            submitted.id,
            { expectedUpdatedAt: submitted.updatedAt },
            context('ai-feedback-diagnose-0001')
        ).feedback;
        assert.ok(diagnosed.diagnosis);
        const retested = executeRetestAiAnswerFeedback(
            fixture.dependencies,
            'admin',
            submitted.id,
            {
                answerText: '复测后确认是性能测试报告。',
                toolResults: [],
                expectedUpdatedAt: diagnosed.updatedAt,
            },
            context('ai-feedback-retest-0001')
        ).feedback;
        const reviewed = executeReviewAiAnswerFeedback(
            fixture.dependencies,
            'admin',
            submitted.id,
            {
                status: 'resolved',
                resolutionNote: '已复测',
                expectedUpdatedAt: retested.updatedAt,
            },
            context('ai-feedback-review-0001')
        ).feedback;
        assert.equal(reviewed.status, 'resolved');
        assert.throws(() => executeReviewAiAnswerFeedback(
            fixture.dependencies,
            'admin',
            submitted.id,
            {
                status: 'open',
                expectedUpdatedAt: submitted.updatedAt,
            },
            context('ai-feedback-review-0002')
        ), /已被其他操作修改/);
    } finally {
        fixture.db.close();
    }
});

test('AI 反馈命令：原会话软删除后反馈仍按 owner 隔离并可处理', () => {
    const fixture = createFixture();
    try {
        const submitted = executeSubmitAiAnswerFeedback(
            fixture.dependencies,
            'admin',
            {
                messageId: fixture.messageId,
                rating: 'incorrect',
                note: '正确分类是性能测试报告。',
                learnFromCorrection: true,
            },
            context('ai-feedback-submit-deleted-conversation')
        ).feedback;
        fixture.db.prepare(`
            UPDATE ai_conversations
            SET deleted_at = '2026-08-19T01:17:10.138Z'
            WHERE id = ?
        `).run(submitted.conversationId);

        const diagnosed = executeDiagnoseAiAnswerFeedback(
            fixture.dependencies,
            'admin',
            submitted.id,
            { expectedUpdatedAt: submitted.updatedAt },
            context('ai-feedback-diagnose-deleted-conversation')
        ).feedback;
        assert.equal(diagnosed.conversationDeleted, true);
        assert.throws(() => executeDiagnoseAiAnswerFeedback(
            fixture.dependencies,
            'operator',
            submitted.id,
            { expectedUpdatedAt: diagnosed.updatedAt },
            context('ai-feedback-diagnose-wrong-owner')
        ), /反馈不存在/);

        const reviewed = executeReviewAiAnswerFeedback(
            fixture.dependencies,
            'admin',
            submitted.id,
            {
                status: 'resolved',
                resolutionNote: '已根据反馈快照完成处理',
                expectedUpdatedAt: diagnosed.updatedAt,
            },
            context('ai-feedback-review-deleted-conversation')
        ).feedback;
        assert.equal(reviewed.status, 'resolved');
        assert.equal(reviewed.conversationDeleted, true);
    } finally {
        fixture.db.close();
    }
});

test('AI 反馈命令：长期规则修改同步回归用例并逐项强审计', () => {
    const fixture = createFixture();
    try {
        const submitted = executeSubmitAiAnswerFeedback(
            fixture.dependencies,
            'admin',
            {
                messageId: fixture.messageId,
                rating: 'incorrect',
                note: '附件不是参考图纸，正确分类是性能测试报告。',
                learnFromCorrection: true,
            },
            context('ai-feedback-submit-0003')
        ).feedback;
        const updated = executeUpdateFactoryAiRule(
            fixture.dependencies,
            submitted.learningRule.id,
            {
                instruction: '正确分类是水泵性能测试报告。',
                conflictGroup: 'test-report-classification',
                expectedUpdatedAt: submitted.learningRule.updatedAt,
            },
            context('ai-learning-rule-update-0001')
        );
        assert.equal(updated.capabilityId, 'ai.learning_rules.update');
        assert.equal(updated.auditIds.length, 3);
        assert.match(updated.rule.instruction, /水泵性能测试报告/);
        assert.equal(updated.rule.conflictGroup, 'test-report-classification');
        assert.match(
            fixture.db.prepare(`
                SELECT config_json
                FROM ai_evaluation_cases
                WHERE source_feedback_id = ?
            `).get(submitted.id).config_json,
            /水泵性能测试报告/
        );
    } finally {
        fixture.db.close();
    }
});

test('AI 反馈命令：派生写缺少强审计时反馈、规则和 operation 整体回滚', () => {
    const fixture = createFixture();
    try {
        const missingAudit = {
            ...fixture.dependencies,
            safeInsert(table, values) {
                const columns = Object.keys(values);
                return fixture.db.prepare(`
                    INSERT INTO ${table} (${columns.join(', ')})
                    VALUES (${columns.map(() => '?').join(', ')})
                `).run(...columns.map(key => values[key]));
            },
            safeUpdate(table, id, values) {
                const columns = Object.keys(values);
                return fixture.db.prepare(`
                    UPDATE ${table}
                    SET ${columns.map(key => `${key} = ?`).join(', ')}
                    WHERE id = ?
                `).run(...columns.map(key => values[key]), id);
            },
        };
        assert.throws(() => executeSubmitAiAnswerFeedback(
            missingAudit,
            'admin',
            {
                messageId: fixture.messageId,
                rating: 'incorrect',
                note: '附件不是参考图纸，正确分类是性能测试报告。',
                learnFromCorrection: true,
            },
            context('ai-feedback-submit-0004')
        ), /强审计记录不完整/);
        assert.equal(
            fixture.db.prepare(
                'SELECT COUNT(*) count FROM ai_answer_feedback'
            ).get().count,
            0
        );
        assert.equal(
            fixture.db.prepare(
                "SELECT COUNT(*) count FROM api_operations WHERE capability_id = 'ai.feedback.submit'"
            ).get().count,
            0
        );
    } finally {
        fixture.db.close();
    }
});
