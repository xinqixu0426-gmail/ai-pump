const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { CANONICAL_TABLES_SQL } = require('../api/database/schema.cjs');
const { CATALOG_IDENTITY_SCHEMA_SQL } = require('../api/database/catalogSchema.cjs');
const { queryPartRenameImpact } = require('../api/services/partRenameQuery.cjs');
const { inspectPartRename } = require('../api/services/partRenameImpact.cjs');

function fixture(t) {
    const db = new Database(':memory:');
    t.after(() => db.close());
    db.exec(CANONICAL_TABLES_SQL);
    db.exec(CATALOG_IDENTITY_SCHEMA_SQL);
    db.exec('ALTER TABLE parts ADD COLUMN naming_json TEXT');
    db.prepare('INSERT INTO parts (model, supplier, stock, price) VALUES (?, ?, ?, ?)').run('旧名称', '甲', 7, 3);
    return db;
}

test('改名影响报告给出全部阻塞及具体引用，Query 不产生写入或授权', t => {
    const db = fixture(t);
    db.prepare('INSERT INTO parts (model, supplier) VALUES (?, ?)').run('新名称', '甲');
    db.prepare('INSERT INTO recipes (name, parts_json) VALUES (?, ?)').run('测试配方',
        JSON.stringify([{ partId: 1, model: '旧名称' }, { model: '旧名称', supplier: '甲' }]));
    db.pragma('query_only = ON');
    const before = db.prepare('SELECT total_changes() n').get().n;
    const report = queryPartRenameImpact(db, 1, { model: '新名称' });
    assert.equal(report.complete, true);
    assert.deepEqual(report.blockers.map(item => item.code), ['PART_RENAME_NAME_CONFLICT', 'PART_RENAME_REFERENCES_REQUIRE_MIGRATION']);
    assert.equal(report.blockers[0].conflictingPartId, 2);
    assert.ok(report.references.some(ref => ref.sourceType === 'recipe' && ref.path === '/parts_json/0/model'));
    assert.ok(report.references.some(ref => ref.status === 'resolved_legacy'));
    assert.equal(report.referenceCount, report.references.length);
    assert.equal(report.displayOnly, true);
    assert.equal(report.confirmationToken, undefined);
    assert.equal(db.prepare('SELECT total_changes() n').get().n, before);
    const current = db.prepare('SELECT * FROM parts WHERE id = 1').get();
    assert.throws(() => inspectPartRename(db, current, { model: '新名称' }), { code: report.blockers[0].code });
});

test('影响报告分页绑定来源哈希，来源和目标改变后不能拼接旧页', t => {
    const db = fixture(t);
    db.prepare('INSERT INTO recipes (name, parts_json) VALUES (?, ?)').run('测试',
        JSON.stringify([{ model: '旧名称', partId: 1 }, { model: '旧名称', partId: 1 }]));
    const first = queryPartRenameImpact(db, 1, { model: '新名称', limit: 1 });
    assert.equal(first.references.length, 1);
    assert.equal(first.nextOffset, 1);
    const second = queryPartRenameImpact(db, 1, { model: '新名称', offset: 1, sourceHash: first.sourceHash });
    assert.equal(second.nextOffset, null);
    assert.notEqual(second.references[0].path, first.references[0].path);
    db.prepare('UPDATE parts SET price = ? WHERE id = 1').run(9);
    assert.throws(() => queryPartRenameImpact(db, 1, { model: '新名称', offset: 1, sourceHash: first.sourceHash }), { code: 'PART_RENAME_QUERY_STALE' });
});

test('无引用和名称未变不产生改名授权，生成名仍报告普通修改限制', t => {
    const db = fixture(t);
    const report = queryPartRenameImpact(db, 1, { model: '新名称' });
    assert.deepEqual(report.blockers, []);
    assert.equal(report.referenceCount, 0);
    db.prepare('UPDATE parts SET model = ?, category = ?, naming_json = ? WHERE id = 1').run('纸箱-大', '包装',
        JSON.stringify({ ruleId: 'packaging', ruleVersion: 1, spec: { kind: '纸箱', specification: '大' } }));
    assert.equal(queryPartRenameImpact(db, 1, { model: '任意名称' }).blockers[0].code, 'PART_NAMING_MODEL_MISMATCH');
    const unchanged = queryPartRenameImpact(db, 1, { model: '纸箱-大' });
    assert.equal(unchanged.nameChanged, false);
    assert.deepEqual(unchanged.blockers, []);
});

test('损坏来源显式报告盘点不完整，参数和停用目标不能冒充零引用', t => {
    const db = fixture(t);
    db.prepare('INSERT INTO recipes (name, parts_json) VALUES (?, ?)').run('损坏', '{broken');
    const report = queryPartRenameImpact(db, 1, { model: '新名称' });
    assert.equal(report.complete, false);
    assert.equal(report.blockers[0].code, 'PART_RENAME_AUDIT_INCOMPLETE');
    for (const input of [{ model: '' }, { model: '新', limit: 101 }, { model: '新', offset: -1 }, { model: '新', execute: true }]) {
        assert.throws(() => queryPartRenameImpact(db, 1, input), { code: 'PART_RENAME_QUERY_INVALID' });
    }
    assert.throws(() => queryPartRenameImpact(db, 1, { model: '新', offset: 1 }), { code: 'PART_RENAME_QUERY_HASH_REQUIRED' });
    db.prepare('UPDATE parts SET deleted_at = ? WHERE id = 1').run('now');
    assert.throws(() => queryPartRenameImpact(db, 1, { model: '新' }), { code: 'PART_NOT_FOUND' });
});
