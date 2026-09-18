const { hydrateCatalogRow } = require('./catalogLiveReferences.cjs');
const { inspectRecipeInventory } = require('./recipeInventory.cjs');
const { resolveCatalogPartIdentity } = require('./bomPartIdentity.cjs');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const INVENTORY_CAPABILITY_ID = requireBusinessCapability('recipes.inventory_status').capabilityId;
const { selectRecipeBaseline, applyRecipeBaseline } = require('./recipeConfigurationBaseline.cjs');
const { collapseLegacyCableParts } = require('./cableAccessory.cjs');
const { buildRecipeBomDraft } = require('./recipeBomEngine.cjs');
const { buildRecipeCostDraft, findUnpricedRecipeParts } = require('./costEngine.cjs');
const { resolvePumpShellPart } = require('./pumpShellPartResolver.cjs');
const { normalizeOptionalBoolean } = require('./queryValidation.cjs');
const { parseJsonArray, parsePositiveId } = require('./validation.cjs');

class RecipeQueryError extends Error {
    constructor(message, statusCode = 400, code = null, details = undefined) {
        super(message);
        this.name = 'RecipeQueryError';
        this.statusCode = statusCode;
        if (code) this.code = code;
        if (details !== undefined) this.details = details;
    }
}

function createRecipeQueries({
    db,
    listCoils,
    listParts,
    listRecipes,
    modelVariantRow,
    recipeRow,
    templateRow,
    getSetting = () => undefined,
    buildBomDraft = buildRecipeBomDraft,
} = {}) {
    if (!db || typeof db.prepare !== 'function') {
        throw new Error('配方查询服务缺少数据库依赖');
    }
    for (const [name, dependency] of Object.entries({
        listCoils,
        listParts,
        listRecipes,
        modelVariantRow,
        recipeRow,
        templateRow,
        buildBomDraft,
    })) {
        if (typeof dependency !== 'function') {
            throw new Error(`配方查询服务缺少 ${name}`);
        }
    }

    function loadTemplateContext(rawTemplateId) {
        const templateId = parsePositiveId(rawTemplateId);
        if (!templateId) {
            return { template: null, shellMeta: null };
        }
        const rawTemplate = db.prepare('SELECT * FROM pump_shell_templates WHERE id = ?').get(templateId);
        const template = rawTemplate && !rawTemplate.deleted_at ? templateRow(rawTemplate) : null;
        if (!template) {
            return { template: null, shellMeta: null };
        }
        const shellPart = resolvePumpShellPart(db.prepare(`
            SELECT *
            FROM parts
            WHERE category = ?
              AND deleted_at IS NULL
            ORDER BY id
        `).all('泵壳'), template.shellModel, template.shellPartId);
        let shellMeta = null;
        try {
            shellMeta = shellPart?.remark ? JSON.parse(hydrateCatalogRow(db, 'part', shellPart).remark) : null;
        } catch {
            shellMeta = null;
        }
        return { template, shellMeta };
    }

    function getAllRecipes(options = {}) {
        const keyword = String(options.keyword || '').trim().toLocaleLowerCase();
        const hasTechnicalFiles = normalizeOptionalBoolean(
            options.hasTechnicalFiles,
            'hasTechnicalFiles'
        );
        const technicalFileCounts = new Map(db.prepare(`
            SELECT recipe_id AS recipeId, COUNT(*) AS technicalFileCount
            FROM recipe_technical_files
            WHERE deleted_at IS NULL
            GROUP BY recipe_id
        `).all().map(row => [
            Number(row.recipeId),
            Number(row.technicalFileCount || 0),
        ]));
        const allRecipes = listRecipes().map(recipe => ({
            ...recipe,
            technicalFileCount: technicalFileCounts.get(Number(recipe.id)) || 0,
        }));
        const recipes = allRecipes.filter(recipe => (
            [recipe.name, recipe.spec]
                .some(value => !keyword || String(value || '').toLocaleLowerCase().includes(keyword))
        ));
        if (hasTechnicalFiles === null) return recipes;
        return recipes
            .filter(recipe => (
                hasTechnicalFiles
                    ? recipe.technicalFileCount > 0
                    : recipe.technicalFileCount === 0
            ));
    }

    function getRecipe(rawRecipeId) {
        const recipeId = parsePositiveId(rawRecipeId);
        if (!recipeId) {
            throw new RecipeQueryError('非法配方ID');
        }
        const recipe = recipeRow(
            db.prepare(`
                SELECT *
                FROM recipes
                WHERE id = ? AND deleted_at IS NULL
            `).get(recipeId)
        );
        if (!recipe) {
            throw new RecipeQueryError('配方不存在', 404);
        }
        return recipe;
    }

    function getInventoryStatus(rawRecipeId) {
        const recipeId = parsePositiveId(rawRecipeId);
        if (!recipeId) {
            throw new RecipeQueryError('非法配方ID');
        }
        return db.transaction(() => {
            const recipeRecord = hydrateCatalogRow(db, 'recipe', db.prepare('SELECT * FROM recipes WHERE id = ? AND deleted_at IS NULL').get(recipeId));
            if (!recipeRecord) throw new RecipeQueryError('配方不存在', 404);
            let parts;
            try { parts = JSON.parse(recipeRecord.parts_json || '[]'); } catch {
                throw new RecipeQueryError('配方 BOM 数据损坏，不能核对库存', 422, 'RECIPE_BOM_INVALID');
            }
            if (!Array.isArray(parts) || parts.some(part => !part || typeof part !== 'object' || Array.isArray(part))) {
                throw new RecipeQueryError('配方 BOM 必须为配件对象数组', 422, 'RECIPE_BOM_INVALID');
            }
            if (parts.length > 10000) throw new RecipeQueryError('配方 BOM 超过库存查询上限', 413, 'RECIPE_BOM_LIMIT_EXCEEDED');
            const recipeParts = collapseLegacyCableParts(parts);
            const items = inspectRecipeInventory(recipeParts,
                db.prepare('SELECT * FROM parts').all(), db.prepare('SELECT * FROM coils').all(), recipeRecord);
            return { recipe: recipeRow(recipeRecord), items, sourceOfTruth: INVENTORY_CAPABILITY_ID };
        }).deferred();
    }

    function getBomDraft(input = {}) {
        for (const field of ['floatPartId', 'cablePartId']) {
            if (input[field] != null && (!Number.isSafeInteger(input[field]) || input[field] <= 0)) throw new RecipeQueryError(`${field} 必须为正安全整数`, 400, 'WIRE_PART_ID_INVALID');
        }
        const explicitBaseline = input.baseRecipeId !== undefined ? selectRecipeBaseline(listRecipes(), input, input.templateId) : null;
        const variantId = parsePositiveId(input?.modelVariantId);
        if (input?.modelVariantId != null && !variantId) {
            throw new RecipeQueryError('非法常用配置预设编号');
        }
        const variant = variantId
            ? modelVariantRow(db.prepare(`
                SELECT *
                FROM pump_model_variants
                WHERE id = ? AND deleted_at IS NULL
            `).get(variantId))
            : null;
        if (variantId && !variant) {
            throw new RecipeQueryError('常用配置预设不存在', 404, 'MODEL_VARIANT_NOT_FOUND');
        }
        const shellModel = String(input?.shellModel || '').trim();
        let templateId = input?.templateId ?? variant?.templateId ?? explicitBaseline?.templateId;
        if (input?.templateId != null && !parsePositiveId(input.templateId)) {
            throw new RecipeQueryError('非法泵壳模板ID');
        }
        if (!templateId && shellModel) {
            const templates = db.prepare('SELECT * FROM pump_shell_templates ORDER BY id').all()
                .filter(row => !row.deleted_at)
                .map(templateRow);
            const exact = templates.filter(item => (
                String(item?.shellModel || '').trim().toLocaleLowerCase() === shellModel.toLocaleLowerCase()
            ));
            const candidates = exact.length > 0
                ? exact
                : templates.filter(item => (
                    String(item?.shellModel || '').toLocaleLowerCase().includes(shellModel.toLocaleLowerCase())
                ));
            if (candidates.length !== 1) {
                throw new RecipeQueryError(
                    candidates.length > 1
                        ? `泵壳模板“${shellModel}”匹配到多条记录，请使用完整型号`
                        : `泵壳模板“${shellModel}”不存在`,
                    candidates.length > 1 ? 409 : 404,
                    candidates.length > 1 ? 'PUMP_SHELL_TEMPLATE_AMBIGUOUS' : 'PUMP_SHELL_TEMPLATE_NOT_FOUND',
                    {
                        shellModel,
                        candidates: candidates.slice(0, 12).map(item => ({
                            templateId: item.id ?? item.Id,
                            shellModel: item.shellModel,
                            description: item.description || '',
                        })),
                    }
                );
            }
            templateId = candidates[0].id ?? candidates[0].Id;
        }
        const { template, shellMeta } = loadTemplateContext(templateId);
        if (templateId && !template) {
            throw new RecipeQueryError('泵壳模板不存在', 404, 'PUMP_SHELL_TEMPLATE_NOT_FOUND', {
                templateId: Number(templateId),
            });
        }
        const hasStandaloneConfiguration = Boolean(
            input.coilSpec
            || input.coilSheets
            || input.hasFloat
            || input.hasCable
            || parseJsonArray(input.packingParts || input.packingPartsJson).length > 0
            || parseJsonArray(input.optionalParts || input.extraParts).length > 0
        );
        if (!template && !variant && !hasStandaloneConfiguration) {
            throw new RecipeQueryError(
                'BOM 草稿必须提供正式泵壳模板、常用配置预设或至少一项有效配置',
                400,
                'RECIPE_BOM_CONFIGURATION_REQUIRED'
            );
        }
        const partsCatalog = listParts();
        const useRecipeBaseline = normalizeOptionalBoolean(input.useRecipeBaseline, 'useRecipeBaseline') === true || input.baseRecipeId !== undefined;
        let baselineRecipe = null, configurationBasis = null;
        if (useRecipeBaseline && template) {
            if (variant) throw new RecipeQueryError('基准配方与常用预设不能同时指定', 400, 'RECIPE_BASELINE_VARIANT_CONFLICT');
            baselineRecipe = selectRecipeBaseline(listRecipes(), input, templateId);
            if (baselineRecipe) {
                const applied = applyRecipeBaseline(baselineRecipe, input, partsCatalog);
                input = applied.input;
                configurationBasis = applied.basis;
            } else configurationBasis = { source: 'template', configurationComplete: false, note: '没有匹配的在售配方，仅计算明确传入的配置；未指定配套项尚未确认，不能作为完整成品成本。' };
        }
        const normalizeConfiguredParts = (value, field, recipeField) => {
            const selections = parseJsonArray(value);
            return selections.map((selection) => {
                if (selection?.partId != null && selection.costSource !== 'manual') {
                    const matched = resolveCatalogPartIdentity(partsCatalog, selection, { field });
                    const supplier = String(selection.supplier || '').trim();
                    if (supplier && supplier !== String(matched.supplier || '').trim()) {
                        throw new RecipeQueryError(`${field} 的供应商与零件 ID 不一致`, 422, 'BOM_PART_ID_SUPPLIER_MISMATCH');
                    }
                    if (recipeField === 'packingPartsJson' && matched.category !== '包装') {
                        throw new RecipeQueryError('包装引用必须属于包装分类', 422, 'BOM_PART_CATEGORY_MISMATCH');
                    }
                    return { ...selection, model: matched.model, supplier: matched.supplier || '', resolutionSource: 'catalog_id' };
                }
                const query = String(selection?.model || '').trim();
                if (!query) return selection;
                const supplier = String(selection?.supplier || '').trim();
                const exact = partsCatalog.filter(part => (
                    String(part.model || '').trim().toLocaleLowerCase() === query.toLocaleLowerCase()
                    && (!supplier || String(part.supplier || '').trim() === supplier)
                ));
                let matches = exact;
                let resolutionSource = exact.length === 1 ? 'catalog_exact' : '';
                let resolutionRecipes = [];
                if (matches.length === 0) {
                    const configuredModels = new Set();
                    for (const recipe of listRecipes()) {
                        if (Number(recipe.templateId || 0) !== Number(templateId || 0)) continue;
                        for (const configured of parseJsonArray(recipe[recipeField])) {
                            const model = String(configured?.model || '').trim();
                            if (model.toLocaleLowerCase().includes(query.toLocaleLowerCase())) {
                                configuredModels.add(model);
                                resolutionRecipes.push({
                                    recipeId: recipe.id ?? recipe.Id,
                                    recipeName: recipe.name || '',
                                    model,
                                });
                            }
                        }
                    }
                    if (configuredModels.size === 1) {
                        const [configuredModel] = configuredModels;
                        matches = partsCatalog.filter(part => (
                            String(part.model || '').trim() === configuredModel
                            && (!supplier || String(part.supplier || '').trim() === supplier)
                        ));
                        if (matches.length === 1) resolutionSource = 'template_recipe_consensus';
                    }
                }
                if (matches.length === 0) {
                    matches = partsCatalog.filter(part => (
                        String(part.model || '').toLocaleLowerCase().includes(query.toLocaleLowerCase())
                        && (!supplier || String(part.supplier || '').trim() === supplier)
                    ));
                    if (matches.length === 1) resolutionSource = 'catalog_unique_partial';
                }
                if (matches.length !== 1) {
                    throw new RecipeQueryError(
                        matches.length > 1
                            ? `${field}“${query}”匹配到多条正式零件，请选择完整型号`
                            : `${field}“${query}”未匹配到正式零件`,
                        matches.length > 1 ? 409 : 404,
                        matches.length > 1 ? 'CONFIGURED_PART_AMBIGUOUS' : 'CONFIGURED_PART_NOT_FOUND',
                        {
                            field,
                            query,
                            candidates: matches.slice(0, 12).map(part => ({
                                partId: part.id ?? part.Id,
                                model: part.model,
                                supplier: part.supplier || '',
                                price: Number(part.price || 0),
                            })),
                        }
                    );
                }
                const matched = matches[0];
                return {
                    ...selection,
                    partId: matched.id ?? matched.Id,
                    model: matched.model,
                    supplier: matched.supplier || '',
                    resolution: {
                        source: resolutionSource || 'catalog_exact',
                        query,
                        ...(resolutionSource === 'template_recipe_consensus'
                            ? { recipes: resolutionRecipes }
                            : {}),
                    },
                };
            });
        };
        const normalizedInput = {
            ...input,
            packingParts: normalizeConfiguredParts(
                input.packingParts || input.packingPartsJson,
                '包装项目',
                'packingPartsJson'
            ),
            optionalParts: normalizeConfiguredParts(
                input.optionalParts || input.extraParts,
                '可选零件',
                'extraPartsJson'
            ),
        };
        const draft = buildBomDraft(normalizedInput, {
            template,
            variant,
            shellMeta,
            partsCatalog,
            coils: listCoils(),
            getSetting,
        });
        const surfaceTreatmentMode = (baselineRecipe ? input.surfaceTreatmentMode : undefined) || baselineRecipe?.surfaceTreatmentMode || template?.surfaceTreatmentMode
            || (template?.paintingWage != null ? 'painting' : 'none');
        const costDraft = buildRecipeCostDraft({
            parts: draft.parts || [],
            customBarrelLength: draft.customBarrelLength ?? normalizedInput.customBarrelLength,
            longScrewExtraLength: draft.longScrewExtraLength ?? normalizedInput.longScrewExtraLength,
            assemblyWage: Number(baselineRecipe?.assemblyWage ?? template?.assemblyWage ?? 0),
            packingWage: Number(baselineRecipe?.packingWage ?? template?.packingWage ?? 0),
            surfaceTreatmentMode,
            surfaceTreatmentCost: surfaceTreatmentMode === 'none'
                ? 0
                : Number((baselineRecipe ? input.surfaceTreatmentCost : undefined) ?? baselineRecipe?.surfaceTreatmentCost ?? baselineRecipe?.paintingWage ?? template?.surfaceTreatmentCost ?? template?.paintingWage ?? 0),
            managementFee: Number(baselineRecipe?.managementFee ?? getSetting('management_fee') ?? 0),
            coilMaterial: normalizedInput.coilMaterial || variant?.coilMaterial || '钢带',
        }, { partsCatalog });
        const unpricedParts = findUnpricedRecipeParts(costDraft.parts);
        return {
            ...draft,
            parts: costDraft.parts,
            ...(configurationBasis ? { configurationBasis } : {}),
            costPreview: {
                sourceOfTruth: 'costEngine',
                costBasis: 'configuredBomDraft',
                pricingComplete: unpricedParts.length === 0,
                currentTotalCost: unpricedParts.length === 0 ? costDraft.savedTotalCost : null,
                partsCost: costDraft.partsCost,
                laborCost: costDraft.laborCost,
                missingParts: unpricedParts.map(part => ({
                    partId: part.partId || null,
                    model: part.model || '',
                    supplier: part.supplier || '',
                    qty: Number(part.qty || 1),
                })),
                details: costDraft.savedCostDetails,
            },
        };
    }

    function getModelVariantDraft(rawModelVariantId) {
        const modelVariantId = parsePositiveId(rawModelVariantId);
        if (!modelVariantId) {
            throw new RecipeQueryError('非法常用配置预设编号');
        }
        const variant = modelVariantRow(db.prepare(`
            SELECT *
            FROM pump_model_variants
            WHERE id = ? AND deleted_at IS NULL
        `).get(modelVariantId));
        if (!variant) {
            throw new RecipeQueryError('常用配置预设不存在', 404);
        }
        const { template } = loadTemplateContext(variant.templateId);
        const paintingWage = template?.paintingWage ?? null;
        const recipeDraft = {
            name: variant.modelName || '',
            spec: variant.note || '',
            templateId: variant.templateId,
            modelVariantId: variant.id,
            coilId: variant.coilId || null,
            coilSchemeFamilyCode: variant.coilSchemeFamilyCode || '',
            coilSpec: variant.coilSpec || '',
            coilSheets: variant.coilSheets || 0,
            coilMaterial: variant.coilMaterial || '钢带',
            coilSlotType: variant.coilSlotType || '小眼',
            customBarrelLength: variant.barrelLength ?? null,
            longScrewExtraLength: variant.longScrewExtraLength || 0,
            impellerModel: variant.impellerModel || '',
            impellerThickness: variant.impellerThickness ?? null,
            impellerDiameter: variant.impellerDiameter ?? null,
            impellerBladeCount: variant.impellerBladeCount ?? null,
            assemblyWage: template?.assemblyWage || 0,
            packingWage: template?.packingWage || 0,
            paintingWage,
            surfaceTreatmentMode: (
                template?.surfaceTreatmentMode
                || (paintingWage != null ? 'painting' : 'none')
            ),
            surfaceTreatmentCost: (
                template?.surfaceTreatmentCost
                ?? (paintingWage != null ? Number(paintingWage) || 0 : 0)
            ),
        };
        return { recipeDraft, variant, template };
    }

    return {
        getAllRecipes,
        getBomDraft,
        getInventoryStatus,
        getModelVariantDraft,
        getRecipe,
        loadTemplateContext,
    };
}

module.exports = {
    RecipeQueryError,
    createRecipeQueries,
};
