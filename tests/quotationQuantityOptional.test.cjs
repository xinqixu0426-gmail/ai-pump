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
            coil_material TEXT,
            has_float INTEGER,
            has_cable INTEGER,
            deleted_at TEXT
        );
        CREATE TABLE factory_files (
            id INTEGER PRIMARY KEY,
            deleted_at TEXT
        );
        INSERT INTO customers (id) VALUES (1);
        INSERT INTO recipes (
            id, name, spec, parts_json, saved_total_cost,
            coil_material, has_float, has_cable
        ) VALUES (
            2, '测试水泵', 'Q-1',
            '[{"name":"泵体","model":"P-1","supplier":"供应商","qty":1,"snapshotPrice":10}]',
            10, '钢带', 0, 0
        );
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
        dbGetAllCoils: () => [],
        getSetting: () => undefined,
        loadPartsData: () => ({
            partsCache: { 'P-1': { price: 10, supplier: '供应商' } },
            partsByModel: {
                'P-1': [{ model: 'P-1', price: 10, supplier: '供应商' }],
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
