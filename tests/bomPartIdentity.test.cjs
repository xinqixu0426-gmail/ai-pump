const test = require('node:test');
const assert = require('node:assert/strict');

const {
    bindStableBomPartIdentities,
    resolveCatalogPartIdentity,
    resolveSavedCatalogPartIdentity,
} = require('../api/services/bomPartIdentity.cjs');
const { normalizeBomRoles } = require('../api/services/bomRoles.cjs');

test('已保存引用按 ID 读取现名，新写入仍拒绝错误型号，客户端标记不能切换模式', () => {
    const rows = [{ id: 1, model: '新名称', supplier: '甲' }];
    const snapshot = { partId: 1, model: '弃用旧称', supplier: '甲', readMode: 'saved' };
    const before = JSON.stringify(snapshot);
    assert.equal(resolveSavedCatalogPartIdentity(rows, snapshot).model, '新名称');
    assert.equal(JSON.stringify(snapshot), before);
    assert.throws(() => resolveCatalogPartIdentity(rows, snapshot), { code: 'BOM_PART_ID_MODEL_MISMATCH' });
    assert.throws(() => bindStableBomPartIdentities([snapshot], rows), { code: 'BOM_PART_ID_MODEL_MISMATCH' });
    assert.throws(() => resolveSavedCatalogPartIdentity(rows, { ...snapshot, supplier: '乙' }), { code: 'BOM_PART_ID_SUPPLIER_MISMATCH' });
    assert.throws(() => resolveSavedCatalogPartIdentity(rows, { ...snapshot, partId: 2 }), { code: 'BOM_PART_ID_NOT_FOUND' });
    assert.throws(() => resolveSavedCatalogPartIdentity([{ ...rows[0], deletedAt: 'deleted' }], snapshot), { code: 'BOM_PART_ID_NOT_FOUND' });
    assert.throws(() => resolveSavedCatalogPartIdentity(rows, { ...snapshot, partId: true }), { code: 'BOM_PART_ID_INVALID' });
    assert.throws(() => resolveSavedCatalogPartIdentity(rows, { model: '弃用旧称' }), { code: 'BOM_PART_IDENTITY_NOT_FOUND' });
});

const catalog = [
    { id: 1, model: '纸箱-A', supplier: '供应商甲', price: 3 },
    { id: 2, model: '纸箱-A', supplier: '供应商乙', price: 2 },
    { id: 3, model: '木箱-B', supplier: '供应商丙', price: 8 },
];

test('BOM 零件优先按 partId 绑定并使用目录标准身份', () => {
    const matched = resolveCatalogPartIdentity(catalog, {
        partId: 2,
        model: '纸箱-A',
        supplier: '供应商乙',
    });
    assert.equal(matched.id, 2);

    const [bound] = bindStableBomPartIdentities([{
        partId: 2,
        model: '纸箱-A',
        supplier: '供应商乙',
        qty: 1,
        snapshotPrice: 2,
        costRole: 'packing',
    }], catalog);
    assert.equal(bound.partId, 2);
    assert.equal(bound.supplier, '供应商乙');
    assert.equal(bound.snapshotPrice, 2);
});

test('无供应商时只有同型号唯一候选可以兼容绑定', () => {
    assert.equal(resolveCatalogPartIdentity(catalog, { model: '木箱-B' }).id, 3);
    assert.throws(
        () => resolveCatalogPartIdentity(catalog, { model: '纸箱-A' }),
        error => error.code === 'BOM_PART_IDENTITY_AMBIGUOUS'
            && error.statusCode === 422
    );
});

test('型号加供应商精确绑定，不使用同型号最低价回退', () => {
    assert.equal(resolveCatalogPartIdentity(catalog, {
        model: '纸箱-A',
        supplier: '供应商甲',
    }).id, 1);
    assert.throws(
        () => resolveCatalogPartIdentity(catalog, {
            model: '纸箱-A',
            supplier: '不存在的供应商',
        }),
        error => error.code === 'BOM_PART_IDENTITY_NOT_FOUND'
    );
});

test('线圈与人工估算项不伪造零件 partId', () => {
    const result = bindStableBomPartIdentities([
        { model: '12-120', name: '线圈转子', costRole: 'coil', inventoryType: 'coil', snapshotPrice: 10, qty: 1 },
        { model: '泵壳套件', costRole: 'shell', costSource: 'manual', snapshotPrice: 20, qty: 1 },
    ], catalog);
    assert.equal(result[0].partId, undefined);
    assert.equal(result[1].partId, undefined);
});

test('只读 BOM 草稿可标记未解析身份，正式保存仍保持严格拒绝', () => {
    const draft = bindStableBomPartIdentities([
        { model: '缺失型号', name: '浮球', snapshotPrice: 0, costRole: 'float' },
    ], catalog, { allowUnresolved: true });

    assert.equal(draft[0].identityStatus, 'unresolved');
    assert.throws(
        () => bindStableBomPartIdentities(draft, catalog),
        error => error.code === 'BOM_PART_IDENTITY_NOT_FOUND'
    );
});

test('历史正价快照只能以 legacy 模式读取，新配置覆盖不能借用兼容放行', () => {
    const [legacy] = bindStableBomPartIdentities([
        { model: '历史停用件', name: '固定件', snapshotPrice: 5, costRole: 'fixed' },
    ], catalog, { allowLegacySnapshot: true });
    assert.equal(legacy.identityStatus, 'legacy_unresolved');

    assert.throws(
        () => bindStableBomPartIdentities([
            { model: '历史停用件', name: '固定件', snapshotPrice: 5, costRole: 'fixed', source: 'configuration_override' },
        ], catalog, { allowLegacySnapshot: true }),
        error => error.code === 'BOM_PART_IDENTITY_NOT_FOUND'
    );
});

test('BOM 角色统一生成配置依赖矩阵', () => {
    const parts = normalizeBomRoles([
        { name: '普通固定件', model: 'F' },
        { name: '线圈转子', model: 'Y90-10' },
        { name: '电容', model: '20μF' },
        { name: '浮球', model: '浮球-线径0.75' },
        { name: '成品电缆', model: '电缆-线径0.75' },
        { name: '纸箱', model: '纸箱-A', packingRole: 'container' },
        { name: '不锈钢拉伸筒(按cm)', model: '筒-A' },
        { name: '长螺丝', model: '6*200', dynamicRule: 'longScrewByBarrelLength' },
    ]);

    assert.deepEqual(parts.map(part => [part.costRole, part.configurationDependencies]), [
        ['fixed', []],
        ['coil', ['coilSpec', 'coilSheets', 'coilMaterial', 'coilSlotType']],
        ['capacitor', ['coilSpec', 'coilSheets', 'coilMaterial', 'coilSlotType']],
        ['float', ['hasFloat', 'floatWire', 'floatAccessoryType']],
        ['cable', ['hasCable', 'cableLength', 'cableWire', 'cableAccessoryType']],
        ['packing', ['packingPartsJson']],
        ['barrelLength', ['customBarrelLength']],
        ['longScrew', ['customBarrelLength']],
    ]);
});
test('显式非法 ID 不得退回名称匹配', () => {
    for (const partId of [0, -1, 1.5, true, [], {}, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => resolveCatalogPartIdentity([{ id: 1, model: 'A' }], { partId, model: 'A' }), error => error.code === 'BOM_PART_ID_INVALID');
    }
});
