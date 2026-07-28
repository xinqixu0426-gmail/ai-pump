const ORDER_STATUSES = new Set(['待确认', '待采购', '采购中', '采购完成', '已关闭', '已取消']);
const TERMINAL_ORDER_STATUSES = new Set(['已关闭', '已取消']);

const ORDER_TRANSITIONS = new Map([
    ['待确认', new Set(['待采购', '已取消'])],
    ['待采购', new Set(['已取消'])],
    ['采购中', new Set(['已取消'])],
    ['采购完成', new Set(['已关闭'])],
    ['已关闭', new Set()],
    ['已取消', new Set()],
]);

const QUOTATION_STATUSES = new Set(['草稿', '报价中', '已接受', '已拒绝', '已转订单', '已过时']);
const QUOTATION_TRANSITIONS = new Map([
    ['草稿', new Set(['报价中', '已拒绝'])],
    ['报价中', new Set(['已接受', '已拒绝', '已过时'])],
    ['已接受', new Set(['已转订单'])],
    ['已拒绝', new Set()],
    ['已转订单', new Set()],
    ['已过时', new Set()],
]);

function finiteNonNegative(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizePurchaseItem(item = {}) {
    const plannedQty = finiteNonNegative(item.plannedQty, finiteNonNegative(item.needToBuy));
    const legacyOrderedQty = item.purchased ? plannedQty : 0;
    const orderedQty = finiteNonNegative(item.orderedQty, legacyOrderedQty);
    const receivedQty = finiteNonNegative(item.receivedQty);
    const stockedQty = finiteNonNegative(item.stockedQty);
    return {
        ...item,
        plannedQty,
        needToBuy: plannedQty,
        orderedQty,
        receivedQty,
        stockedQty,
        purchasePrice: finiteNonNegative(item.purchasePrice),
        actualSupplier: String(item.actualSupplier || item.supplier || ''),
        orderedAt: item.orderedAt || null,
        receivedAt: item.receivedAt || null,
        stockedAt: item.stockedAt || null,
        stockInHistory: Array.isArray(item.stockInHistory) ? item.stockInHistory : [],
        purchased: plannedQty > 0 && orderedQty >= plannedQty,
    };
}

function hasPurchaseProgress(item) {
    const normalized = normalizePurchaseItem(item);
    return normalized.orderedQty > 0 || normalized.receivedQty > 0 || normalized.stockedQty > 0;
}

function purchaseToInventoryQty(item, purchaseQty) {
    const factor = finiteNonNegative(item?.stockQtyPerUnit, 1) || 1;
    return finiteNonNegative(purchaseQty) * factor;
}

function validatePurchaseProgress(item, input = {}) {
    const current = normalizePurchaseItem(item);
    const readQty = (field) => {
        if (input[field] === undefined) return Number(current[field] || 0);
        const value = Number(input[field]);
        if (!Number.isFinite(value) || value < 0) throw new Error(`${field} 必须是大于等于 0 的数字`);
        return value;
    };
    const orderedQty = readQty('orderedQty');
    const receivedQty = readQty('receivedQty');
    const stockedQty = readQty('stockedQty');
    if (orderedQty > current.plannedQty && !input.allowOverPurchase) {
        throw new Error(`下单数量不能超过计划数量 ${current.plannedQty}，超采必须明确确认`);
    }
    if (receivedQty > orderedQty) throw new Error('到货数量不能超过已下单数量');
    if (stockedQty > receivedQty) throw new Error('入库数量不能超过已到货数量');
    if (stockedQty < current.stockedQty) throw new Error('入库数量不能在普通采购操作中减少');
    return { plannedQty: current.plannedQty, orderedQty, receivedQty, stockedQty };
}

function deriveProcurementStatus(currentStatus, purchaseList) {
    if (TERMINAL_ORDER_STATUSES.has(currentStatus) || currentStatus === '待确认') return currentStatus;
    const required = (purchaseList || []).map(normalizePurchaseItem).filter(item => item.plannedQty > 0);
    if (
        required.length === 0
        || required.every(item => item.stockedQty >= Math.max(item.plannedQty, item.orderedQty))
    ) return '采购完成';
    if (required.some(hasPurchaseProgress)) return '采购中';
    return '待采购';
}

function assertOrderTransition(currentStatus, nextStatus, options = {}) {
    if (!ORDER_STATUSES.has(nextStatus)) throw new Error('非法订单状态');
    if (currentStatus === nextStatus) return;
    const allowed = ORDER_TRANSITIONS.get(currentStatus);
    if (!allowed?.has(nextStatus)) {
        throw new Error(`订单状态不能从“${currentStatus}”变更为“${nextStatus}”`);
    }
    if (nextStatus === '已取消' && !String(options.reason || '').trim()) {
        throw new Error('取消订单必须填写原因');
    }
}

function assertQuotationTransition(currentStatus, nextStatus) {
    if (!QUOTATION_STATUSES.has(nextStatus)) throw new Error('报价状态无效');
    if (currentStatus === nextStatus) return;
    const allowed = QUOTATION_TRANSITIONS.get(currentStatus);
    if (!allowed?.has(nextStatus)) {
        throw new Error(`报价状态不能从“${currentStatus}”变更为“${nextStatus}”`);
    }
}

function mergePurchasePlanItem(nextItem, previousItem) {
    const stockQtyPerUnit = finiteNonNegative(nextItem?.stockQtyPerUnit, 1) || 1;
    const legacyCableProgress = nextItem?.purchaseUnit === '根'
        && previousItem
        && previousItem.purchaseUnit !== '根'
        && stockQtyPerUnit > 1;
    const convertedPrevious = legacyCableProgress
        ? {
            ...previousItem,
            plannedQty: Math.ceil(finiteNonNegative(previousItem.plannedQty, finiteNonNegative(previousItem.needToBuy)) / stockQtyPerUnit),
            needToBuy: Math.ceil(finiteNonNegative(previousItem.needToBuy) / stockQtyPerUnit),
            orderedQty: Math.ceil(finiteNonNegative(previousItem.orderedQty) / stockQtyPerUnit),
            receivedQty: Math.ceil(finiteNonNegative(previousItem.receivedQty) / stockQtyPerUnit),
            stockedQty: Math.ceil(finiteNonNegative(previousItem.stockedQty) / stockQtyPerUnit),
            stockInHistory: Array.isArray(previousItem.stockInHistory)
                ? previousItem.stockInHistory.map(entry => ({
                    ...entry,
                    qty: Math.ceil(finiteNonNegative(entry.qty) / stockQtyPerUnit),
                }))
                : [],
            purchaseUnit: '根',
            stockQtyPerUnit,
        }
        : previousItem;
    const previous = normalizePurchaseItem(convertedPrevious || {});
    const next = normalizePurchaseItem(nextItem);
    const progressStarted = hasPurchaseProgress(previous);
    const plannedQty = progressStarted ? previous.plannedQty : next.plannedQty;
    return normalizePurchaseItem({
        ...next,
        ...(convertedPrevious || {}),
        model: next.model,
        name: next.name,
        supplier: next.supplier,
        totalQty: next.totalQty,
        currentStock: next.currentStock,
        partId: next.partId,
        coilId: next.coilId,
        inventoryType: next.inventoryType,
        identityKey: next.identityKey,
        purchaseUnit: next.purchaseUnit,
        stockQtyPerUnit: next.stockQtyPerUnit,
        specification: next.specification,
        cableLength: next.cableLength,
        cableAccessoryType: next.cableAccessoryType,
        cableAccessoryName: next.cableAccessoryName,
        plannedQty,
        needToBuy: plannedQty,
    });
}

module.exports = {
    ORDER_STATUSES,
    TERMINAL_ORDER_STATUSES,
    QUOTATION_STATUSES,
    normalizePurchaseItem,
    validatePurchaseProgress,
    deriveProcurementStatus,
    assertOrderTransition,
    assertQuotationTransition,
    mergePurchasePlanItem,
    purchaseToInventoryQty,
};
