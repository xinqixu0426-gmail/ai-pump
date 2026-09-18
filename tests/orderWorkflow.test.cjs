const test = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizePurchaseItem,
    orderCoreEditEligibility,
    validatePurchaseProgress,
    deriveProcurementStatus,
    assertOrderTransition,
    assertQuotationTransition,
    mergePurchasePlanItem,
    purchaseToInventoryQty,
} = require('../api/services/orderWorkflow.cjs');

test('订单核心编辑资格允许待确认和零采购进度待采购', () => {
    assert.equal(orderCoreEditEligibility('待确认', []).allowed, true);
    assert.equal(orderCoreEditEligibility('待采购', []).allowed, true);
    assert.equal(orderCoreEditEligibility('待采购', [{ plannedQty: 2, orderedQty: 0 }]).allowed, true);
});

test('订单核心编辑资格拒绝已有采购进度和其他状态', () => {
    assert.equal(orderCoreEditEligibility('待采购', [{ model: 'P-1', orderedQty: 1 }]).allowed, false);
    for (const status of ['采购中', '采购完成', '已关闭', '已取消']) {
        assert.equal(orderCoreEditEligibility(status, []).allowed, false);
    }
});

test('旧采购布尔值兼容为完整已下单数量', () => {
    const item = normalizePurchaseItem({ needToBuy: 6, purchased: true });
    assert.equal(item.plannedQty, 6);
    assert.equal(item.orderedQty, 6);
    assert.equal(item.receivedQty, 0);
    assert.equal(item.stockedQty, 0);
    assert.equal(item.purchased, true);
});

test('采购项保留线圈页面总成本参考价来源', () => {
    const item = normalizePurchaseItem({
        referencePrice: 146.8,
        referencePriceSource: 'coil_total_cost',
    });
    assert.equal(item.referencePrice, 146.8);
    assert.equal(item.referencePriceSource, 'coil_total_cost');
});

test('订单采购状态由数量自动推导且采购完成不等于订单关闭', () => {
    assert.equal(deriveProcurementStatus('待采购', [{ plannedQty: 5 }]), '待采购');
    assert.equal(deriveProcurementStatus('待采购', [{ plannedQty: 5, orderedQty: 2 }]), '采购中');
    assert.equal(deriveProcurementStatus('采购中', [{ plannedQty: 5, orderedQty: 5, receivedQty: 5, stockedQty: 5 }]), '采购完成');
    assert.equal(deriveProcurementStatus('采购中', [{ plannedQty: 5, orderedQty: 6, receivedQty: 5, stockedQty: 5 }]), '采购中');
    assert.equal(deriveProcurementStatus('采购中', [{ plannedQty: 5, orderedQty: 6, receivedQty: 6, stockedQty: 6 }]), '采购完成');
    assert.equal(deriveProcurementStatus('采购完成', [{ plannedQty: 5, stockedQty: 5 }]), '采购完成');
});

test('分批采购数量遵守入库不超过到货不超过下单', () => {
    const item = normalizePurchaseItem({ plannedQty: 10, stockedQty: 2 });
    assert.deepEqual(
        validatePurchaseProgress(item, { orderedQty: 8, receivedQty: 5, stockedQty: 3 }),
        { plannedQty: 10, orderedQty: 8, receivedQty: 5, stockedQty: 3 },
    );
    assert.throws(
        () => validatePurchaseProgress(item, { orderedQty: 5, receivedQty: 6, stockedQty: 2 }),
        /到货数量不能超过/,
    );
    assert.throws(
        () => validatePurchaseProgress(item, { orderedQty: 8, receivedQty: 5, stockedQty: 6 }),
        /入库数量不能超过/,
    );
    assert.throws(
        () => validatePurchaseProgress(item, { orderedQty: 11, receivedQty: 5, stockedQty: 2 }),
        /超采必须明确确认/,
    );
    assert.doesNotThrow(
        () => validatePurchaseProgress(item, {
            orderedQty: 11,
            receivedQty: 5,
            stockedQty: 2,
            allowOverPurchase: true,
        }),
    );
});

test('订单状态禁止任意倒退且取消必须填写原因', () => {
    assert.doesNotThrow(() => assertOrderTransition('待确认', '待采购'));
    assert.doesNotThrow(() => assertOrderTransition('采购完成', '已关闭'));
    assert.throws(() => assertOrderTransition('采购中', '待采购'), /不能从/);
    assert.throws(() => assertOrderTransition('待采购', '已取消'), /必须填写原因/);
    assert.doesNotThrow(() => assertOrderTransition('待采购', '已取消', { reason: '客户取消' }));
});

test('报价只能沿状态机流转且已转订单为终态', () => {
    assert.doesNotThrow(() => assertQuotationTransition('草稿', '报价中'));
    assert.doesNotThrow(() => assertQuotationTransition('报价中', '已接受'));
    assert.doesNotThrow(() => assertQuotationTransition('已接受', '已转订单'));
    assert.throws(() => assertQuotationTransition('已转订单', '报价中'), /不能从/);
    assert.throws(() => assertQuotationTransition('报价中', '已转订单'), /不能从/);
});

test('采购计划重算保留已经发生的分批进度和原计划数量', () => {
    const merged = mergePurchasePlanItem(
        {
            model: '轴承A',
            supplier: '供应商A',
            plannedQty: 2,
            needToBuy: 2,
            currentStock: 3,
            identityKey: 'part:1',
            partId: 1,
            referencePrice: 9.2,
            referencePriceSource: 'part_catalog',
        },
        {
            model: '轴承A',
            supplier: '供应商A',
            plannedQty: 5,
            orderedQty: 3,
            receivedQty: 2,
            stockedQty: 1,
            purchasePrice: 8.5,
            identityKey: 'part:1',
            stockInHistory: [{ receiptId: 'batch-1', qty: 1, at: '2026-01-01' }],
        },
    );

    assert.equal(merged.plannedQty, 5);
    assert.equal(merged.orderedQty, 3);
    assert.equal(merged.receivedQty, 2);
    assert.equal(merged.stockedQty, 1);
    assert.equal(merged.purchasePrice, 8.5);
    assert.equal(merged.purchasePriceRecorded, true);
    assert.equal(merged.referencePrice, 9.2);
    assert.equal(merged.referencePriceSource, 'part_catalog');
    assert.equal(merged.currentStock, 3);
    assert.equal(merged.stockInHistory.length, 1);
});

test('成品电缆采购按根登记并按每根长度折算线材库存', () => {
    assert.equal(purchaseToInventoryQty({ purchaseUnit: '根', stockQtyPerUnit: 8 }, 30), 240);
    assert.equal(purchaseToInventoryQty({}, 30), 30);
});
