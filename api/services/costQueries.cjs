const {
    calculatePackingEstimate,
    calculateOverheadEstimate,
    createPartPriceGetter,
} = require('./costEngine.cjs');
const { calculateCoilCost } = require('./coilCost.cjs');
const { calculateRecipeCostPreview } = require('./dynamicCostPreview.cjs');
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
    calculateFullEstimateCoilCost,
    buildFullEstimateResult,
} = require('./fullCostEstimate.cjs');
const { calculateCurrentRecipeCost } = require('./currentRecipeCost.cjs');

class CostQueryError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.name = 'CostQueryError';
        this.statusCode = statusCode;
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
            items: listRecipes().map(recipe => calculateCurrentRecipeCost(
                recipe,
                {
                    partsCache,
                    partsByModel,
                    calculateRecipeCost,
                    coils,
                    getSetting,
                }
            )),
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
                result.status || 400
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
        const result = calculateRecipeCostPreview(
            row,
            overrides,
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
            },
        };
    }

    function calculateFullEstimate(input = {}) {
        const {
            pumphousing_model,
            stator,
            cableLength = 0,
            floatAccessoryType = 'standard',
            cableAccessoryType = 'standard',
            boxType = '',
            hasFloat = false,
            floatWire,
            cableWire,
        } = input;
        const statorMaterial = (
            input.statorMaterial
            || input.material
            || DEFAULT_COIL_MATERIAL
        );
        const statorSlotType = (
            input.statorSlotType
            || input.slotType
            || '小眼'
        );
        const { partsCache, partsByModel } = loadPartsData();
        const getPrice = createPartPriceGetter(partsByModel);
        let recipeCost = null;

        if (pumphousing_model) {
            try {
                const recipe = listRecipes().find(item => (
                    String(item.name || '').includes(pumphousing_model)
                ));
                if (recipe) {
                    const parts = (() => {
                        try {
                            return JSON.parse(recipe.partsJson || '[]');
                        } catch {
                            return [];
                        }
                    })();
                    recipeCost = {
                        recipeName: recipe.name,
                        recipeSpec: recipe.spec,
                        ...calculateRecipeCost(
                            parts,
                            partsCache,
                            partsByModel
                        ),
                    };
                } else {
                    recipeCost = {
                        error: `未找到名称包含 "${pumphousing_model}" 的配方`,
                    };
                }
            } catch (error) {
                recipeCost = {
                    error: `查询配方失败: ${error.message}`,
                };
            }
        }

        const { statorSpec, statorSheets } = parseStatorInput(stator);
        const coils = listCoils();
        const statorCost = calculateFullEstimateCoilCost(
            coils,
            statorSpec,
            statorSheets,
            statorMaterial,
            statorSlotType
        );
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
        const dynamic = calculateDynamicConfigCost(
            {
                hasFloat,
                floatWire,
                floatAccessoryType,
                cableLength,
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
        return buildFullEstimateResult({
            recipeCost,
            statorCost,
            dynamicCost: {
                totalCost: dynamic.totalCost.toFixed(2),
                resolvedWire,
                details: dynamic.details,
            },
        });
    }

    function getRecipeDifference(input = {}) {
        return buildCostDifference(input, {
            dbAccessors: {
                calculateRecipeCost,
                loadPartsData,
            },
            recipes: listRecipes(),
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
};
