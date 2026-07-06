const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveRecipeLockedUnitCost } = require('../api/services/orderCostLock.cjs');

test('AI 订单成本契约：优先使用配方保存成本作为订单锁价', () => {
    const cost = resolveRecipeLockedUnitCost(
        { savedTotalCost: 88, partsJson: '[{"model":"轴承202","qty":1}]' },
        {},
        { '轴承202': [{ model: '轴承202', supplier: '', price: 12 }] },
    );

    assert.equal(cost, 88);
});

test('AI 订单成本契约：没有保存成本时才回退当前重算参考价', () => {
    const cost = resolveRecipeLockedUnitCost(
        { savedTotalCost: 0, partsJson: '[{"model":"轴承202","supplier":"A","qty":3}]' },
        {},
        { '轴承202': [{ model: '轴承202', supplier: 'A', price: 4 }] },
    );

    assert.equal(cost, 12);
});
