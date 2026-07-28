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

function isCompleteCablePart(part) {
    return part?.cableAssembly === true || String(part?.name || '').startsWith('成品电缆');
}

function completeCableIdentity(part, supplier, partId) {
    const base = purchaseIdentity(part.model, supplier, partId);
    const length = Number(part.cableLength ?? part.inventoryQty ?? 0);
    const accessory = String(part.cableAccessoryType || part.cableAccessoryName || 'standard').trim();
    return `${base}|cable:${length}m|accessory:${accessory}`;
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
            const completeCable = isCompleteCablePart(part);
            const cableLength = completeCable ? Number(part.cableLength ?? part.inventoryQty ?? 0) : 0;
            const qty = completeCable ? Number(part.qty ?? 1) : Number(part.inventoryQty ?? part.qty ?? 0);
            if (qty <= 0) continue;
            const supplier = String(part.supplier || '').trim();
            const mergeKey = completeCable
                ? `${model}|${supplier}|${cableLength}|${part.cableAccessoryType || part.cableAccessoryName || 'standard'}`
                : `${model}|${supplier}`;
            const purchasePart = completeCable
                ? {
                    ...part,
                    purchaseUnit: '根',
                    stockQtyPerUnit: cableLength,
                    specification: `每根 ${cableLength}m + ${part.cableAccessoryName || (part.cableAccessoryType === 'xinjie' ? '新界式' : '普通铜套')}`,
                }
                : part;
            const existing = merged.get(mergeKey);
            if (existing) {
                existing.totalQty += qty * itemQty;
            } else {
                merged.set(mergeKey, { part: purchasePart, totalQty: qty * itemQty, supplier });
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
        const stockQtyPerUnit = Math.max(1, Number(part.stockQtyPerUnit || 1));
        const currentInventoryStock = exactPart ? Number(exactPart.stock || 0) : 0;
        const partId = exactPart?.Id || exactPart?.id;
        const resolvedSupplier = supplier || dbPart?.supplier || '';
        const stockIdentityKey = purchaseIdentity(part.model, resolvedSupplier, partId);
        const identityKey = isCompleteCablePart(part)
            ? completeCableIdentity(part, resolvedSupplier, partId)
            : stockIdentityKey;
        const alreadyReserved = Number(reservedDemand.get(stockIdentityKey) || 0);
        const availableInventoryStock = Math.max(0, currentInventoryStock - alreadyReserved);
        const availableStock = Math.floor(availableInventoryStock / stockQtyPerUnit);
        const needToBuy = Math.max(0, totalQty - availableStock);
        reservedDemand.set(stockIdentityKey, alreadyReserved + totalQty * stockQtyPerUnit);
        purchaseList.push({
            model: part.model,
            name: part.name || part.model,
            supplier: resolvedSupplier,
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
            purchaseUnit: part.purchaseUnit || '',
            stockQtyPerUnit,
            specification: part.specification || '',
            cableLength: part.cableLength,
            cableAccessoryType: part.cableAccessoryType,
            cableAccessoryName: part.cableAccessoryName,
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
        const detail = parts.map(part => `${part.model}×${part.needToBuy}${part.purchaseUnit || ''}`).join(', ');
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
            previousByKey.get(item.identityKey)
                || (item.purchaseUnit === '根'
                    ? previous.find(previousItem => (
                        !previousItem.purchaseUnit
                        && previousItem.model === item.model
                        && String(previousItem.supplier || '') === String(item.supplier || '')
                    ))
                    : undefined),
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
