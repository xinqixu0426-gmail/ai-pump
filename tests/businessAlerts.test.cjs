const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBusinessAlerts } = require('../api/services/businessAlerts.cjs');

test('经营异常提醒识别报价低于成本、长期未跟进和订单待采购', () => {
    const now = new Date('2026-07-20T00:00:00.000Z');
    const result = buildBusinessAlerts({
        now,
        customers: [{ id: 1, name: '测试客户' }],
        quotations: [
            {
                id: 7,
                customerId: 1,
                status: '报价中',
                updatedAt: '2026-06-01T00:00:00.000Z',
                totalPrice: 80,
                itemsJson: JSON.stringify([
                    { baseRecipeName: 'V750 12-120', qty: 1, unitCost: 90, unitPrice: 80 },
                ]),
            },
        ],
        orders: [
            {
                id: 9,
                customerName: '测试客户',
                status: '待采购',
                updatedAt: '2026-07-01T00:00:00.000Z',
                itemsJson: JSON.stringify([
                    { recipeName: 'V750 12-140', qty: 1, unitCost: 92, unitPrice: 110 },
                ]),
                purchaseListJson: JSON.stringify([
                    { model: '长螺丝 M6x170', supplier: 'A', needToBuy: 4, purchased: false },
                ]),
                todosJson: '[]',
            },
        ],
    });

    assert.equal(result.totals.high, 2);
    assert.equal(result.totals.medium, 2);
    assert.equal(result.totals.all, 4);
    assert.ok(result.alerts.some(alert => alert.title.includes('低于成本')));
    assert.ok(result.alerts.some(alert => alert.title.includes('待采购')));
});
