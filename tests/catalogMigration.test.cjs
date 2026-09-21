const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-migration-'));
process.env.NODE_ENV = 'test';
process.env.PUMP_TEST_DATABASE_PATH = path.join(dir, 'pump-{pid}.db');
const deps = require('../api/db.cjs');
const { previewCatalogMigration, executeCatalogMigration } = require('../api/services/catalogMigration.cjs');
const { auditCatalogReferences } = require('../api/services/catalogReferenceAudit.cjs');
const { createDatabaseBackup } = require('../api/services/databaseBackup.cjs');
const { restoreDatabaseBackup, RESTORE_CONFIRMATION } = require('../api/services/databaseRestore.cjs');
test.after(() => { deps.stopBackupScheduler(); deps.db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const subject = 'test:migration';
const part = code => Number(deps.safeInsert('parts', { model: code, category: '轴承', supplier: '甲', price: 2, stock: 10, updated_at: new Date().toISOString() }).lastInsertRowid);
const entry = (id, code) => ({ entityType: 'part', entityId: id, expectedUpdatedAt: deps.db.prepare('SELECT updated_at FROM parts WHERE id=?').get(id).updated_at, samePhysicalItem: true, naming: { ruleId: 'bearing', spec: { code } } });
const apply = (preview, dependencies = deps) => executeCatalogMigration(dependencies, { confirmationToken: preview.confirmationToken, idempotencyKey: preview.suggestedIdempotencyKey }, { actorKey: subject, idempotencyKey: preview.suggestedIdempotencyKey }, subject);
const snapshot = () => ['parts', 'catalog_identity_profiles', 'catalog_reference_bindings', 'audit_log', 'api_operations', 'business_change_events'].map(table => deps.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all());

test('已核对批量改名一次事务完成、相交引用续接，保留库存/金额/原快照并支持幂等', () => {
    const a = part('6202'); const b = part('6203');
    const recipeId = Number(deps.safeInsert('recipes', { name: '历史配方', parts_json: JSON.stringify([{ partId: a, model: '6202', supplier: '甲', qty: 2 }, { partId: b, model: '6203', supplier: '甲', qty: 1 }]), saved_total_cost: 6 }).lastInsertRowid);
    const original = deps.db.prepare('SELECT * FROM recipes WHERE id=?').get(recipeId);
    const baseline = auditCatalogReferences(deps.db).businessBaseline;
    const beforePreview = snapshot();
    const preview = previewCatalogMigration(deps.db, { entries: [entry(a, '202'), entry(b, '203')] }, subject);
    assert.deepEqual(snapshot(), beforePreview);
    const result = apply(preview);
    assert.equal(result.migratedCount, 2);
    assert.ok(result.auditIds.length >= 4);
    assert.equal(apply(preview).idempotentReplay, true);
    assert.deepEqual(deps.db.prepare('SELECT * FROM recipes WHERE id=?').get(recipeId), original);
    assert.deepEqual(auditCatalogReferences(deps.db).businessBaseline, baseline);
    const live = deps.recipeRow(original);
    assert.deepEqual(JSON.parse(live.partsJson).map(part => part.model), ['轴承-202', '轴承-203']);
});

test('批次重复对象/生成撞名、来源漂移、换主体和中途写失败均安全拒绝或整体回滚', () => {
    const a = part('6204'); const b = part('6205');
    const first = entry(a, '204'); const second = entry(b, '205');
    assert.throws(() => previewCatalogMigration(deps.db, { entries: [first, first] }, subject), error => error.code === 'CATALOG_MIGRATION_DUPLICATE');
    assert.throws(() => previewCatalogMigration(deps.db, { entries: [first, { ...second, naming: first.naming }] }, subject), error => error.code === 'CATALOG_MIGRATION_NAME_CONFLICT');
    const stale = previewCatalogMigration(deps.db, { entries: [first, second] }, subject);
    deps.safeUpdate('parts', a, { stock: 11 });
    assert.throws(() => apply(stale), error => /resource_version_conflict|CATALOG_MIGRATION_PREVIEW_STALE/.test(error.code));
    const preview = previewCatalogMigration(deps.db, { entries: [entry(a, '204'), second] }, subject);
    assert.throws(() => executeCatalogMigration(deps, { confirmationToken: preview.confirmationToken, idempotencyKey: preview.suggestedIdempotencyKey }, { actorKey: 'other' }, 'other'), error => error.code === 'confirmation_subject_mismatch');
    const before = snapshot();
    let writes = 0;
    assert.throws(() => apply(preview, { ...deps, safeUpdate: (...args) => { if (args[0] === 'parts' && ++writes === 2) throw new Error('第二条写入故障'); return deps.safeUpdate(...args); } }), /第二条写入故障/);
    assert.deepEqual(snapshot(), before);
});

test('目录迁移后用正式备份/恢复服务演练恢复，完整表数据与备份一致', async () => {
    const backupRoot = path.join(dir, 'backups');
    const baseline = snapshot();
    const backup = await createDatabaseBackup(deps.db, { type: 'release', root: backupRoot, gitCommit: 'catalog-migration-rehearsal' });
    const a = part('6206');
    apply(previewCatalogMigration(deps.db, { entries: [entry(a, '206')] }, subject));
    const targetPath = path.join(dir, 'restored.db');
    await deps.db.backup(targetPath);
    await restoreDatabaseBackup({ root: backupRoot, backupPath: backup.path, targetPath, confirmation: RESTORE_CONFIRMATION, expectedGitCommit: 'catalog-migration-rehearsal', port: 39999 });
    const restored = new Database(targetPath, { readonly: true });
    try {
        const tables = ['parts', 'catalog_identity_profiles', 'catalog_reference_bindings', 'audit_log', 'api_operations', 'business_change_events'];
        assert.deepEqual(tables.map(table => restored.prepare(`SELECT * FROM ${table} ORDER BY id`).all()), baseline);
        assert.equal(restored.pragma('integrity_check', { simple: true }), 'ok');
        assert.deepEqual(restored.pragma('foreign_key_check'), []);
    } finally { restored.close(); }
});
