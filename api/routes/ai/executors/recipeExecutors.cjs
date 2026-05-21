const { db, dbGetAllParts, dbGetAllRecipes, loadPartsData, calculateRecipeCost, safeUpdate, softDelete } = require('../../../db.cjs');

async function executeRecipeTool(toolName, args, internalFetch) {
    switch (toolName) {
        case 'create_recipe': {
            const { name, spec = '', parts = [] } = args;
            if (!name) return { success: false, error: '缺少配方名称' };

            // 解析零件：自动匹配零件库
            const allParts = dbGetAllParts();
            const recipeParts = [];
            for (const p of parts) {
                const dbPart = allParts.find(dp => (dp.model || '') === p.model || (dp.model || '').includes(p.model));
                recipeParts.push({
                    model: p.model,
                    name: dbPart ? (dbPart.model || p.model) : p.model,
                    supplier: dbPart ? (dbPart.supplier || '-') : '-',
                    qty: p.qty,
                    snapshotPrice: dbPart ? Number(dbPart.price || 0) : 0
                });
            }

            const { partsCache, partsByModel } = loadPartsData();
            const costRes = calculateRecipeCost(recipeParts, partsCache, partsByModel);

            const body = {
                name: name,
                spec: spec,
                parts_json: JSON.stringify(recipeParts),
                saved_total_cost: parseFloat(costRes.totalCost || 0),
                saved_cost_details: JSON.stringify(costRes.details || [])
            };
            const now_r = new Date().toISOString();
            const createRes = db.prepare('INSERT INTO recipes (name, spec, parts_json, saved_total_cost, saved_cost_details, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
                body.name, body.spec, body.parts_json, body.saved_total_cost, body.saved_cost_details, now_r, now_r
            );
            createRes.Id = createRes.lastInsertRowid;
            const newId = createRes?.Id || createRes?.id;
            if (!newId) return { success: false, error: '配方创建失败' };
            return { success: true, message: `配方"${name}"创建成功`, recipe: { id: newId, name, spec, partsCount: recipeParts.length, totalCost: costRes.totalCost } };
        }

        case 'delete_recipe': {
            const { recipeName } = args;
            const allRecipes = dbGetAllRecipes();
            const recipe = allRecipes.find(r => (r.name) === recipeName || (r.name || '').includes(recipeName));
            if (!recipe) return { success: false, error: '找不到配方: ' + recipeName };
            softDelete('recipes', recipe.Id);
            return { success: true, message: `配方"${recipe.name || recipeName}"已删除`, recipeName: recipe.name || recipeName };
        }

        case 'update_recipe': {
            const { recipeName, newName, newSpec, addParts = [], removeParts = [], updateParts = [] } = args;
            const allRecipes = dbGetAllRecipes();
            const recipe = allRecipes.find(r => (r.name) === recipeName || (r.name || '').includes(recipeName));
            if (!recipe) return { success: false, error: '找不到配方: ' + recipeName };

            let parts = []; try { parts = JSON.parse(recipe.parts_json || '[]'); } catch (e) { }
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

            const patchBody = { Id: recipe.Id, parts_json: JSON.stringify(parts) };
            if (newName) { patchBody.name = newName; changes.push(`名称: ${recipe.name} → ${newName}`); }
            if (newSpec) { patchBody.spec = newSpec; changes.push(`规格: ${recipe.spec} → ${newSpec}`); }

            // 重新计算成本
            const { partsCache: pc, partsByModel: pbm } = loadPartsData();
            const costRes = calculateRecipeCost(parts, pc, pbm);
            patchBody.saved_total_cost = parseFloat(costRes.totalCost || 0);
            patchBody.saved_cost_details = JSON.stringify(costRes.details || []);

            if (changes.length === 0) return { success: false, error: '没有指定任何修改' };
            const { Id, ...recipeUpdates } = patchBody;
            safeUpdate('recipes', Id, recipeUpdates);
            return { success: true, message: `配方"${recipe.name}"修改成功`, recipeName: newName || recipe.name, partsCount: parts.length, newCost: costRes.totalCost, changes };
        }

        case 'compare_recipes': {
            const { recipe1, recipe2 } = args;
            const allRecipes = dbGetAllRecipes();
            const r1 = allRecipes.find(r => (r.name) === recipe1 || (r.name || '').includes(recipe1));
            const r2 = allRecipes.find(r => (r.name) === recipe2 || (r.name || '').includes(recipe2));
            if (!r1) return { success: false, error: '找不到配方: ' + recipe1 };
            if (!r2) return { success: false, error: '找不到配方: ' + recipe2 };

            const { partsCache: pc, partsByModel: pbm } = loadPartsData();
            let p1 = []; try { p1 = JSON.parse(r1.parts_json || '[]'); } catch (e) { }
            let p2 = []; try { p2 = JSON.parse(r2.parts_json || '[]'); } catch (e) { }
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
