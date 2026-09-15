const { parsePositiveId } = require('./validation.cjs');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
requireBusinessCapability('rotor.template_draft');
requireBusinessCapability('rotor.recipe_draft');
const {
    buildRotorRecipeDraft,
    buildRotorTemplateDraft,
} = require('./rotorTemplateDraft.cjs');

class RotorQueryError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = 'RotorQueryError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function rotorQueryError(code, message, statusCode = 400) {
    return new RotorQueryError(code, message, statusCode);
}

function parseItems(value) {
    try {
        const items = JSON.parse(value || '[]');
        return Array.isArray(items) ? items : [];
    } catch {
        return [];
    }
}

function listOrderPumpModels(db) {
    const orders = db.prepare(`
        SELECT id, customer_name, contract_no, items_json
        FROM orders
        ORDER BY updated_at DESC
    `).all();
    const models = [];
    for (const row of orders) {
        for (const item of parseItems(row.items_json)) {
            if (!item?.recipeName) continue;
            models.push({
                orderId: row.id,
                customerName: row.customer_name || '',
                contractNo: row.contract_no || '',
                recipeName: item.recipeName,
                spec: item.spec || '',
            });
        }
    }
    return models;
}

function buildRecipeRotorDraft(db, recipeIdValue) {
    const recipeId = parsePositiveId(recipeIdValue);
    if (!recipeId) {
        throw rotorQueryError(
            'recipe_id_invalid',
            'recipeId 为必填',
            400
        );
    }
    const recipe = db.prepare(`
        SELECT *
        FROM recipes
        WHERE id = ? AND deleted_at IS NULL
    `).get(recipeId);
    if (!recipe) {
        throw rotorQueryError('recipe_not_found', '配方不存在', 404);
    }
    const template = recipe.template_id
        ? db.prepare(
            'SELECT * FROM pump_shell_templates WHERE id = ?'
        ).get(recipe.template_id)
        : null;
    const variant = recipe.model_variant_id
        ? db.prepare(`
            SELECT *
            FROM pump_model_variants
            WHERE id = ? AND deleted_at IS NULL
        `).get(recipe.model_variant_id)
        : null;
    const parts = db.prepare(`
        SELECT *
        FROM parts
        WHERE deleted_at IS NULL
    `).all();
    return {
        ...buildRotorRecipeDraft({ recipe, template, variant, parts }),
        recipeId,
        templateId: recipe.template_id || null,
        variantId: recipe.model_variant_id || null,
    };
}

function buildTemplateRotorDraft(
    db,
    templateIdValue,
    variantIdValue = null
) {
    const templateId = parsePositiveId(templateIdValue);
    if (!templateId) {
        throw rotorQueryError(
            'template_id_invalid',
            'templateId 为必填',
            400
        );
    }
    const template = db.prepare(
        'SELECT * FROM pump_shell_templates WHERE id = ?'
    ).get(templateId);
    if (!template) {
        throw rotorQueryError('template_not_found', '模板不存在', 404);
    }

    let variant = null;
    let variantId = null;
    if (variantIdValue !== undefined
        && variantIdValue !== null
        && variantIdValue !== '') {
        variantId = parsePositiveId(variantIdValue);
        if (!variantId) {
            throw rotorQueryError(
                'variant_id_invalid',
                'variantId 非法',
                400
            );
        }
        variant = db.prepare(`
            SELECT *
            FROM pump_model_variants
            WHERE id = ? AND deleted_at IS NULL
        `).get(variantId);
        if (!variant) {
            throw rotorQueryError(
                'variant_not_found',
                '常用配置预设不存在',
                404
            );
        }
        if (Number(variant.template_id) !== Number(templateId)) {
            throw rotorQueryError(
                'variant_template_mismatch',
                '常用配置预设不属于该模板',
                400
            );
        }
    }

    const parts = db.prepare(`
        SELECT *
        FROM parts
        WHERE deleted_at IS NULL
    `).all();
    return {
        ...buildRotorTemplateDraft({ template, variant, parts }),
        templateId,
        variantId,
    };
}

function listRotorLinkTargets(db) {
    const targets = [];
    const orders = db.prepare(`
        SELECT id, customer_name, contract_no, items_json
        FROM orders
        WHERE deleted_at IS NULL
        ORDER BY updated_at DESC
    `).all();
    for (const row of orders) {
        for (const item of parseItems(row.items_json)) {
            if (!item?.recipeName) continue;
            const label = item.recipeName
                + (item.spec ? ` (${item.spec})` : '');
            targets.push({
                type: 'order',
                id: `${row.id}:${item.recipeName}`,
                label,
                value: `订单:${label}`,
                secondary: `订单#${row.id} - ${row.customer_name || ''}${row.contract_no ? ` / ${row.contract_no}` : ''}`,
            });
        }
    }

    const variants = db.prepare(`
        SELECT v.id, v.model_name, v.barrel_length, v.coil_spec,
               v.coil_sheets, t.shell_model
        FROM pump_model_variants v
        LEFT JOIN pump_shell_templates t ON t.id = v.template_id
        WHERE v.deleted_at IS NULL
        ORDER BY v.model_name
    `).all();
    variants.forEach(row => {
        const details = [
            row.shell_model || '',
            row.barrel_length ? `机筒${row.barrel_length}mm` : '',
            row.coil_spec
                ? `${row.coil_spec}-${row.coil_sheets || 0}`
                : '',
        ].filter(Boolean).join(' / ');
        targets.push({
            type: 'variant',
            id: String(row.id),
            label: row.model_name,
            value: `变体:${row.model_name}`,
            secondary: details || '常用配置预设',
        });
    });

    const recipes = db.prepare(`
        SELECT id, name, spec, custom_barrel_length, coil_spec, coil_sheets
        FROM recipes
        WHERE deleted_at IS NULL
        ORDER BY updated_at DESC
    `).all();
    recipes.forEach(row => {
        const label = row.name + (row.spec ? ` (${row.spec})` : '');
        const details = [
            row.custom_barrel_length
                ? `机筒${row.custom_barrel_length}mm`
                : '',
            row.coil_spec
                ? `${row.coil_spec}-${row.coil_sheets || 0}`
                : '',
        ].filter(Boolean).join(' / ');
        targets.push({
            type: 'recipe',
            id: String(row.id),
            label,
            value: `配方:${label}`,
            secondary: details || `配方#${row.id}`,
        });
    });

    return targets;
}

module.exports = {
    RotorQueryError,
    buildRecipeRotorDraft,
    buildTemplateRotorDraft,
    listOrderPumpModels,
    listRotorLinkTargets,
};
