const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { CANONICAL_TABLES_SQL } = require('../api/database/schema.cjs');
const { CATALOG_IDENTITY_SCHEMA_SQL } = require('../api/database/catalogSchema.cjs');
const { resolveCatalogReferences } = require('../api/services/catalogReferences.cjs');

function fixture(t) {
    const db = new Database(':memory:');
    t.after(() => db.close());
    db.exec(CANONICAL_TABLES_SQL);
    db.exec(CATALOG_IDENTITY_SCHEMA_SQL);
    db.exec('ALTER TABLE pump_shell_templates ADD COLUMN deleted_at TEXT');
    db.prepare('INSERT INTO parts (model, supplier, stock) VALUES (?, ?, ?)').run('轴承-202', '甲', 9);
    db.prepare('INSERT INTO parts (model, supplier, stock) VALUES (?, ?, ?)').run('轴承-202', '乙', 10);
    db.prepare("INSERT INTO parts (model, deleted_at) VALUES ('已停用', 'now')").run();
    db.prepare("INSERT INTO catalog_identity_profiles (part_id, naming_state, rule_id, spec_fingerprint, name_revision, spec_revision, created_at, updated_at) VALUES (1, 'structured', 'bearing', ?, 3, 2, 'now', 'now')").run('a'.repeat(64));
    return db;
}

test('按 ID 批量投影现名，保持旧名称与库存；重复请求不产生写入', t => {
    const db = fixture(t);
    db.pragma('query_only = ON');
    const before = db.prepare('SELECT total_changes() AS n').get().n;
    const input = { references: [
        { entityType: 'part', entityId: 1, snapshotName: '202', specRevision: 2 },
        { entityType: 'part', entityId: 2, snapshotName: '旧乙名称' },
    ] };
    const result = resolveCatalogReferences(db, input);
    assert.equal(result.items[0].currentName, '轴承-202');
    assert.equal(result.items[0].snapshotName, '202');
    assert.equal(result.items[0].nameRevision, 3);
    assert.equal(result.items[0].referenceStatus, 'resolved');
    assert.equal(result.items[1].entityId, 2);
    assert.equal(result.items[1].namingState, 'legacy');
    assert.deepEqual(resolveCatalogReferences(db, input), result);
    assert.equal(db.prepare('SELECT total_changes() AS n').get().n, before);
    assert.equal(db.prepare('SELECT stock FROM parts WHERE id=1').get().stock, 9);
    assert.equal(input.references[0].snapshotName, '202');
});

test('缺失、停用、规格变化和未核实规格分别报告，不能用名字匹配其他记录', t => {
    const db = fixture(t);
    const result = resolveCatalogReferences(db, { references: [
        { entityType: 'part', entityId: 999, snapshotName: '轴承-202' },
        { entityType: 'part', entityId: 3 },
        { entityType: 'part', entityId: 1, specRevision: 1 },
        { entityType: 'part', entityId: 2, specRevision: 1 },
    ] });
    assert.deepEqual(result.items.map(item => item.referenceStatus), ['missing', 'inactive', 'specification_changed', 'specification_unverified']);
    assert.equal(result.items[0].currentName, null);
});

test('全部资源查询可用，非法类型/ID/字段和超预算不得进入数据库', t => {
    const db = fixture(t);
    const types = ['part', 'coil', 'template', 'recipe', 'modelVariant'];
    assert.equal(resolveCatalogReferences(db, { references: types.map(entityType => ({ entityType, entityId: 999 })) }).items.length, 5);
    assert.deepEqual(resolveCatalogReferences(db, { references: [] }).items, []);
    for (const input of [
        { references: [{ entityType: 'part', entityId: true }] },
        { references: [{ entityType: 'part', entityId: '1' }] },
        { references: [{ entityType: 'part', entityId: -1 }] },
        { references: [{ entityType: 'part', entityId: 1, model: '覆盖名' }] },
        { references: [{ entityType: 'orders', entityId: 1 }] },
        { references: Array(101).fill({ entityType: 'part', entityId: 1 }) },
    ]) assert.throws(() => resolveCatalogReferences(db, input), error => error.code === 'CATALOG_REFERENCES_INVALID');
});
