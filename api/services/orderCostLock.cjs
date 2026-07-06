const { calculateRecipeCost: calculateCurrentRecipeCost } = require('./costEngine.cjs');

function parseRecipeParts(partsJson) {
    try {
        const parsed = JSON.parse(partsJson || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function resolveRecipeLockedUnitCost(recipe, partsCache = {}, partsByModel = {}, calculateCost = calculateCurrentRecipeCost) {
    const savedCost = Number(recipe?.savedTotalCost || 0);
    if (Number.isFinite(savedCost) && savedCost > 0) return savedCost;
    const parts = parseRecipeParts(recipe?.partsJson);
    if (parts.length === 0) return 0;
    const result = calculateCost(parts, partsCache, partsByModel);
    return parseFloat(result.totalCost || 0) || 0;
}

module.exports = {
    parseRecipeParts,
    resolveRecipeLockedUnitCost,
};
