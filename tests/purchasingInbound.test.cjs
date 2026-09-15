const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { installBusinessChangeSchema } = require('./helpers/businessChangeSchema.cjs');
const {
    CAPABILITY_ID,
    buildCompletePurchaseDraft,
    executeCompletePurchase,
} = require('../api/services/purchasingInbound.cjs');

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
        CREATE TABLE orders (
            id INTEGER PRIMARY KEY,
            customer_name TEXT,
            contract_no TEXT,
            remark TEXT,
            status TEXT,
            items_json TEXT,
            purchase_list_json TEXT,
            todos_json TEXT,
            purchase_completed_at TEXT,
            purchase_receipt_id TEXT,
            status_reason TEXT,
            status_changed_at TEXT,
            closed_at TEXT,
            cancelled_at TEXT,
            created_at TEXT,
            updated_at TEXT,
            deleted_at TEXT
        );
        INSERT INTO parts (
            id, model, supplier, price, stock, updated_at
        ) VALUES (
            1, 'P-1', '供应商A', 5, 0, '${FIXED_UPDATED_AT}'
        );
        INSERT INTO coils (
            id, spec, sheets, material, slot_type, scheme_status, stock, updated_at
        ) VALUES (
            2, '12', 120, '钢带', '小眼', 'official', 0, '${FIXED_UPDATED_AT}'
        );
    `);
    const orderItems = [{
        id: 'item-1',
        recipeName: '测试水泵',
        qty: 2,
        unitCost: 20,
        unitPrice: 25,
        partsJson: JSON.stringify([
            {
                model: 'P-1',
                name: '普通配件',
                supplier: '供应商A',
                qty: 3,
                inventoryQty: 3,
                snapshotPrice: 5,
            },
            {
                model: '12-120',
                name: '线圈转子',
                inventoryType: 'coil',
                material: '钢带',
                slotType: '小眼',
                qty: 1,
                inventoryQty: 1,
                snapshotPrice: 8,
            },
            {
                model: '13-130',
                name: '线圈转子',
                inventoryType: 'coil',
                material: '钢带',
                slotType: '小眼',
                qty: 1,
                inventoryQty: 1,
                snapshotPrice: 9,
            },
        ]),
    }];
    db.prepare(`
        INSERT INTO orders (
            id, customer_name, status, items_json, purchase_list_json,
            todos_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        3,
        '测试客户',
        '待采购',
        JSON.stringify(orderItems),
        '[]',
        '[]',
        FIXED_UPDATED_AT,
        FIXED_UPDATED_AT
    );

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
        const columns = Object.keys(updates).filter(column => updates[column] !== undefined);
        db.prepare(`
            UPDATE ${table}
            SET ${columns.map(column => `${column} = ?`).join(', ')}, updated_at = ?
            WHERE id = ?
        `).run(...columns.map(column => updates[column]), NEXT_UPDATED_AT, id);
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

    const dependencies = {
        db,
        dbGetAllParts: () => db.prepare(
            'SELECT id, model, supplier, price, stock, updated_at AS updatedAt FROM parts'
        ).all(),
        dbGetAllCoils: () => db.prepare(`
            SELECT
                id, spec, sheets, material, slot_type AS slotType,
                scheme_status AS schemeStatus, stock, updated_at AS updatedAt
            FROM coils
        `).all(),
        invalidatePartsCache: () => {},
        orderRow: row => ({
            id: row.id,
            status: row.status,
            purchaseListJson: row.purchase_list_json,
            purchaseCompletedAt: row.purchase_completed_at,
            purchaseReceiptId: row.purchase_receipt_id,
            updatedAt: row.updated_at,
        }),
        safeInsert,
        safeUpdate,
    };
    return { db, dependencies };
}

