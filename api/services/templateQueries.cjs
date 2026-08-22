const { parsePositiveId } = require('./validation.cjs');
const {
    normalizeOptionalLimit,
    normalizeQueryText,
} = require('./queryValidation.cjs');

class TemplateQueryError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.name = 'TemplateQueryError';
        this.statusCode = statusCode;
    }
}

function parseJson(value, fallback) {
    if (!value) return fallback;
    try {
        return typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
        return fallback;
    }
}

function createTemplateQueries({
    db,
    calculateRecipeCost,
    listTemplates,
    loadPartsData,
    normalizeSurfaceTreatmentMode,
    recipeRow,
    shellComponentCategory,
    templateRow,
} = {}) {
    if (!db || typeof db.prepare !== 'function') {
        throw new Error('泵壳模板查询服务缺少数据库依赖');
    }
    for (const [name, dependency] of Object.entries({
        calculateRecipeCost,
        listTemplates,
        loadPartsData,
        normalizeSurfaceTreatmentMode,
        recipeRow,
        templateRow,
    })) {
        if (typeof dependency !== 'function') {
            throw new Error(`泵壳模板查询服务缺少 ${name}`);
        }
    }
    if (!shellComponentCategory) {
        throw new Error('泵壳模板查询服务缺少 shellComponentCategory');
    }

    function requireTemplateId(rawTemplateId) {
        const templateId = parsePositiveId(rawTemplateId);
        if (!templateId) {
            throw new TemplateQueryError('非法模板ID');
        }
        return templateId;
    }

    function loadRawTemplate(rawTemplateId) {
        const templateId = requireTemplateId(rawTemplateId);
        const template = db.prepare(
            'SELECT * FROM pump_shell_templates WHERE id = ?'
        ).get(templateId);
        if (!template) {
            throw new TemplateQueryError('模板不存在', 404);
        }
        return template;
    }

    function componentCatalogPrice(component, partsByModel = {}) {
        const model = String(component?.model || '').trim();
        const supplier = String(component?.supplier || '').trim();
        const candidates = (partsByModel[model] || [])
            .filter(part => part.category === shellComponentCategory);
        const exact = supplier
            ? candidates.find(part => part.supplier === supplier)
            : null;
        const fallback = exact
            || candidates.find(part => Number(part.price || 0) > 0);
        return Number(fallback?.price || 0);
    }

    function buildTemplateCostParts(template, fixedParts, partsByModel = {}) {
        const mode = template.cost_mode || 'components';
        if (mode === 'bundle') {
            return [
                {
                    model: template.shell_model,
                    name: '泵壳套件',
                    supplier: '',
                    qty: 1,
                    snapshotPrice: Number(template.bundle_cost || 0),
                    source: 'pump_shell_template',
                    costSource: 'manual',
                },
                ...fixedParts.map(part => ({
                    ...part,
                    supplier: part.supplier || '',
                })),
            ];
        }

        const components = parseJson(template.shell_components_json, [])
            .filter(component => (
                component
                && component.name
                && component.included !== false
            ))
            .map(component => {
                const catalogPrice = componentCatalogPrice(
                    component,
                    partsByModel
                );
                const isSubassembly = component.componentType === 'subassembly';
                const subassemblyContents = isSubassembly
                    && Array.isArray(component.subassemblyContents)
                    ? component.subassemblyContents
                    : [];
                return {
                    model: component.model || component.name,
                    name: component.name,
                    supplier: component.supplier || '',
                    qty: Number(component.qty || 1),
                    snapshotPrice: catalogPrice
                        || Number(component.unitCost || 0),
                    source: 'pump_shell_template',
                    costSource: catalogPrice > 0 ? 'catalog' : 'manual',
                    ...(isSubassembly ? {
                        componentType: 'subassembly',
                        subassemblyContents,
                        inventoryType: 'part',
                        formula: `${component.name}: ${catalogPrice || Number(component.unitCost || 0)}×${Number(component.qty || 1)}（包含：${subassemblyContents.map(item => `${item.name}×${item.qty}`).join('、')}；子项不单独计价）`,
                    } : {}),
                };
            });

        return [
            ...components,
            ...fixedParts.map(part => ({
                ...part,
                supplier: part.supplier || '',
            })),
        ];
    }

    function loadCostContext(rawTemplateId) {
        const rawTemplate = loadRawTemplate(rawTemplateId);
        const fixedParts = parseJson(rawTemplate.parts_json, []);
        const { partsCache, partsByModel } = loadPartsData();
        const cost = calculateRecipeCost(
            buildTemplateCostParts(rawTemplate, fixedParts, partsByModel),
            partsCache,
            partsByModel
        );
        return {
            cost,
            fixedParts,
            partsByModel,
            rawTemplate,
        };
    }

    function getAllTemplates(options = {}) {
        const shellModel = normalizeQueryText(options.shellModel, 'shellModel').toLocaleLowerCase();
        const description = normalizeQueryText(options.description, 'description').toLocaleLowerCase();
        const limit = normalizeOptionalLimit(options.limit);
        const templates = listTemplates().filter(template => (
            (!shellModel || String(template.shellModel || '').toLocaleLowerCase().includes(shellModel))
            && (!description || String(template.description || '').toLocaleLowerCase().includes(description))
        ));
        return limit ? templates.slice(0, limit) : templates;
    }

    function getTemplate(rawTemplateId) {
        return templateRow(loadRawTemplate(rawTemplateId));
    }

    function getTemplateCost(rawTemplateId) {
        const { cost, rawTemplate } = loadCostContext(rawTemplateId);
        return {
            templateId: rawTemplate.id,
            shellModel: rawTemplate.shell_model,
            ...cost,
        };
    }

    function getDefaultRecipe(rawTemplateId) {
        const {
            cost,
            fixedParts: parts,
            rawTemplate,
        } = loadCostContext(rawTemplateId);
        const template = templateRow(rawTemplate);
        const rotorParams = parseJson(template.rotorParamsJson, {});
        return {
            template,
            recipeDraft: {
                name: template.shellModel,
                spec: template.description || '',
                templateId: template.id,
                partsJson: JSON.stringify(parts),
                assemblyWage: template.assemblyWage || 0,
                packingWage: template.packingWage || 0,
                paintingWage: template.paintingWage,
                surfaceTreatmentMode: normalizeSurfaceTreatmentMode(
                    template.surfaceTreatmentMode,
                    template.paintingWage
                ),
                surfaceTreatmentCost: template.surfaceTreatmentCost || 0,
                configurationPolicyJson: template.configurationPolicyJson || null,
            },
            parts,
            rotorParams,
            cost,
        };
    }

    function applyTemplate(rawTemplateId, baseRecipe = {}) {
        const template = getTemplate(rawTemplateId);
        const parts = parseJson(template.partsJson, []);
        const recipeDraft = {
            ...baseRecipe,
            templateId: template.id,
            partsJson: JSON.stringify(parts),
            assemblyWage: baseRecipe.assemblyWage
                ?? template.assemblyWage
                ?? 0,
            packingWage: baseRecipe.packingWage
                ?? template.packingWage
                ?? 0,
            paintingWage: baseRecipe.paintingWage
                ?? template.paintingWage
                ?? null,
            surfaceTreatmentMode: baseRecipe.surfaceTreatmentMode
                ?? normalizeSurfaceTreatmentMode(
                    template.surfaceTreatmentMode,
                    template.paintingWage
                ),
            surfaceTreatmentCost: baseRecipe.surfaceTreatmentCost
                ?? template.surfaceTreatmentCost
                ?? 0,
            configurationPolicyJson: baseRecipe.configurationPolicyJson
                ?? template.configurationPolicyJson
                ?? null,
        };
        return {
            template,
            recipeDraft,
            parts,
            rotorParams: parseJson(template.rotorParamsJson, {}),
        };
    }

    function getTemplateRecipes(rawTemplateId) {
        const templateId = requireTemplateId(rawTemplateId);
        return db.prepare(
            'SELECT * FROM recipes WHERE template_id = ?'
        ).all(templateId).map(recipeRow);
    }

    return {
        applyTemplate,
        getAllTemplates,
        getDefaultRecipe,
        getTemplate,
        getTemplateCost,
        getTemplateRecipes,
    };
}

module.exports = {
    TemplateQueryError,
    createTemplateQueries,
};
