const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    DEFAULT_AUDIT_RETENTION_DAYS,
    auditRetentionDays,
    pruneAuditLog,
} = require('../api/services/auditRetention.cjs');

function auditDatabase() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT
        )
    `);
    return db;
}

test('审计保留：默认保留 365 天且过短配置回退默认值', () => {
    assert.equal(auditRetentionDays(undefined), DEFAULT_AUDIT_RETENTION_DAYS);
    assert.equal(auditRetentionDays('29'), DEFAULT_AUDIT_RETENTION_DAYS);
    assert.equal(auditRetentionDays('730'), 730);
    assert.equal(auditRetentionDays('0'), 0);
});

test('审计保留：只删除超过保留期的日志', () => {
    const db = auditDatabase();
    try {
        const insert = db.prepare('INSERT INTO audit_log (created_at) VALUES (?)');
        insert.run('2025-01-01T00:00:00.000Z');
        insert.run('2026-01-01T00:00:00.000Z');
        const result = pruneAuditLog(db, {
            retentionDays: 365,
            now: new Date('2026-07-25T00:00:00.000Z'),
        });
        assert.equal(result.deletedCount, 1);
        assert.deepEqual(
            db.prepare('SELECT created_at FROM audit_log ORDER BY id').all(),
            [{ created_at: '2026-01-01T00:00:00.000Z' }]
        );
    } finally {
        db.close();
    }
});
