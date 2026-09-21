const test = require('node:test');
const assert = require('node:assert/strict');
const {
    PACKAGING_SUBCATEGORIES,
    inferPackagingSubcategory,
    normalizePackagingSubcategory,
    partSubcategory,
} = require('../api/services/packagingClassification.cjs');
const { inferPackagingSemantics } = require('../api/services/packagingSemantics.cjs');

test('包装二级分类固定为外包装、内衬和固定包材', () => {
    assert.deepEqual(PACKAGING_SUBCATEGORIES, ['外包装', '内衬', '固定包材']);
});

test('历史包装零件可从型号、备注和供应商推断二级分类', () => {
    assert.equal(inferPackagingSubcategory({ model: '550w牛皮纸箱' }), '外包装');
    assert.equal(inferPackagingSubcategory({ model: 'v1100DF', remark: '木箱' }), '外包装');
    assert.equal(inferPackagingSubcategory({ model: '850w上下泡沫' }), '内衬');
    assert.equal(inferPackagingSubcategory({ model: '珍珠棉' }), '内衬');
    assert.equal(inferPackagingSubcategory({ model: '400w月亮弯', supplier: '山市泡沫厂' }), '内衬');
    assert.equal(inferPackagingSubcategory({ model: '外箱贴纸' }), '固定包材');
});

test('旧包材名称兼容映射到新的二级分类', () => {
    assert.equal(normalizePackagingSubcategory('泡沫内衬'), '内衬');
    assert.equal(normalizePackagingSubcategory('珍珠棉'), '内衬');
    assert.equal(normalizePackagingSubcategory('彩印箱'), '外包装');
    assert.equal(partSubcategory('轴承', '外包装'), '');
});

test('历史配方中的 18 条纸箱误标可按型号和供应商恢复真实语义', () => {
    const wrongRows = [
        ['850w上下泡沫', '山市泡沫厂', '泡沫', 'foam'],
        ['外箱贴纸', '四通', '其他包材', 'fixed'],
        ['850w上下泡沫', '山市泡沫厂', '泡沫', 'foam'],
        ['800', '山市泡沫厂', '泡沫', 'foam'],
        ['说明书', '新野印刷', '说明书', 'fixed'],
        ['外箱贴纸', '四通', '其他包材', 'fixed'],
        ['珍珠棉', '大溪珍珠棉', '珍珠棉', 'pearlCotton'],
        ['三寸木箱', '', '木箱', 'container'],
        ['说明书', '新野印刷', '说明书', 'fixed'],
        ['大元2号上下泡沫', '山市泡沫厂', '泡沫', 'foam'],
        ['说明书', '新野印刷', '说明书', 'fixed'],
        ['850w上下泡沫', '山市泡沫厂', '泡沫', 'foam'],
        ['说明书', '新野印刷', '说明书', 'fixed'],
        ['4寸上下泡沫', '山市泡沫厂', '泡沫', 'foam'],
        ['说明书', '新野印刷', '说明书', 'fixed'],
        ['外箱贴纸', '四通', '其他包材', 'fixed'],
        ['木箱', '', '木箱', 'container'],
        ['珍珠棉', '大溪珍珠棉', '珍珠棉', 'pearlCotton'],
    ];
    assert.equal(wrongRows.length, 18);
    wrongRows.forEach(([model, supplier, packagingMaterial, packingRole]) => {
        assert.deepEqual(
            inferPackagingSemantics({ model, supplier, packagingMaterial: '纸箱' }),
            { packagingMaterial, packingRole }
        );
    });
});
