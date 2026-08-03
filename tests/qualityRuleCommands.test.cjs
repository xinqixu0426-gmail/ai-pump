const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../api/database/migrations.cjs');
const {
    executeRefreshFactoryRuleCandidates,
    executeResolveRecipeAnalysisFeedback,
    executeRestoreFactoryRuleEvent,
    executeReviewFactoryRuleCandidate,
    executeSaveRecipeAnalysisFeedback,
} = require('../api/services/qualityRuleCommands.cjs');

function createFixture(overrides = {}) {
    const db = new Database(':memory:');
    runMigrations(db, { now: '2026-08-03T14:00:00.000Z' });
    let tick = 0;
    const nextTime = () => (
        `2026-08-03T14:00:${String(++tick).padStart(2, '0')}.000Z`
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
        hardDelete(table, id, context) {
            const info = db.prepare(
                `DELETE FROM ${table} WHERE id = ?`
            ).run(id);
            return {
                ...info,
                auditId: audit('DELETE', table, id, context),
            };
        },
        analyzeRecipeConfiguration() {
            return {
                factoryRuleAlerts: [],
                missingItems: [],
                priceAlerts: [],
                suppressedFindings: [],
            };
        },
        ...overrides,
    };
    db.exec(`
        INSERT INTO pump_shell_templates(id, shell_model)
        VALUES (7, 'V750');
        INSERT INTO recipes(id, name, template_id, updated_at, deleted_at)
        VALUES
            (1, 'V750 A', 7, '2026-08-03T13:00:00.000Z', NULL),
            (2, 'V750 B', 7, '2026-08-03T13:00:00.000Z', NULL);
    `);
    return { db, dependencies };
}

function context(key) {
    return {
        actorKey: 'user:quality-rule-test',
        idempotencyKey: key,
        operationId: `operation:${key}`,
        requestId: `request:${key}`,
        warnings: [],
    };
}

function feedbackInput(overrides = {}) {
    return {
        findingKey: 'peer_pattern:包装:fixed',
        findingType: 'peer_pattern',
        decision: 'confirmed',
        note: '同类泵通常需要说明书',
        findingSnapshot: {
            title: '同类配方通常包含「说明书」',
        },
        ...overrides,
    };
}

function seedCandidate(fixture) {
    executeSaveRecipeAnalysisFeedback(
        fixture.dependencies,
        1,
        feedbackInput(),
        context('quality-feedback-save-0001')
    );
    executeSaveRecipeAnalysisFeedback(
        fixture.dependencies,
        2,
        feedbackInput(),
        context('quality-feedback-save-0002')
    );
    return fixture.db.prepare(
        'SELECT * FROM factory_rule_candidates ORDER BY id LIMIT 1'
    ).get();
}

test('质量反馈命令：反馈、候选规则和事件原子审计且相同请求可重放', () => {
    const fixture = createFixture();
    try {
        const first = executeSaveRecipeAnalysisFeedback(
            fixture.dependencies,
            1,
            feedbackInput(),
            context('quality-feedback-save-replay')
        );
        const replay = executeSaveRecipeAnalysisFeedback(
            fixture.dependencies,
            1,
            feedbackInput(),
            context('quality-feedback-save-replay')
        );
        assert.equal(first.capabilityId, 'quality.recipe_feedback.save');
        assert.equal(first.auditIds.length, 1);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(
            fixture.db.prepare(
                'SELECT COUNT(*) count FROM recipe_analysis_feedback'
            ).get().count,
            1
        );

        const second = executeSaveRecipeAnalysisFeedback(
            fixture.dependencies,
            2,
            feedbackInput(),
            context('quality-feedback-save-candidate')
        );
        assert.equal(second.feedback.ruleLearning.refreshed, true);
        assert.equal(second.auditIds.length, 3);
        assert.equal(
            fixture.db.prepare(
                'SELECT COUNT(*) count FROM factory_rule_candidates'
            ).get().count,
            1
        );
        assert.equal(
            fixture.db.prepare(
                'SELECT COUNT(*) count FROM factory_rule_events'
            ).get().count,
            1
        );
    } finally {
        fixture.db.close();
    }
});

