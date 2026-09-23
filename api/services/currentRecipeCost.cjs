const { roundMoney } = require('./costEngine.cjs');
const { calculateCoilCost } = require('./coilCost.cjs');
const { currentSavedParts, parseSavedParts } = require('./savedPartReferences.cjs');

function parseParts(value) {
    return parseSavedParts(value, '配方物料');
}

function buildCurrentRecipeBomInput(recipe, catalog) {
    const selections = (value, field, category) => catalog
        ? currentSavedParts(value, catalog, field, category) : parseParts(value);
    const dynamic = parseParts(recipe.partsJson);
    const floatPartId = dynamic.find(part => part.costRole === 'float' || /^浮球(?:-|$)/.test(part.name || ''))?.partId;
    const cablePartId = dynamic.find(part => part.cableAssembly === true || part.costRole === 'cable')?.partId;
    return {
        ...(floatPartId ? { floatPartId } : {}), ...(cablePartId ? { cablePartId } : {}),
        templateId: recipe.templateId ?? null,
        modelVariantId: recipe.modelVariantId ?? null,
        customBarrelLength: recipe.customBarrelLength ?? null,
        longScrewExtraLength: recipe.longScrewExtraLength ?? 0,
        coilId: recipe.coilId ?? null,
        coilSchemeFamilyCode: recipe.coilSchemeFamilyCode || '',
        coilSpec: recipe.coilSpec || '',
        coilSheets: recipe.coilSheets || 0,
        coilMaterial: recipe.coilMaterial || '钢带',
        coilSlotType: recipe.coilSlotType || '小眼',
        coilWireWeight: recipe.coilWireWeight ?? null,
        optionalParts: selections(recipe.extraPartsJson, '配方选配件'),
        hasFloat: Boolean(recipe.hasFloat),
        floatWire: recipe.floatWire || '',
        floatAccessoryType: recipe.floatAccessoryType || 'standard',
        hasCable: Boolean(recipe.hasCable),
        cableLength: recipe.cableLength || 0,
        cableWire: recipe.cableWire || '',
        cableAccessoryType: recipe.cableAccessoryType || 'standard',
        packingParts: selections(recipe.packingPartsJson, '配方包装', '包装'),
    };
}

function calculateLaborTotal(recipe, getSetting = () => undefined) {
    return roundMoney(buildLaborCostDetails(recipe, getSetting).reduce(
        (sum, item) => sum + Number(item.subtotal || 0),
        0
    ));
}

function buildLaborCostDetails(recipe, getSetting = () => undefined) {
    // An EXPLICIT `none` is a formal zero-cost configuration.  Keeping this
    // normalization here makes current-cost and same-read-set scenario previews
    // share the same business basis.
    //
    // An ABSENT mode is not the same thing and must keep the pre-existing
    // production fallback: the production recipe row adapter
    // (api/db.cjs:recipeRow) derives the mode from the legacy painting wage
    // (`painting_wage != null ? 'painting' : 'none'`), and templateCommands
    // uses the same rule.  Treating a missing mode as `none` would silently
    // drop the legacy painting wage from every current-cost basis that is
    // built from a raw row, which is a production regression, not a Native
    // requirement.  Only a surfaced mode is therefore allowed to zero the cost.
    const rawMode = recipe.surfaceTreatmentMode;
    const normalizedMode = String(rawMode ?? '').trim() || 'none';
    const surfaceTreatmentCost = normalizedMode === 'none'
        ? (rawMode === null || rawMode === undefined || String(rawMode).trim() === ''
            ? (recipe.surfaceTreatmentCost ?? recipe.paintingWage ?? 0)
            : 0)
        : (recipe.surfaceTreatmentCost ?? recipe.paintingWage ?? 0);
    const managementFee = recipe.managementFee ?? getSetting('management_fee') ?? 0;
    return [
        {
            model: '__assembly_wage__',
            name: '安装工资',
            qty: 1,
            subtotal: roundMoney(recipe.assemblyWage || 0),
            source: '配方人工费用',
        },
        {
            model: '__packing_wage__',
            name: '打包工资',
            qty: 1,
            subtotal: roundMoney(recipe.packingWage || 0),
            source: '配方人工费用',
        },
        {
            model: '__surface_treatment__',
            name: '表面处理',
            qty: 1,
            subtotal: roundMoney(surfaceTreatmentCost || 0),
            source: '配方工艺费用',
        },
        {
            model: '__management_fee__',
            name: '管理费',
            qty: 1,
            subtotal: roundMoney(managementFee || 0),
            source: recipe.managementFee == null ? '系统默认管理费' : '配方管理费',
        },
    ];
}

