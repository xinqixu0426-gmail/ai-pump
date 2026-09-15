const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { readBusinessChangeRevision } = require('../api/services/businessChangeRevision.cjs');

test('变更版本按提交 ID 读取，不受业务时间排序影响，回滚不发出新版本', () => {
    const db = new Database(':memory:');
    try {
        db.exec('CREATE TABLE business_change_events (id INTEGER PRIMARY KEY, operation_id TEXT, occurred_at TEXT)');
        assert.equal(readBusinessChangeRevision(db).revision, 'empty');
        db.prepare('INSERT INTO business_change_events VALUES (?, ?, ?)').run(1, 'first', '2099');
        db.prepare('INSERT INTO business_change_events VALUES (?, ?, ?)').run(2, 'second', '2000');
        assert.equal(readBusinessChangeRevision(db).revision, '2:second');
        assert.throws(() => db.transaction(() => {
            db.prepare('INSERT INTO business_change_events VALUES (?, ?, ?)').run(3, 'rollback', '2100');
            throw new Error('rollback');
        })(), /rollback/);
        assert.equal(readBusinessChangeRevision(db).revision, '2:second');
        assert.equal(db.prepare('SELECT count(*) n FROM business_change_events').get().n, 2);
    } finally { db.close(); }
});
