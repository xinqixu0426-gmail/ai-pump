const test = require('node:test');
const assert = require('node:assert/strict');
const accessors = require('../api/db.cjs');
const { previewCatalogRename, executeCatalogRename } = require('../api/services/catalogRename.cjs');
const { hydrateCatalogRow } = require('../api/services/catalogLiveReferences.cjs');
const { executeOrderTodoToggle } = require('../api/services/orderTodoCommands.cjs');
const { catalogSourceHash } = require('../api/services/catalogSources.cjs');
let sequence = 0;

function fixture() {
    const { db, safeInsert } = accessors;
    const code = String(203 + sequence++);
    const partId = Number(safeInsert('parts', { model: code, category: '轴承', supplier: '续接供应商', price: 3, stock: 9, updated_at: new Date().toISOString() }).lastInsertRowid);
    const bom = JSON.stringify([{ model: code, supplier: '续接供应商', qty: 2, snapshotPrice: 3 }]);
    const orderId = Number(safeInsert('orders', { customer_name: '续接客户', status: '采购中',
        items_json: JSON.stringify([{ partsJson: bom }]), purchase_list_json: bom,
        todos_json: JSON.stringify([{ id: 'todo', done: false }]) }).lastInsertRowid);
    const preview = previewCatalogRename(db, { entityType: 'part', entityId: partId, naming: { ruleId: 'bearing', spec: { code } },
        samePhysicalItem: true, expectedUpdatedAt: db.prepare('SELECT updated_at FROM parts WHERE id=?').get(partId).updated_at }, 'continuity');
    executeCatalogRename(accessors, { confirmationToken: preview.confirmationToken, idempotencyKey: preview.suggestedIdempotencyKey },
        { actorKey: 'continuity', idempotencyKey: preview.suggestedIdempotencyKey }, 'continuity');
    const raw = () => db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    const view = () => hydrateCatalogRow(db, 'order', raw());
    return { db, partId, orderId, bom, raw, view, name: `轴承-${code}` };
}

test('正式待办命令及状态、备注、采购进度更新保留其他未变引用，快照不改且重放不重复续接', () => {
    const f = fixture();
    const input = { todoId: 'todo', done: true, expectedUpdatedAt: f.raw().updated_at };
    const context = { actorKey: 'continuity', idempotencyKey: `continuity-todo-${f.orderId}` };
    const receipt = executeOrderTodoToggle(accessors, f.orderId, input, context);
    assert.equal(receipt.status, 'completed');
    const count = f.db.prepare('SELECT count(*) n FROM catalog_reference_bindings WHERE source_type=? AND source_id=?').get('order', f.orderId).n;
    assert.equal(executeOrderTodoToggle(accessors, f.orderId, input, context).idempotentReplay, true);
    assert.equal(f.db.prepare('SELECT count(*) n FROM catalog_reference_bindings WHERE source_type=? AND source_id=?').get('order', f.orderId).n, count);
    for (const update of [{ status: '采购完成' }, { remark: '核对完成' }, { purchase_list_json: JSON.stringify([{ model: '独立采购项', receivedQty: 1 }]) }]) {
        accessors.safeUpdate('orders', f.orderId, update, { requireAudit: true });
        const row = f.view();
        assert.equal(JSON.parse(JSON.parse(row.items_json)[0].partsJson)[0].model, f.name);
        assert.equal(JSON.parse(JSON.parse(row.items_json)[0].partsJson)[0].partId, f.partId);
        assert.equal(f.raw().items_json, JSON.stringify([{ partsJson: f.bom }]));
    }
    const hash = catalogSourceHash(f.raw());
    const binding = f.db.prepare('SELECT * FROM catalog_reference_bindings WHERE source_type=? AND source_id=? AND source_hash=? AND deleted_at IS NULL').get('order', f.orderId, hash);
    assert.ok(binding);
    assert.ok(f.db.prepare("SELECT id FROM audit_log WHERE table_name='catalog_reference_bindings' AND record_id=?").get(binding.id));
});

test('同名对象更换 ID 或供应商以及数组插入/重排不能继承绑定', () => {
    for (const replacement of [row => ({ ...row, partId: 999999 }), row => ({ ...row, supplier: '其他供应商' }), row => ({ ...row, qty: 99 })]) {
        const f = fixture();
        const row = JSON.parse(f.bom)[0];
        accessors.safeUpdate('orders', f.orderId, { purchase_list_json: JSON.stringify([replacement(row)]) });
        const hash = catalogSourceHash(f.raw());
        assert.equal(f.db.prepare('SELECT count(*) n FROM catalog_reference_bindings WHERE source_type=? AND source_id=? AND source_path=? AND source_hash=? AND deleted_at IS NULL').get('order', f.orderId, '/purchase_list_json/0/model', hash).n, 0);
    }
    const f = fixture();
    accessors.safeUpdate('orders', f.orderId, { purchase_list_json: JSON.stringify([{ model: '新行' }, ...JSON.parse(f.bom)]) });
    assert.equal(JSON.parse(f.view().purchase_list_json)[1].partId, undefined);
});

test('续接写入失败使业务更新、绑定和审计一并回滚，原引用仍有效', () => {
    const f = fixture();
    const before = f.raw();
    const auditCount = f.db.prepare('SELECT count(*) n FROM audit_log').get().n;
    f.db.exec("CREATE TEMP TRIGGER reject_continuity BEFORE INSERT ON catalog_reference_bindings BEGIN SELECT RAISE(ABORT, 'continuity failure'); END");
    try {
        assert.throws(() => accessors.safeUpdate('orders', f.orderId, { remark: '不能提交' }), /continuity failure/);
        assert.deepEqual(f.raw(), before);
        assert.equal(f.db.prepare('SELECT count(*) n FROM audit_log').get().n, auditCount);
        assert.equal(JSON.parse(f.view().purchase_list_json)[0].model, f.name);
    } finally { f.db.exec('DROP TRIGGER reject_continuity'); }
});

test('来源删除、引用删除和目标规格修订失效不自动续接或恢复身份', () => {
    for (const mode of ['source_deleted', 'reference_removed', 'spec_changed']) {
        const f = fixture();
        if (mode === 'spec_changed') f.db.prepare('UPDATE catalog_identity_profiles SET spec_revision=spec_revision+1 WHERE part_id=?').run(f.partId);
        accessors.safeUpdate('orders', f.orderId, mode === 'source_deleted' ? { deleted_at: new Date().toISOString() }
            : mode === 'reference_removed' ? { items_json: '[]', purchase_list_json: '[]' } : { remark: '规格需要重新核实' });
        const hash = catalogSourceHash(f.raw());
        assert.equal(f.db.prepare('SELECT count(*) n FROM catalog_reference_bindings WHERE source_type=? AND source_id=? AND source_hash=? AND deleted_at IS NULL').get('order', f.orderId, hash).n, 0);
    }
});
