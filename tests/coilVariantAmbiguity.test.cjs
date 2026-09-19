const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createCoilVariantLookup,
    sameSpecSheetsRows,
    variantLabel,
} = require('../api/services/coilVariantAmbiguity.cjs');
const {
    appendMissingCoilVariants,
} = require('../api/services/aiCoilVariantAnswer.cjs');

const coils = [
    { id: 6, spec: '12', sheets: 220, material: '钢带', slotType: '小眼', schemeCode: 'COIL-0006', schemeStatus: 'official', isDefault: true, cost: 166.9728 },
    { id: 10, spec: '12', sheets: 220, material: '冷轧', slotType: '国标眼', schemeCode: 'COIL-0010', schemeStatus: 'official', isDefault: true, cost: 196.1669 },
    { id: 11, spec: '12', sheets: 220, material: '钢带', slotType: '小眼', schemeCode: 'COIL-0011', schemeStatus: 'testing', isDefault: false, cost: 150 },
    { id: 2, spec: '12', sheets: 140, material: '钢带', slotType: '小眼', schemeCode: 'COIL-0002', schemeStatus: 'official', isDefault: true, cost: 116.99 },
];

test('线圈歧义：只统计正式方案，测试方案不参与唯一性判断', () => {
    const rows = sameSpecSheetsRows(coils, '12', 220);
    assert.deepEqual(rows.map(row => row.schemeCode), ['COIL-0006', 'COIL-0010']);
});

test('线圈歧义：按材质或方案 ID 收窄时给出同规格片数的其它正式方案', async () => {
    const getJson = async () => coils;
    const lookup = createCoilVariantLookup(getJson);
    const narrowedByMaterial = await lookup(null, { spec: '12', sheets: 220, excludeIds: [6] });
    assert.deepEqual(narrowedByMaterial.variants.map(item => item.schemeCode), ['COIL-0010']);
    assert.match(narrowedByMaterial.notice, /12-220/);
    assert.match(narrowedByMaterial.notice, /COIL-0010（冷轧\/国标眼）/);
    assert.match(narrowedByMaterial.notice, /不是该规格片数的唯一成本/);

    const onlyVariant = await lookup(null, { spec: '12', sheets: 140, excludeIds: [2] });
    assert.deepEqual(onlyVariant.variants, []);
    assert.equal(onlyVariant.notice, '');
});

test('线圈歧义：回答只讲一套方案时追加完整清单', () => {
    const toolResults = [{
        name: 'search_coils',
        result: { success: true, data: coils.map(row => ({ ...row, schemeStatus: row.schemeStatus })) },
    }];
    const partial = appendMissingCoilVariants('12-220 钢带小眼的成本是 166.9728 元。', toolResults);
    assert.match(partial, /12-220 钢带小眼的成本是 166\.9728 元。/);
    assert.match(partial, /同一 12-220 在正式目录中共有 2 套方案/u);
    assert.match(partial, /COIL-0010（冷轧\/国标眼）/u);
    assert.match(partial, /请确认要采用哪一套/u);

    const complete = '12-220 有 2 套正式方案：COIL-0006（钢带/小眼）166.9728 元、COIL-0010（冷轧/国标眼）196.1669 元。';
    assert.equal(appendMissingCoilVariants(complete, toolResults), complete);

    const unrelated = '这两套方案的库存都是 0。';
    assert.equal(appendMissingCoilVariants(unrelated, toolResults), unrelated);
});

test('线圈歧义：执行器返回的单方案结果也带出其它方案并触发补充', () => {
    const toolResults = [{
        name: 'calculate_coil_cost',
        result: {
            success: true,
            data: {
                coilId: 6,
                schemeCode: 'COIL-0006',
                spec: '12',
                sheets: 220,
                material: '钢带',
                slotType: '小眼',
                totalCost: 166.97,
                sameSpecSheetsVariants: [{ id: 10, spec: '12', sheets: 220, schemeCode: 'COIL-0010', material: '冷轧', slotType: '国标眼', cost: 196.1669 }],
            },
        },
    }];
    const answer = 'COIL-0006（钢带/小眼）的当前成本是 166.97 元。';
    const enriched = appendMissingCoilVariants(answer, toolResults);
    assert.match(enriched, /共有 2 套方案/u);
    assert.match(enriched, /COIL-0010/u);
});

test('线圈歧义：变体文案包含材质槽眼与编码', () => {
    assert.equal(
        variantLabel({ id: 10, schemeCode: 'COIL-0010', material: '冷轧', slotType: '国标眼' }),
        'COIL-0010（冷轧/国标眼）'
    );
});
