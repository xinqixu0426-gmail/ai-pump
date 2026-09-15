const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { CANONICAL_TABLES_SQL } = require('../api/database/schema.cjs');
const { CATALOG_IDENTITY_SCHEMA_SQL } = require('../api/database/catalogSchema.cjs');
const { auditCatalogReferences } = require('../api/services/catalogReferenceAudit.cjs');
const { catalogSourceHash, readCatalogSource, readSnapshotPointer } = require('../api/services/catalogSources.cjs');
const { previewCatalogBindings, executeCatalogBindings, readBoundCatalogNames } = require('../api/services/catalogBindings.cjs');

function fixture(t) {
    const db = new Database(':memory:');
    t.after(() => db.close());
    db.exec(CANONICAL_TABLES_SQL);
    db.exec(CATALOG_IDENTITY_SCHEMA_SQL);
    db.pragma('foreign_keys = ON');
    db.prepare('INSERT INTO parts (model, supplier, stock, price) VALUES (?, ?, ?, ?)').run('202', '甲', 9, 3);
    db.prepare('INSERT INTO parts (model, supplier, stock, price) VALUES (?, ?, ?, ?)').run('202', '乙', 8, 4);
    db.prepare('INSERT INTO recipes (name, parts_json) VALUES (?, ?)').run('V550', JSON.stringify([
        { model: '202', supplier: '甲', quantity: 2 }, { partId: 1, model: '202', supplier: '甲' },
        { model: '202' }, { model: '未知' }, { partId: 999 }, { model: '其他', partId: 1 },
        { model: '人工', inventoryType: 'none' }, { 'a/b~c': { partsJson: JSON.stringify([{ partId: 1 }]) } },
    ]));
    const dependencies = { db, safeInsert(table, values, context) {
        assert.ok(['catalog_identity_profiles', 'catalog_reference_bindings'].includes(table));
        assert.equal(context.requireAudit, true);
        const columns = Object.keys(values);
        assert.ok(columns.every(column => /^[a-z_]+$/.test(column)));
        const write = db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(values));
        const audit = db.prepare(`INSERT INTO audit_log (action, table_name, record_id, operation_id, capability_id, request_id, user)
            VALUES ('INSERT', ?, ?, ?, ?, ?, ?)`).run(table, Number(write.lastInsertRowid), context.operationId, context.capabilityId, context.requestId, context.user);
        return { ...write, auditId: Number(audit.lastInsertRowid) };
    } };
    function selection(path = '/parts_json/0/model', overrides = {}) {
        const ref = auditCatalogReferences(db).references.find(row => row.sourceType === 'recipe' && row.path === path);
        return { sourceType: 'recipe', sourceId: 1, path, sourceHash: ref.sourceHash, targetType: 'part', targetId: 1, ...overrides };
    }
    function preview(bindings = [selection()]) { return previewCatalogBindings(db, { bindings }, 'tester'); }
    function apply(preview, options = {}) {
        return executeCatalogBindings(options.dependencies || dependencies,
            { confirmationToken: preview.confirmationToken, ...options.input },
            { actorKey: 'tester', idempotencyKey: preview.suggestedIdempotencyKey, requestId: 'test-request', ...options.context },
            options.subject || 'tester');
    }
    return { db, dependencies, selection, preview, apply };
}

test('已核实绑定显示改名后的目录名，原快照、价格和库存不变，重复提交只返回回执', t => {
    const { db, preview, apply, selection } = fixture(t);
    const before = readCatalogSource(db, 'recipe', 1);
    const p = preview([selection(), selection('/parts_json/7/a~1b~0c/partsJson/0/partId')]);
    assert.equal(db.prepare('SELECT count(*) n FROM catalog_identity_profiles').get().n, 0);
    const receipt = apply(p);
    assert.equal(receipt.bindingIds.length, 2);
    assert.equal(receipt.auditIds.length, 3);
    assert.equal(db.prepare('SELECT count(*) n FROM business_change_events').get().n, 1);
    db.prepare("UPDATE parts SET model = '轴承-202' WHERE id = 1").run();
    const names = readBoundCatalogNames(db, { sourceType: 'recipe', sourceId: 1 });
    assert.deepEqual(names.items.map(row => row.snapshotValue), ['202', 1]);
    assert.ok(names.items.every(row => row.currentName === '轴承-202' && row.referenceStatus === 'bound_legacy' && row.displayOnly));
    assert.deepEqual(readCatalogSource(db, 'recipe', 1), before);
    assert.deepEqual(db.prepare('SELECT stock, price FROM parts WHERE id=1').get(), { stock: 9, price: 3 });
    assert.equal(apply(p).idempotentReplay, true);
    assert.equal(db.prepare('SELECT count(*) n FROM audit_log').get().n, 3);
    assert.throws(() => apply(p, { context: { idempotencyKey: 'another-key' } }), /幂等|绑定|确认/);
});

