const {
    createPartPriceGetter,
    configuredWireModel,
    lengthPricedPartSubtotal,
    buildRecipeCostDraft,
    getCableAccessoryFee: getCableAccessoryFeeFromEngine,
} = require('./costEngine.cjs');
const {
    DEFAULT_COIL_MATERIAL,
    calculateCoilCost,
    getMaterialPriceMap,
    resolveWireFromCoils,
} = require('./coilCost.cjs');

function toBool(v) {
    return v === true || v === 1 || v === '1';
}

function sameNumber(a, b) {
    return Number(a || 0) === Number(b || 0);
}

function sameText(a, b) {
    return String(a || '') === String(b || '');
}

function getOverride(overrides, camelKey, snakeKey, fallback) {
    if (overrides?.[camelKey] !== undefined) return overrides[camelKey];
    if (overrides?.[snakeKey] !== undefined) return overrides[snakeKey];
    return fallback;
}

function normalizePackingJsonText(value, boxType) {
    let list = [];
    try {
        list = JSON.parse(value || '[]');
    } catch {
        list = [];
    }
    if ((!Array.isArray(list) || list.length === 0) && boxType) {
        list = [{ model: boxType, supplier: '', qty: 1 }];
    }
    if (!Array.isArray(list)) list = [];
    return JSON.stringify(list
        .filter(part => part?.model)
        .map(part => {
            const normalized = {
                model: part.model,
                supplier: part.supplier || '',
                qty: Number(part.qty || 1)
            };
            if (part.snapshotPrice !== undefined) normalized.snapshotPrice = Number(part.snapshotPrice || 0);
            if (part.costSource === 'manual') normalized.costSource = 'manual';
            if (part.packagingMaterial) normalized.packagingMaterial = String(part.packagingMaterial);
            return normalized;
        }));
}

function managedPartType(part) {
    const name = String(part?.name || '');
    const model = String(part?.model || '');
    if (name.includes('cm)')) return 'barrelLength';
    if (part?.dynamicRule === 'longScrewByBarrelLength' || name.includes('长螺丝') || model.includes('长螺丝')) return 'longScrew';
    if (name === '线圈转子') return 'coil';
    if (name.includes('浮球') || model.startsWith('浮球-')) return 'float';
    if (name.includes('电缆') || model.startsWith('电缆-') || model === '电缆配件费') return 'cable';
    if (name.includes('木箱') || name.includes('纸箱') || model.includes('木箱') || model.includes('纸箱')) return 'box';
    return null;
}

function partSnapshotSubtotal(part, partsCache, partsByModel, calculateRecipeCost) {
    if (part?.snapshotPrice !== undefined) return Number(part.snapshotPrice || 0) * Number(part.qty || 0);
    return Number(calculateRecipeCost([part], partsCache, partsByModel).totalCost || 0);
}

function getCableAccessoryFee(partsByModel, cableModel, supplier, getSetting, accessoryType = 'standard') {
    return getCableAccessoryFeeFromEngine(partsByModel, cableModel, supplier, accessoryType, getSetting);
}

function getFloatAccessoryDelta(getSetting, accessoryType = 'standard') {
    if (accessoryType !== 'xinjie') return 0;
    const delta = Number(getSetting('float_accessory_delta'));
    return Number.isFinite(delta) && delta >= 0 ? delta : 0;
}

function getFloatPrice(model, getPrice, getSetting, accessoryType = 'standard') {
    return getPrice(model) + getFloatAccessoryDelta(getSetting, accessoryType);
}

function findBoxPrice(boxType, getPrice, partsCache) {
    if (!boxType) return 0;
    let price = getPrice(boxType);
    if (price !== 0) return price;
    const kw = String(boxType).trim();
    const cands = [];
    for (const [m, info] of Object.entries(partsCache)) {
        if (info.category === '包装' && m.includes(kw)) cands.push({ model: m, price: info.price });
    }
    return cands.length > 0 ? cands.reduce((min, c) => c.price < min.price ? c : min, cands[0]).price : 0;
}

function calculatePackingPartsCost(packingPartsJson, getPrice) {
    let packingParts = [];
    try { packingParts = JSON.parse(packingPartsJson || '[]'); } catch { packingParts = []; }
    return packingParts.reduce((sum, part) => {
        if (!part?.model) return sum;
        const price = part.snapshotPrice !== undefined ? Number(part.snapshotPrice || 0) : getPrice(part.model);
        return sum + price * Number(part.qty || 1);
    }, 0);
}

