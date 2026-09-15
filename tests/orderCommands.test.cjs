const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { installBusinessChangeSchema } = require('./helpers/businessChangeSchema.cjs');
const {
    CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID,
    STATUS_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID,
    buildOrderStatusDraft,
    buildOrderSavePayloadDraft,
    executeOrderCreate,
    executeOrderDelete,
    executeOrderStatus,
    executeOrderUpdate,
} = require('../api/services/orderCommands.cjs');
const { createCostQueries } = require('../api/services/costQueries.cjs');
const { buildOrderReadiness } = require('../api/services/orderReadiness.cjs');
const { listOrderRevisions } = require('../api/services/orderRevisions.cjs');

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
        CREATE TABLE coil_stock_movements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            coil_id INTEGER NOT NULL,
            change_qty INTEGER NOT NULL,
            balance_after INTEGER NOT NULL,
            movement_type TEXT NOT NULL,
            reference_type TEXT,
            reference_id TEXT,
            note TEXT,
            created_at TEXT NOT NULL
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
            coil_spec TEXT,
            coil_sheets INTEGER,
            coil_material TEXT,
            coil_slot_type TEXT,
            has_float INTEGER,
            float_wire TEXT,
            float_accessory_type TEXT,
            has_cable INTEGER,
            cable_length REAL,
            cable_wire TEXT,
            cable_accessory_type TEXT,
            box_type TEXT,
            packing_parts_json TEXT,
            custom_barrel_length REAL,
            assembly_wage REAL,
            packing_wage REAL,
            painting_wage REAL,
            surface_treatment_mode TEXT,
            surface_treatment_cost REAL,
            management_fee REAL,
            configuration_policy_json TEXT,
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
        CREATE TABLE order_revisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            revision_no INTEGER NOT NULL,
            reason TEXT NOT NULL,
            before_snapshot_json TEXT NOT NULL,
            after_snapshot_json TEXT NOT NULL,
            change_summary_json TEXT NOT NULL,
            operation_id TEXT NOT NULL UNIQUE,
            actor TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(order_id, revision_no)
        );
        INSERT INTO parts (
            id, model, name, supplier, price, stock, updated_at
        ) VALUES
            (1, 'P-1', '测试零件', '供应商A', 5, 0, '${FIXED_UPDATED_AT}'),
            (2, 'BOX-1', '测试纸箱', '包装供应商', 12, 0, '${FIXED_UPDATED_AT}'),
            (30, '浮球-0.55', '浮球', '供应商A', 10, 0, '${FIXED_UPDATED_AT}');
        INSERT INTO coils (
            id, spec, sheets, material, slot_type, scheme_status, stock, updated_at
        ) VALUES (10, 'Y90', 10, '钢带', '小眼', 'official', 0, '${FIXED_UPDATED_AT}');
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
        INSERT INTO recipes (
            id, name, spec, parts_json, saved_total_cost,
            coil_spec, coil_sheets, coil_material, coil_slot_type,
            has_float, float_wire, float_accessory_type, has_cable,
            packing_parts_json, surface_treatment_mode
        ) VALUES (
            2, '可配置水泵', '配置规格',
            '[{"model":"P-1","name":"测试零件","supplier":"供应商A","qty":1,"snapshotPrice":5},{"model":"浮球-0.55","name":"浮球","supplier":"供应商A","qty":1,"snapshotPrice":10}]',
            15, 'Y90', 10, '钢带', '小眼', 1, '0.55', 'standard', 0,
            '[]', 'none'
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
        assert.ok(['orders', 'order_revisions', 'coil_stock_movements'].includes(table));
        const columns = Object.keys(values).filter(column => values[column] !== undefined);
        const info = db.prepare(`
            INSERT INTO ${table} (${columns.join(', ')})
            VALUES (${columns.map(() => '?').join(', ')})
        `).run(...columns.map(column => values[column]));
        return {
            ...info,
            auditId: audit(table, Number(info.lastInsertRowid), context),
        };
    }

    function safeUpdate(table, id, updates, context) {
        assert.ok(['orders', 'parts', 'coils'].includes(table));
        const columns = Object.keys(updates).filter(column => updates[column] !== undefined);
        db.prepare(`
            UPDATE ${table}
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
        calculateRecipeCost: parts => ({
            totalCost: (parts || []).reduce((sum, part) => sum + Number(part.snapshotPrice || 0) * Number(part.qty || 1), 0),
        }),
        db,
        dbGetAllParts: () => db.prepare(`
            SELECT id, model, name, supplier, price, stock, updated_at AS updatedAt
            FROM parts WHERE deleted_at IS NULL
        `).all(),
        dbGetAllCoils: () => [
            { id: 10, spec: 'Y90', material: '钢带', slotType: '小眼', sheets: 10, unitPrice: 0.2, wireWeight: 0.2, copperBase: 70, coilFee: 2, rotorFee: 3, schemeStatus: 'official' },
            { id: 20, spec: 'Y90', material: '钢带', slotType: '小眼', sheets: 20, unitPrice: 0.2, wireWeight: 0.4, copperBase: 70, coilFee: 4, rotorFee: 5, schemeStatus: 'official' },
        ],
        getSetting: () => undefined,
        loadPartsData: () => ({
            partsCache: {
                'P-1': { price: 5, supplier: '供应商A', category: '测试' },
                '浮球-0.55': { price: 10, supplier: '供应商A', category: '选配' },
                'BOX-1': { price: 12, supplier: '包装供应商', category: '包装' },
            },
            partsByModel: {
                'P-1': [{ id: 1, model: 'P-1', name: '测试零件', supplier: '供应商A', price: 5 }],
                '浮球-0.55': [{ id: 30, model: '浮球-0.55', name: '浮球', supplier: '供应商A', price: 10 }],
                'BOX-1': [{ id: 2, model: 'BOX-1', name: '测试纸箱', supplier: '包装供应商', price: 12, category: '包装' }],
            },
        }),
        orderRow,
        safeInsert,
        safeUpdate,
        invalidatePartsCache() {},
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

function kitCoil() {
    return {
        id: 88,
        spec: 'Y90',
        material: '钢带',
        slotType: '小眼',
        sheets: 12,
        pricingMode: 'kit',
        kitPrice: 88.5,
        cost: 88.5,
        schemeStatus: 'official',
        stock: 0,
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

test('历史配方不带客户配置直接建单时统一补齐稳定零件身份', () => {
    const fixture = createFixture();
    try {
        const draft = buildOrderSavePayloadDraft(fixture.dependencies, draftInput());
        const [item] = JSON.parse(draft.itemsJson);
        const [part] = JSON.parse(item.partsJson);

        assert.equal(part.partId, 1);
        assert.equal(part.model, 'P-1');
        assert.equal(part.supplier, '供应商A');
        assert.equal(item.unitCost, 5);
    } finally {
        fixture.db.close();
    }
});

test('历史配方零件身份有歧义时阻止生成新的订单快照', () => {
    const fixture = createFixture();
    try {
        fixture.db.prepare(`
            INSERT INTO parts (id, model, name, supplier, price, stock, updated_at)
            VALUES (3, 'P-1', '测试零件', '供应商B', 4, 0, ?)
        `).run(FIXED_UPDATED_AT);
        fixture.db.prepare('UPDATE recipes SET parts_json = ? WHERE id = 1').run(JSON.stringify([{
            model: 'P-1',
            name: '测试零件',
            qty: 1,
            snapshotPrice: 5,
        }]));
        fixture.dependencies.loadPartsData = () => ({
            partsCache: {},
            partsByModel: {
                'P-1': fixture.dependencies.dbGetAllParts().filter(part => part.model === 'P-1'),
            },
        });

        assert.throws(
            () => buildOrderSavePayloadDraft(fixture.dependencies, draftInput()),
            error => error.code === 'BOM_PART_IDENTITY_AMBIGUOUS' && error.statusCode === 422
        );
    } finally {
        fixture.db.close();
    }
});

test('历史线圈 BOM 在新订单入口统一识别角色且不伪造零件身份', () => {
    const fixture = createFixture();
    try {
        fixture.db.prepare(`
            INSERT INTO recipes (id, name, spec, parts_json, saved_total_cost)
            VALUES (3, '历史线圈水泵', '线圈规格', ?, 99.8)
        `).run(JSON.stringify([{
            name: '线圈转子',
            model: '历史完整档案线圈',
            category: '线圈',
            qty: 1,
            snapshotPrice: 99.8,
        }]));

        const draft = buildOrderSavePayloadDraft(fixture.dependencies, {
            ...draftInput(),
            items: [{ recipeId: 3, qty: 1 }],
        });
        const [part] = JSON.parse(JSON.parse(draft.itemsJson)[0].partsJson);

        assert.equal(part.costRole, 'coil');
        assert.deepEqual(part.configurationDependencies, [
            'coilSpec', 'coilSheets', 'coilMaterial', 'coilSlotType',
        ]);
        assert.equal(part.partId, undefined);
        assert.equal(part.snapshotPrice, 99.8);
    } finally {
        fixture.db.close();
    }
});

test('直接建单按客户配置覆盖锁定最终成本、配置和 BOM 快照', () => {
    const fixture = createFixture();
    try {
        const draft = buildOrderSavePayloadDraft(fixture.dependencies, {
            ...draftInput(),
            items: [{
                id: 'configured-order-item',
                recipeId: 2,
                qty: 3,
                profitMargin: 1.2,
                configurationOverrides: { hasFloat: false },
            }],
        });
        const [item] = JSON.parse(draft.itemsJson);
        assert.equal(item.unitCost, 5);
        assert.equal(item.configurationOverrides.hasFloat, false);
        assert.equal(item.configurationSnapshot.hasFloat, false);
        assert.equal(item.configurationSnapshot.coilSpec, 'Y90');
        assert.equal(item.snapshotSource, 'direct_order');
        assert.equal(item.snapshotVersion, 2);
        assert.deepEqual(JSON.parse(item.partsJson).map(part => part.model), ['P-1']);
        assert.equal(JSON.parse(draft.purchaseListJson)[0].plannedQty, 3);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('直接建单锁定供应商线圈转子套件价并生成正式线圈库存计划', () => {
    const fixture = createFixture();
    try {
        fixture.dependencies.dbGetAllCoils = () => [kitCoil()];
        const draft = buildOrderSavePayloadDraft(fixture.dependencies, {
            ...draftInput(),
            items: [{
                id: 'kit-coil-order-item',
                recipeId: 2,
                qty: 2,
                profitMargin: 1.2,
                configurationOverrides: {
                    hasFloat: false,
                    coilSheets: 12,
                },
            }],
        });
        const [item] = JSON.parse(draft.itemsJson);
        const coilPart = JSON.parse(item.partsJson).find(part => part.costRole === 'coil');
        const coilPlan = JSON.parse(draft.purchaseListJson).find(part => part.inventoryType === 'coil');

        assert.equal(item.unitCost, 93.5);
        assert.equal(coilPart.snapshotPrice, 88.5);
        assert.equal(coilPart.pricingMode, 'kit');
        assert.equal(coilPart.kitPrice, 88.5);
        assert.equal(coilPart.coilId, 88);
        assert.equal(coilPart.inventoryType, 'coil');
        assert.equal(coilPart.formula, '供应商套件价');
        assert.equal(coilPlan.coilId, 88);
        assert.equal(coilPlan.plannedQty, 2);
        assert.equal(coilPlan.referencePrice, 88.5);

        const result = executeOrderCreate(
            fixture.dependencies,
            draft,
            commandContext(CREATE_CAPABILITY_ID, 'kit-coil')
        );
        const [storedItem] = JSON.parse(result.order.itemsJson);
        const storedCoilPart = JSON.parse(storedItem.partsJson).find(part => part.costRole === 'coil');
        assert.equal(storedCoilPart.pricingMode, 'kit');
        assert.equal(storedCoilPart.kitPrice, 88.5);
        assert.equal(storedCoilPart.coilId, 88);
    } finally {
        fixture.db.close();
    }
});

test('直接建单锁定不锈钢接轴工艺且不生成采购缺料或线圈阻塞', () => {
    const fixture = createFixture();
    try {
        const draft = buildOrderSavePayloadDraft(fixture.dependencies, {
            ...draftInput(),
            items: [{
                id: 'stainless-shaft-order-item',
                recipeId: 2,
                qty: 2,
                profitMargin: 1.2,
                configurationOverrides: {
                    hasFloat: false,
                    hasStainlessShaftJoint: true,
                    stainlessShaftJointCost: 8,
                },
            }],
        });
        const [item] = JSON.parse(draft.itemsJson);
        const bom = JSON.parse(item.partsJson);
        const purchaseList = JSON.parse(draft.purchaseListJson);
        const processPart = bom.find(part => part.costRole === 'rotorProcess');

        assert.equal(item.unitCost, 13);
        assert.equal(item.configurationSnapshot.hasStainlessShaftJoint, true);
        assert.equal(item.configurationSnapshot.stainlessShaftJointCost, 8);
        assert.equal(item.configurationSnapshot.rotorShaftProcess, 'stainless_friction_weld');
        assert.equal(item.costSnapshot.processes.rotorShaft.cost, 8);
        assert.equal(processPart.inventoryType, 'none');
        assert.equal(purchaseList.some(part => part.costRole === 'rotorProcess'), false);

        const readiness = buildOrderReadiness({
            order: {
                id: 99,
                status: '待采购',
                itemsJson: draft.itemsJson,
                purchaseListJson: draft.purchaseListJson,
            },
            plan: { purchaseList },
            recipes: [{ id: 2, name: '可配置水泵' }],
            now: new Date('2026-08-02T00:02:00.000Z'),
        });
        assert.equal(readiness.blockers.some(blocker => blocker.code === 'coil_inventory_unresolved'), false);
    } finally {
        fixture.db.close();
    }
});

test('直接建单由服务端拒绝超出配方策略的客户配置', () => {
    const fixture = createFixture();
    try {
        fixture.db.prepare(`
            UPDATE recipes
            SET configuration_policy_json = ?
            WHERE id = 2
        `).run(JSON.stringify({
            version: 1,
            fields: {
                hasFloat: [false, true],
                coilSheets: [10, 12],
            },
        }));
        assert.throws(
            () => buildOrderSavePayloadDraft(fixture.dependencies, {
                ...draftInput(),
                items: [{
                    recipeId: 2,
                    qty: 1,
                    profitMargin: 1.2,
                    configurationOverrides: { coilSheets: 99 },
                }],
            }),
            error => error.code === 'RECIPE_CONFIGURATION_NOT_ALLOWED'
                && error.statusCode === 422
        );
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('直接建单选配预览与最终锁定的成本、BOM 和成本快照一致', () => {
    const fixture = createFixture();
    try {
        const costQueries = createCostQueries({
            db: fixture.db,
            calculateRecipeCost: fixture.dependencies.calculateRecipeCost,
            getSetting: fixture.dependencies.getSetting,
            listCoils: fixture.dependencies.dbGetAllCoils,
            listRecipes: () => [],
            loadPartsData: fixture.dependencies.loadPartsData,
            recipeRow: row => row,
            buildBomDraft: () => ({ parts: [] }),
        });
        const configurationOverrides = {
            hasFloat: false,
            boxType: 'BOX-1',
            packingPartsJson: JSON.stringify([{
                model: 'BOX-1',
                supplier: '包装供应商',
                qty: 1,
                packingRole: 'container',
                snapshotPrice: 999,
            }]),
        };
        const basePreview = costQueries.previewRecipeCost(2, {});
        const configuredPreview = costQueries.previewRecipeCost(2, configurationOverrides);
        const draft = buildOrderSavePayloadDraft(fixture.dependencies, {
            ...draftInput(),
            items: [{
                id: 'configured-consistency-item',
                recipeId: 2,
                qty: 2,
                profitMargin: 1.2,
                configurationOverrides,
            }],
        });
        const [item] = JSON.parse(draft.itemsJson);

        assert.notEqual(configuredPreview.data.unitCost, basePreview.data.unitCost);
        assert.equal(item.unitCost, configuredPreview.data.unitCost);
        assert.deepEqual(JSON.parse(item.partsJson), configuredPreview.data.parts);
        const { generatedAt: lockedGeneratedAt, ...lockedCostSnapshot } = item.costSnapshot;
        const { generatedAt: previewGeneratedAt, ...previewCostSnapshot } = configuredPreview.data.costSnapshot;
        assert.equal(Number.isNaN(Date.parse(lockedGeneratedAt)), false);
        assert.equal(Number.isNaN(Date.parse(previewGeneratedAt)), false);
        assert.deepEqual(lockedCostSnapshot, previewCostSnapshot);
        assert.equal(item.configurationOverrides.packingPartsJson.includes('999'), false);
        assert.equal(JSON.parse(draft.purchaseListJson).find(part => part.model === 'BOX-1').plannedQty, 2);
    } finally {
        fixture.db.close();
    }
});

test('配置订单正式创建复用完整依赖、稳定预览哈希并忽略客户端包材价格', () => {
    const fixture = createFixture();
    try {
        const draft = buildOrderSavePayloadDraft(fixture.dependencies, {
            ...draftInput(),
            items: [{
                id: 'configured-create-item',
                recipeId: 2,
                qty: 2,
                profitMargin: 1.2,
                configurationOverrides: {
                    hasFloat: false,
                    boxType: 'BOX-1',
                    packingPartsJson: JSON.stringify([{
                        model: 'BOX-1',
                        supplier: '包装供应商',
                        qty: 1,
                        packingRole: 'container',
                        snapshotPrice: 999,
                    }]),
                },
            }],
        });
        const first = executeOrderCreate(
            fixture.dependencies,
            draft,
            commandContext(CREATE_CAPABILITY_ID, 'configured-create')
        );
        const [storedItem] = JSON.parse(first.order.itemsJson);
        const storedBom = JSON.parse(storedItem.partsJson);
        const packingPart = storedBom.find(part => part.model === 'BOX-1');

        assert.equal(storedItem.unitCost, 17);
        assert.equal(packingPart.snapshotPrice, 12);
        assert.equal(storedItem.configurationOverrides.packingPartsJson.includes('999'), false);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 1);
    } finally {
        fixture.db.close();
    }
});

test('配置订单正式更新复用共享快照依赖且确认哈希保持稳定', () => {
    const fixture = createFixture();
    try {
        const orderId = insertPendingOrder(fixture);
        const draft = buildOrderSavePayloadDraft(fixture.dependencies, {
            ...draftInput(),
            orderId,
            editReason: '客户取消浮球配置',
            customerId: 3,
            items: [{
                id: 'configured-update-item',
                recipeId: 2,
                qty: 1,
                profitMargin: 1.2,
                configurationOverrides: { hasFloat: false },
            }],
        });
        const result = executeOrderUpdate(
            fixture.dependencies,
            orderId,
            { ...draft, expectedUpdatedAt: FIXED_UPDATED_AT },
            commandContext(UPDATE_CAPABILITY_ID, 'configured-update')
        );
        const [storedItem] = JSON.parse(result.order.itemsJson);

        assert.equal(storedItem.configurationSnapshot.hasFloat, false);
        assert.equal(storedItem.snapshotSource, 'direct_order');
        assert.equal(result.order.customerName, '修改后客户');
    } finally {
        fixture.db.close();
    }
});

test('插值线圈 warning 贯穿订单草稿、持久化、采购计划和生产准备阻塞', () => {
    const fixture = createFixture();
    try {
        const draft = buildOrderSavePayloadDraft(fixture.dependencies, {
            ...draftInput(),
            items: [{
                id: 'configured-coil-item',
                recipeId: 2,
                qty: 1,
                profitMargin: 1.2,
                configurationOverrides: { hasFloat: false, coilSheets: 15 },
            }],
        });
        assert.equal(draft.warnings.some(warning => warning.code === 'coil_inventory_scheme_required'), true);
        assert.equal(JSON.parse(draft.purchaseListJson).some(item => item.inventoryType === 'none'), true);

        const result = executeOrderCreate(
            fixture.dependencies,
            draft,
            commandContext(CREATE_CAPABILITY_ID, 'configured-coil')
        );
        const [storedItem] = JSON.parse(result.order.itemsJson);
        assert.equal(storedItem.configurationWarnings.some(warning => warning.code === 'coil_inventory_scheme_required'), true);

        const readiness = buildOrderReadiness({
            order: result.order,
            plan: { purchaseList: JSON.parse(result.order.purchaseListJson) },
            recipes: [{ id: 2, name: '可配置水泵' }],
            now: new Date('2026-08-02T00:02:00.000Z'),
        });
        assert.equal(readiness.verdict, 'blocked');
        assert.equal(readiness.blockers.some(blocker => blocker.code === 'coil_inventory_unresolved'), true);
    } finally {
        fixture.db.close();
    }
});

test('直接建单严格拒绝字符串布尔值和未知客户配置字段', () => {
    const fixture = createFixture();
    try {
        for (const configurationOverrides of [
            { hasFloat: 'false' },
            { unsupportedOption: true },
        ]) {
            assert.throws(
                () => buildOrderSavePayloadDraft(fixture.dependencies, {
                    ...draftInput(),
                    items: [{ recipeId: 2, qty: 1, configurationOverrides }],
                }),
                error => error.statusCode === 400
                    && ['RECIPE_CONFIGURATION_OVERRIDES_INVALID', 'RECIPE_CONFIGURATION_OVERRIDE_UNKNOWN'].includes(error.code)
            );
        }
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

test('订单领用关闭预览按冻结 BOM 汇总零件和线圈并原子扣库', () => {
    const fixture = createFixture();
    try {
        const orderId = insertPendingOrder(fixture);
        const purchaseList = [{
            model: 'P-1',
            name: '测试零件',
            partId: 1,
            inventoryType: 'part',
            totalQty: 2,
            stockQtyPerUnit: 1,
        }, {
            model: 'Y90-10',
            name: '线圈转子',
            coilId: 10,
            inventoryType: 'coil',
            totalQty: 1,
            stockQtyPerUnit: 1,
        }];
        fixture.db.prepare('UPDATE parts SET stock = 5 WHERE id = 1').run();
        fixture.db.prepare('UPDATE coils SET stock = 3 WHERE id = 10').run();
        fixture.db.prepare(`
            UPDATE orders
            SET status = '采购完成', purchase_list_json = ?
            WHERE id = ?
        `).run(JSON.stringify(purchaseList), orderId);

        const draft = buildOrderStatusDraft(fixture.dependencies, orderId, {
            status: '已关闭',
            inventoryDisposition: 'order_outbound_deducted',
        });
        assert.equal(draft.deductions.length, 2);
        assert.deepEqual(
            draft.deductions.map(item => [item.inventoryType, item.deductQty, item.currentStock, item.stockAfter]),
            [['part', 2, 5, 3], ['coil', 1, 3, 2]]
        );
        assert.equal(fixture.db.prepare('SELECT stock FROM parts WHERE id = 1').get().stock, 5);
        assert.equal(fixture.db.prepare('SELECT stock FROM coils WHERE id = 10').get().stock, 3);

        const context = commandContext(STATUS_CAPABILITY_ID, 'close-with-deduction');
        const result = executeOrderStatus(
            fixture.dependencies,
            orderId,
            {
                status: '已关闭',
                inventoryDisposition: 'order_outbound_deducted',
                expectedUpdatedAt: draft.expectedUpdatedAt,
                previewHash: draft.previewHash,
            },
            context
        );
        const replay = executeOrderStatus(
            fixture.dependencies,
            orderId,
            {
                status: '已关闭',
                inventoryDisposition: 'order_outbound_deducted',
                expectedUpdatedAt: draft.expectedUpdatedAt,
                previewHash: draft.previewHash,
            },
            context
        );

        assert.equal(result.order.status, '已关闭');
        assert.equal(result.order.inventoryDisposition, 'order_outbound_deducted');
        assert.equal(replay.idempotentReplay, true);
        assert.equal(fixture.db.prepare('SELECT stock FROM parts WHERE id = 1').get().stock, 3);
        assert.equal(fixture.db.prepare('SELECT stock FROM coils WHERE id = 10').get().stock, 2);
        const movement = fixture.db.prepare('SELECT * FROM coil_stock_movements').get();
        assert.equal(movement.change_qty, -1);
        assert.equal(movement.movement_type, 'order_outbound');
        assert.equal(movement.reference_type, 'order');
        assert.equal(movement.reference_id, String(orderId));
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM coil_stock_movements').get().count, 1);
    } finally {
        fixture.db.close();
    }
});

test('订单领用关闭遇到任一库存不足时不扣库存也不关闭订单', () => {
    const fixture = createFixture();
    try {
        const orderId = insertPendingOrder(fixture);
        fixture.db.prepare('UPDATE parts SET stock = 1 WHERE id = 1').run();
        fixture.db.prepare(`
            UPDATE orders
            SET status = '采购完成', purchase_list_json = ?
            WHERE id = ?
        `).run(JSON.stringify([{
            model: 'P-1',
            name: '测试零件',
            partId: 1,
            inventoryType: 'part',
            totalQty: 2,
            stockQtyPerUnit: 1,
        }]), orderId);

        assert.throws(
            () => buildOrderStatusDraft(fixture.dependencies, orderId, {
                status: '已关闭',
                inventoryDisposition: 'order_outbound_deducted',
            }),
            error => error.code === 'order_close_stock_insufficient'
                && error.statusCode === 409
        );
        assert.equal(fixture.db.prepare('SELECT stock FROM parts WHERE id = 1').get().stock, 1);
        assert.equal(fixture.db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status, '采购完成');
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('订单领用关闭预览后库存变化时拒绝执行且不产生部分扣减', () => {
    const fixture = createFixture();
    try {
        const orderId = insertPendingOrder(fixture);
        fixture.db.prepare('UPDATE parts SET stock = 5 WHERE id = 1').run();
        fixture.db.prepare(`
            UPDATE orders
            SET status = '采购完成', purchase_list_json = ?
            WHERE id = ?
        `).run(JSON.stringify([{
            model: 'P-1',
            name: '测试零件',
            partId: 1,
            inventoryType: 'part',
            totalQty: 2,
            stockQtyPerUnit: 1,
        }]), orderId);

        const draft = buildOrderStatusDraft(fixture.dependencies, orderId, {
            status: '已关闭',
            inventoryDisposition: 'order_outbound_deducted',
        });
        fixture.db.prepare('UPDATE parts SET stock = 4 WHERE id = 1').run();

        assert.throws(
            () => executeOrderStatus(
                fixture.dependencies,
                orderId,
                {
                    status: '已关闭',
                    inventoryDisposition: 'order_outbound_deducted',
                    expectedUpdatedAt: draft.expectedUpdatedAt,
                    previewHash: draft.previewHash,
                },
                commandContext(STATUS_CAPABILITY_ID, 'close-after-stock-drift')
            ),
            error => error.code === 'preview_changed' && error.statusCode === 409
        );
        assert.equal(fixture.db.prepare('SELECT stock FROM parts WHERE id = 1').get().stock, 4);
        assert.equal(fixture.db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status, '采购完成');
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
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
            orderId,
            editReason: '客户调整订单客户信息',
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
        assert.equal(first.auditIds.length, 2);
        assert.equal(first.revision.revisionNo, 1);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 2);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM order_revisions').get().count, 1);

        const secondDraft = buildOrderSavePayloadDraft(fixture.dependencies, {
            ...draftInput(),
            orderId,
            editReason: '客户再次调整合同号',
            customerId: 3,
            customerName: '修改后客户',
            contractNo: 'HT-002',
        });
        const second = executeOrderUpdate(
            fixture.dependencies,
            orderId,
            { ...secondDraft, expectedUpdatedAt: NEXT_UPDATED_AT },
            commandContext(UPDATE_CAPABILITY_ID, 'update-second')
        );
        assert.equal(second.revision.revisionNo, 2);
        assert.deepEqual(
            listOrderRevisions(fixture.db, orderId).map(revision => revision.revisionNo),
            [2, 1]
        );
    } finally {
        fixture.db.close();
    }
});

test('待确认订单编辑拒绝旧版本且不留下 operation', () => {
    const fixture = createFixture();
    try {
        const orderId = insertPendingOrder(fixture);
        const draft = buildOrderSavePayloadDraft(fixture.dependencies, {
            ...draftInput(),
            orderId,
            editReason: '版本冲突测试',
        });
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

test('订单编辑草稿要求修改原因且限制为500字', () => {
    const fixture = createFixture();
    try {
        const orderId = insertPendingOrder(fixture);
        assert.throws(
            () => buildOrderSavePayloadDraft(fixture.dependencies, {
                ...draftInput(),
                orderId,
                editReason: '   ',
            }),
            error => error.code === 'order_edit_reason_required' && error.statusCode === 422
        );
        assert.throws(
            () => buildOrderSavePayloadDraft(fixture.dependencies, {
                ...draftInput(),
                orderId,
                editReason: '改'.repeat(501),
            }),
            error => error.code === 'order_edit_reason_too_long' && error.statusCode === 422
        );
    } finally {
        fixture.db.close();
    }
});

test('待采购且采购进度为零时允许编辑并替换旧订单参与库存平衡', () => {
    const fixture = createFixture();
    try {
        const orderId = insertPendingOrder(fixture);
        fixture.db.prepare('UPDATE parts SET stock = 2 WHERE id = 1').run();
        fixture.db.prepare(`
            UPDATE orders
            SET status = '待采购', purchase_list_json = ?
            WHERE id = ?
        `).run(JSON.stringify([{
            model: 'P-1',
            supplier: '供应商A',
            plannedQty: 2,
            orderedQty: 0,
            receivedQty: 0,
            stockedQty: 0,
        }]), orderId);

        const draft = buildOrderSavePayloadDraft(fixture.dependencies, {
            ...draftInput(),
            orderId,
            editReason: '客户将数量调整为1台',
            items: [{ ...draftInput().items[0], qty: 1, unitPrice: 7 }],
        });
        const purchaseItem = JSON.parse(draft.purchaseListJson).find(item => item.model === 'P-1');
        assert.equal(purchaseItem.plannedQty, 0);
        assert.equal(draft.capabilityId, UPDATE_CAPABILITY_ID);
        assert.match(draft.suggestedIdempotencyKey, /^order-update:/);

        const result = executeOrderUpdate(
            fixture.dependencies,
            orderId,
            { ...draft, expectedUpdatedAt: FIXED_UPDATED_AT },
            commandContext(UPDATE_CAPABILITY_ID, 'waiting-edit')
        );
        assert.equal(result.order.status, '待采购');
        assert.equal(JSON.parse(result.order.itemsJson)[0].qty, 1);
        assert.equal(result.revision.revisionNo, 1);
    } finally {
        fixture.db.close();
    }
});

test('采购进度在预览后产生时拒绝编辑且不写operation、审计或修订', () => {
    const fixture = createFixture();
    try {
        const orderId = insertPendingOrder(fixture);
        fixture.db.prepare(`UPDATE orders SET status = '待采购' WHERE id = ?`).run(orderId);
        const draft = buildOrderSavePayloadDraft(fixture.dependencies, {
            ...draftInput(),
            orderId,
            editReason: '客户调整数量',
            items: [{ ...draftInput().items[0], qty: 3 }],
        });
        fixture.db.prepare('UPDATE orders SET purchase_list_json = ? WHERE id = ?').run(JSON.stringify([{
            model: 'P-1',
            supplier: '供应商A',
            plannedQty: 2,
            orderedQty: 1,
            receivedQty: 0,
            stockedQty: 0,
        }]), orderId);

        assert.throws(
            () => executeOrderUpdate(
                fixture.dependencies,
                orderId,
                { ...draft, expectedUpdatedAt: FIXED_UPDATED_AT },
                commandContext(UPDATE_CAPABILITY_ID, 'progress-conflict')
            ),
            error => error.code === 'order_update_status_conflict' && error.statusCode === 409
        );
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM order_revisions').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('订单编辑对仅到货或仅入库的采购进度都稳定拒绝且不写入', () => {
    for (const progressField of ['receivedQty', 'stockedQty']) {
        const fixture = createFixture();
        try {
            const orderId = insertPendingOrder(fixture);
            fixture.db.prepare(`
                UPDATE orders SET status = '待采购', purchase_list_json = ? WHERE id = ?
            `).run(JSON.stringify([{
                model: 'P-1',
                supplier: '供应商A',
                plannedQty: 2,
                orderedQty: 0,
                receivedQty: 0,
                stockedQty: 0,
                [progressField]: 1,
            }]), orderId);

            assert.throws(
                () => executeOrderUpdate(
                    fixture.dependencies,
                    orderId,
                    {
                        ...draftInput(),
                        editReason: `${progressField} 边界`,
                        expectedUpdatedAt: FIXED_UPDATED_AT,
                    },
                    commandContext(UPDATE_CAPABILITY_ID, `progress-${progressField}`)
                ),
                error => error.code === 'order_update_status_conflict' && error.statusCode === 409
            );
            assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
            assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
            assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM order_revisions').get().count, 0);
        } finally {
            fixture.db.close();
        }
    }
});

test('订单编辑新增并删除产品后持久化新采购计划和修订摘要', () => {
    const fixture = createFixture();
    try {
        const orderId = insertPendingOrder(fixture);
        const replacement = {
            ...draftInput().items[0],
            id: 'replacement-item',
            qty: 3,
        };
        const draft = buildOrderSavePayloadDraft(fixture.dependencies, {
            ...draftInput(),
            orderId,
            editReason: '客户更换产品明细并调整数量',
            items: [replacement],
        });
        const result = executeOrderUpdate(
            fixture.dependencies,
            orderId,
            { ...draft, expectedUpdatedAt: FIXED_UPDATED_AT },
            commandContext(UPDATE_CAPABILITY_ID, 'replace-item')
        );
        const savedItems = JSON.parse(result.order.itemsJson);
        const savedPurchase = JSON.parse(result.order.purchaseListJson);
        const [revision] = listOrderRevisions(fixture.db, orderId);

        assert.deepEqual(savedItems.map(item => item.id), ['replacement-item']);
        assert.equal(savedPurchase.find(item => item.model === 'P-1').plannedQty, 3);
        assert.ok(revision.changes.some(change => change.type === 'item_removed'));
        assert.ok(revision.changes.some(change => change.type === 'item_added'));
        assert.equal(revision.beforeSnapshot.items.length, 1);
        assert.equal(revision.afterSnapshot.items.length, 1);
    } finally {
        fixture.db.close();
    }
});

test('订单编辑预览漂移、异参幂等复用和修订审计缺失均整体回滚', () => {
    const previewFixture = createFixture();
    try {
        const orderId = insertPendingOrder(previewFixture);
        const draft = buildOrderSavePayloadDraft(previewFixture.dependencies, {
            ...draftInput(),
            orderId,
            editReason: '预览漂移测试',
            items: [{ ...draftInput().items[0], qty: 3 }],
        });
        previewFixture.db.prepare('UPDATE parts SET stock = 10 WHERE id = 1').run();
        assert.throws(
            () => executeOrderUpdate(
                previewFixture.dependencies,
                orderId,
                { ...draft, expectedUpdatedAt: FIXED_UPDATED_AT },
                commandContext(UPDATE_CAPABILITY_ID, 'preview-drift')
            ),
            error => error.code === 'preview_changed' && error.statusCode === 409
        );
        assert.equal(previewFixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
        assert.equal(previewFixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
        assert.equal(previewFixture.db.prepare('SELECT COUNT(*) AS count FROM order_revisions').get().count, 0);
    } finally {
        previewFixture.db.close();
    }

    const idempotencyFixture = createFixture();
    try {
        const orderId = insertPendingOrder(idempotencyFixture);
        const context = commandContext(UPDATE_CAPABILITY_ID, 'idempotency-conflict');
        const firstDraft = buildOrderSavePayloadDraft(idempotencyFixture.dependencies, {
            ...draftInput(), orderId, editReason: '第一次修改', contractNo: 'HT-A',
        });
        executeOrderUpdate(
            idempotencyFixture.dependencies,
            orderId,
            { ...firstDraft, expectedUpdatedAt: FIXED_UPDATED_AT },
            context
        );
        const secondDraft = buildOrderSavePayloadDraft(idempotencyFixture.dependencies, {
            ...draftInput(), orderId, editReason: '第二次修改', contractNo: 'HT-B',
        });
        assert.throws(
            () => executeOrderUpdate(
                idempotencyFixture.dependencies,
                orderId,
                { ...secondDraft, expectedUpdatedAt: NEXT_UPDATED_AT },
                context
            ),
            error => error.code === 'idempotency_key_conflict' && error.statusCode === 409
        );
        assert.equal(idempotencyFixture.db.prepare('SELECT COUNT(*) AS count FROM order_revisions').get().count, 1);
    } finally {
        idempotencyFixture.db.close();
    }

    const auditFixture = createFixture();
    try {
        const orderId = insertPendingOrder(auditFixture);
        const draft = buildOrderSavePayloadDraft(auditFixture.dependencies, {
            ...draftInput(), orderId, editReason: '修订审计回滚测试', contractNo: 'HT-AUDIT',
        });
        const dependencies = {
            ...auditFixture.dependencies,
            safeInsert(table, values, context) {
                if (table !== 'order_revisions') {
                    return auditFixture.dependencies.safeInsert(table, values, context);
                }
                const columns = Object.keys(values);
                const info = auditFixture.db.prepare(`
                    INSERT INTO order_revisions (${columns.join(', ')})
                    VALUES (${columns.map(() => '?').join(', ')})
                `).run(...columns.map(column => values[column]));
                return { ...info, auditId: null };
            },
        };
        assert.throws(
            () => executeOrderUpdate(
                dependencies,
                orderId,
                { ...draft, expectedUpdatedAt: FIXED_UPDATED_AT },
                commandContext(UPDATE_CAPABILITY_ID, 'revision-audit-failure')
            ),
            error => error.code === 'strong_audit_required' && error.statusCode === 500
        );
        const row = auditFixture.db.prepare('SELECT contract_no, updated_at FROM orders WHERE id = ?').get(orderId);
        assert.equal(row.contract_no, 'HT-STATUS');
        assert.equal(row.updated_at, FIXED_UPDATED_AT);
        assert.equal(auditFixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
        assert.equal(auditFixture.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
        assert.equal(auditFixture.db.prepare('SELECT COUNT(*) AS count FROM order_revisions').get().count, 0);
    } finally {
        auditFixture.db.close();
    }
});

test('订单仅修改数量和售价时保留已锁定成本快照并可查询修订历史', () => {
    const fixture = createFixture();
    try {
        const orderId = insertPendingOrder(fixture);
        fixture.db.prepare(`
            UPDATE orders
            SET purchase_completed_at = ?, purchase_receipt_id = ?, status_reason = ?,
                status_changed_at = ?, inventory_disposition_note = ?
            WHERE id = ?
        `).run('2026-08-20T01:00:00.000Z', 'receipt-history', '历史状态说明',
            '2026-08-20T00:30:00.000Z', '历史处置说明', orderId);
        fixture.db.prepare('UPDATE recipes SET saved_total_cost = 50 WHERE id = 1').run();
        const draft = buildOrderSavePayloadDraft(fixture.dependencies, {
            ...draftInput(),
            orderId,
            editReason: '客户增加一台并调整成交价',
            items: [{ ...draftInput().items[0], qty: 3, unitPrice: 7 }],
        });
        const [draftItem] = JSON.parse(draft.itemsJson);
        assert.equal(draftItem.unitCost, 5);
        assert.equal(draftItem.qty, 3);
        assert.equal(draftItem.unitPrice, 7);

        executeOrderUpdate(
            fixture.dependencies,
            orderId,
            { ...draft, expectedUpdatedAt: FIXED_UPDATED_AT },
            commandContext(UPDATE_CAPABILITY_ID, 'snapshot-preserved')
        );
        const [revision] = listOrderRevisions(fixture.db, orderId);
        assert.equal(revision.revisionNo, 1);
        assert.equal(revision.reason, '客户增加一台并调整成交价');
        assert.equal(revision.beforeSnapshot.items[0].qty, 2);
        assert.equal(revision.afterSnapshot.items[0].qty, 3);
        assert.deepEqual(
            revision.afterSnapshot.items[0].costSnapshot,
            revision.beforeSnapshot.items[0].costSnapshot
        );
        const costBearingParts = value => JSON.parse(value).map(part => ({
            model: part.model,
            name: part.name,
            supplier: part.supplier,
            qty: part.qty,
            inventoryQty: part.inventoryQty,
            snapshotPrice: part.snapshotPrice,
        }));
        assert.deepEqual(
            costBearingParts(revision.afterSnapshot.items[0].partsJson),
            costBearingParts(revision.beforeSnapshot.items[0].partsJson)
        );
        assert.deepEqual(
            revision.afterSnapshot.items[0].configurationSnapshot,
            revision.beforeSnapshot.items[0].configurationSnapshot
        );
        for (const snapshot of [revision.beforeSnapshot, revision.afterSnapshot]) {
            assert.equal(snapshot.purchaseCompletedAt, '2026-08-20T01:00:00.000Z');
            assert.equal(snapshot.purchaseReceiptId, 'receipt-history');
            assert.equal(snapshot.statusReason, '历史状态说明');
            assert.equal(snapshot.statusChangedAt, '2026-08-20T00:30:00.000Z');
            assert.equal(snapshot.inventoryDispositionNote, '历史处置说明');
            assert.equal(snapshot.createdAt, FIXED_UPDATED_AT);
        }
        assert.ok(revision.changes.some(change => change.type === 'item_quantity'));
        assert.ok(revision.changes.some(change => change.type === 'item_unit_price'));
        assert.equal(revision.operationId, 'operation-snapshot-preserved');
        assert.equal(revision.actor, '系统');
        assert.ok(revision.createdAt);
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
