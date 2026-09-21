const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { CANONICAL_TABLES_SQL } = require('../api/database/schema.cjs');
const { inspectPurchaseInventory, applyPurchaseInventory } = require('../api/services/purchaseInventory.cjs');

function fixture(t) {
    const db = new Database(':memory:');
    t.after(() => db.close());
    db.exec(CANONICAL_TABLES_SQL);
    db.exec('ALTER TABLE coils ADD COLUMN stock REAL DEFAULT 0');
    db.exec("INSERT INTO parts(model, stock) VALUES ('电缆', 3); INSERT INTO coils(spec,sheets,scheme_status,stock) VALUES ('120',30,'testing',1)");
    let writes = 0;
    return { db, get writes() { return writes; }, safeUpdate(table, id, updates) {
        assert.equal(table, 'parts');
        db.prepare('UPDATE parts SET stock=? WHERE id=?').run(updates.stock, id);
        writes += 1;
        return { auditId: 1 };
    }, safeInsert() { throw new Error('unexpected insert'); } };
}

test('采购入库预览与执行使用相同的 ID、型号、数量和单位校验，失败不写库存', t => {
    const deps = fixture(t);
    const base = { partId: 1, model: '电缆', inventoryType: 'part', stockQtyPerUnit: 0.5 };
    for (const [item, qty] of [
        [{ ...base, partId: true }, 1], [{ ...base, partId: 99 }, 1], [{ ...base, model: '其他实物' }, 1],
        [{ ...base, stockQtyPerUnit: -1 }, 1], [base, -1], [base, true], [base, ''],
        [{ inventoryType: 'coil', coilId: 1, model: '120-30' }, 1],
    ]) {
        let previewError;
        try { inspectPurchaseInventory(deps, item, qty); } catch (error) { previewError = error; }
        assert.ok(previewError);
        assert.throws(() => applyPurchaseInventory(deps, item, qty), error => error.message === previewError.message);
    }
    assert.equal(deps.writes, 0);
    assert.equal(deps.db.prepare('SELECT stock FROM parts').get().stock, 3);
});

test('小于一米的成品电缆按实际换算量入库，零增量不产生写入', t => {
    const deps = fixture(t);
    const item = { partId: 1, model: '电缆', stockQtyPerUnit: 0.5, purchaseUnit: '根' };
    assert.equal(inspectPurchaseInventory(deps, item, 2).stockAfter, 4);
    const result = applyPurchaseInventory(deps, item, 2);
    assert.equal(result.inventoryAddQty, 1);
    assert.equal(deps.db.prepare('SELECT stock FROM parts').get().stock, 4);
    applyPurchaseInventory(deps, item, 0);
    assert.equal(deps.writes, 1);
});

test('供应商漂移在预览和执行均被拒绝，实际供货商不改变库存归属', t => {
    const deps = fixture(t);
    deps.db.prepare('UPDATE parts SET supplier = ? WHERE id = ?').run('甲', 1);
    const item = { partId: 1, model: '电缆', supplier: ' 甲 ', actualSupplier: '乙', stockQtyPerUnit: 1 };
    assert.equal(inspectPurchaseInventory(deps, item, 1).stockAfter, 4);
    deps.db.prepare('UPDATE parts SET supplier = ? WHERE id = ?').run('丙', 1);
    for (const invoke of [inspectPurchaseInventory, applyPurchaseInventory]) {
        assert.throws(() => invoke(deps, item, 1), { code: 'PURCHASE_PART_SUPPLIER_CHANGED' });
    }
    assert.equal(deps.writes, 0);
    assert.equal(deps.db.prepare('SELECT stock FROM parts WHERE id = ?').get(1).stock, 3);
    // Legacy references without supplier still require exact ID + model.
    assert.equal(inspectPurchaseInventory(deps, { ...item, supplier: '' }, 1).resourceId, 1);
});

test('零件/线圈类型冲突不能进入另一种库存，预览和执行一致拒绝', t => {
    const deps = fixture(t);
    const rows = [
        { partId: 1, inventoryType: 'coil' },
        { partId: 1, costRole: 'coil' },
        { partId: 1, costSource: 'coil' },
        { partId: 1, name: '线圈转子' },
        { coilId: 1, inventoryType: 'part' },
    ];
    for (const row of rows) {
        for (const invoke of [inspectPurchaseInventory, applyPurchaseInventory]) {
            assert.throws(() => invoke(deps, { ...row, model: '电缆' }, 1), { code: 'PURCHASE_INVENTORY_TYPE_MISMATCH' });
        }
    }
    assert.equal(deps.writes, 0);
});
