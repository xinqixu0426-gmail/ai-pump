'use strict';

// One formal interpretation of persisted purchase progress.  Read-only
// producers reuse this existing readiness ordering; callers never derive it
// from quantities in the AI adapter or Fact Ledger.
function procurementStage({ shortageQty, plannedQty, orderedQty, receivedQty, stockedQty } = {}) {
    if (Number(shortageQty) <= 0) return '库存已满足';
    if (Number(plannedQty) <= 0) return '未生成采购计划';
    if (Number(orderedQty) < Number(plannedQty)) return '待下单';
    if (Number(receivedQty) < Number(orderedQty)) return '待到货';
    if (Number(stockedQty) < Number(receivedQty)) return '待入库';
    return '库存仍不足';
}

module.exports = { procurementStage };
