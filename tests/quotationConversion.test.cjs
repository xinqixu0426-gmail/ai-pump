const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    CAPABILITY_ID,
    buildQuotationOrderDraft,
    executeQuotationConversion,
} = require('../api/services/quotationConversion.cjs');

const FIXED_UPDATED_AT = '2026-08-02T00:00:00.000Z';

function createFixture() {
    const db = new Database(':memory:');
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
        CREATE TABLE customers (
            id INTEGER PRIMARY KEY,
            name TEXT,
            deleted_at TEXT
        );
        CREATE TABLE recipes (
            id INTEGER PRIMARY KEY,
            name TEXT,
            spec TEXT,
            parts_json TEXT,
            saved_total_cost REAL,
            deleted_at TEXT
        );
        CREATE TABLE orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_name TEXT,
            contract_no TEXT,
            remark TEXT,
            status TEXT,
            items_json TEXT,
            purchase_list_json TEXT,
            todos_json TEXT,
            created_at TEXT,
            updated_at TEXT,
            deleted_at TEXT
        );
        CREATE TABLE quotations (
            id INTEGER PRIMARY KEY,
            customer_id INTEGER,
            status TEXT,
            items_json TEXT,
            remark TEXT,
            converted_order_id INTEGER,
            converted_at TEXT,
            created_at TEXT,
            updated_at TEXT,
            deleted_at TEXT
        );
        INSERT INTO customers (id, name) VALUES (1, '测试客户');
        INSERT INTO recipes (
            id, name, spec, parts_json, saved_total_cost
        ) VALUES (
            2, '测试水泵', 'Q-1',
            '[{"model":"P-1","name":"配件","supplier":"供应商","qty":1,"snapshotPrice":5}]',
            5
        );
    `);
    db.prepare(`
        INSERT INTO quotations (
            id, customer_id, status, items_json, remark, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        3,
        1,
        '已接受',
        JSON.stringify([{
            id: 'quote-item-1',
            baseRecipeId: 2,
            baseRecipeName: '测试水泵',
            spec: 'Q-1',
            qty: 2,
            unitCost: 5,
            unitPrice: 6,
            margin: 1.2,
            bomSnapshot: [{
                model: 'P-1',
                name: '配件',
                supplier: '供应商',
                qty: 1,
                snapshotPrice: 5,
            }],
        }]),
        '测试报价',
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

    function safeInsert(table, values, context) {
        assert.equal(table, 'orders');
        const info = db.prepare(`
            INSERT INTO orders (
                customer_name, contract_no, remark, status, items_json,
                purchase_list_json, todos_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            values.customer_name,
            values.contract_no,
            values.remark,
            values.status,
            values.items_json,
            values.purchase_list_json,
            values.todos_json,
            values.created_at,
            values.updated_at
        );
        return {
            ...info,
            auditId: audit(table, Number(info.lastInsertRowid), context),
        };
    }

    function safeUpdate(table, id, updates, context) {
        assert.equal(table, 'quotations');
        db.prepare(`
            UPDATE quotations
            SET status = ?, converted_order_id = ?, converted_at = ?, updated_at = ?
            WHERE id = ?
        `).run(
            updates.status,
            updates.converted_order_id,
            updates.converted_at,
            '2026-08-02T00:01:00.000Z',
            id
        );
        return { changes: 1, auditId: audit(table, id, context) };
    }

    const dependencies = {
        db,
        dbGetAllParts: () => [{
            id: 4,
            model: 'P-1',
            supplier: '供应商',
            stock: 0,
            price: 5,
        }],
        dbGetAllCoils: () => [],
        orderRow: row => ({
            id: row.id,
            customerName: row.customer_name,
            status: row.status,
            updatedAt: row.updated_at,
        }),
        quotationRow: row => ({
            id: row.id,
            status: row.status,
            convertedOrderId: row.converted_order_id,
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
        idempotencyKey: `quotation:convert:${suffix}`,
        operationId: `operation-${suffix}`,
        requestId: `request-${suffix}`,
        warnings: [],
        now: new Date('2026-08-02T00:00:30.000Z'),
    };
}

test('报价转订单草稿返回版本令牌和建议幂等键且保持只读', () => {
    const fixture = createFixture();
    try {
        const draft = buildQuotationOrderDraft(fixture.dependencies, 3);
        assert.equal(draft.capabilityId, CAPABILITY_ID);
        assert.equal(draft.expectedUpdatedAt, FIXED_UPDATED_AT);
        assert.match(draft.suggestedIdempotencyKey, /^quotation-convert:3:/);
        assert.match(draft.previewHash, /^[a-f0-9]{64}$/);
        assert.equal(draft.items.length, 1);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('报价转订单命令原子创建订单、更新报价、强审计并可安全重放', () => {
    const fixture = createFixture();
    try {
        const commandContext = context('success');
        const draft = buildQuotationOrderDraft(fixture.dependencies, 3);
        const input = {
            quotationId: 3,
            expectedUpdatedAt: FIXED_UPDATED_AT,
            previewHash: draft.previewHash,
        };
        const first = executeQuotationConversion(fixture.dependencies, input, commandContext);
        const replay = executeQuotationConversion(fixture.dependencies, input, commandContext);

        assert.equal(first.order.id, 1);
        assert.equal(first.quotation.status, '已转订单');
        assert.equal(first.auditIds.length, 2);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 1);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 2);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 1);
        const auditCapabilities = fixture.db.prepare(
            'SELECT DISTINCT capability_id FROM audit_log'
        ).all().map(row => row.capability_id);
        assert.deepEqual(auditCapabilities, [CAPABILITY_ID]);
    } finally {
        fixture.db.close();
    }
});

test('报价转订单版本冲突不创建订单、审计或 operation', () => {
    const fixture = createFixture();
    try {
        assert.throws(
            () => executeQuotationConversion(
                fixture.dependencies,
                {
                    quotationId: 3,
                    expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
                },
                context('stale')
            ),
            error => error.code === 'resource_version_conflict' && error.statusCode === 409
        );
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('报价转订单在库存平衡变化后拒绝旧预览', () => {
    const fixture = createFixture();
    try {
        const draft = buildQuotationOrderDraft(fixture.dependencies, 3);
        fixture.dependencies.dbGetAllParts = () => [{
            id: 4,
            model: 'P-1',
            supplier: '供应商',
            stock: 1,
            price: 5,
        }];
        assert.throws(
            () => executeQuotationConversion(
                fixture.dependencies,
                {
                    quotationId: 3,
                    expectedUpdatedAt: draft.expectedUpdatedAt,
                    previewHash: draft.previewHash,
                },
                context('preview-changed')
            ),
            error => error.code === 'preview_changed' && error.statusCode === 409
        );
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('报价转订单任一强审计缺失时全部业务变更回滚', () => {
    const fixture = createFixture();
    try {
        const dependencies = {
            ...fixture.dependencies,
            safeUpdate(table, id, updates) {
                fixture.db.prepare(`
                    UPDATE quotations
                    SET status = ?, converted_order_id = ?, converted_at = ?
                    WHERE id = ?
                `).run(updates.status, updates.converted_order_id, updates.converted_at, id);
                return { changes: 1, auditId: null };
            },
        };
        const draft = buildQuotationOrderDraft(dependencies, 3);
        assert.throws(
            () => executeQuotationConversion(
                dependencies,
                {
                    quotationId: 3,
                    expectedUpdatedAt: FIXED_UPDATED_AT,
                    previewHash: draft.previewHash,
                },
                context('audit-failure')
            ),
            error => error.code === 'strong_audit_required'
        );
        assert.equal(fixture.db.prepare('SELECT status FROM quotations WHERE id = 3').get().status, '已接受');
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
    } finally {
        fixture.db.close();
    }
});
