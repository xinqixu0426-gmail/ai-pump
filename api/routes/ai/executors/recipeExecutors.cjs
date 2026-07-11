const { dbGetAllParts, dbGetAllRecipes, loadPartsData, calculateRecipeCost } = require('../../../db.cjs');

async function readApiJson(response, fallbackError) {
    const result = await response.json();
    if (!result.success) {
        throw new Error(result.error || fallbackError);
    }
    return result.data ?? result;
}

async function postJson(internalFetch, url, body, fallbackError) {
    const response = await internalFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return readApiJson(response, fallbackError);
}

async function patchJson(internalFetch, url, body, fallbackError) {
    const response = await internalFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return readApiJson(response, fallbackError);
}

function buildAiRecipeParts(parts, allParts) {
    return (Array.isArray(parts) ? parts : []).map(part => {
        const model = String(part?.model || '').trim();
        if (!model) return null;
        const dbPart = allParts.find(dp => (dp.model || '') === model || (dp.model || '').includes(model));
        return {
            model,
            name: dbPart ? (dbPart.model || model) : model,
            supplier: dbPart ? (dbPart.supplier || '-') : '-',
            qty: Number(part?.qty || 0),
            snapshotPrice: dbPart ? Number(dbPart.price || 0) : 0
        };
    }).filter(Boolean);
}

