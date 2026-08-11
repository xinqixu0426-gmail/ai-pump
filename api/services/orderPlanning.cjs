const { findScrewPricingPart, isLongScrewPart } = require('./costEngine.cjs');
const { collapseLegacyCableParts } = require('./cableAccessory.cjs');
const { mergePurchasePlanItem, normalizePurchaseItem } = require('./orderWorkflow.cjs');
const { isPackagingEstimatePart } = require('./packagingEstimate.cjs');

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

function buildCoilIndexes(coilsCatalog) {
    const byId = new Map();
    const byDimensions = new Map();
    for (const coil of coilsCatalog || []) {
        const id = Number(coil.id || coil.Id || 0);
        if (id > 0) byId.set(id, coil);
        if (String(coil.schemeStatus || coil.scheme_status || 'official') !== 'official') continue;
        const key = [
            String(coil.spec || '').trim(),
            Number(coil.sheets || 0),
            String(coil.material || '钢带').trim(),
            String(coil.slotType || coil.slot_type || '小眼').trim(),
        ].join('|');
        byDimensions.set(key, coil);
    }
    return { byId, byDimensions };
}

function purchaseIdentity(model, supplier = '', partId) {
    if (partId) return `part:${partId}`;
    return `model:${String(model || '').trim()}|supplier:${String(supplier || '').trim()}`;
}

function isCoilAssemblyPart(part) {
    return part?.inventoryType === 'coil'
        || part?.costSource === 'coil'
        || String(part?.name || '').trim() === '线圈转子';
}

function resolveCoilForPart(part, coilIndexes) {
    const explicitId = Number(part?.coilId || 0);
    if (explicitId > 0 && coilIndexes.byId.has(explicitId)) return coilIndexes.byId.get(explicitId);
    const model = String(part?.model || '').trim();
    const separator = model.lastIndexOf('-');
    if (separator <= 0) return null;
    const spec = model.slice(0, separator);
    const sheets = Number(model.slice(separator + 1));
    if (!Number.isInteger(sheets) || sheets <= 0) return null;
    const key = [
        spec,
        sheets,
        String(part?.material || '钢带').trim(),
        String(part?.slotType || '小眼').trim(),
    ].join('|');
    return coilIndexes.byDimensions.get(key) || null;
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
    const coilIndexes = buildCoilIndexes(options.coilsCatalog);
    const merged = new Map();
    const reservedDemand = options.reservedDemand instanceof Map ? options.reservedDemand : new Map();

    for (const item of items || []) {
        const itemQty = Number(item.qty || 0);
        if (itemQty <= 0) continue;
        for (const part of collapseLegacyCableParts(parsePartsJson(item.partsJson))) {
            if (isPackagingEstimatePart(part)) continue;
            const model = String(part.model || '').trim();
            if (!model) continue;
            const completeCable = isCompleteCablePart(part);
            const cableLength = completeCable ? Number(part.cableLength ?? part.inventoryQty ?? 0) : 0;
            const qty = completeCable ? Number(part.qty ?? 1) : Number(part.inventoryQty ?? part.qty ?? 0);
            if (qty <= 0) continue;
            const supplier = String(part.supplier || '').trim();
            const mergeKey = isCoilAssemblyPart(part)
                ? `${model}|${part.material || '钢带'}|${part.slotType || '小眼'}`
                : completeCable
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
        const coilPart = isCoilAssemblyPart(part);
        const exactCoil = coilPart ? resolveCoilForPart(part, coilIndexes) : null;
        const coilId = Number(exactCoil?.id || exactCoil?.Id || 0) || undefined;
        const exactPart = partIndex.get(`${part.model}|${supplier}`) || partByModel.get(part.model) || null;
        const screwPricingPart = !exactPart && isLongScrewPart(part)
            ? findScrewPricingPart(partsCatalog, part.model, supplier)?.part || null
            : null;
        const dbPart = exactPart || screwPricingPart;
        const stockQtyPerUnit = Math.max(1, Number(part.stockQtyPerUnit || 1));
        const currentInventoryStock = coilId
            ? Number(exactCoil.stock || 0)
            : exactPart ? Number(exactPart.stock || 0) : 0;
        const partId = exactPart?.Id || exactPart?.id;
        const resolvedSupplier = supplier || dbPart?.supplier || '';
        const inventoryType = coilPart ? (coilId ? 'coil' : 'none') : 'part';
        const coilReferencePrice = coilId ? Number(exactCoil?.cost || 0) : 0;
        const catalogReferencePrice = partId ? Number(exactPart?.price || 0) : 0;
        const referencePrice = Number.isFinite(coilReferencePrice) && coilReferencePrice > 0
            ? coilReferencePrice
            : Number.isFinite(catalogReferencePrice) && catalogReferencePrice > 0
                ? catalogReferencePrice
                : 0;
        const referencePriceSource = referencePrice > 0
            ? coilId ? 'coil_total_cost' : 'part_catalog'
            : 'none';
        const stockIdentityKey = coilId
            ? `coil:${coilId}`
            : purchaseIdentity(part.model, resolvedSupplier, partId);
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
            purchasePriceRecorded: false,
            referencePrice,
            referencePriceSource,
            actualSupplier: supplier || dbPart?.supplier || '',
            purchased: false,
            partId,
            coilId,
            inventoryType,
            identityKey,
            purchaseUnit: coilPart ? '套' : part.purchaseUnit || '',
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

function buildBalancedOrderPlans(orders, partsCatalog, options = {}) {
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
        const plan = buildOrderPlan(items, partsCatalog, {
            ...options,
            reservedDemand,
        });
        const previous = parsePartsJson(order.purchase_list_json || order.purchaseListJson);
        const previousByKey = new Map(previous.map(item => [
            item.identityKey || purchaseIdentity(item.model, item.supplier, item.partId),
            normalizePurchaseItem(item),
        ]));
        plan.purchaseList = plan.purchaseList.map(item => {
            const previousItem = previousByKey.get(item.identityKey)
                || (item.inventoryType === 'coil'
                    ? previous.find(previousItem => (
                        !previousItem.inventoryType
                        && previousItem.model === item.model
                        && String(previousItem.supplier || '') === String(item.supplier || '')
                    ))
                    : undefined)
                || (item.inventoryType === 'part' && item.partId
                    ? previous.find(previousItem => (
                        !previousItem.partId
                        && previousItem.model === item.model
                        && String(previousItem.supplier || '') === String(item.supplier || '')
                    ))
                    : undefined)
                || (item.purchaseUnit === '根'
                    ? previous.find(previousItem => (
                        !previousItem.purchaseUnit
                        && previousItem.model === item.model
                        && String(previousItem.supplier || '') === String(item.supplier || '')
                    ))
                    : undefined);
            return mergePurchasePlanItem(item, previousItem);
        });
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