function calculateCoilCostValue(spec, sheets, material = DEFAULT_COIL_MATERIAL, getCoils = () => [], getSetting = () => undefined) {
    if (!spec || !sheets) return 0;
    const result = calculateCoilCost(getCoils(), { spec, sheets, material }, { materialPrices: getMaterialPriceMap(getSetting) });
    return result.success ? Number(result.data.totalCost || 0) : 0;
}

function resolveWire(dbWire, explicitWire) {
    if (explicitWire) return explicitWire;
    if (dbWire) return dbWire;
    return '0.55';
}

function buildRecipeData(row, overrides = {}) {
    return {
        id: row.id,
        name: row.name,
        parts_json: row.parts_json,
        template_id: row.template_id,
        coil_spec: getOverride(overrides, 'coilSpec', 'coil_spec', row.coil_spec),
        coil_sheets: Number(getOverride(overrides, 'coilSheets', 'coil_sheets', row.coil_sheets)),
        coil_material: getOverride(overrides, 'coilMaterial', 'coil_material', row.coil_material || DEFAULT_COIL_MATERIAL),
        has_float: getOverride(overrides, 'hasFloat', 'has_float', row.has_float),
        float_wire: getOverride(overrides, 'floatWire', 'float_wire', row.float_wire),
        float_accessory_type: getOverride(overrides, 'floatAccessoryType', 'float_accessory_type', row.float_accessory_type || 'standard'),
        has_cable: getOverride(overrides, 'hasCable', 'has_cable', row.has_cable),
        cable_length: Number(getOverride(overrides, 'cableLength', 'cable_length', row.cable_length)),
        cable_wire: getOverride(overrides, 'cableWire', 'cable_wire', row.cable_wire),
        cable_accessory_type: getOverride(overrides, 'cableAccessoryType', 'cable_accessory_type', row.cable_accessory_type || 'standard'),
        box_type: getOverride(overrides, 'boxType', 'box_type', row.box_type),
        packing_parts_json: getOverride(overrides, 'packingPartsJson', 'packing_parts_json', row.packing_parts_json),
        custom_barrel_length: (() => {
            const value = getOverride(overrides, 'customBarrelLength', 'custom_barrel_length', row.custom_barrel_length);
            return value != null ? Number(value) : value;
        })(),
        extra_parts_json: getOverride(overrides, 'extraPartsJson', 'extra_parts_json', row.extra_parts_json),
        assembly_wage: row.assembly_wage,
        packing_wage: row.packing_wage,
        painting_wage: row.painting_wage,
        surface_treatment_mode: row.surface_treatment_mode || (row.painting_wage != null ? 'painting' : 'none'),
        surface_treatment_cost: row.surface_treatment_cost != null ? row.surface_treatment_cost : (row.painting_wage != null ? row.painting_wage : 0),
        management_fee: row.management_fee
    };
}