function context(suffix) {
    return {
        capabilityId: CAPABILITY_ID,
        actorKey: 'jwt:test-session',
        idempotencyKey: `purchase:complete:${suffix}`,
        operationId: `operation-${suffix}`,
        requestId: `request-${suffix}`,
        warnings: [],
        now: new Date('2026-08-02T00:00:30.000Z'),
    };
}

test('保存 BOM 的供应商漂移在重建入库计划时拒绝，旧预览不能继续入库', () => {
    const { db, dependencies } = createFixture();
    try {
        const items = JSON.parse(db.prepare('SELECT items_json FROM orders WHERE id = 3').get().items_json);
        const parts = JSON.parse(items[0].partsJson);
        parts[0].partId = 1;
        items[0].partsJson = JSON.stringify(parts);
        db.prepare('UPDATE orders SET items_json = ? WHERE id = 3').run(JSON.stringify(items));
        const draft = buildCompletePurchaseDraft(dependencies, 3);
        db.prepare('UPDATE parts SET supplier = ? WHERE id = 1').run('供应商B');
        const beforeOrder = db.prepare('SELECT * FROM orders WHERE id = 3').get();
        assert.throws(() => buildCompletePurchaseDraft(dependencies, 3), { code: 'PURCHASE_PART_SUPPLIER_CHANGED' });
        assert.throws(() => executeCompletePurchase(dependencies, {
            orderId: 3, expectedUpdatedAt: FIXED_UPDATED_AT, previewHash: draft.previewHash,
        }, context('supplier-drift')), { code: 'PURCHASE_PART_SUPPLIER_CHANGED' });
        assert.equal(db.prepare('SELECT stock FROM parts WHERE id = 1').get().stock, 0);
        assert.equal(db.prepare('SELECT stock FROM coils WHERE id = 2').get().stock, 0);
        assert.deepEqual(db.prepare('SELECT * FROM orders WHERE id = 3').get(), beforeOrder);
        assert.equal(db.prepare('SELECT count(*) n FROM api_operations').get().n, 0);
        assert.equal(db.prepare('SELECT count(*) n FROM audit_log').get().n, 0);
        assert.equal(db.prepare('SELECT count(*) n FROM coil_stock_movements').get().n, 0);
    } finally { db.close(); }
});

test('采购一键入库草稿聚合正式库存事实、版本和幂等键且保持只读', () => {
    const fixture = createFixture();
    try {
        const draft = buildCompletePurchaseDraft(fixture.dependencies, 3);
        assert.equal(draft.capabilityId, CAPABILITY_ID);
        assert.equal(draft.expectedUpdatedAt, FIXED_UPDATED_AT);
        assert.equal(draft.requiresConfirmation, true);
        assert.match(draft.suggestedIdempotencyKey, /^purchase-complete:3:/);
        assert.match(draft.previewHash, /^[a-f0-9]{64}$/);
        assert.equal(draft.additions.length, 3);
        assert.deepEqual(
            draft.additions
                .map(item => [item.inventoryType, item.addQty, item.inventoryAddQty])
                .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
            [
                ['coil', 2, 2],
                ['none', 2, 0],
                ['part', 6, 6],
            ]
        );
        assert.equal(fixture.db.prepare('SELECT stock FROM parts WHERE id = 1').get().stock, 0);
        assert.equal(fixture.db.prepare('SELECT stock FROM coils WHERE id = 2').get().stock, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('采购一键入库原子更新零件、线圈、流水、订单、回执和强审计并可重放', () => {
    const fixture = createFixture();
    try {
        const commandContext = context('success');
        const draft = buildCompletePurchaseDraft(fixture.dependencies, 3);
        const input = {
            orderId: 3,
            expectedUpdatedAt: FIXED_UPDATED_AT,
            previewHash: draft.previewHash,
        };
        const first = executeCompletePurchase(fixture.dependencies, input, commandContext);
        const replay = executeCompletePurchase(fixture.dependencies, input, commandContext);

        assert.equal(first.order.status, '采购完成');
        assert.equal(first.additions.length, 3);
        assert.equal(first.auditIds.length, 4);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(replay.receiptId, first.receiptId);
        assert.equal(fixture.db.prepare('SELECT stock FROM parts WHERE id = 1').get().stock, 6);
        assert.equal(fixture.db.prepare('SELECT stock FROM coils WHERE id = 2').get().stock, 2);
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) AS count FROM coil_stock_movements').get().count,
            1
        );
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 4);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 1);
        const order = fixture.db.prepare('SELECT * FROM orders WHERE id = 3').get();
        assert.equal(order.status, '采购完成');
        assert.ok(order.purchase_receipt_id);
        const purchaseList = JSON.parse(order.purchase_list_json);
        assert.ok(purchaseList.every(item => item.stockedQty === item.plannedQty));
    } finally {
        fixture.db.close();
    }
});

