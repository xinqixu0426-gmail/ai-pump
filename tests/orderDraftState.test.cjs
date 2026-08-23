const test = require('node:test');
const assert = require('node:assert/strict');
const {
    appendPendingOrderItem,
    applyOrderItemPreview,
    buildPendingOrderItem,
    hasOrderPurchaseProgress,
    removeCalculatingItemId,
    removeOrderDraftItem,
    rollbackOrderItemConfiguration,
} = require('../apps/web-next/lib/order-draft-state.cjs');

function item(overrides = {}) {
    return {
        id: 'pending-a',
        recipeId: 1,
        recipeName: 'V750',
        qty: 3,
        unitCost: 100,
        unitPrice: 120,
        profitMargin: 1.2,
        configurationOverrides: { hasFloat: true },
        configurationWarnings: [{ code: 'old', message: '旧提醒' }],
        ...overrides,
    };
}

test('订单待加入产品：有效配方生成候选，无完整成本时拒绝', () => {
    const recipe = { id: 1, name: 'V750', savedTotalCost: 100 };
    const created = buildPendingOrderItem(recipe, '2', '1.15', (source, qty, margin) => ({
        recipeId: source.id,
        qty,
        profitMargin: margin,
    }));
    assert.deepEqual(created, { recipeId: 1, qty: 2, profitMargin: 1.15 });
    assert.throws(
        () => buildPendingOrderItem({ ...recipe, savedTotalCost: 0 }, 1, 1.1, () => ({})),
        /缺少完整保存成本/,
    );
});

test('订单待加入产品：预览成功保留当前数量和加价并更新成本与警告', () => {
    const current = item({ qty: 8, profitMargin: 1.35, unitPrice: 135 });
    const next = applyOrderItemPreview(current, 'pending-a', {
        unitCost: 140,
        warnings: [{ code: 'interpolated', message: '插值方案' }],
    });
    assert.equal(next.qty, 8);
    assert.equal(next.profitMargin, 1.35);
    assert.equal(next.unitCost, 140);
    assert.equal(next.unitPrice, 189);
    assert.deepEqual(next.configurationWarnings, [{ code: 'interpolated', message: '插值方案' }]);
});

test('订单手工销售价在配置成本重算后保持不变并反算利润率', () => {
    const current = item({
        pricingMode: 'manual',
        unitCost: 100,
        unitPrice: 125,
        profitMargin: 1.25,
    });
    const next = applyOrderItemPreview(current, 'pending-a', { unitCost: 110 });
    assert.equal(next.unitCost, 110);
    assert.equal(next.unitPrice, 125);
    assert.equal(next.profitMargin, 125 / 110);
});

test('订单编辑资格兼容历史 purchased 布尔进度并识别到货和入库边界', () => {
    assert.equal(hasOrderPurchaseProgress({ needToBuy: 6, purchased: true }), true);
    assert.equal(hasOrderPurchaseProgress({ plannedQty: 6, purchased: false }), false);
    assert.equal(hasOrderPurchaseProgress({ plannedQty: 6, receivedQty: 1 }), true);
    assert.equal(hasOrderPurchaseProgress({ plannedQty: 6, stockedQty: 1 }), true);
});

test('订单待加入产品：预览失败只回滚配置字段，不吞掉等待期间的数量和价格输入', () => {
    const previous = item();
    const current = item({
        qty: 9,
        profitMargin: 1.4,
        unitPrice: 210,
        configurationOverrides: { hasFloat: false, cableLength: 20 },
        configurationWarnings: [],
    });
    const rolledBack = rollbackOrderItemConfiguration(current, 'pending-a', previous);
    assert.equal(rolledBack.qty, 9);
    assert.equal(rolledBack.profitMargin, 1.4);
    assert.equal(rolledBack.unitPrice, 210);
    assert.deepEqual(rolledBack.configurationOverrides, { hasFloat: true });
    assert.deepEqual(rolledBack.configurationWarnings, [{ code: 'old', message: '旧提醒' }]);
});

test('订单待加入产品：旧配方结果不能覆盖新候选', () => {
    const current = item({ id: 'pending-b', recipeId: 2, recipeName: 'V1100' });
    assert.equal(applyOrderItemPreview(current, 'pending-a', { unitCost: 999 }), current);
    assert.equal(rollbackOrderItemConfiguration(current, 'pending-a', item()), current);
});

test('订单待加入产品：加入后完整保留候选，删除时同步清理计算状态', () => {
    const pending = item({
        qty: 5,
        unitCost: 140,
        unitPrice: 189,
        configurationOverrides: { hasFloat: false, cableLength: 20 },
    });
    const draftItems = appendPendingOrderItem([], pending);
    assert.equal(draftItems[0], pending);
    assert.deepEqual(draftItems[0].configurationOverrides, { hasFloat: false, cableLength: 20 });

    const calculating = removeCalculatingItemId(new Set(['pending-a', 'other']), 'pending-a');
    assert.deepEqual([...calculating], ['other']);
    assert.deepEqual(removeOrderDraftItem(draftItems, 'pending-a'), []);
});
