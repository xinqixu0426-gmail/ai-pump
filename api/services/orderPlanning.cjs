const { findScrewPricingPart, isLongScrewPart } = require('./costEngine.cjs');
const { collapseLegacyCableParts } = require('./cableAccessory.cjs');

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

function buildPurchaseList(items, partsCatalog) {
    const { partIndex, partByModel } = buildPartIndexes(partsCatalog);
    const merged = new Map();

    for (const item of items || []) {
        const itemQty = Number(item.qty || 0);
        if (itemQty <= 0) continue;
        for (const part of collapseLegacyCableParts(parsePartsJson(item.partsJson))) {
            const model = String(part.model || '').trim();
            if (!model) continue;
            const qty = Number(part.inventoryQty ?? part.qty ?? 0);
            if (qty <= 0) continue;
            const existing = merged.get(model);
            if (existing) {
                existing.totalQty += qty * itemQty;
                if (!existing.supplier && part.supplier) existing.supplier = part.supplier;
            } else {
                merged.set(model, { part, totalQty: qty * itemQty, supplier: String(part.supplier || '').trim() });
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
        const needToBuy = Math.max(0, totalQty - currentStock);
        purchaseList.push({
            model: part.model,
            name: part.name || part.model,
            supplier: supplier || dbPart?.supplier || '',
            totalQty,
            currentStock,
            needToBuy,
            purchased: false,
            partId: exactPart?.Id || exactPart?.id,
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

function buildOrderPlan(items, partsCatalog) {
    const purchaseList = buildPurchaseList(items, partsCatalog);
    return { purchaseList, todos: buildTodos(purchaseList) };
}

module.exports = { buildPurchaseList, buildTodos, buildOrderPlan };
