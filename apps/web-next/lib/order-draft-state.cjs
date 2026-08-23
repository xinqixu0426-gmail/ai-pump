function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

function buildPendingOrderItem(recipe, qty, profitMargin, createItem) {
  const savedCost = Number(recipe?.savedTotalCost || 0)
  if (!Number.isFinite(savedCost) || savedCost <= 0) {
    throw new Error('该配方缺少完整保存成本，请先重新保存配方后再建单')
  }
  return createItem(recipe, Number(qty), Number(profitMargin))
}

function applyOrderItemPreview(item, expectedId, preview) {
  if (!item || item.id !== expectedId) return item
  const unitCost = Number(preview?.unitCost || 0)
  const profitMargin = Math.max(0.01, Number(item.profitMargin) || 1.1)
  const manualPrice = item.pricingMode === 'manual'
  const unitPrice = manualPrice
    ? roundMoney(item.unitPrice)
    : roundMoney(unitCost * profitMargin)
  return {
    ...item,
    unitCost,
    unitPrice,
    profitMargin: manualPrice && unitCost > 0 ? unitPrice / unitCost : profitMargin,
    configurationOverrides: preview?.configurationSnapshot ? {
      ...(item.configurationOverrides || {}),
      hasStainlessShaftJoint: Boolean(preview.configurationSnapshot.hasStainlessShaftJoint),
      stainlessShaftJointCost: Number(preview.configurationSnapshot.stainlessShaftJointCost || 0),
    } : item.configurationOverrides,
    configurationWarnings: preview?.warnings || [],
  }
}

function hasOrderPurchaseProgress(item = {}) {
  const plannedQty = Math.max(0, Number(item.plannedQty ?? item.needToBuy ?? 0) || 0)
  const legacyOrderedQty = item.purchased === true ? plannedQty : 0
  const orderedQty = Math.max(0, Number(item.orderedQty ?? legacyOrderedQty) || 0)
  const receivedQty = Math.max(0, Number(item.receivedQty) || 0)
  const stockedQty = Math.max(0, Number(item.stockedQty) || 0)
  return orderedQty > 0 || receivedQty > 0 || stockedQty > 0
}

function rollbackOrderItemConfiguration(item, expectedId, previousItem) {
  if (!item || item.id !== expectedId) return item
  return {
    ...item,
    configurationOverrides: previousItem?.configurationOverrides,
    configurationWarnings: previousItem?.configurationWarnings,
  }
}

function appendPendingOrderItem(items, pendingItem) {
  return pendingItem ? [...items, pendingItem] : items
}

function removeOrderDraftItem(items, itemId) {
  return items.filter(item => item.id !== itemId)
}

function removeCalculatingItemId(ids, itemId) {
  const next = new Set(ids)
  next.delete(itemId)
  return next
}

module.exports = {
  appendPendingOrderItem,
  applyOrderItemPreview,
  hasOrderPurchaseProgress,
  buildPendingOrderItem,
  removeCalculatingItemId,
  removeOrderDraftItem,
  rollbackOrderItemConfiguration,
}
