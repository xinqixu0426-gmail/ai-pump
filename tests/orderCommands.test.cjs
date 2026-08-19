const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID,
    STATUS_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID,
    buildOrderSavePayloadDraft,
    executeOrderCreate,
    executeOrderDelete,
    executeOrderStatus,
    executeOrderUpdate,
} = require('../api/services/orderCommands.cjs');

const FIXED_UPDATED_AT = '2026-08-02T00:00:00.000Z';
const NEXT_UPDATED_AT = '2026-08-02T00:01:00.000Z';

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
        CREATE TABLE customers (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            deleted_at TEXT
        );
        CREATE TABLE recipes (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            spec TEXT,
            parts_json TEXT NOT NULL,
            saved_total_cost REAL NOT NULL,
            deleted_at TEXT
        );
        CREATE TABLE orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER,
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
            inventory_disposition TEXT,
            inventory_disposition_at TEXT,
            inventory_disposition_note TEXT,
            created_at TEXT,
            updated_at TEXT,
            deleted_at TEXT
        );
        INSERT INTO parts (
            id, model, name, supplier, price, stock, updated_at
        ) VALUES (
            1, 'P-1', '测试零件', '供应商A', 5, 0, '${FIXED_UPDATED_AT}'
        );
        INSERT INTO customers (id, name) VALUES
            (1, '测试客户'),
            (2, '待确认客户'),
            (3, '修改后客户');
        INSERT INTO recipes (
            id, name, spec, parts_json, saved_total_cost
        ) VALUES (
            1, '测试水泵', '测试规格',
            '[{"model":"P-1","name":"测试零件","supplier":"供应商A","qty":1,"inventoryQty":1}]',
            5
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

    function safeInsert(table, values, context) {
        assert.equal(table, 'orders');
        const columns = Object.keys(values).filter(column => values[column] !== undefined);
        const info = db.prepare(`
            INSERT INTO orders (${columns.join(', ')})
            VALUES (${columns.map(() => '?').join(', ')})
        `).run(...columns.map(column => values[column]));
        return {
            ...info,
            auditId: audit(table, Number(info.lastInsertRowid), context),
        };
    }

    function safeUpdate(table, id, updates, context) {
        assert.equal(table, 'orders');
        const columns = Object.keys(updates).filter(column => updates[column] !== undefined);
        db.prepare(`
            UPDATE orders
            SET ${columns.map(column => `${column} = ?`).join(', ')}, updated_at = ?
            WHERE id = ?
        `).run(...columns.map(column => updates[column]), NEXT_UPDATED_AT, id);
        return {
            changes: 1,
            auditId: audit(table, id, context),
        };
    }

    const orderRow = row => ({
        id: row.id,
        customerName: row.customer_name,
        contractNo: row.contract_no,
        status: row.status,
        statusReason: row.status_reason || '',
        inventoryDisposition: row.inventory_disposition || null,
        inventoryDispositionAt: row.inventory_disposition_at || null,
        inventoryDispositionNote: row.inventory_disposition_note || '',
        itemsJson: row.items_json,
        purchaseListJson: row.purchase_list_json,
        todosJson: row.todos_json,
        updatedAt: row.updated_at,
    });
    const dependencies = {
        db,
        dbGetAllParts: () => db.prepare(`
            SELECT id, model, name, supplier, price, stock, updated_at AS updatedAt
            FROM parts WHERE deleted_at IS NULL
        `).all(),
        dbGetAllCoils: () => [],
        orderRow,
        safeInsert,
        safeUpdate,
    };
    return { db, dependencies };
}

function draftInput() {
    return {
        customerId: 1,
        customerName: '测试客户',
        contractNo: 'HT-001',
        remark: '服务测试',
        items: [{
            id: 'order-item-test',
            recipeId: 1,
            recipeName: '测试水泵',
            qty: 2,
            unitCost: 5,
            unitPrice: 6,
            profitMargin: 1.2,
            partsJson: JSON.stringify([{
                model: 'P-1',
                name: '测试零件',
                supplier: '供应商A',
                qty: 1,
                inventoryQty: 1,
            }]),
        }],
    };
}

function commandContext(capabilityId, suffix) {
    return {
        capabilityId,
        actorKey: 'jwt:test-session',
        idempotencyKey: `order:command:${suffix}`,
        operationId: `operation-${suffix}`,
        requestId: `request-${suffix}`,
        warnings: [],
    };
}

function insertPendingOrder(fixture) {
    return Number(fixture.db.prepare(`
        INSERT INTO orders (
            customer_name, contract_no, remark, status, items_json,
            purchase_list_json, todos_json, created_at, updated_at
        ) VALUES (?, ?, '', '待确认', ?, '[]', '[]', ?, ?)
    `).run(
        '待确认客户',
        'HT-STATUS',
        JSON.stringify(draftInput().items),
        FIXED_UPDATED_AT,
        FIXED_UPDATED_AT
    ).lastInsertRowid);
}

