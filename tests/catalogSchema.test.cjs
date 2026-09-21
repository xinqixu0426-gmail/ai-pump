const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { CANONICAL_TABLES_SQL } = require('../api/database/schema.cjs');
const { CATALOG_IDENTITY_SCHEMA_SQL } = require('../api/database/catalogSchema.cjs');
const { MIGRATIONS, MIGRATION_TABLE_SQL, migrationChecksum, runMigrations } = require('../api/database/migrations.cjs');

// 从版本 82 的旧库开始，应当依次应用此后追加的全部迁移；不写死版本号，避免每次追加迁移都要改断言。
const VERSIONS_AFTER_82 = MIGRATIONS
    .filter(migration => migration.version > 82)
    .map(migration => migration.version);

function legacyFixture(t) {
    const db = new Database(':memory:');
    t.after(() => db.close());
    db.exec(CANONICAL_TABLES_SQL);
    db.exec(MIGRATION_TABLE_SQL);
    const insert = db.prepare('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)');
    for (const migration of MIGRATIONS.filter(item => item.version <= 82)) insert.run(migration.version, migration.name, migrationChecksum(migration), 'before');
    db.pragma('user_version = 82');
    db.prepare('INSERT INTO parts (model, stock, price) VALUES (?, ?, ?)').run('原物料', 11, 2.5);
    db.prepare('INSERT INTO recipes (name, parts_json, saved_total_cost) VALUES (?, ?, ?)').run('原配方', '[{"model":"原物料","snapshotPrice":2.5,"qty":2}]', 5);
    return db;
}

test('迁移 83/84/85 只扩展结构，保留主数据、库存和快照，重复运行不重复初始化', t => {
    const db = legacyFixture(t);
    const part = db.prepare('SELECT * FROM parts').all();
    const recipe = db.prepare('SELECT * FROM recipes').all();
    assert.deepEqual(runMigrations(db).appliedVersions, VERSIONS_AFTER_82);
    assert.deepEqual(db.prepare('SELECT * FROM parts').all(), part.map(row => ({ ...row, naming_json: null })));
    assert.deepEqual(db.prepare('SELECT * FROM recipes').all(), recipe);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalog_identity_profiles').get().n, 0);
    assert.deepEqual(runMigrations(db).appliedVersions, []);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('迁移中断回滚新表及版本记录，恢复后可重试', t => {
    const db = legacyFixture(t);
    const exec = db.exec.bind(db);
    db.exec = sql => exec(sql === CATALOG_IDENTITY_SCHEMA_SQL ? `${sql}\nSELECT * FROM deliberately_missing_table;` : sql);
    assert.throws(() => runMigrations(db), /deliberately_missing_table/);
    db.exec = exec;
    assert.equal(db.pragma('user_version', { simple: true }), 82);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'catalog_identity_profiles'").get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 83').get().n, 0);
    assert.deepEqual(runMigrations(db).appliedVersions, VERSIONS_AFTER_82);
});

test('类型化外键、唯一身份、合法 JSON 和同一快照位置唯一绑定由数据库约束保护', t => {
    const db = legacyFixture(t);
    runMigrations(db);
    const insert = db.prepare('INSERT INTO catalog_identity_profiles (part_id, recipe_id, created_at, updated_at) VALUES (?, ?, ?, ?)');
    assert.throws(() => insert.run(null, null, 'now', 'now'), /CHECK/);
    assert.throws(() => insert.run(1, 1, 'now', 'now'), /CHECK/);
    assert.throws(() => insert.run(999, null, 'now', 'now'), /FOREIGN KEY/);
    insert.run(1, null, 'now', 'now');
    assert.throws(() => insert.run(1, null, 'now', 'now'), /UNIQUE/);
    assert.throws(() => db.prepare("INSERT INTO catalog_identity_profiles (recipe_id, spec_json, created_at, updated_at) VALUES (1, '[]', 'now', 'now')").run(), /CHECK/);
    const binding = db.prepare("INSERT INTO catalog_reference_bindings (source_type, source_id, source_version, source_path, source_hash, target_profile_id, target_spec_revision, created_at, updated_at) VALUES ('recipe', 1, 'v1', '/parts_json/0/model', ?, 1, 1, 'now', 'now')");
    binding.run('a'.repeat(64));
    assert.throws(() => binding.run('a'.repeat(64)), /UNIQUE/);
    assert.throws(() => db.prepare('DELETE FROM parts WHERE id = 1').run(), /FOREIGN KEY/);
});