function calculateRecipeCostPreview(row, overrides = {}, dependencies = {}) {
    const {
        partsCache = {},
        partsByModel = {},
        partsCatalog = Object.values(partsByModel).flat(),
        calculateRecipeCost,
        getCoils = () => [],
        getSetting = () => undefined,
    } = dependencies;
    if (typeof calculateRecipeCost !== 'function') throw new Error('calculateRecipeCost dependency is required');

    const recipeData = buildRecipeData(row, overrides);
    const parsedParts = JSON.parse(recipeData.parts_json || '[]');
    const longScrewPart = parsedParts.find(part => managedPartType(part) === 'longScrew');
    const refreshedPartsDraft = buildRecipeCostDraft({
        parts: parsedParts,
        customBarrelLength: recipeData.custom_barrel_length,
        longScrewExtraLength: longScrewPart?.longScrewExtraLength,
    }, { partsCatalog });
    const pricedParts = refreshedPartsDraft.parts;
    const getPrice = createPartPriceGetter(partsByModel);

    const managedTotals = { coil: 0, float: 0, cable: 0, box: 0, barrelLength: 0, longScrew: 0 };
    let longScrewTotal = 0;
    const lengthPricedParts = [];
    for (const part of parsedParts) {
        const type = managedPartType(part);
        if (type === 'barrelLength') lengthPricedParts.push(part);
        if (type) managedTotals[type] += partSnapshotSubtotal(part, partsCache, partsByModel, calculateRecipeCost);
    }
    for (const part of pricedParts) {
        if (managedPartType(part) === 'longScrew') {
            longScrewTotal += partSnapshotSubtotal(part, partsCache, partsByModel, calculateRecipeCost);
        }
    }

    const savedBaseCost = Number(row.saved_total_cost || 0);
    const hasSavedBase = savedBaseCost > 0;
    const partsResult = calculateRecipeCost(pricedParts, partsCache, partsByModel);
    let totalCost = hasSavedBase ? savedBaseCost : Number(partsResult.totalCost || 0);
    totalCost -= managedTotals.coil + managedTotals.float + managedTotals.cable + managedTotals.box + managedTotals.barrelLength + managedTotals.longScrew;

    const dbWire = resolveWireFromCoils(getCoils(), recipeData.coil_spec, recipeData.coil_sheets, recipeData.coil_material);
    const resolvedWire = resolveWire(dbWire, recipeData.cable_wire || recipeData.float_wire);

    const coilChanged = !sameText(recipeData.coil_spec, row.coil_spec) || !sameNumber(recipeData.coil_sheets, row.coil_sheets) || !sameText(recipeData.coil_material, row.coil_material || DEFAULT_COIL_MATERIAL);
    const floatChanged = toBool(recipeData.has_float) !== toBool(row.has_float) || !sameText(recipeData.float_wire, row.float_wire) || !sameText(recipeData.float_accessory_type, row.float_accessory_type || 'standard');
    const cableChanged = toBool(recipeData.has_cable) !== toBool(row.has_cable) || !sameNumber(recipeData.cable_length, row.cable_length) || !sameText(recipeData.cable_wire, row.cable_wire) || !sameText(recipeData.cable_accessory_type, row.cable_accessory_type || 'standard');
    const packingJsonChanged = normalizePackingJsonText(recipeData.packing_parts_json, recipeData.box_type) !== normalizePackingJsonText(row.packing_parts_json, row.box_type);
    const boxChanged = !sameText(recipeData.box_type, row.box_type) || packingJsonChanged;

    totalCost += coilChanged ? calculateCoilCostValue(recipeData.coil_spec, recipeData.coil_sheets, recipeData.coil_material, getCoils, getSetting) : managedTotals.coil;

    if (!floatChanged) {
        totalCost += managedTotals.float;
    } else if (toBool(recipeData.has_float)) {
        totalCost += getFloatPrice(configuredWireModel('浮球', recipeData.float_wire, resolvedWire), getPrice, getSetting, recipeData.float_accessory_type);
    }

    if (!cableChanged) {
        totalCost += managedTotals.cable;
    } else if (toBool(recipeData.has_cable) && Number(recipeData.cable_length) > 0) {
        const cableModel = configuredWireModel('电缆', recipeData.cable_wire, resolvedWire);
        totalCost += getPrice(cableModel) * Number(recipeData.cable_length);
        totalCost += getCableAccessoryFee(partsByModel, cableModel, '', getSetting, recipeData.cable_accessory_type);
    }

    totalCost += boxChanged
        ? (calculatePackingPartsCost(recipeData.packing_parts_json, getPrice) || findBoxPrice(recipeData.box_type, getPrice, partsCache))
        : managedTotals.box;

    totalCost += lengthPricedParts.reduce((sum, part) => sum + lengthPricedPartSubtotal(part, recipeData.custom_barrel_length), 0);
    totalCost += longScrewTotal;

    if (!hasSavedBase) {
        totalCost += Number(recipeData.assembly_wage || 0);
        totalCost += Number(recipeData.packing_wage || 0);
        totalCost += Number(recipeData.surface_treatment_cost || recipeData.painting_wage || 0);
        totalCost += Number(recipeData.management_fee || Number(getSetting('management_fee')) || 0);
    }

    return {
        recipeName: recipeData.name,
        unitCost: Number(totalCost.toFixed(2)),
        parts: pricedParts,
    };
}

module.exports = {
    DEFAULT_COIL_MATERIAL,
    buildRecipeData,
    calculateRecipeCostPreview,
};
