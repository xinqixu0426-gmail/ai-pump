const {
    calculatePackingEstimate,
    calculateOverheadEstimate,
    createPartPriceGetter,
} = require('./costEngine.cjs');
const { calculateCoilCost } = require('./coilCost.cjs');
const { calculateRecipeCostPreview } = require('./dynamicCostPreview.cjs');
const {
    configurationSnapshotFromRecipeData,
    normalizeRecipeConfigurationOverrides,
} = require('./configuredRecipeSnapshot.cjs');
const {
    assertRecipeConfigurationAllowed,
    recipeConfigurationPolicyFromRecord,
} = require('./recipeConfigurationPolicy.cjs');
const { buildCostDifference } = require('./costDifference.cjs');
const {
    calculateDynamicConfigCost,
    calculateFloatEstimate,
    calculateCableEstimate,
} = require('./dynamicConfigCost.cjs');
const {
    DEFAULT_COIL_MATERIAL,
    parseStatorInput,
    resolveWireFromCoils,
    resolveWire,
} = require('./fullCostEstimate.cjs');
const {
    buildCurrentRecipeCostFailure,
    calculateCurrentRecipeCost,
} = require('./currentRecipeCost.cjs');

const RECOVERABLE_CURRENT_RECIPE_COST_CODES = new Set([
    'COIL_SCHEME_AMBIGUOUS',
    'COIL_SCHEME_FAMILY_REQUIRED',
]);

function isRecoverableCurrentRecipeCostError(error) {
    return RECOVERABLE_CURRENT_RECIPE_COST_CODES.has(String(error?.code || ''));
}

class CostQueryError extends Error {
    constructor(message, statusCode = 400, code = null, details = undefined) {
        super(message);
        this.name = 'CostQueryError';
        this.statusCode = statusCode;
        if (code) this.code = code;
        if (details !== undefined) this.details = details;
    }
}

function parseRecipeParts(value) {
    try {
        return JSON.parse(value || '[]');
    } catch {
        throw new CostQueryError('配方配件JSON格式错误');
    }
}

