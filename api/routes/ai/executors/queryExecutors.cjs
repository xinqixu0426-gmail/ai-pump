const { getJson, postJson, patchJson, deleteJson } = require('../internalApiClient.cjs');
const {
    executeCoilStockAdjustment,
} = require('../../../services/aiCoilStockExecution.cjs');
const {
    executePartBatchCreate,
    executePartCreate,
    executePartDelete,
    executePartPriceBatch,
    executePartStockAdjustment,
    executePartUpdate,
} = require('../../../services/aiPartExecution.cjs');

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(String(value || '[]'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function resolveUniqueRecipe(recipes, args = {}) {
    const recipeId = Number.parseInt(args.recipeId, 10);
    const recipeName = String(args.recipeName || '').trim();
    const exactMatches = recipes.filter(recipe => (
        (Number.isInteger(recipeId) && recipeId > 0 && Number(recipe.id ?? recipe.Id) === recipeId)
        || (recipeName && String(recipe.name || '').trim() === recipeName)
    ));
    const matches = exactMatches.length > 0
        ? exactMatches
        : recipes.filter(recipe => (
            recipeName && String(recipe.name || '').includes(recipeName)
        ));
    if (matches.length === 0) {
        return { error: `未找到配方：${recipeName || recipeId || '-'}` };
    }
    if (matches.length > 1) {
        return {
            error: '配方名称不明确，请指定完整名称或配方ID',
            candidates: matches.slice(0, 10).map(recipe => ({
                id: recipe.id ?? recipe.Id,
                name: recipe.name,
            })),
        };
    }
    return { recipe: matches[0] };
}

async function executeQueryTool(toolName, args, internalFetch, options = {}) {
    switch (toolName) {
        case 'get_coil_specs': {
            const specs = await getJson(internalFetch, '/api/coils/specs', '线圈规格读取失败');
            return { success: true, data: specs };
        }

        case 'search_coils': {
            const filters = {
                spec: String(args.spec || '').trim(),
                sheets: args.sheets === undefined ? null : Number(args.sheets),
                material: String(args.material || '').trim(),
                slotType: String(args.slotType || '').trim(),
            };
            const query = new URLSearchParams();
            for (const [field, value] of Object.entries(filters)) {
                if (value !== null && value !== '') query.set(field, String(value));
            }
            const coils = await getJson(
                internalFetch,
                `/api/coils${query.size ? `?${query.toString()}` : ''}`,
                '线圈库存读取失败'
            );
            return {
                success: true,
                count: coils.length,
                filters,
                data: coils.map(coil => ({
                    id: coil.id ?? coil.Id,
                    spec: coil.spec,
                    sheets: coil.sheets,
                    material: coil.material,
                    slotType: coil.slotType,
                    schemeName: coil.schemeName || '',
                    schemeStatus: coil.schemeStatus || '',
                    stock: Number(coil.stock || 0),
                    unitPrice: Number(coil.unitPrice || 0),
                    cost: Number(coil.cost || 0),
                    updatedAt: coil.updatedAt || coil.UpdatedAt || null,
                })),
                sources: coils.map(coil => ({
                    sourceTable: 'coils',
                    sourceId: coil.id ?? coil.Id,
                    title: `${coil.spec}-${coil.sheets} ${coil.material || ''} ${coil.slotType || ''}`.trim(),
                })),
            };
        }

        case 'get_all_recipes': {
            const query = new URLSearchParams();
            const keyword = String(args.keyword || '').trim();
            if (keyword) query.set('keyword', keyword);
            const recipes = await getJson(
                internalFetch,
                `/api/recipes${query.size ? `?${query.toString()}` : ''}`,
                '配方列表读取失败'
            );
            const summary = recipes.map(r => ({
                id: r.id ?? r.Id,
                name: r.name,
                spec: r.spec,
                savedCost: r.savedTotalCost || 0
            }));
            return {
                success: true,
                count: summary.length,
                filters: { keyword },
                data: summary,
            };
        }

        case 'get_recipe_detail': {
            const recipes = await getJson(internalFetch, '/api/recipes', '配方列表读取失败');
            const resolved = resolveUniqueRecipe(recipes, args);
            if (resolved.error) return { success: false, ...resolved };
            const recipeId = resolved.recipe.id ?? resolved.recipe.Id;
            const recipe = await getJson(
                internalFetch,
                `/api/recipes/${recipeId}`,
                '配方明细读取失败'
            );
            const parts = parseJsonArray(recipe.partsJson);
            let currentCost = null;
            if (args.includeCurrentCost) {
                currentCost = await postJson(
                    internalFetch,
                    `/api/recipes/${recipeId}/cost-preview`,
                    { overrides: {} },
                    '配方当前成本读取失败'
                );
            }
            return {
                success: true,
                recipe: {
                    ...recipe,
                    parts,
                    partCount: parts.length,
                },
                ...(currentCost ? { currentCost } : {}),
                sources: [{
                    sourceTable: 'recipes',
                    sourceId: recipeId,
                    title: `${recipe.name} 配方明细`,
                }],
            };
        }

        case 'get_recipe_technical_files': {
            const recipes = await getJson(internalFetch, '/api/recipes', '配方列表读取失败');
            const resolved = resolveUniqueRecipe(recipes, args);
            if (resolved.error) return { success: false, ...resolved };
            const recipe = resolved.recipe;
            const id = recipe.id ?? recipe.Id;
            const files = await getJson(
                internalFetch,
                `/api/recipes/${id}/technical-files`,
                '配方技术档案读取失败'
            );
            return {
                success: true,
                recipe: { id, name: recipe.name, spec: recipe.spec },
                files,
                sources: [{
                    sourceTable: 'recipes',
                    sourceId: id,
                    title: `${recipe.name} 技术档案`,
                }],
            };
        }

        case 'get_recent_orders': {
            const query = new URLSearchParams();
            for (const field of ['limit', 'status', 'customerName', 'contractNo']) {
                const value = String(args[field] ?? '').trim();
                if (value) query.set(field, value);
            }
            const recentOrders = await getJson(
                internalFetch,
                `/api/orders${query.size ? `?${query.toString()}` : ''}`,
                '订单列表读取失败'
            );
            const formattedOrders = recentOrders.map(o => ({
                id: o.id ?? o.Id,
                customer: o.customerName || '未知',
                contract: o.contractNo || '-',
                status: o.status || '未知',
                createdAt: o.createdAt || o.CreatedAt || new Date().toISOString()
            }));
            return {
                success: true,
                count: formattedOrders.length,
                filters: {
                    status: String(args.status || '').trim(),
                    customerName: String(args.customerName || '').trim(),
                    contractNo: String(args.contractNo || '').trim(),
                    limit: Number(args.limit || 10),
                },
                data: formattedOrders,
            };
        }

        case 'create_part': {
            return executePartCreate(args, {
                internalFetch,
                postJson,
            });
        }

        case 'batch_create_parts': {
            return executePartBatchCreate(args, {
                internalFetch,
                postJson,
            });
        }

        case 'update_part': {
            return executePartUpdate(args, {
                internalFetch,
                getJson,
                postJson,
                patchJson,
            });
        }

        case 'adjust_part_stock': {
            return executePartStockAdjustment(args, {
                internalFetch,
                getJson,
                postJson,
                confirmationContext: options.confirmationContext,
            });
        }

        case 'adjust_coil_stock': {
            return executeCoilStockAdjustment(args, {
                internalFetch,
                getJson,
                postJson,
            });
        }

        case 'search_parts': {
            const query = new URLSearchParams();
            for (const field of ['keyword', 'category', 'supplier', 'stockStatus']) {
                const value = String(args[field] || '').trim();
                if (value) query.set(field, value);
            }
            const queryString = query.toString();
            const results = await getJson(
                internalFetch,
                `/api/parts${queryString ? `?${queryString}` : ''}`,
                '零件列表读取失败'
            );
            const supplierCounts = new Map();
            for (const part of results) {
                const supplier = String(part.supplier || '').trim();
                if (!supplier) continue;
                supplierCounts.set(supplier, (supplierCounts.get(supplier) || 0) + 1);
            }
            const parts = results.slice(0, 30).map(p => ({ id: p.id ?? p.Id, model: p.model, category: p.category, subcategory: p.subcategory || '', price: p.price, supplier: p.supplier, stock: p.stock || 0 }));
            return {
                success: true,
                count: results.length,
                returnedCount: parts.length,
                truncated: parts.length < results.length,
                filters: {
                    keyword: String(args.keyword || '').trim(),
                    category: String(args.category || '').trim(),
                    supplier: String(args.supplier || '').trim(),
                    stockStatus: String(args.stockStatus || '').trim(),
                },
                stockStatusDefinition: {
                    low: '库存大于0且不超过5',
                    out: '库存不大于0',
                    attention: '库存不超过5（含缺货）',
                    ok: '库存大于5',
                },
                suppliers: [...supplierCounts.entries()].map(([name, partCount]) => ({ name, partCount })),
                parts,
            };
        }

        case 'delete_part': {
            return executePartDelete(args, {
                internalFetch,
                getJson,
                deleteJson,
            });
        }

        case 'batch_update_prices': {
            return executePartPriceBatch(args, {
                internalFetch,
                getJson,
                postJson,
                patchJson,
            });
        }

        case 'get_dashboard_summary': {
            const summary = await getJson(internalFetch, '/api/workbench/summary', '运营汇总读取失败');
            return { success: true, summary };
        }

        default:
            return null;
    }
}

module.exports = { executeQueryTool };
