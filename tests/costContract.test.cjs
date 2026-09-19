const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildRecipeCostDraft,
    calculateRecipeCost,
    findUnpricedRecipeParts,
    assertRecipeBomPrices,
} = require('../api/services/costEngine.cjs');

test('成本契约：保存快照锁定历史成本，当前重算反映零件库价格变化', () => {
    const draft = buildRecipeCostDraft({
        parts: [{ model: '轴承202', name: '轴承', supplier: 'A', qty: 2, snapshotPrice: 5 }],
        assemblyWage: 3,
        packingWage: 2,
        managementFee: 2,
    }, {
        partsCatalog: [{ model: '轴承202', supplier: 'A', price: 5 }],
    });

    assert.equal(draft.savedTotalCost, 17);
    assert.equal(draft.parts[0].snapshotPrice, 5);

    const current = calculateRecipeCost(draft.parts, {}, {
        '轴承202': [{ model: '轴承202', supplier: 'A', price: 8 }],
    });

    assert.equal(current.totalCost, '16.00');
    assert.equal(draft.savedTotalCost, 17);
});

test('成本契约：配方保存拒绝 BOM 中缺失或为零的单价并列出项目', () => {
    const parts = [
        { model: '浮球-线径1.2', name: '浮球', qty: 1, snapshotPrice: 0 },
        { model: '轴承202', name: '轴承', qty: 1, snapshotPrice: 1.2 },
        { model: '未匹配叶轮', name: '叶轮', qty: 1 },
    ];

    assert.deepEqual(findUnpricedRecipeParts(parts).map(part => part.model), ['浮球-线径1.2', '未匹配叶轮']);
    assert.throws(
        () => assertRecipeBomPrices(parts),
        error => error.code === 'RECIPE_BOM_UNPRICED'
            && error.statusCode === 400
            && error.message.includes('浮球（浮球-线径1.2）')
            && error.message.includes('叶轮（未匹配叶轮）')
    );
});
