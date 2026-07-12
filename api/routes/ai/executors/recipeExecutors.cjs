const { getJson, postJson, patchJson, deleteJson } = require('../internalApiClient.cjs');

async function loadRecipes(internalFetch) {
    return getJson(internalFetch, '/api/recipes', '配方列表读取失败');
}

async function loadParts(internalFetch) {
    return getJson(internalFetch, '/api/parts', '零件列表读取失败');
}

function findRecipe(recipes, name) {
    return (recipes || []).find(r => (r.name) === name || (r.name || '').includes(name));
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

function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function compareItemKey(item) {
    const name = String(item.name || '').trim();
    if (name) return `name:${name.replace(/\s+/g, '')}`;
    const model = String(item.model || '').trim();
    if (model) return `model:${model.replace(/\s+/g, '')}`;
    return '';
}

function compareItemIdentity(item) {
    return [item.model, item.supplier].filter(Boolean).join(' / ') || item.name || '-';
}

function aggregateCostDetails(details = []) {
    const map = new Map();
    for (const item of details || []) {
        const key = compareItemKey(item);
        if (!key) continue;
        const current = map.get(key) || {
            key,
            name: item.name || item.model || '-',
            qty: 0,
            amount: 0,
            models: new Set(),
            suppliers: new Set(),
        };
        current.qty += toNumber(item.qty);
        current.amount += toNumber(item.subtotal);
        current.models.add(compareItemIdentity(item));
        if (item.supplier && item.supplier !== '-') current.suppliers.add(item.supplier);
        map.set(key, current);
    }
    return map;
}

function comparisonDifference(leftItem, rightItem) {
    if (leftItem && !rightItem) return '仅配方1有';
    if (!leftItem && rightItem) return '仅配方2有';
    const model1 = Array.from(leftItem?.models || []).join('、') || '-';
    const model2 = Array.from(rightItem?.models || []).join('、') || '-';
    if (model1 !== model2) return '型号不同';
    if (Number((leftItem?.qty || 0).toFixed(3)) !== Number((rightItem?.qty || 0).toFixed(3))) return '数量不同';
    return '金额不同';
}

function buildRecipeComparison(recipe1, recipe2, cost1, cost2) {
    const left = aggregateCostDetails(cost1.details);
    const right = aggregateCostDetails(cost2.details);
    const keys = [...new Set([...left.keys(), ...right.keys()])];
    return keys.map(key => {
        const leftItem = left.get(key);
        const rightItem = right.get(key);
        const amount1 = leftItem?.amount || 0;
        const amount2 = rightItem?.amount || 0;
        const model1 = Array.from(leftItem?.models || []).join('、') || '-';
        const model2 = Array.from(rightItem?.models || []).join('、') || '-';
        return {
            key,
            model: leftItem?.name || rightItem?.name || key,
            name: leftItem?.name || rightItem?.name || key,
            model1,
            model2,
            qty1: Number((leftItem?.qty || 0).toFixed(3)),
            amount1: Number(amount1.toFixed(2)),
            qty2: Number((rightItem?.qty || 0).toFixed(3)),
            amount2: Number(amount2.toFixed(2)),
            diff: Number((amount1 - amount2).toFixed(2)),
            difference: comparisonDifference(leftItem, rightItem),
            onlyIn: leftItem && !rightItem ? recipe1 : (!leftItem && rightItem ? recipe2 : '两者共有'),
        };
    }).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.name.localeCompare(b.name, 'zh-CN'));
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
                const recipeParts = buildAiRecipeParts(parts, await loadParts(internalFetch));
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
            const recipe = findRecipe(await loadRecipes(internalFetch), recipeName);
            if (!recipe) return { success: false, error: '找不到配方: ' + recipeName };
            await deleteJson(internalFetch, `/api/recipes/${recipe.id ?? recipe.Id}`, '配方删除失败');
            return { success: true, message: `配方"${recipe.name || recipeName}"已删除`, recipeName: recipe.name || recipeName };
        }

        case 'update_recipe': {
            const { recipeName, newName, newSpec, addParts = [], removeParts = [], updateParts = [] } = args;
            const recipe = findRecipe(await loadRecipes(internalFetch), recipeName);
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
                const allPartsDb = await loadParts(internalFetch);
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
                const saved = await patchJson(internalFetch, `/api/recipes/${recipe.id ?? recipe.Id}`, payload, '配方修改失败');
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
            const allRecipes = await loadRecipes(internalFetch);
            const r1 = findRecipe(allRecipes, recipe1);
            const r2 = findRecipe(allRecipes, recipe2);
            if (!r1) return { success: false, error: '找不到配方: ' + recipe1 };
            if (!r2) return { success: false, error: '找不到配方: ' + recipe2 };

            let p1 = []; try { p1 = JSON.parse(r1.partsJson || '[]'); } catch (e) { }
            let p2 = []; try { p2 = JSON.parse(r2.partsJson || '[]'); } catch (e) { }
            const cost1 = await postJson(internalFetch, '/api/cost/parts', { parts: p1 }, '配方1成本计算失败');
            const cost2 = await postJson(internalFetch, '/api/cost/parts', { parts: p2 }, '配方2成本计算失败');

            const comparison = buildRecipeComparison(recipe1, recipe2, cost1, cost2);

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
