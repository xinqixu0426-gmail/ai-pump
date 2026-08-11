const { roundMoney } = require('./costEngine.cjs');
const { calculateCoilCost } = require('./coilCost.cjs');

function parseParts(value) {
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function buildCurrentRecipeBomInput(recipe) {
    return {
        templateId: recipe.templateId ?? null,
        modelVariantId: recipe.modelVariantId ?? null,
        customBarrelLength: recipe.customBarrelLength ?? null,
        longScrewExtraLength: recipe.longScrewExtraLength ?? 0,
        coilSpec: recipe.coilSpec || '',
        coilSheets: recipe.coilSheets || 0,
        coilMaterial: recipe.coilMaterial || '钢带',
        coilSlotType: recipe.coilSlotType || '小眼',
        coilWireWeight: recipe.coilWireWeight ?? null,
        optionalParts: parseParts(recipe.extraPartsJson),
        hasFloat: Boolean(recipe.hasFloat),
        floatWire: recipe.floatWire || '',
        floatAccessoryType: recipe.floatAccessoryType || 'standard',
        hasCable: Boolean(recipe.hasCable),
        cableLength: recipe.cableLength || 0,
        cableWire: recipe.cableWire || '',
        cableAccessoryType: recipe.cableAccessoryType || 'standard',
        packingParts: parseParts(recipe.packingPartsJson),
    };
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

function refreshCoilSnapshot(parts, recipe, coils) {
    if (!recipe.coilSpec || !Number(recipe.coilSheets || 0)) return parts;
    const result = calculateCoilCost(coils, {
        spec: recipe.coilSpec,
        sheets: recipe.coilSheets,
        material: recipe.coilMaterial,
        slotType: recipe.coilSlotType || '小眼',
        wireWeight: recipe.coilWireWeight,
    });
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
        buildBomDraft,
    } = dependencies;
    if (typeof calculateRecipeCost !== 'function') throw new Error('calculateRecipeCost dependency is required');

    const currentBom = typeof buildBomDraft === 'function'
        ? buildBomDraft(buildCurrentRecipeBomInput(recipe), recipe)
        : null;
    const sourceParts = Array.isArray(currentBom?.parts)
        ? currentBom.parts
        : parseParts(recipe.partsJson);
    const parts = refreshCoilSnapshot(sourceParts, recipe, coils);
    const partsResult = calculateRecipeCost(parts, partsCache, partsByModel, { getSetting });
    const partialPartsCost = roundMoney(Number(partsResult.totalCost || 0));
    const laborCost = calculateLaborTotal(recipe, getSetting);
    const partialTotalCost = roundMoney(partialPartsCost + laborCost);
    const savedTotalCost = Number(recipe.savedTotalCost || 0);
    const missingParts = [...new Set(
        (Array.isArray(partsResult.missingParts) ? partsResult.missingParts : [])
            .map(value => String(value || '').trim())
            .filter(Boolean)
    )];
    const costComplete = missingParts.length === 0;

    return {
        recipeId: recipe.id,
        currentTotalCost: costComplete ? partialTotalCost : null,
        savedTotalCost: savedTotalCost > 0 ? roundMoney(savedTotalCost) : null,
        difference: costComplete && savedTotalCost > 0
            ? roundMoney(partialTotalCost - savedTotalCost)
            : null,
        partsCost: costComplete ? partialPartsCost : null,
        partialPartsCost,
        partialTotalCost,
        laborCost,
        itemCount: Number(partsResult.itemCount || parts.length),
        missingParts,
        costComplete,
        warnings: costComplete
            ? []
            : [`当前成本不完整，${missingParts.length} 个 BOM 型号缺少价格：${missingParts.join('、')}`],
    };
}

module.exports = {
    calculateCurrentRecipeCost,
    calculateLaborTotal,
    buildCurrentRecipeBomInput,
    refreshCoilSnapshot,
};
