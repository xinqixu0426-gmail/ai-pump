const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    adjustCoilStock,
    assertCoilCanBeDeleted,
    assertCoilIdentityEditable,
    coilStockMovementRow,
} = require('../api/services/coilInventory.cjs');

function createInventoryDb() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE coils (
            id INTEGER PRIMARY KEY,
            spec TEXT NOT NULL,
            sheets INTEGER NOT NULL,
            stock INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT
        );
        CREATE TABLE coil_stock_movements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            coil_id INTEGER NOT NULL,
            change_qty INTEGER NOT NULL,
            balance_after INTEGER NOT NULL,
            movement_type TEXT NOT NULL,
            reference_type TEXT DEFAULT '',
            reference_id TEXT DEFAULT '',
            note TEXT DEFAULT '',
            created_at TEXT NOT NULL
        );
        INSERT INTO coils (id, spec, sheets, stock) VALUES (1, '12', 180, 5);
    `);
    const safeUpdate = (table, id, updates) => {
        assert.equal(table, 'coils');
        db.prepare('UPDATE coils SET stock = ?, updated_at = ? WHERE id = ?')
            .run(updates.stock, '2026-07-28T00:00:00.000Z', id);
    };
    const safeInsert = (table, values) => {
        assert.equal(table, 'coil_stock_movements');
        return db.prepare(`
            INSERT INTO coil_stock_movements (
                coil_id, change_qty, balance_after, movement_type,
                reference_type, reference_id, note, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            values.coil_id,
            values.change_qty,
            values.balance_after,
            values.movement_type,
            values.reference_type,
            values.reference_id,
            values.note,
            values.created_at
        );
    };
    return { db, safeUpdate, safeInsert };
}

test('线圈库存调整写入结存和可追溯流水', () => {
    const dependencies = createInventoryDb();
    const result = adjustCoilStock(dependencies, {
        coilId: 1,
        changeQty: 3,
        movementType: 'purchase_inbound',
        referenceType: 'order',
        referenceId: '88',
        note: '订单采购入库',
        createdAt: '2026-07-28T08:00:00.000Z',
    });
    const movement = coilStockMovementRow(
        dependencies.db.prepare('SELECT * FROM coil_stock_movements').get()
    );

    assert.equal(result.balanceAfter, 8);
    assert.equal(dependencies.db.prepare('SELECT stock FROM coils WHERE id = 1').get().stock, 8);
    assert.deepEqual(movement, {
        id: 1,
        coilId: 1,
        changeQty: 3,
        balanceAfter: 8,
        movementType: 'purchase_inbound',
        referenceType: 'order',
        referenceId: '88',
        note: '订单采购入库',
        createdAt: '2026-07-28T08:00:00.000Z',
    });
    dependencies.db.close();
});

test('线圈库存不能扣成负数且数量必须为整数', () => {
    const dependencies = createInventoryDb();
    assert.throws(
        () => adjustCoilStock(dependencies, { coilId: 1, changeQty: -6 }),
        /库存不足/
    );
    assert.throws(
        () => adjustCoilStock(dependencies, { coilId: 1, changeQty: 1.5 }),
        /非零整数/
    );
    assert.equal(dependencies.db.prepare('SELECT stock FROM coils WHERE id = 1').get().stock, 5);
    assert.equal(dependencies.db.prepare('SELECT COUNT(*) AS count FROM coil_stock_movements').get().count, 0);
    dependencies.db.close();
});

test('只有零库存且没有库存流水的线圈方案可以删除', () => {
    const dependencies = createInventoryDb();
    dependencies.db.prepare(
        'INSERT INTO coils (id, spec, sheets, stock) VALUES (?, ?, ?, ?)'
    ).run(2, '12', 200, 0);

    assert.equal(assertCoilCanBeDeleted(dependencies.db, 2), true);

    assert.throws(
        () => assertCoilCanBeDeleted(dependencies.db, 1),
        error => {
            assert.match(error.message, /已有库存或库存流水/);
            assert.equal(error.statusCode, 409);
            return true;
        }
    );

    adjustCoilStock(dependencies, {
        coilId: 2,
        changeQty: 1,
        createdAt: '2026-07-28T08:00:00.000Z',
    });
    adjustCoilStock(dependencies, {
        coilId: 2,
        changeQty: -1,
        createdAt: '2026-07-28T08:01:00.000Z',
    });
    assert.throws(
        () => assertCoilCanBeDeleted(dependencies.db, 2),
        error => {
            assert.match(error.message, /已有库存或库存流水/);
            assert.equal(error.statusCode, 409);
            return true;
        }
    );
    dependencies.db.close();
});

test('已有库存或流水后冻结线圈身份字段', () => {
    const dependencies = createInventoryDb();
    dependencies.db.prepare(
        'INSERT INTO coils (id, spec, sheets, stock) VALUES (?, ?, ?, ?)'
    ).run(2, '12', 200, 0);

    assert.equal(assertCoilIdentityEditable(dependencies.db, 2, ['片数']), true);
    assert.equal(assertCoilIdentityEditable(dependencies.db, 1, []), true);
    assert.throws(
        () => assertCoilIdentityEditable(dependencies.db, 1, ['片数', '材质']),
        error => {
            assert.equal(error.statusCode, 409);
            assert.match(error.message, /不能修改身份字段：片数、材质/);
            assert.match(error.message, /请新建线圈方案/);
            return true;
        }
    );

    adjustCoilStock(dependencies, {
        coilId: 2,
        changeQty: 1,
        createdAt: '2026-07-28T08:00:00.000Z',
    });
    adjustCoilStock(dependencies, {
        coilId: 2,
        changeQty: -1,
        createdAt: '2026-07-28T08:01:00.000Z',
    });
    assert.throws(
        () => assertCoilIdentityEditable(dependencies.db, 2, ['槽眼']),
        error => error.statusCode === 409 && /库存流水/.test(error.message)
    );
    dependencies.db.close();
});
