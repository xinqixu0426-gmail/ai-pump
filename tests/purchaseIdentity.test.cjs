const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPurchaseList, buildBalancedOrderPlans } = require('../api/services/orderPlanning.cjs');
const { matchPurchasePlanRows, purchaseRowIdentity } = require('../api/services/purchaseIdentity.cjs');
const { mergePurchasePlanItem } = require('../api/services/orderWorkflow.cjs');
const { collapseLegacyCableParts } = require('../api/services/cableAccessory.cjs');

const catalog = [{ id: 1, model: '电缆-0.75', supplier: '甲', stock: 9, price: 2 }];
const cable = (length, accessory = 'standard') => ({ partId: 1, model: '电缆-0.75', supplier: '甲',
    name: '成品电缆', cableAssembly: true, cableLength: length, cableAccessoryType: accessory, qty: 1 });
const items = parts => [{ qty: 3, partsJson: JSON.stringify(parts) }];

test('采购计划规范化之前拒绝供应商和类型冲突，不能用目录字段覆盖冲突证据', () => {
    assert.throws(() => buildPurchaseList(items([{ ...cable(2), supplier: '乙' }]), catalog),
        { code: 'PURCHASE_PART_SUPPLIER_CHANGED' });
    for (const part of [
        { ...cable(2), inventoryType: 'coil' },
        { ...cable(2), coilId: 2 },
        { model: '120-30', inventoryType: 'part', coilId: 2, qty: 1 },
    ]) {
        assert.throws(() => buildPurchaseList(items([part]), catalog), error =>
            ['PURCHASE_ID_INVALID', 'PURCHASE_INVENTORY_TYPE_MISMATCH'].includes(error.code));
    }
    assert.equal(buildPurchaseList(items([{ ...cable(2), actualSupplier: '乙' }]), catalog)[0].partId, 1);
});

test('同一基础电缆的长度和接头配置不丢行、不合并，库存仍按共同物料预留', () => {
    const result = buildPurchaseList(items([cable(2), cable(3), cable(2, 'xinjie')]), catalog);
    assert.equal(result.length, 3);
    assert.equal(new Set(result.map(row => row.identityKey)).size, 3);
    assert.equal(new Set(result.map(row => row.id)).size, 3);
    assert.deepEqual(result.map(row => row.currentStock), [4, 1, 0]);
    assert.deepEqual(result.map(row => row.totalQty), [3, 3, 3]);
    const reversed = buildPurchaseList(items([cable(2, 'xinjie'), cable(3), cable(2)]), catalog);
    for (const row of reversed) assert.equal(row.id, result.find(other => other.identityKey === row.identityKey).id);
});

test('显式 ID 和唯一名称两种入口在解析后只生成一个采购项；不同单位或换算率不合并', () => {
    const plain = { model: 'A', supplier: '甲', qty: 1 };
    const records = [{ id: 1, model: 'A', supplier: '甲', stock: 0 }];
    assert.equal(buildPurchaseList(items([plain, { ...plain, partId: 1 }]), records)[0].totalQty, 6);
    assert.equal(buildPurchaseList(items([plain, { ...plain, purchaseUnit: '盒', stockQtyPerUnit: 10 },
        { ...plain, purchaseUnit: '盒', stockQtyPerUnit: 20 }]), records).length, 3);
    const half = buildPurchaseList(items([cable(0.5)]), catalog)[0];
    assert.equal(half.stockQtyPerUnit, 0.5);
    assert.equal(half.currentStock, 18);
});

test('旧行按类型化 ID 和配置唯一接续，名称或供应商标签变化不重置采购事实', () => {
    const next = { partId: 1, inventoryType: 'part', model: '现名', supplier: '目录供应商', stockQtyPerUnit: 1, plannedQty: 9 };
    const old = { ...next, id: 'original-line-id', identityKey: 'obsolete-name-key', model: '旧名', supplier: '旧目录供应商',
        plannedQty: 8, orderedQty: 6, receivedQty: 4, stockedQty: 2, purchasePrice: 12, purchasePriceRecorded: true,
        actualSupplier: '实际供货商', stockInHistory: [{ qty: 2, receiptId: 'original-receipt' }] };
    const matched = matchPurchasePlanRows([next], [old])[0];
    const merged = mergePurchasePlanItem(next, matched);
    for (const key of ['id', 'plannedQty', 'orderedQty', 'receivedQty', 'stockedQty', 'purchasePrice', 'purchasePriceRecorded', 'actualSupplier', 'stockInHistory']) {
        assert.deepEqual(merged[key], old[key]);
    }
    assert.equal(merged.model, '现名');
    assert.equal(old.model, '旧名');
});

test('重建不同电缆配置分别保留原行 ID、价格和进度，不复用一条旧行', () => {
    const currentItems = items([cable(2), cable(3)]);
    const previous = buildPurchaseList(currentItems, catalog).map((row, index) => ({ ...row,
        id: `original-${index}`, orderedQty: 1, receivedQty: 1, stockedQty: 1, plannedQty: 3,
        purchasePrice: 10 + index, purchasePriceRecorded: true,
    }));
    const [plan] = buildBalancedOrderPlans([{ id: 1, items: currentItems, purchaseListJson: JSON.stringify(previous) }], catalog).values();
    assert.deepEqual(plan.purchaseList.map(row => [row.id, row.purchasePrice, row.stockedQty]), [['original-0', 10, 1], ['original-1', 11, 1]]);
    const legacy = [{ model: '电缆-0.75', supplier: '甲', partId: 1, plannedQty: 6, orderedQty: 6 }];
    assert.throws(() => matchPurchasePlanRows(plan.purchaseList, legacy), { code: 'PURCHASE_CONTINUITY_AMBIGUOUS' });
});

