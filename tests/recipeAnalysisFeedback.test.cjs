const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { saveRecipeAnalysisFeedback } = require('../api/services/recipeAnalysisFeedback.cjs');

function createFixture() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE recipes (
            id INTEGER PRIMARY KEY,
            deleted_at TEXT
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
        INSERT INTO recipes(id, deleted_at) VALUES (1, NULL);
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