test('采购一键入库版本冲突不改变库存、订单、审计或 operation', () => {
    const fixture = createFixture();
    try {
        assert.throws(
            () => executeCompletePurchase(
                fixture.dependencies,
                {
                    orderId: 3,
                    expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
                },
                context('stale')
            ),
            error => error.code === 'resource_version_conflict' && error.statusCode === 409
        );
        assert.equal(fixture.db.prepare('SELECT stock FROM parts WHERE id = 1').get().stock, 0);
        assert.equal(fixture.db.prepare('SELECT stock FROM coils WHERE id = 2').get().stock, 0);
        assert.equal(fixture.db.prepare('SELECT status FROM orders WHERE id = 3').get().status, '待采购');
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('采购一键入库在库存或平衡计划变化后拒绝旧预览', () => {
    const fixture = createFixture();
    try {
        const draft = buildCompletePurchaseDraft(fixture.dependencies, 3);
        fixture.db.prepare('UPDATE parts SET stock = 1 WHERE id = 1').run();
        assert.throws(
            () => executeCompletePurchase(
                fixture.dependencies,
                {
                    orderId: 3,
                    expectedUpdatedAt: draft.expectedUpdatedAt,
                    previewHash: draft.previewHash,
                },
                context('preview-changed')
            ),
            error => error.code === 'preview_changed' && error.statusCode === 409
        );
        assert.equal(fixture.db.prepare('SELECT stock FROM parts WHERE id = 1').get().stock, 1);
        assert.equal(fixture.db.prepare('SELECT stock FROM coils WHERE id = 2').get().stock, 0);
        assert.equal(fixture.db.prepare('SELECT status FROM orders WHERE id = 3').get().status, '待采购');
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('采购一键入库任一强审计缺失时库存、流水、订单和 operation 全部回滚', () => {
    const fixture = createFixture();
    try {
        const originalSafeUpdate = fixture.dependencies.safeUpdate;
        fixture.dependencies.safeUpdate = (table, id, updates, auditContext) => {
            const result = originalSafeUpdate(table, id, updates, auditContext);
            if (table === 'orders' && updates.status === '采购完成') {
                return { ...result, auditId: null };
            }
            return result;
        };
        const draft = buildCompletePurchaseDraft(fixture.dependencies, 3);
        assert.throws(
            () => executeCompletePurchase(
                fixture.dependencies,
                {
                    orderId: 3,
                    expectedUpdatedAt: FIXED_UPDATED_AT,
                    previewHash: draft.previewHash,
                },
                context('audit-failure')
            ),
            error => error.code === 'strong_audit_required' && error.statusCode === 500
        );
        assert.equal(fixture.db.prepare('SELECT stock FROM parts WHERE id = 1').get().stock, 0);
        assert.equal(fixture.db.prepare('SELECT stock FROM coils WHERE id = 2').get().stock, 0);
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) AS count FROM coil_stock_movements').get().count,
            0
        );
        assert.equal(fixture.db.prepare('SELECT status FROM orders WHERE id = 3').get().status, '待采购');
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
    } finally {
        fixture.db.close();
    }
});
