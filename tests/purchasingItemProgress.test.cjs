const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { installBusinessChangeSchema } = require('./helpers/businessChangeSchema.cjs');
const {
    CAPABILITY_ID,
    buildLegacyPurchaseItemToggleInput,
    buildPurchaseItemProgressDraft,
    executePurchaseItemProgress,
} = require('../api/services/purchasingItemProgress.cjs');

const FIXED_UPDATED_AT = '2026-08-02T00:00:00.000Z';
const NEXT_UPDATED_AT = '2026-08-02T00:01:00.000Z';
const { buildPurchaseList } = require('../api/services/orderPlanning.cjs');

test('同名多电缆配置禁止按名称选择首行，明确身份只修改目标配置', () => {
    const fixture = createFixture();
    try {
        const items = [{ qty: 3, partsJson: JSON.stringify([2, 5].map(length => ({
            partId: 1, model: 'P-1', supplier: '供应商A', name: '成品电缆', cableAssembly: true,
            cableLength: length, cableAccessoryType: 'standard', qty: 1,
        }))) }];
        const rows = buildPurchaseList(items, fixture.dependencies.dbGetAllParts());
        fixture.db.prepare('UPDATE orders SET items_json=?, purchase_list_json=? WHERE id=3').run(JSON.stringify(items), JSON.stringify(rows));
        const input = { model: 'P-1', supplier: '供应商A', orderedQty: 2, receivedQty: 0, stockedQty: 0 };
        assert.throws(() => buildPurchaseItemProgressDraft(fixture.dependencies, 3, input), { code: 'PURCHASE_TARGET_AMBIGUOUS' });
        assert.throws(() => buildLegacyPurchaseItemToggleInput(fixture.dependencies, 3, input), { code: 'PURCHASE_TARGET_AMBIGUOUS' });
        const selected = { ...input, identityKey: rows[1].identityKey };
        const draft = buildPurchaseItemProgressDraft(fixture.dependencies, 3, selected);
        executePurchaseItemProgress(fixture.dependencies, { ...selected, orderId: 3, expectedUpdatedAt: draft.expectedUpdatedAt,
            previewHash: draft.previewHash }, { capabilityId: CAPABILITY_ID, actorKey: 'test', idempotencyKey: 'test-config-selection', operationId: 'test-config-selection' });
        const after = JSON.parse(fixture.db.prepare('SELECT purchase_list_json FROM orders WHERE id=3').get().purchase_list_json);
        assert.deepEqual(after.map(row => row.orderedQty), [0, 2]);
        assert.deepEqual(after.map(row => row.id), rows.map(row => row.id));
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
            id, model, name, supplier, price, stock, updated_at
        ) VALUES (
            1, 'P-1', '测试零件', '供应商A', 5, 0, '${FIXED_UPDATED_AT}'
        );
    `);
    db.prepare(`
        INSERT INTO orders (
            id, customer_name, status, items_json, purchase_list_json,
            todos_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        3,
        '测试客户',
        '待采购',
        JSON.stringify([{
            id: 'item-1',
            recipeName: '测试水泵',
            qty: 5,
            unitCost: 5,
            unitPrice: 6,
            partsJson: JSON.stringify([{
                model: 'P-1',
                name: '测试零件',
                supplier: '供应商A',
                qty: 1,
                inventoryQty: 1,
                snapshotPrice: 5,
            }]),
        }]),
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
        dbGetAllParts: () => db.prepare(`
            SELECT
                id, model, name, supplier, price, stock,
                updated_at AS updatedAt
            FROM parts
            WHERE deleted_at IS NULL
        `).all(),
        dbGetAllCoils: () => db.prepare(`
            SELECT
                id, spec, sheets, material, slot_type AS slotType,
                scheme_status AS schemeStatus, stock,
                updated_at AS updatedAt
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

test('旧采购 toggle 兼容输入在 service 内按正式采购项转换', () => {
    const fixture = createFixture();
    try {
        fixture.db.prepare(`
            UPDATE orders
            SET purchase_list_json = ?
            WHERE id = 3
        `).run(JSON.stringify([{
            identityKey: 'part:P-1:供应商A',
            model: 'P-1',
            supplier: '供应商A',
            plannedQty: 5,
            orderedQty: 0,
            receivedQty: 0,
            stockedQty: 0,
        }]));
        assert.deepEqual(
            buildLegacyPurchaseItemToggleInput(
                { db: fixture.db },
                3,
                {
                    model: 'P-1',
                    supplier: '供应商A',
                    purchased: true,
                }
            ),
            {
                identityKey: 'part:P-1:供应商A',
                model: 'P-1',
                supplier: '供应商A',
                orderedQty: 5,
            }
        );
        assert.throws(
            () => buildLegacyPurchaseItemToggleInput(
                { db: fixture.db },
                3,
                { model: '不存在' }
            ),
            error => (
                error.code === 'purchase_item_not_found'
                && error.statusCode === 404
            )
        );
    } finally {
        fixture.db.close();
    }
});

function progressInput() {
    return {
        identityKey: 'part:1',
        model: 'P-1',
        supplier: '供应商A',
        orderedQty: 5,
        receivedQty: 3,
        stockedQty: 2,
        purchasePrice: 4.5,
        actualSupplier: '实际供应商',
    };
}

function context(suffix) {
    return {
        capabilityId: CAPABILITY_ID,
        actorKey: 'jwt:test-session',
        idempotencyKey: `purchase:progress:${suffix}`,
        operationId: `operation-${suffix}`,
        requestId: `request-${suffix}`,
        warnings: [],
        now: new Date('2026-08-02T00:00:30.000Z'),
    };
}

test('采购单项进度草稿返回正式版本、预览哈希和库存影响且保持只读', () => {
    const fixture = createFixture();
    try {
        const draft = buildPurchaseItemProgressDraft(
            fixture.dependencies,
            3,
            progressInput()
        );
        assert.equal(draft.capabilityId, CAPABILITY_ID);
        assert.equal(draft.expectedUpdatedAt, FIXED_UPDATED_AT);
        assert.equal(draft.requiresConfirmation, true);
        assert.match(draft.suggestedIdempotencyKey, /^purchase-progress:3:/);
        assert.match(draft.previewHash, /^[a-f0-9]{64}$/);
        assert.deepEqual(draft.item.after, {
            orderedQty: 5,
            receivedQty: 3,
            stockedQty: 2,
            purchasePrice: 4.5,
            purchasePriceRecorded: true,
            actualSupplier: '实际供应商',
        });
        assert.equal(draft.stockAddition.inventoryType, 'part');
        assert.equal(draft.stockAddition.currentStock, 0);
        assert.equal(draft.stockAddition.stockAfter, 2);
        assert.equal(fixture.db.prepare('SELECT stock FROM parts WHERE id = 1').get().stock, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('采购单项分批入库、operation 和强审计原子提交且相同命令安全重放', () => {
    const fixture = createFixture();
    try {
        const draft = buildPurchaseItemProgressDraft(
            fixture.dependencies,
            3,
            progressInput()
        );
        const input = {
            orderId: 3,
            ...progressInput(),
            expectedUpdatedAt: draft.expectedUpdatedAt,
            previewHash: draft.previewHash,
        };
        const first = executePurchaseItemProgress(
            fixture.dependencies,
            input,
            context('success')
        );
        const replay = executePurchaseItemProgress(
            fixture.dependencies,
            input,
            context('success')
        );
        assert.equal(first.capabilityId, CAPABILITY_ID);
        assert.equal(first.stockAddition.addQty, 2);
        assert.equal(first.stockAddition.inventoryAddQty, 2);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(fixture.db.prepare('SELECT stock FROM parts WHERE id = 1').get().stock, 2);
        const order = fixture.db.prepare('SELECT * FROM orders WHERE id = 3').get();
        const item = JSON.parse(order.purchase_list_json)[0];
        assert.equal(order.status, '采购中');
        assert.equal(item.orderedQty, 5);
        assert.equal(item.receivedQty, 3);
        assert.equal(item.stockedQty, 2);
        assert.equal(item.stockInHistory.length, 1);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 1);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 2);
        const audits = fixture.db.prepare('SELECT * FROM audit_log ORDER BY id').all();
        assert.ok(audits.every(audit => audit.operation_id === 'operation-success'));
        assert.ok(audits.every(audit => audit.capability_id === CAPABILITY_ID));
    } finally {
        fixture.db.close();
    }
});

test('采购单项进度在订单版本冲突时不写库存、订单、operation 或审计', () => {
    const fixture = createFixture();
    try {
        assert.throws(
            () => executePurchaseItemProgress(
                fixture.dependencies,
                {
                    orderId: 3,
                    ...progressInput(),
                    expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
                },
                context('stale')
            ),
            error => error.code === 'resource_version_conflict' && error.statusCode === 409
        );
        assert.equal(fixture.db.prepare('SELECT stock FROM parts WHERE id = 1').get().stock, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('采购单项进度在库存变化后拒绝旧预览并回滚 operation', () => {
    const fixture = createFixture();
    try {
        const draft = buildPurchaseItemProgressDraft(
            fixture.dependencies,
            3,
            progressInput()
        );
        fixture.db.prepare('UPDATE parts SET stock = 4 WHERE id = 1').run();
        assert.throws(
            () => executePurchaseItemProgress(
                fixture.dependencies,
                {
                    orderId: 3,
                    ...progressInput(),
                    expectedUpdatedAt: draft.expectedUpdatedAt,
                    previewHash: draft.previewHash,
                },
                context('preview-changed')
            ),
            error => error.code === 'preview_changed' && error.statusCode === 409
        );
        assert.equal(fixture.db.prepare('SELECT stock FROM parts WHERE id = 1').get().stock, 4);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('采购单项进度缺少强审计时库存、订单和 operation 全部回滚', () => {
    const fixture = createFixture();
    try {
        const draft = buildPurchaseItemProgressDraft(
            fixture.dependencies,
            3,
            progressInput()
        );
        const dependencies = {
            ...fixture.dependencies,
            safeUpdate(table, id, updates, auditContext) {
                if (table === 'parts') {
                    fixture.db.prepare('UPDATE parts SET stock = ? WHERE id = ?')
                        .run(updates.stock, id);
                    return { changes: 1, auditId: null };
                }
                return fixture.dependencies.safeUpdate(
                    table,
                    id,
                    updates,
                    auditContext
                );
            },
        };
        assert.throws(
            () => executePurchaseItemProgress(
                dependencies,
                {
                    orderId: 3,
                    ...progressInput(),
                    expectedUpdatedAt: draft.expectedUpdatedAt,
                    previewHash: draft.previewHash,
                },
                context('audit-failure')
            ),
            error => error.code === 'strong_audit_required'
        );
        assert.equal(fixture.db.prepare('SELECT stock FROM parts WHERE id = 1').get().stock, 0);
        assert.equal(fixture.db.prepare('SELECT status FROM orders WHERE id = 3').get().status, '待采购');
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
    } finally {
        fixture.db.close();
    }
});
