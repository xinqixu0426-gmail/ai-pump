const { findScrewPricingPart, isLongScrewPart } = require('./costEngine.cjs');
const { collapseLegacyCableParts } = require('./cableAccessory.cjs');
const { mergePurchasePlanItem, normalizePurchaseItem } = require('./orderWorkflow.cjs');

function makeId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function parsePartsJson(partsJson) {
    try {
        const parsed = JSON.parse(partsJson || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function buildPartIndexes(partsCatalog) {
    const partIndex = new Map();
    const partByModel = new Map();
    for (const part of partsCatalog || []) {
        const model = String(part.model || '').trim();
        const supplier = String(part.supplier || '').trim();
        if (!model) continue;
        partIndex.set(`${model}|${supplier}`, part);
        if (!partByModel.has(model)) partByModel.set(model, part);
    }
    return { partIndex, partByModel };
}

function purchaseIdentity(model, supplier = '', partId) {
    if (partId) return `part:${partId}`;
    return `model:${String(model || '').trim()}|supplier:${String(supplier || '').trim()}`;
}

function buildPurchaseList(items, partsCatalog, options = {}) {
    const { partIndex, partByModel } = buildPartIndexes(partsCatalog);
    const merged = new Map();
    const reservedDemand = options.reservedDemand instanceof Map ? options.reservedDemand : new Map();

    for (const item of items || []) {
        const itemQty = Number(item.qty || 0);
        if (itemQty <= 0) continue;
        for (const part of collapseLegacyCableParts(parsePartsJson(item.partsJson))) {
            const model = String(part.model || '').trim();
            if (!model) continue;
            const qty = Number(part.inventoryQty ?? part.qty ?? 0);
            if (qty <= 0) continue;
            const supplier = String(part.supplier || '').trim();
            const mergeKey = `${model}|${supplier}`;
            const existing = merged.get(mergeKey);
            if (existing) {
                existing.totalQty += qty * itemQty;
            } else {
                merged.set(mergeKey, { part, totalQty: qty * itemQty, supplier });
            }
        }
    }

    const purchaseList = [];
    for (const [, { part, totalQty, supplier }] of merged) {
        const exactPart = partIndex.get(`${part.model}|${supplier}`) || partByModel.get(part.model) || null;
        const screwPricingPart = !exactPart && isLongScrewPart(part)
            ? findScrewPricingPart(partsCatalog, part.model, supplier)?.part || null
            : null;
        const dbPart = exactPart || screwPricingPart;
        const currentStock = exactPart ? Number(exactPart.stock || 0) : 0;
        const partId = exactPart?.Id || exactPart?.id;
        const identityKey = purchaseIdentity(part.model, supplier || dbPart?.supplier || '', partId);
        const alreadyReserved = Number(reservedDemand.get(identityKey) || 0);
        const availableStock = Math.max(0, currentStock - alreadyReserved);
        const needToBuy = Math.max(0, totalQty - availableStock);
        reservedDemand.set(identityKey, alreadyReserved + totalQty);
        purchaseList.push({
            model: part.model,
            name: part.name || part.model,
            supplier: supplier || dbPart?.supplier || '',
            totalQty,
            currentStock: availableStock,
            needToBuy,
            plannedQty: needToBuy,
            orderedQty: 0,
            receivedQty: 0,
            stockedQty: 0,
            purchasePrice: 0,
            actualSupplier: supplier || dbPart?.supplier || '',
            purchased: false,
            partId,
            identityKey,
        });
    }

    purchaseList.sort((a, b) => String(a.supplier || '').localeCompare(String(b.supplier || '')));
    return purchaseList;
}

function buildTodos(purchaseList) {
    const bySupplier = new Map();
    for (const part of purchaseList || []) {
        if (Number(part.needToBuy || 0) <= 0) continue;
        const supplier = part.supplier || '';
        const items = bySupplier.get(supplier) || [];
        items.push(part);
        bySupplier.set(supplier, items);
    }

    const todos = [];
    for (const [supplier, parts] of bySupplier) {
        const detail = parts.map(part => `${part.model}×${part.needToBuy}`).join(', ');
        todos.push({ id: makeId(), supplier, description: `联系【${supplier}】采购：${detail}`, done: false });
    }
    return todos;
}

function buildOrderPlan(items, partsCatalog, options = {}) {
    const purchaseList = buildPurchaseList(items, partsCatalog, options);
    return { purchaseList, todos: buildTodos(purchaseList) };
}

function buildBalancedOrderPlans(orders, partsCatalog) {
    const reservedDemand = new Map();
    const plans = new Map();
    const ordered = [...(orders || [])].sort((a, b) => {
        const dateCompare = String(a.created_at || a.createdAt || '').localeCompare(String(b.created_at || b.createdAt || ''));
        return dateCompare || Number(a.id || a.Id || 0) - Number(b.id || b.Id || 0);
    });

    for (const order of ordered) {
        const items = Array.isArray(order.items)
            ? order.items
            : parsePartsJson(order.items_json || order.itemsJson);
        const plan = buildOrderPlan(items, partsCatalog, { reservedDemand });
        const previous = parsePartsJson(order.purchase_list_json || order.purchaseListJson);
        const previousByKey = new Map(previous.map(item => [
            item.identityKey || purchaseIdentity(item.model, item.supplier, item.partId),
            normalizePurchaseItem(item),
        ]));
        plan.purchaseList = plan.purchaseList.map(item => mergePurchasePlanItem(
            item,
            previousByKey.get(item.identityKey),
        ));
        plans.set(Number(order.id || order.Id), plan);
    }
    return plans;
}

module.exports = {
    purchaseIdentity,
    buildPurchaseList,
    buildTodos,
    buildOrderPlan,
    buildBalancedOrderPlans,
};