test('候选规则命令：审核和历史恢复绑定版本并同步派生知识', () => {
    const fixture = createFixture();
    try {
        const seeded = seedCandidate(fixture);
        const approved = executeReviewFactoryRuleCandidate(
            fixture.dependencies,
            seeded.id,
            {
                status: 'approved',
                reviewNote: '证据充分',
                expectedUpdatedAt: seeded.updated_at,
            },
            context('quality-rule-review-0001')
        );
        assert.equal(approved.capabilityId, 'quality.rule_candidates.review');
        assert.equal(approved.candidate.status, 'approved');
        assert.equal(approved.auditIds.length, 3);
        assert.equal(
            fixture.db.prepare(`
                SELECT COUNT(*) count
                FROM knowledge_entries
                WHERE source_table = 'factory_rule_candidates'
            `).get().count,
            1
        );

        assert.throws(
            () => executeReviewFactoryRuleCandidate(
                fixture.dependencies,
                seeded.id,
                {
                    status: 'rejected',
                    expectedUpdatedAt: seeded.updated_at,
                },
                context('quality-rule-review-stale')
            ),
            error => error.code === 'resource_version_conflict'
        );

        const createdEvent = fixture.db.prepare(`
            SELECT *
            FROM factory_rule_events
            WHERE candidate_id = ? AND event_type = 'created'
        `).get(seeded.id);
        const current = fixture.db.prepare(
            'SELECT * FROM factory_rule_candidates WHERE id = ?'
        ).get(seeded.id);
        const restored = executeRestoreFactoryRuleEvent(
            fixture.dependencies,
            createdEvent.id,
            {
                restoreNote: '恢复到待审核',
                expectedUpdatedAt: current.updated_at,
            },
            context('quality-rule-restore-0001')
        );
        assert.equal(restored.capabilityId, 'quality.rule_events.restore');
        assert.equal(restored.restoration.candidate.status, 'candidate');
        assert.equal(restored.auditIds.length, 3);
        assert.equal(
            fixture.db.prepare(`
                SELECT COUNT(*) count
                FROM knowledge_entries
                WHERE source_table = 'factory_rule_candidates'
            `).get().count,
            0
        );
    } finally {
        fixture.db.close();
    }
});

test('质量反馈命令：过期反馈解决和显式刷新均返回持久化回执', () => {
    const fixture = createFixture();
    try {
        const saved = executeSaveRecipeAnalysisFeedback(
            fixture.dependencies,
            1,
            feedbackInput(),
            context('quality-feedback-resolve-seed')
        );
        fixture.db.prepare(
            'UPDATE recipes SET updated_at = ? WHERE id = 1'
        ).run('2026-08-03T15:00:00.000Z');
        const resolved = executeResolveRecipeAnalysisFeedback(
            fixture.dependencies,
            saved.feedback.id,
            {
                note: '重新检查后提醒已消失',
                expectedUpdatedAt: saved.feedback.updatedAt,
            },
            context('quality-feedback-resolve-0001')
        );
        assert.equal(
            resolved.capabilityId,
            'quality.recipe_feedback.resolve'
        );
        assert.equal(resolved.feedback.resolved, true);
        assert.equal(resolved.feedback.decision, 'review');

        const refreshed = executeRefreshFactoryRuleCandidates(
            fixture.dependencies,
            {},
            context('quality-rule-refresh-0001')
        );
        const replay = executeRefreshFactoryRuleCandidates(
            fixture.dependencies,
            {},
            context('quality-rule-refresh-0001')
        );
        assert.equal(
            refreshed.capabilityId,
            'quality.rule_candidates.refresh'
        );
        assert.equal(replay.idempotentReplay, true);
    } finally {
        fixture.db.close();
    }
});

test('质量反馈命令：任一派生写入缺少强审计时整体回滚', () => {
    const fixture = createFixture({
        safeInsert(table, values) {
            const columns = Object.keys(values);
            return fixture.db.prepare(`
                INSERT INTO ${table} (${columns.join(', ')})
                VALUES (${columns.map(() => '?').join(', ')})
            `).run(...columns.map(key => values[key]));
        },
    });
    try {
        assert.throws(
            () => executeSaveRecipeAnalysisFeedback(
                fixture.dependencies,
                1,
                feedbackInput(),
                context('quality-feedback-missing-audit')
            ),
            error => error.code === 'strong_audit_required'
        );
        assert.equal(
            fixture.db.prepare(
                'SELECT COUNT(*) count FROM recipe_analysis_feedback'
            ).get().count,
            0
        );
        assert.equal(
            fixture.db.prepare(`
                SELECT COUNT(*) count
                FROM api_operations
                WHERE capability_id = 'quality.recipe_feedback.save'
            `).get().count,
            0
        );
    } finally {
        fixture.db.close();
    }
});