test('歧义、缺失、错误 ID、ID名称冲突、非库存描述以及伪造路径不能绑定', t => {
    const { preview, selection } = fixture(t);
    for (const path of ['/parts_json/2/model', '/parts_json/3/model', '/parts_json/4/partId', '/parts_json/5/model', '/parts_json/6/model']) {
        assert.throws(() => preview([selection(path)]), { code: 'catalog_binding_unresolved' });
    }
    for (const overrides of [{ targetId: 2 }, { targetType: 'recipe' }, { sourceHash: '0'.repeat(64) }, { path: '/name' }]) {
        assert.throws(() => preview([selection(undefined, overrides)]), { code: 'catalog_binding_unresolved' });
    }
    assert.throws(() => preview([selection(), selection()]), { code: 'catalog_binding_duplicate' });
});

test('来源、目标、档案及并发绑定变化使旧预览失效，失败不留下部分写入', async t => {
    for (const sql of [
        "UPDATE recipes SET parts_json='[]' WHERE id=1",
        'UPDATE parts SET stock=10 WHERE id=1',
        "INSERT INTO catalog_identity_profiles(part_id, created_at, updated_at) VALUES(1,'now','now')",
    ]) await t.test(sql.split(' ')[1], t => {
        const { db, preview, apply } = fixture(t);
        const p = preview();
        db.exec(sql);
        assert.throws(() => apply(p), error => ['catalog_binding_unresolved', 'catalog_binding_preview_stale'].includes(error.code));
        assert.equal(db.prepare('SELECT count(*) n FROM catalog_reference_bindings').get().n, 0);
        assert.equal(db.prepare('SELECT count(*) n FROM api_operations').get().n, 0);
    });
    await t.test('并发预览', t => {
        const { db, preview, apply } = fixture(t);
        const first = preview(), second = preview();
        apply(first);
        assert.throws(() => apply(second), { code: 'catalog_binding_preview_stale' });
        assert.equal(db.prepare('SELECT count(*) n FROM catalog_reference_bindings').get().n, 1);
        assert.throws(() => preview(), { code: 'catalog_binding_no_changes' });
    });
});

test('写入异常和缺失强审计导致整批档案、绑定、回执、业务事件回滚', async t => {
    for (const mode of ['throw', 'missingAudit']) await t.test(mode, t => {
        const { db, preview, apply, dependencies, selection } = fixture(t);
        const p = preview([selection(), selection('/parts_json/7/a~1b~0c/partsJson/0/partId')]);
        const faulty = { db, safeInsert(table, values, context) {
            if (table === 'catalog_reference_bindings' && mode === 'throw') throw new Error('injected failure');
            const result = dependencies.safeInsert(table, values, context);
            return mode === 'missingAudit' ? { ...result, auditId: null } : result;
        } };
        assert.throws(() => apply(p, { dependencies: faulty }));
        for (const table of ['catalog_identity_profiles', 'catalog_reference_bindings', 'api_operations', 'audit_log', 'business_change_events']) {
            assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
        }
        assert.equal(apply(p).status, 'completed');
    });
});

