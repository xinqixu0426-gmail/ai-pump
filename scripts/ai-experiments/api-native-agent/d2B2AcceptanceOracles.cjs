'use strict';

function formal(result, label) {
    if (!result?.success || (result?.verified !== true && result?.executionEvidence?.verified !== true)) throw new Error(`D2_B2_FORMAL_ORACLE_UNAVAILABLE:${label}`);
    return result.data || result;
}
function finite(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function byPart(rows, partId) { return (rows || []).find(row => Number(row?.partId) === Number(partId)); }

async function buildControlledOracles(executeToolCall, ids) {
    const call = (name, args) => executeToolCall(name, args, { allowWrite: false });
    const [readinessAResult, detailAResult, purchaseResult, pendingPurchaseResult, partialPurchaseResult, virtualResult, readinessBResult, readinessUResult] = await Promise.all([
        call('check_order_readiness', { orderId: ids.orderA }),
        call('get_order_detail', { orderId: ids.orderA }),
        call('get_purchase_overview', {}),
        call('get_purchase_overview', { pendingOnly: true }),
        call('get_purchase_overview', { limit: 1 }),
        call('preview_virtual_readiness', { version: 1, basisRef: { kind: 'RECIPE_SCENARIO', recipeId: ids.v750General, comparisonInput: { version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [] }, scenarioKey: 'base' }, quantity: 10 }),
        call('check_order_readiness', { orderId: ids.orderB }),
        call('check_order_readiness', { orderId: ids.orderUnresolved }),
    ]);
    const readinessA = formal(readinessAResult, 'order-a-readiness');
    const detailA = formal(detailAResult, 'order-a-detail').order || formal(detailAResult, 'order-a-detail');
    const purchase = formal(purchaseResult, 'purchase-overview');
    const pendingPurchase = formal(pendingPurchaseResult, 'pending-purchase-overview');
    const partialPurchase = formal(partialPurchaseResult, 'partial-purchase-overview');
    const virtual = formal(virtualResult, 'virtual-readiness');
    const readinessB = formal(readinessBResult, 'order-b-readiness');
    const readinessU = formal(readinessUResult, 'order-u-readiness');
    const shortage = byPart(readinessA.shortages, ids.bearing);
    const purchaseTask = byPart(purchase.tasks, ids.bearing);
    const unresolved = (readinessU.shortages || []).find(row => !row?.partId && !row?.coilId);
    if (!shortage || !purchaseTask || !unresolved) throw new Error('D2_B2_FIXTURE_ORACLE_INCOMPLETE');
    return Object.freeze({
        'W1-01': { kind: 'ORDER_SHORTAGE', material: shortage.model, shortage: shortage.shortageQty, unit: shortage.purchaseUnit },
        'W1-02': { kind: 'READINESS', order: readinessA.order?.contractNo || 'ORDER-A', verdict: readinessA.verdict, answerMarker: readinessA.canProduce ? '可以' : '不能' },
        'W1-03': { kind: 'QUANTITY_TRIPLE', material: shortage.model, required: shortage.requiredQty, available: shortage.availableQty, shortage: shortage.shortageQty, unit: shortage.purchaseUnit },
        'W1-04': { kind: 'ORDER_DETAIL', snapshotRecipe: detailA.items?.[0]?.recipeName, qty: detailA.items?.[0]?.qty },
        'W1-05': { kind: 'PURCHASE_STATUS', material: purchaseTask.model, stage: purchaseTask.procurementStage },
        'W1-06': { kind: 'SHORTAGE_PURCHASE', material: shortage.model, shortage: shortage.shortageQty, unit: shortage.purchaseUnit, stage: purchaseTask.procurementStage },
        'W1-07': { kind: 'VIRTUAL_READINESS', recipe: virtual.recipe?.displayName || 'V750-通用款', quantity: virtual.quantity, status: virtual.status, inventoryBasis: virtual.inventoryBasis },
        'W1-08': { kind: 'UNRESOLVED', displayName: unresolved.model || unresolved.name },
        'W1-09': { kind: 'EMPTY_COMPLETE', verdict: readinessB.verdict },
        // Owner wording permits either a complete pending-only query or a
        // correctly disclosed partial collection. The oracle records both
        // formal contracts without prescribing the Agent's tool sequence.
        'W1-10': { kind: 'PENDING_PURCHASE_COLLECTION', pendingOnly: true,
            filteredReturnedCount: pendingPurchase.returnedCount, filteredTotalCount: pendingPurchase.summary?.taskCount,
            partialReturnedCount: partialPurchase.returnedCount, partialTotalCount: partialPurchase.summary?.taskCount },
    });
}

module.exports = { buildControlledOracles, formal, finite };
