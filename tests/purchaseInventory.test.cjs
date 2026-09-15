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