function parseJsonArray(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function parseJsonObject(value) {
    try {
        const parsed = JSON.parse(value || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function buildFormFromRecipe(recipe, overrides = {}) {
    return {
        name: overrides.name ?? recipe.name ?? '',
        spec: overrides.spec ?? recipe.spec ?? '',
        templateId: recipe.templateId ?? null,
        coilSpec: recipe.coilSpec || '',
        coilSheets: recipe.coilSheets ?? 0,
        coilMaterial: recipe.coilMaterial || '钢带',
        coilWireWeight: recipe.coilWireWeight ?? null,
        hasFloat: Boolean(recipe.hasFloat),
        floatWire: recipe.floatWire || '',
        floatAccessoryType: recipe.floatAccessoryType || 'standard',
        hasCable: Boolean(recipe.hasCable),
        cableLength: recipe.cableLength ?? 0,
        cableWire: recipe.cableWire || '',
        cableAccessoryType: recipe.cableAccessoryType || 'standard',
        customBarrelLength: recipe.customBarrelLength ?? null,
        modelVariantId: recipe.modelVariantId ?? null,
        impellerModel: recipe.impellerModel || '',
        impellerThickness: recipe.impellerThickness ?? null,
        impellerDiameter: recipe.impellerDiameter ?? null,
        impellerBladeCount: recipe.impellerBladeCount ?? null,
        assemblyWage: recipe.assemblyWage ?? 0,
        packingWage: recipe.packingWage ?? 0,
        surfaceTreatmentMode: recipe.surfaceTreatmentMode || 'none',
        surfaceTreatmentCost: recipe.surfaceTreatmentCost ?? 0,
        managementFee: recipe.managementFee ?? 0,
    };
}

async function buildAiRecipeSavePayload(internalFetch, form, parts, options = {}) {
    if (parts.length === 0) {
        throw new Error('配方 BOM 不能为空，请至少提供一个零件');
    }
    const costDraft = await postJson(internalFetch, '/api/recipes/cost-draft', { parts }, '生成配方成本草稿失败');
    return postJson(internalFetch, '/api/recipes/save-payload-draft', {
        form: {
            name: form.name,
            spec: form.spec || '',
            assemblyWage: form.assemblyWage ?? 0,
            packingWage: form.packingWage ?? 0,
            surfaceTreatmentMode: form.surfaceTreatmentMode || 'none',
            surfaceTreatmentCost: form.surfaceTreatmentCost ?? 0,
            managementFee: form.managementFee ?? 0,
            templateId: form.templateId ?? null,
            coilSpec: form.coilSpec || '',
            coilSheets: form.coilSheets ?? 0,
            coilMaterial: form.coilMaterial || '钢带',
            coilWireWeight: form.coilWireWeight ?? null,
            hasFloat: Boolean(form.hasFloat),
            floatWire: form.floatWire || '',
            floatAccessoryType: form.floatAccessoryType || 'standard',
            hasCable: Boolean(form.hasCable),
            cableLength: form.cableLength ?? 0,
            cableWire: form.cableWire || '',
            cableAccessoryType: form.cableAccessoryType || 'standard',
            customBarrelLength: form.customBarrelLength ?? null,
            modelVariantId: form.modelVariantId ?? null,
            impellerModel: form.impellerModel || '',
            impellerThickness: form.impellerThickness ?? null,
            impellerDiameter: form.impellerDiameter ?? null,
            impellerBladeCount: form.impellerBladeCount ?? null,
        },
        costDraft,
        packingParts: options.packingParts || [],
        optionalParts: options.optionalParts || [],
        technicalData: options.technicalData || {},
    }, '生成配方保存草稿失败');
}

async function executeRecipeTool(toolName, args, internalFetch) {
    switch (toolName) {
        case 'create_recipe': {
            const { name, spec = '', parts = [] } = args;
            if (!name) return { success: false, error: '缺少配方名称' };

            try {
                const recipeParts = buildAiRecipeParts(parts, dbGetAllParts());
                const payload = await buildAiRecipeSavePayload(internalFetch, { name, spec }, recipeParts);
                const saved = await postJson(internalFetch, '/api/recipes', payload, '配方创建失败');
                return {
                    success: true,
                    message: `配方"${name}"创建成功（已通过标准 API 写入）`,
                    recipe: {
                        id: saved.id || saved.Id,
                        name: saved.name || name,
                        spec: saved.spec || spec,
                        partsCount: recipeParts.length,
                        totalCost: saved.savedTotalCost ?? payload.savedTotalCost
                    }
                };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }

        case 'delete_recipe': {
            const { recipeName } = args;
            const allRecipes = dbGetAllRecipes();
            const recipe = allRecipes.find(r => (r.name) === recipeName || (r.name || '').includes(recipeName));
            if (!recipe) return { success: false, error: '找不到配方: ' + recipeName };
            const response = await internalFetch(`/api/recipes/${recipe.Id}`, { method: 'DELETE' });
            const result = await response.json();
            if (!result.success) {
                return { success: false, error: result.error || '配方删除失败' };
            }
            return { success: true, message: `配方"${recipe.name || recipeName}"已删除`, recipeName: recipe.name || recipeName };
        }

        case 'update_recipe': {
            const { recipeName, newName, newSpec, addParts = [], removeParts = [], updateParts = [] } = args;
            const allRecipes = dbGetAllRecipes();
            const recipe = allRecipes.find(r => (r.name) === recipeName || (r.name || '').includes(recipeName));
            if (!recipe) return { success: false, error: '找不到配方: ' + recipeName };

            let parts = parseJsonArray(recipe.partsJson);
            const changes = [];

            // 移除零件
            if (removeParts.length > 0) {
                const before = parts.length;
                parts = parts.filter(p => !removeParts.some(rm => p.model === rm || (p.model || '').includes(rm)));
                changes.push(`移除了${before - parts.length}个零件`);
            }
            // 修改零件数量
            for (const up of updateParts) {
                const found = parts.find(p => p.model === up.model || (p.model || '').includes(up.model));
                if (found) { changes.push(`${found.model}: 数量 ${found.qty} → ${up.qty}`); found.qty = up.qty; }
            }
            // 添加零件
            if (addParts.length > 0) {
                const allPartsDb = dbGetAllParts();
                for (const ap of addParts) {
                    const dbPart = allPartsDb.find(dp => (dp.model || '') === ap.model || (dp.model || '').includes(ap.model));
                    parts.push({
                        model: ap.model,
                        name: dbPart ? (dbPart.model || ap.model) : ap.model,
                        supplier: dbPart ? (dbPart.supplier || '-') : '-',
                        qty: ap.qty,
                        snapshotPrice: dbPart ? Number(dbPart.price || 0) : 0
                    });
                    changes.push(`添加了 ${ap.model} × ${ap.qty}`);
                }
            }

            const form = buildFormFromRecipe(recipe, { name: newName || recipe.name, spec: newSpec || recipe.spec || '' });
            if (newName) changes.push(`名称: ${recipe.name} → ${newName}`);
            if (newSpec) changes.push(`规格: ${recipe.spec} → ${newSpec}`);

            if (changes.length === 0) return { success: false, error: '没有指定任何修改' };
            try {
                const payload = await buildAiRecipeSavePayload(internalFetch, form, parts, {
                    packingParts: parseJsonArray(recipe.packingPartsJson),
                    optionalParts: parseJsonArray(recipe.extraPartsJson),
                    technicalData: parseJsonObject(recipe.technicalDataJson),
                });
                const saved = await patchJson(internalFetch, `/api/recipes/${recipe.Id}`, payload, '配方修改失败');
                return {
                    success: true,
                    message: `配方"${recipe.name}"修改成功（已通过标准 API 写入）`,
                    recipeName: saved.name || newName || recipe.name,
                    partsCount: parts.length,
                    newCost: saved.savedTotalCost ?? payload.savedTotalCost,
                    changes
                };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }

        case 'compare_recipes': {
            const { recipe1, recipe2 } = args;
            const allRecipes = dbGetAllRecipes();
            const r1 = allRecipes.find(r => (r.name) === recipe1 || (r.name || '').includes(recipe1));
            const r2 = allRecipes.find(r => (r.name) === recipe2 || (r.name || '').includes(recipe2));
            if (!r1) return { success: false, error: '找不到配方: ' + recipe1 };
            if (!r2) return { success: false, error: '找不到配方: ' + recipe2 };

            const { partsCache: pc, partsByModel: pbm } = loadPartsData();
            let p1 = []; try { p1 = JSON.parse(r1.partsJson || '[]'); } catch (e) { }
            let p2 = []; try { p2 = JSON.parse(r2.partsJson || '[]'); } catch (e) { }
            const cost1 = calculateRecipeCost(p1, pc, pbm);
            const cost2 = calculateRecipeCost(p2, pc, pbm);

            // BOM对比
            const allModels = [...new Set([...p1.map(p => p.model), ...p2.map(p => p.model)])];
            const comparison = allModels.map(model => {
                const in1 = p1.find(p => p.model === model);
                const in2 = p2.find(p => p.model === model);
                return { model, qty1: in1?.qty || 0, qty2: in2?.qty || 0, onlyIn: in1 && !in2 ? recipe1 : (!in1 && in2 ? recipe2 : '两者共有') };
            });

            return {
                success: true,
                recipe1: { name: r1.name, spec: r1.spec, cost: cost1.totalCost, partsCount: p1.length },
                recipe2: { name: r2.name, spec: r2.spec, cost: cost2.totalCost, partsCount: p2.length },
                costDiff: (parseFloat(cost1.totalCost) - parseFloat(cost2.totalCost)).toFixed(2),
                comparison
            };
        }

        default:
            return null;
    }
}

const RECIPE_TOOLS = new Set([
    'create_recipe', 'delete_recipe', 'update_recipe', 'compare_recipes'
]);

module.exports = { executeRecipeTool, RECIPE_TOOLS };
