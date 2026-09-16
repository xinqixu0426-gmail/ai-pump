const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createPartsDataCache } = require('../api/services/partsDataCache.cjs');

function fixture(t, filename = ':memory:') {
    const db = new Database(filename);
    t.after(() => db.close());
    db.exec(`CREATE TABLE parts (
        id INTEGER PRIMARY KEY, model TEXT, supplier TEXT, price REAL,
        category TEXT, remark TEXT, deleted_at TEXT
    ); INSERT INTO parts VALUES (1, '旧名', '甲', 10, '配件', '备注', NULL)`);
    return { db, cache: createPartsDataCache(db) };
}

test('同连接内部写入后立即读现名/价格，删除与恢复生效，无变化时复用', t => {
    const { db, cache } = fixture(t);
    const original = cache.read();
    assert.equal(cache.read(), original);
    db.prepare('UPDATE parts SET model = ?, price = ? WHERE id = ?').run('新名', 20, 1);
    const renamed = cache.read();
    assert.equal(renamed.partsByModel['旧名'], undefined);
    assert.equal(renamed.partsByModel['新名'][0].id, 1);
    assert.equal(renamed.partsCache['新名'].price, 20);
    db.prepare('UPDATE parts SET deleted_at = ? WHERE id = ?').run('now', 1);
    assert.equal(cache.read().partsByModel['新名'], undefined);
    db.prepare('UPDATE parts SET deleted_at = NULL WHERE id = ?').run(1);
    assert.equal(cache.read().partsByModel['新名'][0].id, 1);
    const restored = cache.read();
    cache.invalidate();
    assert.notEqual(cache.read(), restored);
});

test('事务内读取自己的修改，回滚/嵌套保存点不污染提交后的缓存', t => {
    const { db, cache } = fixture(t);
    cache.read();
    assert.throws(() => db.transaction(() => {
        db.prepare('UPDATE parts SET model = ? WHERE id = ?').run('未提交', 1);
        assert.equal(cache.read().partsByModel['未提交'][0].id, 1);
        assert.throws(() => db.transaction(() => {
            db.prepare('UPDATE parts SET price = ? WHERE id = ?').run(999, 1);
            assert.equal(cache.read().partsCache['未提交'].price, 999);
            throw new Error('savepoint rollback');
        })(), /savepoint rollback/);
        assert.equal(cache.read().partsCache['未提交'].price, 10);
        throw new Error('outer rollback');
    })(), /outer rollback/);
    assert.equal(cache.read().partsByModel['未提交'], undefined);
    assert.equal(cache.read().partsCache['旧名'].price, 10);
    db.transaction(() => {
        db.prepare('UPDATE parts SET model = ? WHERE id = ?').run('已提交', 1);
        assert.equal(cache.read().partsByModel['已提交'][0].id, 1);
    })();
    assert.equal(cache.read().partsByModel['已提交'][0].id, 1);
});

test('其他连接提交自动失效；读事务遵守自身快照且不污染外部最新视图', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parts-cache-'));
    const filename = path.join(dir, 'catalog.db');
    const { db, cache } = fixture(t, filename);
    db.pragma('journal_mode = WAL');
    const writer = new Database(filename);
    t.after(() => writer.close());
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const original = cache.read();
    writer.prepare('UPDATE parts SET model = ? WHERE id = ?').run('外部现名', 1);
    assert.notEqual(cache.read(), original);
    db.transaction(() => {
        assert.equal(cache.read().partsCache['外部现名'].price, 10);
        writer.prepare('UPDATE parts SET price = ? WHERE id = ?').run(30, 1);
        assert.equal(cache.read().partsCache['外部现名'].price, 10);
    })();
    assert.equal(cache.read().partsCache['外部现名'].price, 30);
});

test('目录读取失败不伪装成旧缓存；同名多供应商与特殊名称保持独立记录', t => {
    const { db, cache } = fixture(t);
    db.prepare('INSERT INTO parts (id, model, supplier, price) VALUES (?, ?, ?, ?)').run(2, '旧名', '乙', 40);
    db.prepare('INSERT INTO parts (id, model, supplier, price) VALUES (?, ?, ?, ?)').run(3, '__proto__', '甲', 50);
    const result = cache.read();
    assert.deepEqual(result.partsByModel['旧名'].map(row => row.id), [1, 2]);
    assert.equal(result.partsByModel.__proto__[0].id, 3);
    const changes = db.prepare('SELECT total_changes() AS n').get().n;
    cache.invalidate();
    cache.read();
    assert.equal(db.prepare('SELECT total_changes() AS n').get().n, changes);
    db.exec('DROP TABLE parts');
    assert.throws(() => cache.read(), /no such table/);
});
