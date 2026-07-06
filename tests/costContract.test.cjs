const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildRecipeCostDraft,
    calculateRecipeCost,
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