function refreshCoilSnapshot(parts, recipe, coils) {
    if (!recipe.coilSpec || !Number(recipe.coilSheets || 0)) return parts;
    const result = calculateCoilCost(coils, {
        spec: recipe.coilSpec,
        sheets: recipe.coilSheets,
        material: recipe.coilMaterial,
        slotType: recipe.coilSlotType || '小眼',
        wireWeight: recipe.coilWireWeight,
        coilId: recipe.coilId,
        schemeFamilyCode: recipe.coilSchemeFamilyCode || '',
    });
    if (!result.success || !result.data) return parts;

    return parts.map(part => part?.name === '线圈转子'
        ? {
            ...part,
            snapshotPrice: Number(result.data.totalCost || 0),
            pricingMode: result.data.pricingMode || 'calculated',
            kitPrice: Number(result.data.kitPrice || 0),
            unitPrice: result.data.unitPrice,
            coilId: result.data.coilId || null,
            schemeCode: result.data.schemeCode || '',
            schemeName: result.data.schemeName || '',
            ratedVoltageV: result.data.ratedVoltageV || null,
            ratedFrequencyHz: result.data.ratedFrequencyHz || null,
            market: result.data.market || '',
            schemeFamilyCode: result.data.schemeFamilyCode || '',
            source: result.data.source,
            formula: result.data.formula,
        }
        : part);
}

function buildCurrentRecipeCostBasis(recipe, dependencies = {}) {
    const {
        partsCache = {},
        partsByModel = {},
        calculateRecipeCost,
        coils = [],
        getSetting = () => undefined,
        buildBomDraft,
    } = dependencies;
    if (typeof calculateRecipeCost !== 'function') throw new Error('calculateRecipeCost dependency is required');

    const catalog = Object.values(partsByModel).flat();
    const currentBom = typeof buildBomDraft === 'function'
        ? buildBomDraft(buildCurrentRecipeBomInput(recipe, catalog), recipe)
        : null;
    const sourceParts = Array.isArray(currentBom?.parts)
        ? currentBom.parts
        : currentSavedParts(recipe.partsJson, catalog, '配方 BOM');
    const parts = refreshCoilSnapshot(sourceParts, recipe, coils);
    const partsResult = calculateRecipeCost(parts, partsCache, partsByModel, { getSetting });
    const partialPartsCost = roundMoney(Number(partsResult.totalCost || 0));
    const laborDetails = buildLaborCostDetails(recipe, getSetting);
    const laborCost = roundMoney(laborDetails.reduce(
        (sum, item) => sum + Number(item.subtotal || 0),
        0
    ));
    const partialTotalCost = roundMoney(partialPartsCost + laborCost);
    const missingParts = [...new Set(
        (Array.isArray(partsResult.missingParts) ? partsResult.missingParts : [])
            .map(value => String(value || '').trim())
            .filter(Boolean)
    )];
    const costComplete = missingParts.length === 0;

    return {
        parts,
        partsResult,
        laborDetails,
        laborCost,
        partialPartsCost,
        partialTotalCost,
        missingParts,
        costComplete,
    };
}

function calculateCurrentRecipeCost(recipe, dependencies = {}) {
    const basis = buildCurrentRecipeCostBasis(recipe, dependencies);
    const savedTotalCost = Number(recipe.savedTotalCost || 0);

    return {
        recipeId: recipe.id,
        currentTotalCost: basis.costComplete ? basis.partialTotalCost : null,
        savedTotalCost: savedTotalCost > 0 ? roundMoney(savedTotalCost) : null,
        difference: basis.costComplete && savedTotalCost > 0
            ? roundMoney(basis.partialTotalCost - savedTotalCost)
            : null,
        partsCost: basis.costComplete ? basis.partialPartsCost : null,
        partialPartsCost: basis.partialPartsCost,
        partialTotalCost: basis.partialTotalCost,
        laborCost: basis.laborCost,
        itemCount: Number(basis.partsResult.itemCount || basis.parts.length),
        missingParts: basis.missingParts,
        costComplete: basis.costComplete,
        warnings: basis.costComplete
            ? []
            : [`当前成本不完整，${basis.missingParts.length} 个 BOM 型号缺少价格：${basis.missingParts.join('、')}`],
    };
}

function buildCurrentRecipeCostFailure(recipe, error, dependencies = {}) {
    const savedTotalCost = Number(recipe.savedTotalCost || 0);
    const message = String(error?.message || '当前成本计算失败');
    return {
        recipeId: recipe.id,
        currentTotalCost: null,
        savedTotalCost: savedTotalCost > 0 ? roundMoney(savedTotalCost) : null,
        difference: null,
        partsCost: null,
        partialPartsCost: 0,
        partialTotalCost: 0,
        laborCost: calculateLaborTotal(recipe, dependencies.getSetting),
        itemCount: 0,
        missingParts: [],
        costComplete: false,
        warnings: [message],
        calculationError: {
            code: String(error?.code || 'CURRENT_RECIPE_COST_FAILED'),
            message,
            ...(error?.details === undefined ? {} : { details: error.details }),
        },
    };
}

module.exports = {
    buildCurrentRecipeCostBasis,
    buildCurrentRecipeCostFailure,
    buildLaborCostDetails,
    calculateCurrentRecipeCost,
    calculateLaborTotal,
    buildCurrentRecipeBomInput,
    refreshCoilSnapshot,
};
