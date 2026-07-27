const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    buildRuleCandidateGroups,
    refreshFactoryRuleCandidates,
    reviewFactoryRuleCandidate,
} = require('../api/services/factoryRuleCandidates.cjs');

function createFixture() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE recipes (
            id INTEGER PRIMARY KEY,
            name TEXT,
            template_id INTEGER,
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
            updated_at TEXT
        );
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
            status TEXT NOT NULL DEFAULT 'candidate',
            review_note TEXT DEFAULT '',
            approved_at TEXT,
            created_at TEXT,
            updated_at TEXT
        );
        INSERT INTO pump_shell_templates(id, shell_model) VALUES (7, 'V750 大脚板 2寸');
        INSERT INTO recipes(id, name, template_id, deleted_at) VALUES
            (1, 'V750 菲律宾', 7, NULL),
            (2, 'V750 越南', 7, NULL),
            (3, 'V750 删除', 7, '2026-01-01');
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

function insertFeedback(db, recipeId, overrides = {}) {
    db.prepare(`
        INSERT INTO recipe_analysis_feedback(
            recipe_id, finding_key, finding_type, decision, note,
            finding_snapshot_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        recipeId,
        overrides.findingKey || 'peer_pattern:包装:fixed',
        overrides.findingType || 'peer_pattern',
        overrides.decision || 'confirmed',
        overrides.note || '',
        JSON.stringify({ title: overrides.title || '同类配方通常包含「说明书」' }),
        '2026-01-01',
        '2026-01-02'
    );
}

test('候选规则只归纳同模板至少两个配方确认的同类高频项', () => {
    const rows = [
        { id: 1, recipe_id: 1, recipe_name: 'A', template_id: 7, template_name: 'V750', finding_key: 'peer_pattern:包装:fixed', finding_type: 'peer_pattern', decision: 'confirmed', finding_snapshot_json: '{"title":"通常有说明书"}' },
        { id: 2, recipe_id: 2, recipe_name: 'B', template_id: 7, template_name: 'V750', finding_key: 'peer_pattern:包装:fixed', finding_type: 'peer_pattern', decision: 'confirmed', finding_snapshot_json: '{"title":"通常有说明书"}' },
        { id: 3, recipe_id: 3, recipe_name: 'C', template_id: 7, template_name: 'V750', finding_key: 'catalog:202', finding_type: 'catalog_price_difference', decision: 'confirmed' },
    ];
    const groups = buildRuleCandidateGroups(rows);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].evidenceCount, 2);
    assert.equal(groups[0].scopeRef, '7');
    assert.match(groups[0].content, /2 个不同配方/);
});

test('候选规则可刷新、批准且保留证据', () => {
    const fixture = createFixture();
    try {
        insertFeedback(fixture.db, 1);
        insertFeedback(fixture.db, 2, { note: '已补说明书' });
        insertFeedback(fixture.db, 3);
        const refreshed = refreshFactoryRuleCandidates(fixture);
        assert.equal(refreshed.stats.created, 1);
        assert.equal(refreshed.candidates[0].evidenceCount, 2);
        assert.deepEqual(refreshed.candidates[0].evidence.map(item => item.recipeId).sort(), [1, 2]);

        const approved = reviewFactoryRuleCandidate(refreshed.candidates[0].id, {
            status: 'approved',
            reviewNote: '作为 V750 默认复核规则',
        }, fixture);
        assert.equal(approved.status, 'approved');
        assert.ok(approved.approvedAt);
        assert.equal(approved.reviewNote, '作为 V750 默认复核规则');
    } finally {
        fixture.db.close();
    }
});

test('证据不足的候选规则不能批准', () => {
    const fixture = createFixture();
    try {
        fixture.safeInsert('factory_rule_candidates', {
            rule_key: 'template:7:peer_pattern:测试',
            title: '测试',
            content: '测试',
            scope_type: 'pump_shell_template',
            scope_ref: '7',
            finding_key: 'peer_pattern:测试',
            finding_type: 'peer_pattern',
            evidence_count: 1,
            evidence_json: '[]',
            status: 'candidate',
            created_at: '2026-01-01',
            updated_at: '2026-01-01',
        });
        assert.throws(
            () => reviewFactoryRuleCandidate(1, { status: 'approved' }, fixture),
            /至少需要 2 个不同配方/
        );
    } finally {
        fixture.db.close();
    }
});