test('确认主体、显式幂等键和严格字段校验，不允许提交时替换映射', t => {
    const { db, preview, apply, selection } = fixture(t);
    const p = preview();
    assert.throws(() => apply(p, { subject: 'someone-else' }), /会话/);
    assert.throws(() => apply(p, { context: { idempotencyKey: undefined } }), { code: 'idempotency_key_required' });
    assert.throws(() => apply(p, { context: { warnings: [{ code: 'idempotency_key_missing_compatibility' }] } }), { code: 'idempotency_key_required' });
    assert.throws(() => apply(p, { input: { bindings: [selection()] } }), { code: 'catalog_binding_invalid' });
    for (const bindings of [[], Array(101).fill(selection()), [selection(undefined, { targetId: '1' })], [selection(undefined, { path: '/bad~2' })]]) {
        assert.throws(() => previewCatalogBindings(db, { bindings }, 'tester'), { code: 'catalog_binding_invalid' });
    }
    db.exec('DROP TABLE factory_file_links');
    assert.throws(() => preview(), { code: 'catalog_binding_audit_incomplete' });
});

test('分页及转义嵌套路径可读；停用、规格变化、撤销和失效来源明确报告', t => {
    const { db, selection, preview, apply } = fixture(t);
    apply(preview([selection(), selection('/parts_json/7/a~1b~0c/partsJson/0/partId')]));
    const first = readBoundCatalogNames(db, { sourceType: 'recipe', sourceId: 1, limit: 1 });
    assert.equal(first.items.length, 1);
    const second = readBoundCatalogNames(db, { sourceType: 'recipe', sourceId: 1, afterId: first.nextAfterId, limit: 1 });
    assert.equal(second.items[0].snapshotValue, 1);
    assert.equal(second.nextAfterId, null);
    db.prepare("UPDATE parts SET deleted_at='now' WHERE id=1").run();
    assert.equal(readBoundCatalogNames(db, { sourceType: 'recipe', sourceId: 1 }).items[0].referenceStatus, 'inactive');
    db.prepare('UPDATE catalog_identity_profiles SET spec_revision=2 WHERE part_id=1').run();
    // Inactive remains explicit even when its specification also changes.
    db.prepare('UPDATE parts SET deleted_at=NULL WHERE id=1').run();
    assert.equal(readBoundCatalogNames(db, { sourceType: 'recipe', sourceId: 1 }).items[0].referenceStatus, 'specification_changed');
    db.prepare("UPDATE catalog_reference_bindings SET deleted_at='now' WHERE id=2").run();
    assert.equal(readBoundCatalogNames(db, { sourceType: 'recipe', sourceId: 1 }).items.length, 1);
    db.prepare("UPDATE recipes SET name='new version' WHERE id=1").run();
    db.pragma('query_only = ON');
    const stale = readBoundCatalogNames(db, { sourceType: 'recipe', sourceId: 1 }).items[0];
    assert.equal(stale.referenceStatus, 'stale_source');
    assert.equal(stale.currentName, null);
    assert.equal(stale.snapshotValue, null);
    assert.throws(() => readBoundCatalogNames(db, { sourceType: 'recipe', sourceId: 999 }), { code: 'catalog_binding_source_missing' });
    assert.throws(() => readBoundCatalogNames(db, { sourceType: 'recipe', sourceId: 1, limit: 101 }), { code: 'catalog_binding_invalid' });
});

test('审计源哈希与绑定读取共用完全相同的行投影，JSON Pointer 不穿透原型', t => {
    const { db } = fixture(t);
    for (const row of auditCatalogReferences(db).sourceHashes) {
        assert.equal(catalogSourceHash(readCatalogSource(db, row.sourceType, row.sourceId)), row.sha256);
    }
    assert.deepEqual(readSnapshotPointer({ data: '{bad' }, '/data/name'), { found: false });
    assert.deepEqual(readSnapshotPointer({}, '/__proto__/constructor'), { found: false });
    assert.throws(() => readCatalogSource(db, 'constructor', 1));
});

