const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    CoilQueryError,
    createCoilQueries,
    normalizeMovementLimit,
} = require('../api/services/coilQueries.cjs');

function createFixture() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE coils (
            id INTEGER PRIMARY KEY
        );
        CREATE TABLE coil_stock_movements (
            id INTEGER PRIMARY KEY,
            coil_id INTEGER NOT NULL,
            change_qty INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
        INSERT INTO coils (id) VALUES (1);
        INSERT INTO coil_stock_movements
            (id, coil_id, change_qty, created_at)
        VALUES
            (1, 1, 2, '2026-08-01T00:00:00.000Z'),
            (2, 1, -1, '2026-08-02T00:00:00.000Z');
    `);
    const coils = [{
        id: 1,
        spec: '12',
        commonName: '12',
        diameterMm: 120,
        material: '冷轧',
        slotType: '国标眼',
        sheets: 160,
        unitPrice: 1.2,
        schemeStatus: 'official',
    }];
    const variants = [{ id: 1, name: '12冷轧' }];
    const queries = createCoilQueries({
        db,
        listCoils: () => coils,
        listStatorVariants: () => variants,
        movementRow: row => ({
            id: row.id,
            coilId: row.coil_id,
            changeQty: row.change_qty,
        }),
    });
    return { db, coils, variants, queries };
}

test('线圈 Query 统一返回线圈、定子组合、规格草稿和规格选项', () => {
    const fixture = createFixture();
    try {
        assert.equal(fixture.queries.getAllCoils(), fixture.coils);
        assert.deepEqual(fixture.queries.getAllCoils({
            spec: '12',
            sheets: '160',
            material: '冷轧',
            slotType: '国标眼',
        }), fixture.coils);
        assert.deepEqual(fixture.queries.getAllCoils({ sheets: 999 }), []);
        assert.equal(
            fixture.queries.getAllStatorVariants(),
            fixture.variants
        );
        const draft = fixture.queries.getSpecDraft({
            spec: '12',
            material: '冷轧',
            slotType: '国标眼',
        });
        assert.equal(draft.spec, '12');
        assert.equal(draft.material, '冷轧');
        assert.equal(draft.slotType, '国标眼');
        assert.equal(draft.source, 'same-variant');
        const options = fixture.queries.getSpecOptions();
        assert.equal(options.length, 1);
        assert.deepEqual(options[0].sheets, [160]);
    } finally {
        fixture.db.close();
    }
});

test('线圈 Query 库存流水只读、按时间倒序并限制返回数量', () => {
    const fixture = createFixture();
    try {
        const rows = fixture.queries.getStockMovements('1', '1');
        assert.deepEqual(rows, [{
            id: 2,
            coilId: 1,
            changeQty: -1,
        }]);
        assert.equal(normalizeMovementLimit(undefined), 20);
        assert.equal(normalizeMovementLimit(1000), 100);
        assert.equal(normalizeMovementLimit(-1), 1);
    } finally {
        fixture.db.close();
    }
});

test('线圈 Query 使用稳定的输入和不存在资源错误', () => {
    const fixture = createFixture();
    try {
        assert.throws(
            () => fixture.queries.getAllCoils({ sheets: 'bad' }),
            error => (
                error instanceof CoilQueryError
                && error.statusCode === 400
                && error.message === 'sheets 必须是正整数'
            )
        );
        assert.throws(
            () => fixture.queries.getSpecDraft({}),
            error => (
                error instanceof CoilQueryError
                && error.statusCode === 400
                && error.message === 'spec 为必填'
            )
        );
        assert.throws(
            () => fixture.queries.getStockMovements('bad', 20),
            error => (
                error instanceof CoilQueryError
                && error.statusCode === 400
                && error.message === '非法线圈ID'
            )
        );
        assert.throws(
            () => fixture.queries.getStockMovements(999, 20),
            error => (
                error instanceof CoilQueryError
                && error.statusCode === 404
                && error.message === '线圈记录不存在'
            )
        );
    } finally {
        fixture.db.close();
    }
});
