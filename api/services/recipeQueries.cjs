const { collapseLegacyCableParts } = require('./cableAccessory.cjs');
const { buildRecipeBomDraft } = require('./recipeBomEngine.cjs');
const { findPumpShellPart } = require('./pumpShellPartResolver.cjs');
const { normalizeOptionalBoolean } = require('./queryValidation.cjs');
const { parseJsonArray, parsePositiveId } = require('./validation.cjs');

class RecipeQueryError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.name = 'RecipeQueryError';
        this.statusCode = statusCode;
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
        const template = templateRow(
            db.prepare('SELECT * FROM pump_shell_templates WHERE id = ?').get(templateId)
        );
        if (!template) {
            return { template: null, shellMeta: null };
        }
        const shellPart = findPumpShellPart(db.prepare(`
            SELECT *
            FROM parts
            WHERE category = ?
              AND deleted_at IS NULL
            ORDER BY id
        `).all('泵壳'), template.shellModel);
        let shellMeta = null;
        try {
            shellMeta = shellPart?.remark ? JSON.parse(shellPart.remark) : null;
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
        const allRecipes = listRecipes();
        if (!keyword && hasTechnicalFiles === null) return allRecipes;
        const recipes = allRecipes.filter(recipe => (
            [recipe.name, recipe.spec]
                .some(value => !keyword || String(value || '').toLocaleLowerCase().includes(keyword))
        ));
        if (hasTechnicalFiles === null) return recipes;

        const technicalFileCounts = new Map(db.prepare(`
            SELECT recipe_id AS recipeId, COUNT(*) AS technicalFileCount
            FROM recipe_technical_files
            WHERE deleted_at IS NULL
            GROUP BY recipe_id
        `).all().map(row => [
            Number(row.recipeId),
            Number(row.technicalFileCount || 0),
        ]));
        return recipes
            .map(recipe => ({
                ...recipe,
                technicalFileCount: technicalFileCounts.get(Number(recipe.id)) || 0,
            }))
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
            db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipeId)
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
        const recipeRecord = db.prepare(`
            SELECT *
            FROM recipes
            WHERE id = ? AND deleted_at IS NULL
        `).get(recipeId);
        if (!recipeRecord) {
            throw new RecipeQueryError('配方不存在', 404);
        }
        const recipeParts = collapseLegacyCableParts(
            parseJsonArray(recipeRecord.parts_json || recipeRecord.partsJson)
        );
        const allParts = db.prepare(`
            SELECT *
            FROM parts
            WHERE deleted_at IS NULL
        `).all();
        const items = recipeParts.map(recipePart => {
            const model = String(recipePart?.model || '').trim();
            const supplier = String(recipePart?.supplier || '').trim();
            if (String(recipePart?.name || '').trim() === '线圈转子') {
                const coil = db.prepare(`
                    SELECT id, stock
                    FROM coils
                    WHERE spec = ?
                      AND sheets = ?
                      AND material = ?
                      AND slot_type = ?
                      AND scheme_status = 'official'
                    ORDER BY id DESC
                    LIMIT 1
                `).get(
                    String(recipeRecord.coil_spec || '').trim(),
                    Number(recipeRecord.coil_sheets || 0),
                    String(recipeRecord.coil_material || '钢带').trim() || '钢带',
                    String(recipeRecord.coil_slot_type || '小眼').trim() || '小眼'
                );
                const currentStock = coil ? Number(coil.stock || 0) : 0;
                return {
                    name: '线圈转子',
                    model,
                    supplier: '',
                    currentStock,
                    coilId: coil?.id,
                    inventoryType: 'coil',
                    status: !coil
                        ? 'missing'
                        : currentStock > 0
                            ? 'in_stock'
                            : 'out_of_stock',
                };
            }
            const matchedPart = allParts.find(part => (
                part.model === model
                && String(part.supplier || '') === supplier
            )) || allParts.find(part => part.model === model);
            const currentStock = matchedPart ? Number(matchedPart.stock || 0) : 0;
            return {
                name: String(recipePart?.name || model),
                model,
                supplier,
                currentStock,
                partId: matchedPart?.id,
                inventoryType: 'part',
                status: !matchedPart
                    ? 'missing'
                    : currentStock > 0
                        ? 'in_stock'
                        : 'out_of_stock',
            };
        });
        return {
            recipe: recipeRow(recipeRecord),
            items,
        };
    }

    function getBomDraft(input = {}) {
        const variantId = parsePositiveId(input?.modelVariantId);
        const variant = variantId
            ? modelVariantRow(db.prepare(`
                SELECT *
                FROM pump_model_variants
                WHERE id = ? AND deleted_at IS NULL
            `).get(variantId))
            : null;
        const templateId = input?.templateId ?? variant?.templateId;
        const { template, shellMeta } = loadTemplateContext(templateId);
        return buildBomDraft(input, {
            template,
            variant,
            shellMeta,
            partsCatalog: listParts(),
            coils: listCoils(),
            getSetting,
        });
    }

    function getModelVariantDraft(rawModelVariantId) {
        const modelVariantId = parsePositiveId(rawModelVariantId);
        if (!modelVariantId) {
            throw new RecipeQueryError('非法型号变体ID');
        }
        const variant = modelVariantRow(db.prepare(`
            SELECT *
            FROM pump_model_variants
            WHERE id = ? AND deleted_at IS NULL
        `).get(modelVariantId));
        if (!variant) {
            throw new RecipeQueryError('型号变体不存在', 404);
        }
        const { template } = loadTemplateContext(variant.templateId);
        const paintingWage = template?.paintingWage ?? null;
        const recipeDraft = {
            name: variant.modelName || '',
            spec: variant.note || '',
            templateId: variant.templateId,
            modelVariantId: variant.id,
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