test('模板、配置、报价、已关闭订单和不可修改修订均可绑定，采购进度与原始正文保持一致', t => {
    const { db, apply } = fixture(t);
    const parts = JSON.stringify([{ model: '202', supplier: '甲', quantity: 2 }]);
    db.prepare('INSERT INTO pump_shell_templates(shell_model, parts_json) VALUES (?, ?)').run('独立模板名', parts);
    db.prepare("INSERT INTO stator_variants(diameter_mm, material) VALUES (120, '钢带')").run();
    db.prepare("INSERT INTO coils(spec, sheets, scheme_name, stator_variant_id) VALUES ('120', 30, '方案甲', 1)").run();
    db.prepare("INSERT INTO pump_model_variants(model_name, template_id, coil_id) VALUES ('常用配置', 1, 1)").run();
    db.prepare("INSERT INTO customers(name) VALUES ('验收客户')").run();
    const items = JSON.stringify([{ recipeId: 1, templateId: 1, coilId: 1, modelVariantId: 1, partsJson: parts, price: 111, quantity: 3 }]);
    const purchases = JSON.stringify([{ id: 'stable-cable-line', partId: 1, model: '202', supplier: '甲',
        quantity: 4, orderedQuantity: 3, receivedQuantity: 2, inboundQuantity: 1, price: 4,
        configuration: { cableLength: 5, accessoryType: 'standard', unit: 'm' } }]);
    db.prepare("INSERT INTO orders(customer_name, status, items_json, purchase_list_json, purchase_receipt_id) VALUES ('验收客户', '已关闭', ?, ?, 'original-receipt')").run(items, purchases);
    db.prepare('INSERT INTO quotations(customer_id, items_json, total_price, total_cost) VALUES(1, ?, 333, 222)').run(items);
    const snapshot = JSON.stringify({ itemsJson: items, purchaseListJson: purchases });
    db.prepare("INSERT INTO order_revisions(order_id, revision_no, reason, before_snapshot_json, after_snapshot_json, operation_id, created_at) VALUES(1, 1, '原修订', ?, ?, 'revision-operation', 'now')").run(snapshot, snapshot);
    db.prepare("INSERT INTO rotor_drawings(job_id, params_json) VALUES ('binding-fixture', '{\"partId\":1}')").run();
    db.prepare("INSERT INTO factory_files(original_name, extension, detected_type, mime_type, file_size, file_sha256, file_blob, created_at, updated_at) VALUES('test.txt', 'txt', 'text', 'text/plain', 1, 'fixture', ?, 'now', 'now')").run(Buffer.from('a'));
    db.prepare("INSERT INTO factory_file_links(file_id, target_type, target_id, created_at, updated_at) VALUES(1, 'recipe', 1, 'now', 'now')").run();
    const report = auditCatalogReferences(db);
    assert.equal(report.complete, true);
    assert.equal(new Set(report.sourceHashes.map(row => row.sourceType)).size, 11);
    for (const row of report.sourceHashes) {
        assert.equal(catalogSourceHash(readCatalogSource(db, row.sourceType, row.sourceId)), row.sha256);
    }
    const bindings = report.references.filter(ref => ref.sourceType !== 'recipe' && ['resolved_id', 'resolved_legacy'].includes(ref.status)
        && ['part', 'coil', 'template', 'recipe', 'modelVariant'].includes(ref.targetType)).map(ref => ({
        sourceType: ref.sourceType, sourceId: ref.sourceId, path: ref.path, sourceHash: ref.sourceHash,
        targetType: ref.targetType, targetId: ref.candidateIds[0],
    }));
    const before = report.sourceHashes.map(row => [row.sourceType, row.sourceId, readCatalogSource(db, row.sourceType, row.sourceId)]);
    const receipt = apply(previewCatalogBindings(db, { bindings }, 'tester'));
    assert.equal(receipt.bindingIds.length, bindings.length);
    for (const [type, id, row] of before) assert.deepEqual(readCatalogSource(db, type, id), row);
    db.prepare("UPDATE parts SET model='轴承-202' WHERE id=1").run();
    const order = readBoundCatalogNames(db, { sourceType: 'order', sourceId: 1 });
    assert.ok(order.items.some(item => item.path === '/purchase_list_json/0/model' && item.currentName === '轴承-202'));
    const revision = readBoundCatalogNames(db, { sourceType: 'orderRevision', sourceId: 1 });
    assert.ok(revision.items.some(item => item.currentName === '轴承-202'));
    assert.equal(db.prepare('SELECT before_snapshot_json FROM order_revisions').get().before_snapshot_json, snapshot);
    assert.equal(db.prepare('SELECT purchase_list_json FROM orders').get().purchase_list_json, purchases);
    assert.deepEqual(db.prepare('SELECT total_price, total_cost FROM quotations').get(), { total_price: 333, total_cost: 222 });
});
