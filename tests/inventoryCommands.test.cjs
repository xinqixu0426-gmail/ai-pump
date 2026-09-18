const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { installBusinessChangeSchema } = require('./helpers/businessChangeSchema.cjs');
const {
    buildCoilStockPreview,
    buildPartStockPreview,
    executeConfirmedCoilStockBatch,
    executeConfirmedPartStockBatch,
    executeCoilStockBatch,
    executePartStockBatch,
} = require('../api/services/inventoryCommands.cjs');
const {
    resetBusinessConfirmationsForTests,
} = require('../api/services/businessConfirmation.cjs');

const FIXED_UPDATED_AT = '2026-08-02T00:00:00.000Z';

function createFixture() {
    const db = new Database(':memory:');
    installBusinessChangeSchema(db);
    db.exec(`
        CREATE TABLE api_operations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operation_id TEXT NOT NULL,
            capability_id TEXT NOT NULL,
            actor_key TEXT NOT NULL,
            idempotency_key TEXT NOT NULL,
            request_hash TEXT NOT NULL,
            request_id TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            response_json TEXT,
            created_at TEXT NOT NULL,
            completed_at TEXT,
            expires_at TEXT NOT NULL,
            UNIQUE(actor_key, capability_id, idempotency_key)
        );
        CREATE TABLE audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT,
            record_id INTEGER,
            request_id TEXT,
            operation_id TEXT,
            capability_id TEXT,
            user TEXT
        );
        CREATE TABLE parts (
            id INTEGER PRIMARY KEY,
            model TEXT,
            stock REAL,
            updated_at TEXT,
            deleted_at TEXT
        );
        CREATE TABLE coils (
            id INTEGER PRIMARY KEY,
            spec TEXT,
            common_name TEXT,
            material TEXT,
            slot_type TEXT,
            sheets INTEGER,
            pricing_mode TEXT,
            kit_price REAL,
            cost REAL,
            stock INTEGER,
            updated_at TEXT
        );
        CREATE TABLE coil_stock_movements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            coil_id INTEGER,
            change_qty INTEGER,
            balance_after INTEGER,
            movement_type TEXT,
            reference_type TEXT,
            reference_id TEXT,
            note TEXT,
            created_at TEXT
        );
        INSERT INTO parts (id, model, stock, updated_at) VALUES (1, 'P-1', 10, '${FIXED_UPDATED_AT}');
        INSERT INTO coils (
            id, spec, common_name, material, slot_type, sheets,
            pricing_mode, kit_price, cost, stock, updated_at
        ) VALUES (
            2, '12', '12', '钢带', '小眼', 120,
            'kit', 88.5, 88.5, 4, '${FIXED_UPDATED_AT}'
        );
    `);

    function audit(table, id, context) {
        const info = db.prepare(`
            INSERT INTO audit_log (
                table_name, record_id, request_id, operation_id, capability_id, user
            ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            table,
            id,
            context?.requestId || null,
            context?.operationId || null,
            context?.capabilityId || null,
            context?.user || 'system'
        );
        return Number(info.lastInsertRowid);
    }

    function safeUpdate(table, id, updates, context) {
        if (table === 'parts') {
            db.prepare('UPDATE parts SET stock = ?, updated_at = ? WHERE id = ?')
                .run(updates.stock, '2026-08-02T00:01:00.000Z', id);
        } else if (table === 'coils') {
            db.prepare('UPDATE coils SET stock = ?, updated_at = ? WHERE id = ?')
                .run(updates.stock, '2026-08-02T00:01:00.000Z', id);
        } else {
            throw new Error(`unexpected update table ${table}`);
        }
        return { changes: 1, auditId: audit(table, id, context) };
    }

    function safeInsert(table, values, context) {
        assert.equal(table, 'coil_stock_movements');
        const info = db.prepare(`
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
        return {
            ...info,
            auditId: audit(table, Number(info.lastInsertRowid), context),
        };
    }

    return {
        db,
        dependencies: {
            db,
            safeUpdate,
            safeInsert,
            partRow: row => ({
                id: row.id,
                model: row.model,
                stock: row.stock,
                updatedAt: row.updated_at,
            }),
            coilRow: row => ({
                id: row.id,
                stock: row.stock,
                updatedAt: row.updated_at,
            }),
        },
    };
}

function context(capabilityId, suffix) {
    return {
        capabilityId,
        actorKey: 'user:admin:test',
        idempotencyKey: `inventory:test:${suffix}`,
        operationId: `operation-${suffix}`,
        requestId: `request-${suffix}`,
        warnings: [],
        now: new Date('2026-08-02T00:00:30.000Z'),
    };
}

test('库存命令：零件增量、operation 与强审计在同一事务提交且可重放', () => {
    const fixture = createFixture();
    try {
        const commandContext = context('inventory.parts.batch_adjust_stock', 'part');
        const input = {
            operations: [{
                partId: 1,
                delta: 3,
                expectedUpdatedAt: FIXED_UPDATED_AT,
            }],
        };
        const first = executePartStockBatch(fixture.dependencies, input, commandContext);
        const replay = executePartStockBatch(fixture.dependencies, input, commandContext);
        assert.equal(fixture.db.prepare('SELECT stock FROM parts WHERE id = 1').get().stock, 13);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 1);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 1);
        assert.equal(first.auditIds.length, 1);
        assert.equal(replay.idempotentReplay, true);
        const audit = fixture.db.prepare('SELECT * FROM audit_log').get();
        assert.equal(audit.operation_id, 'operation-part');
        assert.equal(audit.capability_id, 'inventory.parts.batch_adjust_stock');
    } finally {
        fixture.db.close();
    }
});

