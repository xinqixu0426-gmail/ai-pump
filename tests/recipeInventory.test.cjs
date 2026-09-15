const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectRecipeInventory } = require('../api/services/recipeInventory.cjs');

const parts = [
    { id: 1, model: '轴承-202', supplier: '甲', stock: 5 },
    { id: 2, model: '轴承-202', supplier: '乙', stock: 0 },
    { id: 3, model: '旧件', supplier: '甲', stock: 50, deleted_at: 'deleted' },
];
const coils = [
    { id: 1, spec: '12', sheets: 160, material: '冷轧', slot_type: '国标眼', scheme_name: '线圈方案甲', scheme_status: 'official', stock: 4, is_default: 1 },
    { id: 2, spec: '12', sheets: 160, material: '冷轧', slot_type: '国标眼', scheme_name: '线圈方案乙', scheme_status: 'testing', stock: 8 },
];
const recipe = { coil_spec: '12', coil_sheets: 160, coil_material: '冷轧', coil_slot_type: '国标眼' };
const inspect = (row, defaults = recipe) => inspectRecipeInventory([row], parts, coils, defaults)[0];

test('库存查引用按 ID 或精确供应商，不能取另一个同名件的库存', () => {
    assert.equal(inspect({ model: '轴承-202', partId: 2 }).currentStock, 0);
    assert.equal(inspect({ model: '轴承-202', supplier: '乙' }).status, 'out_of_stock');
    assert.equal(inspect({ model: '轴承-202', supplier: '丙' }).referenceStatus, 'missing');
    assert.equal(inspect({ model: '轴承-202' }).referenceStatus, 'ambiguous');
    for (const id of [0, true, -1, 'bad', 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal(inspect({ partId: id, model: '轴承-202', supplier: '甲' }).referenceStatus, 'invalid_id');
    }
    assert.equal(inspect({ partId: 999, model: '轴承-202', supplier: '甲' }).referenceStatus, 'missing');
});

test('旧名称与当前名称并列返回，名称不一致或停用不能冒充已核实库存', () => {
    const row = inspect({ name: '安装用轴承', partId: 1, model: '202' });
    assert.equal(row.name, '安装用轴承');
    assert.equal(row.model, '202');
    assert.equal(row.snapshotName, '202');
    assert.equal(row.currentName, '轴承-202');
    assert.equal(row.referenceStatus, 'identity_mismatch');
    assert.equal(row.currentStock, null);
    assert.equal(row.status, 'needs_review');
    assert.equal(inspect({ partId: 3, model: '旧件' }).referenceStatus, 'inactive');
    assert.equal(inspect({ partId: 3, model: '旧件' }).currentStock, null);
});

test('线圈库存明确 ID 不回退，按角色识别且 BOM 身份优先于配方默认', () => {
    assert.equal(inspect({ costRole: 'coil', name: '改过的角色名', coilId: 1 }).currentName, '线圈方案甲');
    assert.equal(inspect({ inventoryType: 'coil', coilId: 999 }).referenceStatus, 'missing');
    assert.equal(inspect({ name: '线圈转子' }, { ...recipe, coil_id: 999 }).referenceStatus, 'missing');
    assert.equal(inspect({ costRole: 'coil', coilId: 2 }).referenceStatus, 'inactive');
    assert.equal(inspect({ costRole: 'coil', coilId: 1 }, { ...recipe, coil_id: 2 }).currentStock, 4);
    assert.equal(inspect({ name: '线圈转子', coilId: true }).referenceStatus, 'invalid_id');
    assert.equal(inspect({ name: '线圈转子', coilId: 1, partId: 1 }).referenceStatus, 'invalid_reference');
    assert.equal(inspect({ costRole: 'coil', inventoryType: 'part' }).referenceStatus, 'invalid_reference');
});

test('没有线圈 ID 的历史行只能唯一匹配或采用唯一默认方案', () => {
    const row = { name: '线圈转子', model: '12-160' };
    assert.equal(inspect(row).referenceStatus, 'resolved_legacy');
    const alternatives = [coils[0], { ...coils[0], id: 3 }];
    assert.equal(inspectRecipeInventory([row], parts, alternatives, recipe)[0].referenceStatus, 'ambiguous');
    alternatives[1].is_default = 0;
    assert.equal(inspectRecipeInventory([row], parts, alternatives, recipe)[0].coilId, 1);
    assert.equal(inspect(row, { ...recipe, coil_sheets: 0 }).referenceStatus, 'missing');
    assert.equal(inspectRecipeInventory([{ coilId: 1 }], parts, [{ ...coils[0], sheets: 0 }], recipe)[0].referenceStatus, 'invalid_reference');
    assert.equal(inspectRecipeInventory([{ coilId: 1 }], parts, [{ ...coils[0], stock: 1.5 }], recipe)[0].referenceStatus, 'invalid_stock');
});

test('非库存费用不显示缺货，异常库存不伪装为零，查询不改写快照', () => {
    const rows = [{ costRole: 'rotorProcess', model: '加工费' }, { model: '外包装估算', name: '包装估算' }, { inventoryType: 'none', model: '费用' }];
    const before = JSON.stringify({ rows, parts, coils });
    for (const row of inspectRecipeInventory(rows, parts, coils, recipe)) {
        assert.equal(row.status, 'not_tracked');
        assert.equal(row.inventoryType, 'none');
        assert.equal(row.currentStock, null);
    }
    for (const stock of [null, '', ' ', true, 'broken', -1, Infinity]) {
        const [row] = inspectRecipeInventory([{ partId: 1 }], [{ ...parts[0], stock }], coils, recipe);
        assert.equal(row.referenceStatus, 'invalid_stock');
        assert.equal(row.currentStock, null);
    }
    assert.equal(JSON.stringify({ rows, parts, coils }), before);
});