test('订单保存草稿返回正式建单能力元数据且保持只读', () => {
    const fixture = createFixture();
    try {
        const draft = buildOrderSavePayloadDraft(fixture.dependencies, draftInput());
        assert.equal(draft.capabilityId, CREATE_CAPABILITY_ID);
        assert.equal(draft.requiresConfirmation, true);
        assert.match(draft.suggestedIdempotencyKey, /^order-create:/);
        assert.match(draft.previewHash, /^[a-f0-9]{64}$/);
        assert.equal(JSON.parse(draft.purchaseListJson)[0].plannedQty, 2);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('直接建单使用预览绑定、持久幂等和强审计并保持旧订单字段', () => {
    const fixture = createFixture();
    try {
        const draft = buildOrderSavePayloadDraft(fixture.dependencies, draftInput());
        const context = commandContext(CREATE_CAPABILITY_ID, 'create');
        const first = executeOrderCreate(fixture.dependencies, draft, context);
        const replay = executeOrderCreate(fixture.dependencies, draft, context);

        assert.equal(first.order.customerName, '测试客户');
        assert.equal(first.order.status, '待确认');
        assert.equal(first.status, 'completed');
        assert.equal(first.auditIds.length, 1);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 1);
        const audit = fixture.db.prepare(`
            SELECT capability_id, operation_id FROM audit_log
        `).get();
        assert.equal(audit.capability_id, CREATE_CAPABILITY_ID);
        assert.equal(audit.operation_id, 'operation-create');
    } finally {
        fixture.db.close();
    }
});

test('直接建单拒绝已变化的预览且不产生业务或命令记录', () => {
    const fixture = createFixture();
    try {
        const draft = buildOrderSavePayloadDraft(fixture.dependencies, draftInput());
        assert.throws(
            () => executeOrderCreate(
                fixture.dependencies,
                { ...draft, customerId: 3, customerName: '修改后客户' },
                commandContext(CREATE_CAPABILITY_ID, 'preview-conflict')
            ),
            error => error.code === 'preview_changed' && error.statusCode === 409
        );
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('订单状态命令校验 expectedUpdatedAt 并在冲突时整体回滚', () => {
    const fixture = createFixture();
    try {
        const orderId = insertPendingOrder(fixture);
        assert.throws(
            () => executeOrderStatus(
                fixture.dependencies,
                orderId,
                {
                    status: '待采购',
                    expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
                },
                commandContext(STATUS_CAPABILITY_ID, 'version-conflict')
            ),
            error => error.code === 'resource_version_conflict'
                && error.statusCode === 409
        );
        assert.equal(
            fixture.db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status,
            '待确认'
        );
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('确认订单重新计算采购计划并生成可重放的标准回执', () => {
    const fixture = createFixture();
    try {
        const orderId = insertPendingOrder(fixture);
        const input = {
            status: '待采购',
            expectedUpdatedAt: FIXED_UPDATED_AT,
        };
        const context = commandContext(STATUS_CAPABILITY_ID, 'confirm');
        const first = executeOrderStatus(fixture.dependencies, orderId, input, context);
        const replay = executeOrderStatus(fixture.dependencies, orderId, input, context);

        assert.equal(first.order.status, '待采购');
        assert.equal(JSON.parse(first.order.purchaseListJson)[0].plannedQty, 2);
        assert.equal(first.status, 'completed');
        assert.equal(first.auditIds.length, 1);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 1);
    } finally {
        fixture.db.close();
    }
});

test('关闭订单必须明确库存去向，释放预留必须填写原因', () => {
    const fixture = createFixture();
    try {
        const orderId = insertPendingOrder(fixture);
        fixture.db.prepare(`UPDATE orders SET status = '采购完成' WHERE id = ?`).run(orderId);
        const context = commandContext(STATUS_CAPABILITY_ID, 'close-with-disposition');

        assert.throws(
            () => executeOrderStatus(
                fixture.dependencies,
                orderId,
                { status: '已关闭', expectedUpdatedAt: FIXED_UPDATED_AT },
                context
            ),
            error => error.code === 'order_close_inventory_disposition_required'
                && error.statusCode === 422
        );
        assert.throws(
            () => executeOrderStatus(
                fixture.dependencies,
                orderId,
                {
                    status: '已关闭',
                    inventoryDisposition: 'reservation_released',
                    expectedUpdatedAt: FIXED_UPDATED_AT,
                },
                context
            ),
            error => error.code === 'order_close_release_note_required'
                && error.statusCode === 422
        );

        const result = executeOrderStatus(
            fixture.dependencies,
            orderId,
            {
                status: '已关闭',
                inventoryDisposition: 'reservation_released',
                inventoryDispositionNote: '客户取消后续生产安排',
                expectedUpdatedAt: FIXED_UPDATED_AT,
            },
            context
        );
        assert.equal(result.order.status, '已关闭');
        assert.equal(result.order.inventoryDisposition, 'reservation_released');
        assert.equal(result.order.inventoryDispositionNote, '客户取消后续生产安排');
    } finally {
        fixture.db.close();
    }
});

test('订单状态强审计缺失时回滚状态和 operation', () => {
    const fixture = createFixture();
    try {
        const orderId = insertPendingOrder(fixture);
        const dependencies = {
            ...fixture.dependencies,
            safeUpdate(table, id, updates) {
                const columns = Object.keys(updates).filter(column => updates[column] !== undefined);
                fixture.db.prepare(`
                    UPDATE orders
                    SET ${columns.map(column => `${column} = ?`).join(', ')}, updated_at = ?
                    WHERE id = ?
                `).run(...columns.map(column => updates[column]), NEXT_UPDATED_AT, id);
                return { changes: 1, auditId: null };
            },
        };
        assert.throws(
            () => executeOrderStatus(
                dependencies,
                orderId,
                {
                    status: '待采购',
                    expectedUpdatedAt: FIXED_UPDATED_AT,
                },
                commandContext(STATUS_CAPABILITY_ID, 'audit-failure')
            ),
            error => error.code === 'strong_audit_required'
                && error.statusCode === 500
        );
        const row = fixture.db.prepare(
            'SELECT status, updated_at FROM orders WHERE id = ?'
        ).get(orderId);
        assert.equal(row.status, '待确认');
        assert.equal(row.updated_at, FIXED_UPDATED_AT);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('待确认订单编辑绑定草稿、版本、幂等和强审计', () => {
    const fixture = createFixture();
    try {
        const orderId = insertPendingOrder(fixture);
        const draft = buildOrderSavePayloadDraft(fixture.dependencies, {
            ...draftInput(),
            customerId: 3,
            customerName: '修改后客户',
        });
        const input = {
            ...draft,
            expectedUpdatedAt: FIXED_UPDATED_AT,
        };
        const context = commandContext(UPDATE_CAPABILITY_ID, 'update');
        const first = executeOrderUpdate(
            fixture.dependencies,
            orderId,
            input,
            context
        );
        const replay = executeOrderUpdate(
            fixture.dependencies,
            orderId,
            input,
            context
        );

        assert.equal(first.order.customerName, '修改后客户');
        assert.equal(first.status, 'completed');
        assert.equal(first.auditIds.length, 1);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 1);
    } finally {
        fixture.db.close();
    }
});

test('待确认订单编辑拒绝旧版本且不留下 operation', () => {
    const fixture = createFixture();
    try {
        const orderId = insertPendingOrder(fixture);
        const draft = buildOrderSavePayloadDraft(fixture.dependencies, draftInput());
        assert.throws(
            () => executeOrderUpdate(
                fixture.dependencies,
                orderId,
                {
                    ...draft,
                    expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
                },
                commandContext(UPDATE_CAPABILITY_ID, 'update-version')
            ),
            error => error.code === 'resource_version_conflict'
                && error.statusCode === 409
        );
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('订单删除使用版本、持久幂等和强审计并保持软删除', () => {
    const fixture = createFixture();
    try {
        const orderId = insertPendingOrder(fixture);
        const input = { expectedUpdatedAt: FIXED_UPDATED_AT };
        const context = commandContext(DELETE_CAPABILITY_ID, 'delete');
        const first = executeOrderDelete(
            fixture.dependencies,
            orderId,
            input,
            context
        );
        const replay = executeOrderDelete(
            fixture.dependencies,
            orderId,
            input,
            context
        );

        assert.equal(first.deleted, 1);
        assert.equal(first.orderId, orderId);
        assert.equal(first.status, 'completed');
        assert.equal(first.auditIds.length, 1);
        assert.equal(replay.idempotentReplay, true);
        assert.ok(fixture.db.prepare(
            'SELECT deleted_at FROM orders WHERE id = ?'
        ).get(orderId).deleted_at);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 1);
    } finally {
        fixture.db.close();
    }
});

test('订单删除拒绝采购中订单并整体回滚', () => {
    const fixture = createFixture();
    try {
        const orderId = insertPendingOrder(fixture);
        fixture.db.prepare(
            'UPDATE orders SET status = ? WHERE id = ?'
        ).run('采购中', orderId);
        assert.throws(
            () => executeOrderDelete(
                fixture.dependencies,
                orderId,
                { expectedUpdatedAt: FIXED_UPDATED_AT },
                commandContext(DELETE_CAPABILITY_ID, 'delete-status')
            ),
            error => error.code === 'order_delete_status_conflict'
                && error.statusCode === 409
        );
        assert.equal(
            fixture.db.prepare('SELECT deleted_at FROM orders WHERE id = ?').get(orderId).deleted_at,
            null
        );
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
    } finally {
        fixture.db.close();
    }
});