test('库存命令：版本冲突在写库存、审计和 operation 前整体拒绝', () => {
    const fixture = createFixture();
    try {
        assert.throws(
            () => executePartStockBatch(
                fixture.dependencies,
                {
                    operations: [{
                        partId: 1,
                        delta: 3,
                        expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
                    }],
                },
                context('inventory.parts.batch_adjust_stock', 'stale')
            ),
            error => error.code === 'resource_version_conflict' && error.statusCode === 409
        );
        assert.equal(fixture.db.prepare('SELECT stock FROM parts WHERE id = 1').get().stock, 10);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('库存命令：缺少强审计回执时业务更新和 operation 全部回滚', () => {
    const fixture = createFixture();
    try {
        const dependencies = {
            ...fixture.dependencies,
            safeUpdate(table, id, updates) {
                fixture.db.prepare('UPDATE parts SET stock = ? WHERE id = ?').run(updates.stock, id);
                return { changes: 1, auditId: null };
            },
        };
        assert.throws(
            () => executePartStockBatch(
                dependencies,
                { operations: [{ partId: 1, delta: 1, expectedUpdatedAt: FIXED_UPDATED_AT }] },
                context('inventory.parts.batch_adjust_stock', 'audit-failure')
            ),
            error => error.code === 'strong_audit_required'
        );
        assert.equal(fixture.db.prepare('SELECT stock FROM parts WHERE id = 1').get().stock, 10);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('库存命令：套件计价线圈按同一身份入库且不改变价格事实', () => {
    const fixture = createFixture();
    try {
        const result = executeCoilStockBatch(
            fixture.dependencies,
            {
                adjustments: [{
                    coilId: 2,
                    changeQty: 3,
                    expectedUpdatedAt: FIXED_UPDATED_AT,
                }],
                note: '测试入库',
            },
            context('inventory.coils.adjust_stock', 'coil')
        );
        assert.deepEqual(
            fixture.db.prepare(`
                SELECT stock, pricing_mode, kit_price, cost
                FROM coils WHERE id = 2
            `).get(),
            { stock: 7, pricing_mode: 'kit', kit_price: 88.5, cost: 88.5 }
        );
        const movement = fixture.db.prepare('SELECT * FROM coil_stock_movements').get();
        assert.equal(movement.balance_after, 7);
        assert.equal(movement.reference_type, 'api_operation');
        assert.equal(movement.reference_id, 'operation-coil');
        assert.equal(result.auditIds.length, 2);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 2);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 1);
    } finally {
        fixture.db.close();
    }
});

test('库存命令：非法数量是 400，线圈库存不足是 409 且不产生副作用', () => {
    const fixture = createFixture();
    try {
        assert.throws(
            () => executeCoilStockBatch(
                fixture.dependencies,
                { adjustments: [{ coilId: 2, changeQty: 1.5, expectedUpdatedAt: FIXED_UPDATED_AT }] },
                context('inventory.coils.adjust_stock', 'invalid-change')
            ),
            error => error.code === 'stock_change_invalid' && error.statusCode === 400
        );
        assert.throws(
            () => executeCoilStockBatch(
                fixture.dependencies,
                { adjustments: [{ coilId: 2, changeQty: -5, expectedUpdatedAt: FIXED_UPDATED_AT }] },
                context('inventory.coils.adjust_stock', 'insufficient')
            ),
            error => error.code === 'stock_insufficient' && error.statusCode === 409
        );
        assert.equal(fixture.db.prepare('SELECT stock FROM coils WHERE id = 2').get().stock, 4);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM coil_stock_movements').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('库存正式预览：零件确认凭证绑定服务端库存版本并支持同键安全重放', () => {
    resetBusinessConfirmationsForTests();
    const fixture = createFixture();
    try {
        const preview = buildPartStockPreview(
            fixture.dependencies,
            { operations: [{ partId: 1, delta: 3 }] },
            'user:admin:test'
        );
        assert.equal(preview.operations[0].currentStock, 10);
        assert.equal(preview.operations[0].nextStock, 13);
        assert.equal(preview.operations[0].expectedUpdatedAt, FIXED_UPDATED_AT);
        const commandContext = {
            ...context('inventory.parts.batch_adjust_stock', 'part-confirmed'),
            idempotencyKey: preview.suggestedIdempotencyKey,
        };
        const input = { confirmationToken: preview.confirmationToken };
        const first = executeConfirmedPartStockBatch(
            fixture.dependencies,
            input,
            commandContext,
            'user:admin:test'
        );
        const replay = executeConfirmedPartStockBatch(
            fixture.dependencies,
            input,
            commandContext,
            'user:admin:test'
        );
        assert.equal(first.parts[0].stock, 13);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(
            fixture.db.prepare('SELECT stock FROM parts WHERE id = 1').get().stock,
            13
        );
    } finally {
        fixture.db.close();
        resetBusinessConfirmationsForTests();
    }
});

test('库存正式预览：线圈库存不足在签发确认前拒绝，成功预览绑定备注和快照', () => {
    resetBusinessConfirmationsForTests();
    const fixture = createFixture();
    try {
        assert.throws(
            () => buildCoilStockPreview(
                fixture.dependencies,
                { adjustments: [{ coilId: 2, changeQty: -5 }] },
                'user:admin:test'
            ),
            error => error.code === 'stock_insufficient'
        );
        const preview = buildCoilStockPreview(
            fixture.dependencies,
            {
                adjustments: [{ coilId: 2, changeQty: 2 }],
                note: '正式预览',
            },
            'user:admin:test'
        );
        const result = executeConfirmedCoilStockBatch(
            fixture.dependencies,
            { confirmationToken: preview.confirmationToken },
            {
                ...context('inventory.coils.adjust_stock', 'coil-confirmed'),
                idempotencyKey: preview.suggestedIdempotencyKey,
            },
            'user:admin:test'
        );
        assert.equal(result.adjustments[0].adjustment.balanceAfter, 6);
        assert.equal(
            fixture.db.prepare('SELECT note FROM coil_stock_movements').get().note,
            '正式预览'
        );
    } finally {
        fixture.db.close();
        resetBusinessConfirmationsForTests();
    }
});
