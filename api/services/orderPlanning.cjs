const crypto = require('node:crypto');
const { findScrewPricingPart, isLongScrewPart } = require('./costEngine.cjs');
const { collapseLegacyCableParts } = require('./cableAccessory.cjs');
const { mergePurchasePlanItem } = require('./orderWorkflow.cjs');
const { resolveCatalogPartIdentity, resolveSavedCatalogPartIdentity } = require('./bomPartIdentity.cjs');
const { assertPurchasePartSupplier, isPurchaseCoil: isCoilAssemblyPart, catalogId, positiveFactor, purchaseConfiguration, purchaseIdentityError, purchaseIdentity, purchaseStockIdentity, purchaseRowIdentity, purchaseRowId, matchPurchasePlanRows } = require('./purchaseIdentity.cjs');
const { isPackagingEstimatePart } = require('./packagingEstimate.cjs');
const { isRotorProcessPart } = require('./rotorShaftJoint.cjs');

function makeId(value) {
    return `purchase-${crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16)}`;
}

function parsePartsJson(partsJson) {
    try {
        const parsed = JSON.parse(partsJson || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function resolveInventoryPart(part, supplier, partsCatalog, resolveIdentity = resolveCatalogPartIdentity) {
    try {
        const matched = resolveIdentity(partsCatalog, { ...part, supplier });
        assertPurchasePartSupplier({ ...part, supplier }, matched);
        return matched;
    } catch (error) {
        if (resolveIdentity === resolveCatalogPartIdentity && error.code === 'BOM_PART_ID_SUPPLIER_MISMATCH') throw purchaseIdentityError('PURCHASE_PART_SUPPLIER_CHANGED', error.message);
        if (part.partId == null && ['BOM_PART_IDENTITY_NOT_FOUND', 'BOM_PART_IDENTITY_AMBIGUOUS'].includes(error.code)) return null;
        throw error;
    }
}

function resolveSavedInventoryPart(part, supplier, partsCatalog) {
    return resolveInventoryPart(part, supplier, partsCatalog, resolveSavedCatalogPartIdentity);
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
        const candidates = byDimensions.get(key) || [];
        candidates.push(coil);
        byDimensions.set(key, candidates);
    }
    return { byId, byDimensions };
}

function resolveCoilForPart(part, coilIndexes) {
    const explicitId = catalogId(part?.coilId);
    if (explicitId) {
        const coil = coilIndexes.byId.get(explicitId);
        if (!coil || String(coil.schemeStatus || coil.scheme_status || 'official') !== 'official') {
            throw purchaseIdentityError('PURCHASE_COIL_UNAVAILABLE', '采购项的正式线圈方案不存在或已停用');
        }
        return coil;
    }
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
    const candidates = coilIndexes.byDimensions.get(key) || [];
    if (candidates.length === 1) return candidates[0];
    const defaults = candidates.filter(coil => Boolean(coil.isDefault || coil.is_default));
    return defaults.length === 1 ? defaults[0] : null;
}

function isCompleteCablePart(part) {
    return part?.cableAssembly === true || String(part?.name || '').startsWith('成品电缆');
}

function buildPurchaseList(items, partsCatalog, options = {}, resolvePart = resolveInventoryPart) {
    const activeParts = (partsCatalog || []).filter(part => !part.deletedAt && !part.deleted_at);
    const coilIndexes = buildCoilIndexes(options.coilsCatalog);
    const merged = new Map();
    const reservedDemand = options.reservedDemand instanceof Map ? options.reservedDemand : new Map();

    for (const item of items || []) {
        const itemQty = Number(item.qty || 0);
        if (itemQty <= 0) continue;
        for (const part of collapseLegacyCableParts(parsePartsJson(item.partsJson))) {
            if (isPackagingEstimatePart(part)) continue;
            if (isRotorProcessPart(part)) continue;
            purchaseStockIdentity(part);
            const model = String(part.model || '').trim();
            if (!model) continue;
            const completeCable = isCompleteCablePart(part);
            const cableLength = completeCable ? Number(part.cableLength ?? part.inventoryQty ?? 0) : 0;
            const qty = completeCable ? Number(part.qty ?? 1) : Number(part.inventoryQty ?? part.qty ?? 0);
            if (qty <= 0) continue;
            const supplier = String(part.supplier || '').trim();
            let purchasePart = completeCable
                ? {
                    ...part,
                    purchaseUnit: '根',
                    stockQtyPerUnit: cableLength,
                    specification: `每根 ${cableLength}m + ${part.cableAccessoryName || (part.cableAccessoryType === 'xinjie' ? '新界式' : '普通铜套')}`,
                }
                : part;
            const coil = isCoilAssemblyPart(part) ? resolveCoilForPart(part, coilIndexes) : null;
            const exactPart = isCoilAssemblyPart(part) ? null : resolvePart(part, supplier, activeParts);
            purchasePart = { ...purchasePart,
                ...(exactPart ? { partId: exactPart.id || exactPart.Id, supplier: exactPart.supplier || '' } : {}),
                ...(coil ? { coilId: coil.id || coil.Id, inventoryType: 'coil', purchaseUnit: '套' } : {}),
            };
            const mergeKey = purchaseRowIdentity(purchasePart);
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
        const exactPart = coilPart ? null : resolvePart(part, supplier, activeParts);
        const screwPricingPart = !exactPart && isLongScrewPart(part)
            ? findScrewPricingPart(partsCatalog, part.model, supplier)?.part || null
            : null;
        const dbPart = exactPart || screwPricingPart;
        const stockQtyPerUnit = positiveFactor(part.stockQtyPerUnit);
        const currentInventoryStock = coilId
            ? Number(exactCoil.stock || 0)
            : exactPart ? Number(exactPart.stock || 0) : 0;
        const partId = exactPart?.Id || exactPart?.id;
        const resolvedSupplier = exactPart?.supplier || supplier || dbPart?.supplier || '';
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
        const identityItem = { ...part, supplier: resolvedSupplier, partId, coilId, inventoryType,
            purchaseUnit: coilPart ? '套' : part.purchaseUnit || '', stockQtyPerUnit };
        const stockIdentityKey = purchaseStockIdentity(identityItem);
        const identityKey = purchaseRowIdentity(identityItem);
        const alreadyReserved = Number(reservedDemand.get(stockIdentityKey) || 0);
        const availableInventoryStock = Math.max(0, currentInventoryStock - alreadyReserved);
        const availableStock = Math.floor(availableInventoryStock / stockQtyPerUnit);
        const needToBuy = Math.max(0, totalQty - availableStock);
        // These are the planner's own unit-normalized quantities.  Persisted
        // order callers keep their legacy display fields above; read-only
        // virtual readiness consumes this projection instead of redoing stock
        // subtraction in an AI controller or response formatter.
        const availableForPlanningQty = availableStock * stockQtyPerUnit;
        const requiredStockQty = totalQty * stockQtyPerUnit;
        const shortageStockQty = needToBuy * stockQtyPerUnit;
        reservedDemand.set(stockIdentityKey, alreadyReserved + totalQty * stockQtyPerUnit);
        const readSaved = resolvePart === resolveSavedInventoryPart;
        const currentName = readSaved ? (exactPart?.model || exactCoil?.schemeName || exactCoil?.scheme_name || part.model) : part.model;
        purchaseList.push({
            id: purchaseRowId(identityItem),
            model: currentName,
            name: part.name && part.name !== part.model ? part.name : currentName,
            ...(readSaved ? { snapshotName: part.model } : {}),
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
            stockOnHandQty: currentInventoryStock,
            reservedByActiveOrdersQty: alreadyReserved,
            availableForPlanningQty,
            requiredStockQty,
            shortageStockQty,
            specification: part.specification || '',
            cableLength: part.cableLength,
            cableAccessoryType: part.cableAccessoryType,
            cableAccessoryName: part.cableAccessoryName,
            floatAccessoryType: readSaved ? purchaseConfiguration(identityItem)[4] ?? undefined : part.floatAccessoryType,
            ...(coilPart ? { material: part.material || '钢带', slotType: part.slotType || '小眼' } : {}),
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
        todos.push({
            id: makeId(JSON.stringify([supplier, parts.map(purchaseRowIdentity).sort()])),
            supplier,
            description: `联系【${supplier}】采购：${detail}`,
            done: false,
        });
    }
    return todos;
}

function buildOrderPlan(items, partsCatalog, options = {}, resolvePart = resolveInventoryPart) {
    const purchaseList = buildPurchaseList(items, partsCatalog, options, resolvePart);
    return { purchaseList, todos: buildTodos(purchaseList) };
}

function buildBalancedOrderPlanningProjectionWithResolver(orders, partsCatalog, options, resolvePart) {
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
        }, resolvePart);
        const previous = parsePartsJson(order.purchase_list_json || order.purchaseListJson);
        const previousMatches = matchPurchasePlanRows(plan.purchaseList, previous);
        plan.purchaseList = plan.purchaseList.map((item, index) => mergePurchasePlanItem(item, previousMatches[index]));
        plans.set(Number(order.id || order.Id), plan);
    }
    return { plans, reservedDemand };
}

function buildBalancedOrderPlansWithResolver(orders, partsCatalog, options, resolvePart) {
    return buildBalancedOrderPlanningProjectionWithResolver(orders, partsCatalog, options, resolvePart).plans;
}

function buildBalancedOrderPlans(orders, partsCatalog, options = {}) {
    return buildBalancedOrderPlansWithResolver(orders, partsCatalog, options, resolveInventoryPart);
}

// Only persisted order Query callers use this view. Drafts, previews and all
// commands retain the strict builder; request fields cannot select this mode.
function buildSavedBalancedOrderPlanViews(orders, partsCatalog, options = {}) {
    return buildBalancedOrderPlansWithResolver(orders, partsCatalog, options, resolveSavedInventoryPart);
}

module.exports = {
    purchaseIdentity,
    buildPurchaseList,
    buildTodos,
    buildOrderPlan,
    buildBalancedOrderPlans,
    buildBalancedOrderPlanningProjection: (orders, partsCatalog, options = {}) =>
        buildBalancedOrderPlanningProjectionWithResolver(orders, partsCatalog, options, resolveInventoryPart),
    buildSavedBalancedOrderPlanViews,
};
