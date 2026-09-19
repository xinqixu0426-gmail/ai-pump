const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBusinessSummary } = require('../api/services/businessSummary.cjs');

function order(id, status, unitCost, unitPrice) {
    return {
        Id: id,
        customerName: `客户${id}`,
        status,
        itemsJson: JSON.stringify([{ qty: 1, unitCost, unitPrice }]),
        purchaseListJson: '[]',
        todosJson: '[]',
        CreatedAt: '2026-08-19T00:00:00.000Z',
    };
}

test('经营看板排除取消订单并区分订单额、预计和已完成利润', () => {
    const summary = buildBusinessSummary({
        orders: [
            order(1, '已取消', 100, 150),
            order(2, '待确认', 20, 30),
            order(3, '采购中', 50, 80),
            order(4, '已关闭', 70, 100),
        ],
        parts: [],
        recipes: [],
        now: new Date('2026-08-19T08:00:00.000Z'),
    });

    assert.deepEqual(summary.financials.orderBook, {
        totalCost: 140,
        lockedTotalCost: 140,
        procurementVariance: 0,
        totalRevenue: 210,
        totalProfit: 70,
        profitRate: 33.33,
    });
    assert.equal(summary.financials.totalRevenue, 180);
    assert.equal(summary.financials.totalProfit, 60);
    assert.deepEqual(summary.financials.completed, {
        totalCost: 70,
        lockedTotalCost: 70,
        procurementVariance: 0,
        totalRevenue: 100,
        totalProfit: 30,
        profitRate: 30,
    });
    assert.equal(summary.financials.basis, 'confirmed_orders_locked_cost_plus_recorded_procurement_variance');
    assert.equal(summary.kpis.totalRevenue, 180);
});

test('经营看板把已记录采购价差计入预计成本和利润', () => {
    const pricedOrder = order(5, '采购中', 100, 150);
    pricedOrder.purchaseListJson = JSON.stringify([{
        plannedQty: 2,
        orderedQty: 2,
        referencePrice: 10,
        purchasePrice: 12,
        purchasePriceRecorded: true,
    }]);
    const summary = buildBusinessSummary({
        orders: [pricedOrder],
        parts: [],
        recipes: [],
        now: new Date('2026-08-19T08:00:00.000Z'),
    });

    assert.equal(summary.financials.lockedTotalCost, 100);
    assert.equal(summary.financials.procurementVariance, 4);
    assert.equal(summary.financials.totalCost, 104);
    assert.equal(summary.financials.totalProfit, 46);
});
