const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    buildQuotationSavePayloadDraft,
} = require('../api/services/quotationDraft.cjs');

function fixture() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE customers (
            id INTEGER PRIMARY KEY,
            deleted_at TEXT
        );
        CREATE TABLE recipes (
            id INTEGER PRIMARY KEY,
            name TEXT,
            spec TEXT,
            parts_json TEXT,
            saved_total_cost REAL,
            coil_spec TEXT,
            coil_sheets INTEGER,
            coil_material TEXT,
            coil_slot_type TEXT,
            has_float INTEGER,
            has_cable INTEGER,
            box_type TEXT,
            packing_parts_json TEXT,
            deleted_at TEXT
        );
        CREATE TABLE factory_files (
            id INTEGER PRIMARY KEY,
            deleted_at TEXT
        );
        INSERT INTO customers (id) VALUES (1);
        INSERT INTO recipes (
            id, name, spec, parts_json, saved_total_cost,
            coil_spec, coil_sheets, coil_material, coil_slot_type,
            has_float, has_cable, box_type, packing_parts_json
        ) VALUES (
            2, '测试水泵', 'Q-1',
            '[{"name":"泵体","model":"P-1","supplier":"供应商","qty":1,"snapshotPrice":10}]',
            10, 'Y90', 10, '钢带', '小眼', 0, 0, '', '[]'
        );
        ALTER TABLE recipes ADD COLUMN configuration_policy_json TEXT;
        UPDATE recipes
        SET configuration_policy_json = '{"version":1,"fields":{"cableLength":[5]}}'
        WHERE id = 2;
    `);
    return {
        db,
        calculateRecipeCost(parts) {
            return {
                totalCost: parts.reduce((sum, part) => (
                    sum + Number(part.snapshotPrice || 0) * Number(part.qty || 1)
                ), 0),
            };
        },
        dbGetAllCoils: () => [
            { id: 10, spec: 'Y90', material: '钢带', slotType: '小眼', sheets: 10, unitPrice: 0.2, wireWeight: 0.2, copperBase: 70, coilFee: 2, rotorFee: 3, schemeStatus: 'official' },
            { id: 20, spec: 'Y90', material: '钢带', slotType: '小眼', sheets: 20, unitPrice: 0.2, wireWeight: 0.4, copperBase: 70, coilFee: 4, rotorFee: 5, schemeStatus: 'official' },
        ],
        getSetting: () => undefined,
        loadPartsData: () => ({
            partsCache: {
                'P-1': { price: 10, supplier: '供应商' },
                'BOX-1': { price: 12, supplier: '包装供应商', category: '包装' },
            },
            partsByModel: {
                'P-1': [{ model: 'P-1', price: 10, supplier: '供应商' }],
                'BOX-1': [{ model: 'BOX-1', name: '测试纸箱', price: 12, supplier: '包装供应商', category: '包装' }],
            },
        }),
    };
}

function item(qty) {
    return {
        id: 'quotation-item-1',
        baseRecipeId: 2,
        baseRecipeName: '测试水泵',
        spec: 'Q-1',
        qty,
        margin: 1.2,
        unitPrice: 12,
        overrides: {},
    };
}

test('报价保存草稿允许数量待定且不生成误导总金额', () => {
    const dependencies = fixture();
    try {
        const draft = buildQuotationSavePayloadDraft(dependencies, {
            customerId: 1,
            status: '报价中',
            items: [item(null)],
        });
        const items = JSON.parse(draft.itemsJson);

        assert.equal(items[0].qty, null);
        assert.equal(items[0].totalPrice, null);
        assert.equal(items[0].unitCost, 10);
        assert.equal(items[0].unitPrice, 12);
        assert.equal(draft.totalCost, null);
        assert.equal(draft.totalPrice, null);
        assert.equal(draft.quantitiesConfirmed, false);
        assert.equal(draft.warnings[0].code, 'quotation_quantity_pending');
    } finally {
        dependencies.db.close();
    }
});

test('历史或明确数量报价继续生成总成本与总报价', () => {
    const dependencies = fixture();
    try {
        const draft = buildQuotationSavePayloadDraft(dependencies, {
            customerId: 1,
            status: '报价中',
            items: [item(3)],
        });

        assert.equal(draft.totalCost, 30);
        assert.equal(draft.totalPrice, 36);
        assert.equal(draft.quantitiesConfirmed, true);
        assert.deepEqual(draft.warnings, []);
    } finally {
        dependencies.db.close();
    }
});

test('报价保存草稿拒绝配方范围外的客户配置', () => {
    const dependencies = fixture();
    try {
        assert.throws(
            () => buildQuotationSavePayloadDraft(dependencies, {
                customerId: 1,
                status: '报价中',
                items: [{ ...item(1), overrides: { cableLength: 10 } }],
            }),
            error => error.code === 'RECIPE_CONFIGURATION_NOT_ALLOWED'
                && error.statusCode === 422
        );
    } finally {
        dependencies.db.close();
    }
});

test('报价保存持久化插值线圈 warning 且客户端包材价格不进入正式快照', () => {
    const dependencies = fixture();
    try {
        const draft = buildQuotationSavePayloadDraft(dependencies, {
            customerId: 1,
            status: '报价中',
            items: [{
                ...item(2),
                overrides: {
                    coilSheets: 15,
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
        const [savedItem] = JSON.parse(draft.itemsJson);
        const packingPart = savedItem.bomSnapshot.find(part => part.model === 'BOX-1');

        assert.equal(savedItem.warnings.some(warning => warning.code === 'coil_inventory_scheme_required'), true);
        assert.equal(savedItem.bomSnapshot.some(part => part.inventoryType === 'none'), true);
        assert.equal(packingPart.snapshotPrice, 12);
        assert.equal(savedItem.overrides.packingPartsJson.includes('999'), false);
    } finally {
        dependencies.db.close();
    }
});

test('报价保存锁定不锈钢接轴费用、工艺要求和非库存 BOM 行', () => {
    const dependencies = fixture();
    try {
        const draft = buildQuotationSavePayloadDraft(dependencies, {
            customerId: 1,
            status: '报价中',
            items: [{
                ...item(2),
                overrides: {
                    hasStainlessShaftJoint: true,
                    stainlessShaftJointCost: 7.5,
                },
            }],
        });
        const [savedItem] = JSON.parse(draft.itemsJson);
        const processPart = savedItem.bomSnapshot.find(part => part.costRole === 'rotorProcess');

        assert.equal(savedItem.unitCost, 17.5);
        assert.equal(savedItem.overrides.hasStainlessShaftJoint, true);
        assert.equal(savedItem.overrides.stainlessShaftJointCost, 7.5);
        assert.equal(savedItem.configurationSnapshot.rotorShaftProcess, 'stainless_friction_weld');
        assert.equal(savedItem.costSnapshot.processes.rotorShaft.cost, 7.5);
        assert.equal(processPart.inventoryType, 'none');
        assert.equal(processPart.processCode, 'stainless_friction_weld');
    } finally {
        dependencies.db.close();
    }
});
