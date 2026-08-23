const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { installBusinessChangeSchema } = require('./helpers/businessChangeSchema.cjs');
const {
    CAPABILITY_ID,
    buildPurchaseBatchDraft,
    executePurchaseBatch,
} = require('../api/services/purchasingBatchOrder.cjs');

const FIXED_UPDATED_AT = '2026-08-02T00:00:00.000Z';
const NEXT_UPDATED_AT = '2026-08-02T00:01:00.000Z';

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
            name TEXT,
            supplier TEXT,
            price REAL,
            stock REAL,
            updated_at TEXT,
            deleted_at TEXT
        );
        CREATE TABLE coils (
            id INTEGER PRIMARY KEY,
            spec TEXT,
            sheets INTEGER,
            material TEXT,
            slot_type TEXT,
            scheme_status TEXT,
            stock INTEGER,
            updated_at TEXT
        );
        CREATE TABLE orders (
            id INTEGER PRIMARY KEY,
            customer_name TEXT,
            contract_no TEXT,
            status TEXT,
            items_json TEXT,
            purchase_list_json TEXT,
            todos_json TEXT,
            status_changed_at TEXT,
            created_at TEXT,
            updated_at TEXT,
            deleted_at TEXT
        );
        INSERT INTO parts (
            id, model, name, supplier, price, stock, updated_at
        ) VALUES (
            1, 'P-1', '测试零件', '供应商A', 5, 0, '${FIXED_UPDATED_AT}'
        );
    `);
    const insertOrder = db.prepare(`
        INSERT INTO orders (
            id, customer_name, contract_no, status, items_json,
            purchase_list_json, todos_json, created_at, updated_at
        ) VALUES (?, ?, ?, '待采购', ?, '[]', '[]', ?, ?)
    `);
    for (const [id, qty] of [[3, 2], [4, 3]]) {
        insertOrder.run(
            id,
            `客户${id}`,
            `C-${id}`,
            JSON.stringify([{
                recipeName: '测试水泵',
                qty,
                partsJson: JSON.stringify([{
                    model: 'P-1',
                    name: '测试零件',
                    supplier: '供应商A',
                    qty: 1,
                    inventoryQty: 1,
                }]),
            }]),
            FIXED_UPDATED_AT,
            FIXED_UPDATED_AT
        );
    }

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
        assert.equal(table, 'orders');
        const columns = Object.keys(updates).filter(column => updates[column] !== undefined);
        db.prepare(`
            UPDATE orders
            SET ${columns.map(column => `${column} = ?`).join(', ')}, updated_at = ?
            WHERE id = ?
        `).run(...columns.map(column => updates[column]), NEXT_UPDATED_AT, id);
        return { changes: 1, auditId: audit(table, id, context) };
    }
    const dependencies = {
        db,
        dbGetAllParts: () => db.prepare(`
            SELECT id, model, name, supplier, price, stock, updated_at AS updatedAt
            FROM parts WHERE deleted_at IS NULL
        `).all(),
        dbGetAllCoils: () => [],
        orderRow: row => ({
            id: row.id,
            status: row.status,
            purchaseListJson: row.purchase_list_json,
            updatedAt: row.updated_at,
        }),
        safeUpdate,
    };
    return { db, dependencies };
}

function taskInput() {
    return {
        identityKey: 'part:1',
        model: 'P-1',
        supplier: '供应商A',
        purchased: true,
    };
}

function context(suffix) {
    return {
        capabilityId: CAPABILITY_ID,
        actorKey: 'jwt:test-session',
        idempotencyKey: `purchase:batch:${suffix}`,
        operationId: `operation-${suffix}`,
        requestId: `request-${suffix}`,
        warnings: [],
    };
}

test('采购批量下单草稿聚合受影响订单、版本和数量且保持只读', () => {
    const fixture = createFixture();
    try {
        const draft = buildPurchaseBatchDraft(fixture.dependencies, taskInput());
        assert.equal(draft.capabilityId, CAPABILITY_ID);
        assert.equal(draft.affectedOrders.length, 2);
        assert.equal(draft.expectedVersions.length, 2);
        assert.equal(
            draft.affectedOrders.reduce((sum, item) => sum + item.afterOrderedQty, 0),
            5
        );
        assert.match(draft.previewHash, /^[a-f0-9]{64}$/);
        assert.match(draft.suggestedIdempotencyKey, /^purchase-batch:/);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('采购批量下单跨订单原子提交强审计并可安全重放', () => {
    const fixture = createFixture();
    try {
        const draft = buildPurchaseBatchDraft(fixture.dependencies, taskInput());
        const input = {
            ...taskInput(),
            expectedVersions: draft.expectedVersions,
            previewHash: draft.previewHash,
        };
        const first = executePurchaseBatch(fixture.dependencies, input, context('success'));
        const replay = executePurchaseBatch(fixture.dependencies, input, context('success'));
        assert.equal(first.updatedCount, 2);
        assert.equal(first.auditIds.length, 2);
        assert.equal(replay.idempotentReplay, true);
        for (const row of fixture.db.prepare('SELECT * FROM orders ORDER BY id').all()) {
            const item = JSON.parse(row.purchase_list_json)[0];
            assert.equal(item.orderedQty, item.plannedQty);
            assert.equal(row.status, '采购中');
        }
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 2);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 1);
    } finally {
        fixture.db.close();
    }
});

test('采购批量下单在订单版本变化后拒绝且不部分更新', () => {
    const fixture = createFixture();
    try {
        const draft = buildPurchaseBatchDraft(fixture.dependencies, taskInput());
        fixture.db.prepare('UPDATE orders SET updated_at = ? WHERE id = 4')
            .run(NEXT_UPDATED_AT);
        assert.throws(
            () => executePurchaseBatch(
                fixture.dependencies,
                {
                    ...taskInput(),
                    expectedVersions: draft.expectedVersions,
                    previewHash: draft.previewHash,
                },
                context('stale')
            ),
            error => (
                ['resource_version_conflict', 'preview_changed'].includes(error.code)
                && error.statusCode === 409
            )
        );
        assert.ok(
            fixture.db.prepare('SELECT purchase_list_json FROM orders').all()
                .every(row => row.purchase_list_json === '[]')
        );
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('采购批量下单缺少任一强审计时全部订单和 operation 回滚', () => {
    const fixture = createFixture();
    try {
        const draft = buildPurchaseBatchDraft(fixture.dependencies, taskInput());
        let writes = 0;
        const dependencies = {
            ...fixture.dependencies,
            safeUpdate(table, id, updates, auditContext) {
                writes += 1;
                const result = fixture.dependencies.safeUpdate(
                    table,
                    id,
                    updates,
                    auditContext
                );
                return writes === 2 ? { ...result, auditId: null } : result;
            },
        };
        assert.throws(
            () => executePurchaseBatch(
                dependencies,
                {
                    ...taskInput(),
                    expectedVersions: draft.expectedVersions,
                    previewHash: draft.previewHash,
                },
                context('audit-failure')
            ),
            error => error.code === 'strong_audit_required'
        );
        assert.ok(
            fixture.db.prepare('SELECT purchase_list_json FROM orders').all()
                .every(row => row.purchase_list_json === '[]')
        );
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
    } finally {
        fixture.db.close();
    }
});
