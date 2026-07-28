const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    resolveRecipeAnalysisFeedback,
    saveRecipeAnalysisFeedback,
} = require('../api/services/recipeAnalysisFeedback.cjs');

function createFixture() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE recipes (
            id INTEGER PRIMARY KEY,
            name TEXT,
            template_id INTEGER,
            updated_at TEXT,
            deleted_at TEXT
        );
        CREATE TABLE pump_shell_templates (
            id INTEGER PRIMARY KEY,
            shell_model TEXT
        );
        CREATE TABLE recipe_analysis_feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id INTEGER NOT NULL,
            finding_key TEXT NOT NULL,
            finding_type TEXT NOT NULL,
            decision TEXT NOT NULL,
            note TEXT DEFAULT '',
            finding_snapshot_json TEXT DEFAULT '{}',
            created_at TEXT,
            updated_at TEXT,
            UNIQUE(recipe_id, finding_key)
        );
        INSERT INTO pump_shell_templates(id, shell_model) VALUES (7, 'V750');
        INSERT INTO recipes(id, name, template_id, updated_at, deleted_at)
        VALUES (1, 'V750 A', 7, '2026-01-01', NULL);
    `);
    const safeInsert = (table, values) => {
        const columns = Object.keys(values);
        return db.prepare(`
            INSERT INTO ${table} (${columns.join(', ')})
            VALUES (${columns.map(() => '?').join(', ')})
        `).run(...columns.map(column => values[column]));
    };
    const safeUpdate = (table, id, values) => {
        const columns = Object.keys(values);
        db.prepare(`
            UPDATE ${table}
            SET ${columns.map(column => `${column} = ?`).join(', ')}, updated_at = ?
            WHERE id = ?
        `).run(...columns.map(column => values[column]), new Date().toISOString(), id);
    };
    return { db, safeInsert, safeUpdate };
}

function createLearningFixture() {
    const fixture = createFixture();
    fixture.db.exec(`
        CREATE TABLE factory_rule_candidates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rule_key TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            scope_type TEXT NOT NULL,
            scope_ref TEXT NOT NULL,
            finding_key TEXT NOT NULL,
            finding_type TEXT NOT NULL,
            evidence_count INTEGER NOT NULL DEFAULT 0,
            evidence_json TEXT DEFAULT '[]',
            support_count INTEGER NOT NULL DEFAULT 0,
            special_case_count INTEGER NOT NULL DEFAULT 0,
            ignored_count INTEGER NOT NULL DEFAULT 0,
            confidence_score REAL NOT NULL DEFAULT 0,
            learning_evidence_json TEXT DEFAULT '{}',
            learning_hash TEXT DEFAULT '',
            reviewed_learning_hash TEXT DEFAULT '',
            learning_updated_at TEXT,
            status TEXT NOT NULL DEFAULT 'candidate',
            review_note TEXT DEFAULT '',
            approved_at TEXT,
            created_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE factory_rule_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            candidate_id INTEGER NOT NULL,
            rule_key TEXT NOT NULL,
            event_type TEXT NOT NULL,
            previous_status TEXT,
            new_status TEXT,
            actor TEXT NOT NULL DEFAULT 'system',
            note TEXT DEFAULT '',
            snapshot_json TEXT DEFAULT '{}',
            created_at TEXT NOT NULL
        );
        CREATE TABLE knowledge_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_type TEXT NOT NULL,
            source_table TEXT NOT NULL,
            source_id TEXT NOT NULL,
            source_updated_at TEXT,
            title TEXT NOT NULL,
            summary TEXT DEFAULT '',
            content TEXT DEFAULT '',
            tags_json TEXT DEFAULT '[]',
            metadata_json TEXT DEFAULT '{}',
            search_text TEXT DEFAULT '',
            content_hash TEXT DEFAULT '',
            synced_at TEXT,
            created_at TEXT,
            updated_at TEXT,
            UNIQUE(source_table, source_id)
        );
        INSERT INTO recipes(id, name, template_id, updated_at, deleted_at)
        VALUES (2, 'V750 B', 7, '2026-01-01', NULL);
    `);
    return fixture;
}

test('配方检查反馈按配方和提醒键新增后更新', () => {
    const fixture = createFixture();
    try {
        const first = saveRecipeAnalysisFeedback(1, {
            findingKey: 'missing_shell',
            findingType: 'configuration_conflict',
            decision: 'ignored',
            note: '客户自备',
            findingSnapshot: { title: '缺少泵壳' },
        }, fixture);
        assert.equal(first.decision, 'ignored');

        const second = saveRecipeAnalysisFeedback(1, {
            findingKey: 'missing_shell',
            findingType: 'configuration_conflict',
            decision: 'review',
            note: '',
            findingSnapshot: { title: '缺少泵壳' },
        }, fixture);
        assert.equal(second.id, first.id);
        assert.equal(second.decision, 'review');
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM recipe_analysis_feedback').get().count, 1);
    } finally {
        fixture.db.close();
    }
});

test('配方检查反馈拒绝无效判断和不存在的配方', () => {
    const fixture = createFixture();
    try {
        assert.throws(
            () => saveRecipeAnalysisFeedback(1, {
                findingKey: 'missing_shell',
                findingType: 'configuration_conflict',
                decision: 'wrong',
            }, fixture),
            /decision 必须/
        );
        assert.throws(
            () => saveRecipeAnalysisFeedback(99, {
                findingKey: 'missing_shell',
                findingType: 'configuration_conflict',
                decision: 'ignored',
            }, fixture),
            /配方不存在/
        );
    } finally {
        fixture.db.close();
    }
});

test('配方检查反馈由服务端固化证据来源并覆盖客户端伪造上下文', () => {
    const fixture = createFixture();
    try {
        const saved = saveRecipeAnalysisFeedback(1, {
            findingKey: 'peer_pattern:包装:fixed',
            findingType: 'configuration_conflict',
            decision: 'confirmed',
            findingSnapshot: {
                title: '同类配方通常包含说明书',
                evidenceContext: {
                    recipeId: 999,
                    templateId: 999,
                    templateName: '伪造模板',
                },
            },
        }, fixture);
        const snapshot = JSON.parse(saved.findingSnapshotJson);
        assert.equal(snapshot.title, '同类配方通常包含说明书');
        assert.deepEqual(snapshot.evidenceContext, {
            recipeId: 1,
            recipeName: 'V750 A',
            templateId: 7,
            templateName: 'V750',
            recipeUpdatedAt: '2026-01-01',
            recordedAt: snapshot.evidenceContext.recordedAt,
        });
        assert.match(snapshot.evidenceContext.recordedAt, /^\d{4}-\d{2}-\d{2}T/);
    } finally {
        fixture.db.close();
    }
});

test('同类高频项反馈保存后自动归纳候选规则且失败时整体回滚', () => {
    const fixture = createLearningFixture();
    try {
        const first = saveRecipeAnalysisFeedback(1, {
            findingKey: 'peer_pattern:包装:fixed',
            findingType: 'peer_pattern',
            decision: 'confirmed',
            findingSnapshot: { title: '同类配方通常包含说明书' },
        }, fixture);
        assert.equal(first.ruleLearning.refreshed, true);
        assert.equal(first.ruleLearning.stats.active, 0);

        const second = saveRecipeAnalysisFeedback(2, {
            findingKey: 'peer_pattern:包装:fixed',
            findingType: 'peer_pattern',
            decision: 'confirmed',
            findingSnapshot: { title: '同类配方通常包含说明书' },
        }, fixture);
        assert.equal(second.ruleLearning.stats.created, 1);
        assert.equal(second.ruleLearning.candidateCount, 1);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM factory_rule_candidates').get().count, 1);

        assert.throws(
            () => saveRecipeAnalysisFeedback(1, {
                findingKey: 'peer_pattern:包装:manual',
                findingType: 'peer_pattern',
                decision: 'confirmed',
            }, {
                ...fixture,
                refreshFactoryRuleCandidates: () => {
                    throw new Error('归纳失败');
                },
            }),
            /归纳失败/
        );
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) AS count FROM recipe_analysis_feedback WHERE finding_key = ?')
                .get('peer_pattern:包装:manual').count,
            0
        );
    } finally {
        fixture.db.close();
    }
});

test('过期学习反馈在原提醒消失后可确认解决并保留原始证据', () => {
    const fixture = createLearningFixture();
    try {
        const saved = saveRecipeAnalysisFeedback(1, {
            findingKey: 'peer_pattern:包装:fixed',
            findingType: 'peer_pattern',
            decision: 'confirmed',
            note: '原判断',
            findingSnapshot: { title: '同类配方通常包含说明书' },
        }, fixture);
        const originalSnapshot = saved.findingSnapshotJson;

        assert.throws(
            () => resolveRecipeAnalysisFeedback(saved.id, {}, fixture),
            /仍对应当前配方版本/
        );

        fixture.db.prepare('UPDATE recipes SET updated_at = ? WHERE id = ?')
            .run('2026-02-01', 1);
        assert.throws(
            () => resolveRecipeAnalysisFeedback(saved.id, {}, {
                ...fixture,
                analyzeRecipeConfiguration: () => ({
                    missingItems: [{ key: 'peer_pattern:包装:fixed' }],
                }),
            }),
            /原提醒在当前配方智能检查中仍然存在/
        );

        const resolved = resolveRecipeAnalysisFeedback(saved.id, {}, {
            ...fixture,
            analyzeRecipeConfiguration: () => ({
                factoryRuleAlerts: [],
                missingItems: [],
                priceAlerts: [],
                suppressedFindings: [],
            }),
        });
        assert.equal(resolved.resolved, true);
        assert.equal(resolved.previousDecision, 'confirmed');
        assert.equal(resolved.resolutionReason, 'content_outdated');
        assert.equal(resolved.decision, 'review');
        assert.match(resolved.note, /原判断/);
        assert.match(resolved.note, /确认已解决/);
        assert.equal(resolved.findingSnapshotJson, originalSnapshot);

        const health = require('../api/services/factoryRuleCandidates.cjs')
            .buildFactoryLearningHealth(fixture);
        assert.equal(health.summary.totalEvidenceCount, 0);
        assert.equal(health.summary.recheckEvidenceCount, 0);
    } finally {
        fixture.db.close();
    }
});
