const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { historicalPurchaseNameView } = require('../api/services/historicalPurchaseNames.cjs');

function fixture() {
    const db = new Database(':memory:');
    db.exec(require('../api/database/schema.cjs').CANONICAL_TABLES_SQL);
    db.exec(require('../api/database/catalogSchema.cjs').CATALOG_IDENTITY_SCHEMA_SQL);
    db.prepare("INSERT INTO parts (id, model, supplier, price, stock) VALUES (1, '新零件名', '甲', 9, 100)").run();
    db.prepare("INSERT INTO parts (id, model, deleted_at) VALUES (2, '停用件现名', 'deleted')").run();
    db.prepare("INSERT INTO coils (id, spec, sheets, scheme_name, scheme_status) VALUES (1, '12', 100, '新线圈名', 'official')").run();
    return db;
}

test('终态订单只替换显示名，原 ID、数量、实际价格、进度、库存快照全部保留', () => {
    const db = fixture();
    try {
        for (const status of ['已关闭', '已取消']) {
            const rows = [{ id: 'old-row', partId: 1, model: '弃用旧名', name: '安装角色', supplier: '历史供应商',
                currentStock: 3, plannedQty: 4, orderedQty: 4, receivedQty: 4, stockedQty: 4, purchasePrice: 7,
                actualSupplier: '实际采购商', stockInHistory: [{ qty: 4, receiptId: 'R' }] },
            { coilId: 1, model: '旧线圈', name: '旧线圈', inventoryType: 'coil', purchasePrice: 23 }];
            const order = { status, purchaseListJson: JSON.stringify(rows), updatedAt: 'original' };
            const before = JSON.stringify(order);
            const view = historicalPurchaseNameView(db, order);
            const result = JSON.parse(view.purchaseListJson);
            assert.equal(result[0].model, '新零件名');
            assert.equal(result[0].name, '安装角色');
            assert.equal(result[0].snapshotName, '弃用旧名');
            assert.equal(result[1].model, '新线圈名');
            assert.equal(result[1].name, '新线圈名');
            for (const key of Object.keys(rows[0]).filter(key => key !== 'model')) assert.deepEqual(result[0][key], rows[0][key], key);
            assert.equal(JSON.stringify(order), before);
            assert.equal(view.updatedAt, 'original');
        }
    } finally { db.close(); }
});

test('历史缺失、停用、无 ID 与类型冲突明确区分，不猜测旧称', () => {
    const db = fixture();
    try {
        const rows = [{ partId: 2, model: '旧名' }, { partId: 999, model: '缺失' },
            { model: '新零件名' }, { partId: true, model: '坏ID' }, { partId: 1, coilId: 1 }, { inventoryType: 'none', model: '费用' }];
        const result = JSON.parse(historicalPurchaseNameView(db, { status: '已关闭', purchaseListJson: JSON.stringify(rows) }).purchaseListJson);
        assert.deepEqual(result.map(row => row.nameReferenceStatus), ['inactive', 'missing', 'unbound', 'invalid_reference', 'invalid_reference', 'not_tracked']);
        assert.equal(result[0].model, '停用件现名');
        assert.equal(result[1].model, '缺失');
        assert.equal(result[2].partId, undefined);
    } finally { db.close(); }
});

test('活动订单不进入历史装配，损坏或超限快照保持原文并提示', () => {
    const db = fixture();
    try {
        const active = { status: '采购中', purchaseListJson: 'bad' };
        assert.equal(historicalPurchaseNameView(db, active), active);
        for (const raw of ['bad', '{}', '[null]']) {
            const result = historicalPurchaseNameView(db, { status: '已关闭', purchaseListJson: raw });
            assert.equal(result.purchaseListJson, raw);
            assert.equal(result.purchaseNameWarning, 'invalid_snapshot');
        }
        const result = historicalPurchaseNameView(db, { status: '已关闭', purchaseListJson: JSON.stringify(Array.from({ length: 10001 }, () => ({}))) });
        assert.equal(result.purchaseNameWarning, 'snapshot_limit_exceeded');
    } finally { db.close(); }
});
