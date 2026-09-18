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
const { buildPurchaseList } = require('../api/services/orderPlanning.cjs');

test('跨订单同名不同配置必须明确任务身份，不得把多个配置批量下单', () => {
    const fixture = createFixture();
    try {
        let chosen;
        for (const [id, length] of [[3, 2], [4, 5]]) {
            const items = [{ qty: 2, partsJson: JSON.stringify([{ partId: 1, model: 'P-1', supplier: '供应商A',
                name: '成品电缆', cableAssembly: true, cableLength: length, cableAccessoryType: 'standard', qty: 1 }]) }];
            fixture.db.prepare('UPDATE orders SET items_json=? WHERE id=?').run(JSON.stringify(items), id);
            if (id === 3) chosen = buildPurchaseList(items, fixture.dependencies.dbGetAllParts())[0];
        }
        const input = { model: 'P-1', supplier: '供应商A', purchased: true };
        assert.throws(() => buildPurchaseBatchDraft(fixture.dependencies, input), { code: 'PURCHASE_TARGET_AMBIGUOUS' });
        const draft = buildPurchaseBatchDraft(fixture.dependencies, { ...input, identityKey: chosen.identityKey });
        assert.equal(draft.affectedOrders.length, 1);
        assert.equal(draft.affectedOrders[0].orderId, 3);
        assert.equal(fixture.db.prepare('SELECT count(*) n FROM api_operations').get().n, 0);
    } finally { fixture.db.close(); }
});

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
        ), (
            2, 'P-2', '测试零件二', '供应商A', 6, 0, '${FIXED_UPDATED_AT}'
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
                }, {
                    model: 'P-2',
                    name: '测试零件二',
                    supplier: '供应商A',
                    qty: 2,
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

function supplierBatchInput() {
    return {
        supplier: '供应商A',
        purchased: true,
        tasks: [
            { identityKey: 'part:1', model: 'P-1', supplier: '供应商A' },
            { identityKey: 'part:2', model: 'P-2', supplier: '供应商A' },
        ],
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

test('同供应商多物料预览一次返回任务集合、明细和唯一订单版本且不写库', () => {
    const fixture = createFixture();
    try {
        const draft = buildPurchaseBatchDraft(fixture.dependencies, supplierBatchInput());
        assert.equal(draft.tasks.length, 2);
        assert.equal(draft.affectedItems.length, 4);
        assert.equal(draft.affectedOrders.length, 2);
        assert.equal(draft.expectedVersions.length, 2);
        assert.equal(new Set(draft.expectedVersions.map(item => item.orderId)).size, 2);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('同供应商多物料在一次命令中原子下单并安全重放', () => {
    const fixture = createFixture();
    try {
        const draft = buildPurchaseBatchDraft(fixture.dependencies, supplierBatchInput());
        const input = {
            ...supplierBatchInput(),
            expectedVersions: draft.expectedVersions,
            previewHash: draft.previewHash,
        };
        const first = executePurchaseBatch(fixture.dependencies, input, context('supplier-success'));
        const replay = executePurchaseBatch(fixture.dependencies, input, context('supplier-success'));
        assert.equal(first.updatedCount, 2);
        assert.equal(first.changes.filter(change => change.field === 'orderedQty').length, 4);
        assert.equal(replay.idempotentReplay, true);
        for (const row of fixture.db.prepare('SELECT * FROM orders ORDER BY id').all()) {
            const items = JSON.parse(row.purchase_list_json);
            assert.equal(items.length, 2);
            assert.ok(items.every(item => item.orderedQty === item.plannedQty));
        }
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 2);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 1);
    } finally {
        fixture.db.close();
    }
});

test('供应商批量拒绝空任务、重复任务、混合供应商和超限任务', () => {
    const fixture = createFixture();
    try {
        assert.throws(
            () => buildPurchaseBatchDraft(fixture.dependencies, { purchased: true, tasks: [] }),
            error => error.code === 'purchase_tasks_required' && error.statusCode === 400
        );
        const repeated = supplierBatchInput().tasks[0];
        assert.throws(
            () => buildPurchaseBatchDraft(fixture.dependencies, { purchased: true, tasks: [repeated, repeated] }),
            error => error.code === 'purchase_tasks_duplicate' && error.statusCode === 400
        );
        assert.throws(
            () => buildPurchaseBatchDraft(fixture.dependencies, {
                purchased: true,
                tasks: [repeated, { model: 'P-X', supplier: '供应商B' }],
            }),
            error => error.code === 'purchase_supplier_mismatch' && error.statusCode === 400
        );
        assert.throws(
            () => buildPurchaseBatchDraft(fixture.dependencies, {
                purchased: true,
                tasks: Array.from({ length: 51 }, (_, index) => ({
                    model: `P-${index + 10}`,
                    supplier: '供应商A',
                })),
            }),
            error => error.code === 'purchase_tasks_limit_exceeded' && error.statusCode === 400
        );
    } finally {
        fixture.db.close();
    }
});

test('供应商批量任一任务失效或选择范围重叠时整批拒绝且不写库', () => {
    const fixture = createFixture();
    try {
        assert.throws(
            () => buildPurchaseBatchDraft(fixture.dependencies, {
                purchased: true,
                tasks: [
                    supplierBatchInput().tasks[0],
                    { identityKey: 'part:999', model: 'P-999', supplier: '供应商A' },
                ],
            }),
            error => error.code === 'purchase_task_unavailable' && error.statusCode === 409
        );
        assert.throws(
            () => buildPurchaseBatchDraft(fixture.dependencies, {
                purchased: true,
                tasks: [
                    supplierBatchInput().tasks[0],
                    { model: 'P-1', supplier: '供应商A' },
                ],
            }),
            error => error.code === 'purchase_tasks_overlap' && error.statusCode === 400
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

test('供应商批量取消下单走同一预览命令链并恢复全部任务', () => {
    const fixture = createFixture();
    try {
        const purchaseDraft = buildPurchaseBatchDraft(fixture.dependencies, supplierBatchInput());
        executePurchaseBatch(fixture.dependencies, {
            ...supplierBatchInput(),
            expectedVersions: purchaseDraft.expectedVersions,
            previewHash: purchaseDraft.previewHash,
        }, context('supplier-order-before-cancel'));

        const cancelInput = {
            ...supplierBatchInput(),
            purchased: false,
        };
        const cancelDraft = buildPurchaseBatchDraft(fixture.dependencies, cancelInput);
        const cancelled = executePurchaseBatch(fixture.dependencies, {
            ...cancelInput,
            expectedVersions: cancelDraft.expectedVersions,
            previewHash: cancelDraft.previewHash,
        }, context('supplier-cancel'));
        assert.equal(cancelled.updatedCount, 2);
        for (const row of fixture.db.prepare('SELECT purchase_list_json FROM orders').all()) {
            const items = JSON.parse(row.purchase_list_json);
            assert.ok(items.every(item => item.orderedQty === 0));
        }
    } finally {
        fixture.db.close();
    }
});

test('供应商批量在任务集合变化后拒绝旧预览', () => {
    const fixture = createFixture();
    try {
        const draft = buildPurchaseBatchDraft(fixture.dependencies, supplierBatchInput());
        assert.throws(
            () => executePurchaseBatch(
                fixture.dependencies,
                {
                    purchased: true,
                    tasks: [supplierBatchInput().tasks[0]],
                    expectedVersions: draft.expectedVersions,
                    previewHash: draft.previewHash,
                },
                context('task-drift')
            ),
            error => error.code === 'preview_changed' && error.statusCode === 409
        );
        assert.ok(
            fixture.db.prepare('SELECT purchase_list_json FROM orders').all()
                .every(row => row.purchase_list_json === '[]')
        );
    } finally {
        fixture.db.close();
    }
});

test('供应商批量相同幂等键不同任务参数返回冲突且不重复写入', () => {
    const fixture = createFixture();
    try {
        const firstDraft = buildPurchaseBatchDraft(fixture.dependencies, supplierBatchInput());
        const commandContext = context('supplier-conflict');
        executePurchaseBatch(fixture.dependencies, {
            ...supplierBatchInput(),
            expectedVersions: firstDraft.expectedVersions,
            previewHash: firstDraft.previewHash,
        }, commandContext);
        const secondInput = {
            purchased: true,
            tasks: [supplierBatchInput().tasks[0]],
        };
        const secondDraft = buildPurchaseBatchDraft(fixture.dependencies, secondInput);
        assert.throws(
            () => executePurchaseBatch(fixture.dependencies, {
                ...secondInput,
                expectedVersions: secondDraft.expectedVersions,
                previewHash: secondDraft.previewHash,
            }, commandContext),
            error => error.code === 'idempotency_key_conflict' && error.statusCode === 409
        );
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 1);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 2);
    } finally {
        fixture.db.close();
    }
});
