const { roundMoney } = require('./costEngine.cjs');
const { calculateCoilCost, getMaterialPriceMap } = require('./coilCost.cjs');

function parseParts(value) {
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function calculateLaborTotal(recipe, getSetting = () => undefined) {
    const surfaceTreatmentCost = recipe.surfaceTreatmentCost ?? recipe.paintingWage ?? 0;
    const managementFee = recipe.managementFee ?? getSetting('management_fee') ?? 0;
    return roundMoney(
        Number(recipe.assemblyWage || 0)
        + Number(recipe.packingWage || 0)
        + Number(surfaceTreatmentCost || 0)
        + Number(managementFee || 0)
    );
}

function refreshCoilSnapshot(parts, recipe, coils, getSetting = () => undefined) {
    if (!recipe.coilSpec || !Number(recipe.coilSheets || 0)) return parts;
    const result = calculateCoilCost(coils, {
        spec: recipe.coilSpec,
        sheets: recipe.coilSheets,
        material: recipe.coilMaterial,
        wireWeight: recipe.coilWireWeight,
    }, { materialPrices: getMaterialPriceMap(getSetting) });
    if (!result.success || !result.data) return parts;

    return parts.map(part => part?.name === '线圈转子'
        ? {
            ...part,
            snapshotPrice: Number(result.data.totalCost || 0),
            unitPrice: result.data.unitPrice,
            source: result.data.source,
            formula: result.data.formula,
        }
        : part);
}

function calculateCurrentRecipeCost(recipe, dependencies = {}) {
    const {
        partsCache = {},
        partsByModel = {},
        calculateRecipeCost,
        coils = [],
        getSetting = () => undefined,
    } = dependencies;
    if (typeof calculateRecipeCost !== 'function') throw new Error('calculateRecipeCost dependency is required');

    const parts = refreshCoilSnapshot(parseParts(recipe.partsJson), recipe, coils, getSetting);
    const partsResult = calculateRecipeCost(parts, partsCache, partsByModel);
    const partsCost = Number(partsResult.totalCost || 0);
    const laborCost = calculateLaborTotal(recipe, getSetting);
    const currentTotalCost = roundMoney(partsCost + laborCost);
    const savedTotalCost = Number(recipe.savedTotalCost || 0);

    return {
        recipeId: recipe.id,
        currentTotalCost,
        savedTotalCost: savedTotalCost > 0 ? roundMoney(savedTotalCost) : null,
        difference: savedTotalCost > 0 ? roundMoney(currentTotalCost - savedTotalCost) : null,
        partsCost: roundMoney(partsCost),
        laborCost,
        itemCount: Number(partsResult.itemCount || parts.length),
        missingParts: Array.isArray(partsResult.missingParts) ? partsResult.missingParts : [],
    };
}

module.exports = {
    calculateCurrentRecipeCost,
    calculateLaborTotal,
    refreshCoilSnapshot,
};