test('伪造旧键不决定身份，重复候选与遗失实际采购事实都失败关闭', () => {
    const next = { partId: 1, model: 'A' };
    assert.throws(() => matchPurchasePlanRows([next], [{ partId: 2, model: 'A', identityKey: 'part:1', orderedQty: 1 }]), { code: 'PURCHASE_CONTINUITY_LOST' });
    assert.throws(() => matchPurchasePlanRows([next], [{ partId: 1 }, { partId: 1 }]), { code: 'PURCHASE_CONTINUITY_AMBIGUOUS' });
    assert.throws(() => matchPurchasePlanRows([], [{ partId: 1, purchasePriceRecorded: true, purchasePrice: 0 }]), { code: 'PURCHASE_CONTINUITY_LOST' });
    assert.notEqual(purchaseRowIdentity({ model: 'A|B', supplier: 'C' }), purchaseRowIdentity({ model: 'A', supplier: 'B|C' }));
});

test('旧电缆单位转换禁止向上取整、改变实际价格单位或重复分配历史进度', () => {
    const next = { ...cable(8), purchaseUnit: '根', stockQtyPerUnit: 8, plannedQty: 3 };
    assert.throws(() => mergePurchasePlanItem(next, { plannedQty: 24, orderedQty: 9 }), { code: 'PURCHASE_UNIT_MIGRATION_REQUIRED' });
    assert.throws(() => mergePurchasePlanItem(next, { plannedQty: 24, orderedQty: 8, purchasePriceRecorded: true }), { code: 'PURCHASE_UNIT_MIGRATION_REQUIRED' });
    const converted = mergePurchasePlanItem(next, { plannedQty: 24, purchased: true });
    assert.equal(converted.orderedQty, 3);
});

test('旧行缺失浮球接头字段时只从同一冻结计划唯一接续，明确旧类型和多配置不可覆盖', () => {
    const next = { partId: 1, model: '浮球-0.55', floatAccessoryType: 'xinjie' };
    const previous = { partId: 1, model: '浮球-0.55', orderedQty: 2, purchasePrice: 10 };
    assert.equal(matchPurchasePlanRows([next], [previous])[0], previous);
    assert.throws(() => matchPurchasePlanRows([next], [{ ...previous, floatAccessoryType: 'standard' }]), { code: 'PURCHASE_CONTINUITY_LOST' });
    assert.throws(() => matchPurchasePlanRows([next, { ...next, floatAccessoryType: 'standard' }], [previous]), { code: 'PURCHASE_CONTINUITY_AMBIGUOUS' });
    assert.equal(mergePurchasePlanItem(next, previous).floatAccessoryType, 'xinjie');
});

test('明确错误 ID 不回退同名对象，明确 ID/名称冲突和停用线圈仍不能进入采购', () => {
    for (const partId of [true, -1, 1.5, 'bad', 99]) {
        assert.throws(() => buildPurchaseList(items([{ ...cable(2), partId }]), catalog));
    }
    assert.throws(() => buildPurchaseList(items([{ ...cable(2), model: '其他规格' }]), catalog), { code: 'BOM_PART_ID_MODEL_MISMATCH' });
    const coil = { inventoryType: 'coil', coilId: 99, model: '120-30', qty: 1 };
    const options = { coilsCatalog: [{ id: 1, spec: '120', sheets: 30 }] };
    assert.throws(() => buildPurchaseList(items([coil]), [], options), { code: 'PURCHASE_COIL_UNAVAILABLE' });
    options.coilsCatalog[0].schemeStatus = 'draft';
    assert.throws(() => buildPurchaseList(items([{ ...coil, coilId: 1 }]), [], options), { code: 'PURCHASE_COIL_UNAVAILABLE' });
});

test('多种新电缆配置原样保留，含义不明的新旧混合或多旧电缆不能删行', () => {
    const complete = [cable(2), cable(3)];
    assert.deepEqual(collapseLegacyCableParts(complete), complete);
    const accessory = { model: '电缆配件费', qty: 1 };
    assert.throws(() => collapseLegacyCableParts([...complete, accessory]), { code: 'CABLE_LEGACY_CONFIGURATION_AMBIGUOUS' });
    assert.throws(() => collapseLegacyCableParts([{ model: '电缆-A' }, { model: '电缆-B' }, accessory]), { code: 'CABLE_LEGACY_CONFIGURATION_AMBIGUOUS' });
    assert.throws(() => collapseLegacyCableParts([cable(2), { model: '电缆-0.75', supplier: '甲', name: '电缆线', qty: 5 }]), { code: 'CABLE_LEGACY_CONFIGURATION_AMBIGUOUS' });
    assert.throws(() => collapseLegacyCableParts([cable(2), { ...accessory, cableAccessoryType: 'xinjie' }]), { code: 'CABLE_LEGACY_CONFIGURATION_AMBIGUOUS' });
});

test('没有正式方案的计算型线圈保留材质和槽型，不合并为同名零件', () => {
    const coils = ['钢带', '冷轧'].map(material => ({ name: '线圈转子', model: '120-39', material, slotType: '小眼', qty: 1 }));
    const rows = buildPurchaseList(items(coils), []);
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.inventoryType === 'none'));
    assert.equal(new Set(rows.map(row => row.identityKey)).size, 2);
    const old = rows.map(row => ({ ...row, plannedQty: 3, orderedQty: 1 }));
    assert.deepEqual(matchPurchasePlanRows(rows, old), old);
});