function createCostQueries({
    db,
    calculateRecipeCost,
    getSetting,
    listCoils,
    listRecipes,
    loadPartsData,
    recipeRow,
    buildBomDraft,
} = {}) {
    if (!db || typeof db.prepare !== 'function') {
        throw new Error('成本查询服务缺少数据库依赖');
    }
    for (const [name, dependency] of Object.entries({
        calculateRecipeCost,
        getSetting,
        listCoils,
        listRecipes,
        loadPartsData,
        recipeRow,
        buildBomDraft,
    })) {
        if (typeof dependency !== 'function') {
            throw new Error(`成本查询服务缺少 ${name}`);
        }
    }

    function calculateParts(input = {}) {
        const { parts } = input;
        if (!Array.isArray(parts) || parts.length === 0) {
            throw new CostQueryError('请求体必须包含 parts 数组');
        }
        const { partsCache, partsByModel } = loadPartsData();
        return calculateRecipeCost(parts, partsCache, partsByModel);
    }

    function getRecipeCostByName(rawName) {
        const recipeName = String(rawName || '');
        if (!recipeName) {
            throw new CostQueryError('请提供 name 查询参数');
        }
        let recipes;
        try {
            recipes = listRecipes();
        } catch (error) {
            throw new CostQueryError(
                `获取配方失败: ${error.message}`,
                500
            );
        }
        if (!recipes || recipes.length === 0) {
            throw new CostQueryError('数据库中没有配方', 404);
        }
        const recipe = recipes.find(item => (
            String(item.name || '').includes(recipeName)
        ));
        if (!recipe) {
            throw new CostQueryError(
                `未找到名称包含 "${recipeName}" 的配方`,
                404
            );
        }
        const parts = parseRecipeParts(recipe.partsJson);
        const { partsCache, partsByModel } = loadPartsData();
        return {
            recipeId: recipe.id ?? recipe.Id,
            recipeName: recipe.name,
            recipeSpec: recipe.spec,
            ...calculateRecipeCost(parts, partsCache, partsByModel),
        };
    }

    function getCurrentRecipeCosts(now = new Date()) {
        const { partsCache, partsByModel } = loadPartsData();
        const coils = listCoils();
        return {
            asOf: now.toISOString(),
            sourceOfTruth: 'costEngine',
            basis: 'currentTemplateAndRecipeParameters',
            items: listRecipes().map(recipe => {
                const dependencies = {
                    partsCache,
                    partsByModel,
                    calculateRecipeCost,
                    coils,
                    getSetting,
                    buildBomDraft,
                };
                try {
                    return calculateCurrentRecipeCost(recipe, dependencies);
                } catch (error) {
                    if (!isRecoverableCurrentRecipeCostError(error)) throw error;
                    return buildCurrentRecipeCostFailure(recipe, error, dependencies);
                }
            }),
        };
    }

    function getRecipeCostById(rawRecipeId) {
        const recipe = recipeRow(
            db.prepare('SELECT * FROM recipes WHERE id = ?')
                .get(Number.parseInt(rawRecipeId, 10))
        );
        if (!recipe) {
            throw new CostQueryError(
                `配方ID ${rawRecipeId} 不存在`,
                404
            );
        }
        const parts = parseRecipeParts(recipe.partsJson);
        const { partsCache, partsByModel } = loadPartsData();
        return {
            recipeId: rawRecipeId,
            recipeName: recipe.name,
            recipeSpec: recipe.spec,
            ...calculateRecipeCost(parts, partsCache, partsByModel),
        };
    }

    function calculateCoil(input = {}) {
        const result = calculateCoilCost(listCoils(), input);
        if (!result.success) {
            throw new CostQueryError(
                result.error,
                result.status || 400,
                result.code || null,
                result.details
            );
        }
        return result.data;
    }

    function calculateFloat(input = {}) {
        const { partsByModel } = loadPartsData();
        return calculateFloatEstimate(input, partsByModel, getSetting);
    }

    function calculateCable(input = {}) {
        const { partsByModel } = loadPartsData();
        return calculateCableEstimate(input, partsByModel, getSetting);
    }

    function calculatePacking(input = {}) {
        const { partsByModel } = loadPartsData();
        return calculatePackingEstimate(input, partsByModel);
    }

    function calculateOverhead(input = {}) {
        return calculateOverheadEstimate(input);
    }

    function calculateDynamic(input = {}) {
        const {
            stator,
            statorSpec: rawSpec,
            statorSheets: rawSheets,
            statorMaterial = DEFAULT_COIL_MATERIAL,
            statorSlotType = '小眼',
            hasFloat,
            floatWire,
            floatAccessoryType = 'standard',
            hasCable,
            cableWire,
            cableLength,
            cableAccessoryType = 'standard',
            boxType,
        } = input;
        let statorSpec = rawSpec;
        let statorSheets = rawSheets;
        if (
            stator
            && typeof stator === 'string'
            && stator.includes('-')
        ) {
            const [spec, sheets] = stator.split('-');
            statorSpec = statorSpec || spec.trim();
            statorSheets = statorSheets || sheets.trim();
        }
        const { partsCache, partsByModel } = loadPartsData();
        const getPrice = createPartPriceGetter(partsByModel);
        const coils = listCoils();
        const dbWire = resolveWireFromCoils(
            coils,
            statorSpec,
            statorSheets,
            statorMaterial,
            statorSlotType
        );
        const resolvedWire = resolveWire(
            dbWire,
            cableWire || floatWire
        );
        const effectiveCableLength = (
            hasCable
            || (cableLength && Number(cableLength) > 0)
        ) ? cableLength : 0;
        const { totalCost, details } = calculateDynamicConfigCost(
            {
                hasFloat,
                floatWire,
                floatAccessoryType,
                cableLength: effectiveCableLength,
                cableWire,
                cableAccessoryType,
                boxType,
                resolvedWire,
            },
            {
                partsCache,
                partsByModel,
                getPrice,
                getSetting,
            }
        );
        return {
            totalCost: totalCost.toFixed(2),
            itemCount: details.length,
            resolvedWire,
            details,
        };
    }

    function previewRecipeCost(rawRecipeId, overrides = {}) {
        const row = db.prepare(`
            SELECT *
            FROM recipes
            WHERE id = ? AND deleted_at IS NULL
        `).get(rawRecipeId);
        if (!row) {
            throw new CostQueryError('Recipe not found', 404);
        }
        const { partsCache, partsByModel } = loadPartsData();
        const normalizedOverrides = normalizeRecipeConfigurationOverrides(overrides);
        const configurationPolicy = recipeConfigurationPolicyFromRecord(row);
        assertRecipeConfigurationAllowed({
            baseline: configurationSnapshotFromRecipeData(row),
            overrides: normalizedOverrides,
            policy: configurationPolicy,
        });
        const result = calculateRecipeCostPreview(
            row,
            normalizedOverrides,
            {
                partsCache,
                partsByModel,
                partsCatalog: Object.values(partsByModel).flat(),
                calculateRecipeCost,
                getCoils: listCoils,
                getSetting,
            }
        );
        return {
            recipeName: result.recipeName,
            data: {
                unitCost: result.unitCost,
                parts: result.parts,
                costSnapshot: result.costSnapshot,
                warnings: result.warnings || [],
                configurationPolicy,
                configurationPolicyMode: configurationPolicy ? 'explicit' : 'legacy_open',
                configurationSnapshot: configurationSnapshotFromRecipeData(result.recipeData),
            },
        };
    }

    function calculateFullEstimate(input = {}) {
        const {
            recipeId,
            recipeName,
            stator,
            cableLength = 0,
            floatAccessoryType = 'standard',
            cableAccessoryType = 'standard',
            boxType = '',
            hasFloat = false,
            floatWire,
            cableWire,
        } = input;
        const selectorName = String(recipeName || '').trim();
        const selectorId = Number(recipeId);
        if ((!Number.isInteger(selectorId) || selectorId <= 0) && !selectorName) {
            throw new CostQueryError(
                '完整成本估算必须提供 recipeId 或 recipeName；泵壳模板请使用泵壳成本试算能力',
                400,
                'FULL_ESTIMATE_RECIPE_REQUIRED'
            );
        }
        const recipes = listRecipes();
        const exactMatches = Number.isInteger(selectorId) && selectorId > 0
            ? recipes.filter(item => Number(item.id ?? item.Id) === selectorId)
            : recipes.filter(item => String(item.name || '').trim().toLowerCase() === selectorName.toLowerCase());
        const candidates = exactMatches.length > 0
            ? exactMatches
            : recipes.filter(item => String(item.name || '').toLowerCase().includes(selectorName.toLowerCase()));
        if (candidates.length === 0) {
            throw new CostQueryError(
                Number.isInteger(selectorId) && selectorId > 0
                    ? `未找到配方ID ${selectorId}`
                    : `未找到成品型号包含“${selectorName}”的配方；泵壳模板名不能作为成品型号`,
                404,
                'FULL_ESTIMATE_RECIPE_NOT_FOUND',
                { recipeId: Number.isInteger(selectorId) && selectorId > 0 ? selectorId : null, recipeName: selectorName || null }
            );
        }
        if (candidates.length > 1) {
            throw new CostQueryError(
                `成品型号“${selectorName}”匹配到 ${candidates.length} 条记录，请改用 recipeId 或完整型号`,
                409,
                'FULL_ESTIMATE_RECIPE_AMBIGUOUS',
                {
                    recipeName: selectorName,
                    candidates: candidates.slice(0, 10).map(item => ({
                        id: item.id ?? item.Id,
                        name: item.name,
                        spec: item.spec,
                    })),
                }
            );
        }
        const recipe = candidates[0];
        const overrides = {};
        if (stator) {
            const { statorSpec, statorSheets } = parseStatorInput(stator);
            overrides.coilSpec = statorSpec;
            overrides.coilSheets = statorSheets;
        }
        if (input.statorMaterial || input.material) {
            overrides.coilMaterial = input.statorMaterial || input.material;
        }
        if (input.statorSlotType || input.slotType) {
            overrides.coilSlotType = input.statorSlotType || input.slotType;
        }
        if (Object.prototype.hasOwnProperty.call(input, 'hasFloat')) overrides.hasFloat = hasFloat;
        if (floatWire) overrides.floatWire = floatWire;
        if (input.floatAccessoryType) overrides.floatAccessoryType = floatAccessoryType;
        if (Object.prototype.hasOwnProperty.call(input, 'cableLength')) {
            overrides.hasCable = Number(cableLength) > 0;
            overrides.cableLength = Number(cableLength || 0);
        }
        if (cableWire) overrides.cableWire = cableWire;
        if (input.cableAccessoryType) overrides.cableAccessoryType = cableAccessoryType;
        if (boxType) overrides.boxType = boxType;
        if (input.packingPartsJson) overrides.packingPartsJson = input.packingPartsJson;

        const preview = previewRecipeCost(recipe.id ?? recipe.Id, overrides);
        const totalCost = Number(preview.data.unitCost || 0);
        const coilPart = (preview.data.parts || []).find(part => part.costRole === 'coil');
        return {
            sourceOfTruth: 'costEngine',
            costBasis: Object.keys(overrides).length > 0 ? 'overridePreview' : 'currentFullCost',
            recipeCost: {
                recipeId: recipe.id ?? recipe.Id,
                recipeName: recipe.name,
                recipeSpec: recipe.spec,
                totalCost: totalCost.toFixed(2),
            },
            totalCost: totalCost.toFixed(2),
            parts: preview.data.parts,
            costSnapshot: preview.data.costSnapshot,
            warnings: preview.data.warnings || [],
            configurationSnapshot: preview.data.configurationSnapshot,
            ...(coilPart ? {
                statorCost: {
                    cost: Number(coilPart.snapshotPrice || 0).toFixed(2),
                    coilId: coilPart.coilId || null,
                    inventoryType: coilPart.inventoryType || (coilPart.coilId ? 'coil' : 'none'),
                    pricingMode: coilPart.pricingMode || 'calculated',
                    kitPrice: Number(coilPart.kitPrice || 0),
                    unitPrice: Number(coilPart.unitPrice || 0),
                    wireWeight: Number(coilPart.wireWeight || 0),
                    copperBase: Number(coilPart.copperBase || 0),
                    formula: coilPart.formula || '',
                    source: coilPart.coilCostSource || coilPart.source || '',
                },
            } : {}),
            compatibility: {
                deprecatedTool: 'full_calculate',
                replacement: 'preview_recipe_cost',
                managedRolesReplacedOnce: true,
            },
        };
    }

    function getRecipeDifference(input = {}) {
        return buildCostDifference(input, {
            recipes: listRecipes(),
            currentCostDependencies: {
                calculateRecipeCost,
                ...loadPartsData(),
                coils: listCoils(),
                getSetting,
                buildBomDraft,
            },
        });
    }

    return {
        calculateCable,
        calculateCoil,
        calculateDynamic,
        calculateFloat,
        calculateFullEstimate,
        calculateOverhead,
        calculatePacking,
        calculateParts,
        getCurrentRecipeCosts,
        getRecipeCostById,
        getRecipeCostByName,
        getRecipeDifference,
        previewRecipeCost,
    };
}

module.exports = {
    CostQueryError,
    createCostQueries,
    isRecoverableCurrentRecipeCostError,
};
