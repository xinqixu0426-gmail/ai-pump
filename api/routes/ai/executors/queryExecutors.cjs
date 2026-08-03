const { getJson, postJson, patchJson, deleteJson } = require('../internalApiClient.cjs');
const {
    executeCoilStockAdjustment,
} = require('../../../services/aiCoilStockExecution.cjs');
const {
    executePartCreate,
    executePartDelete,
    executePartPriceBatch,
    executePartUpdate,
} = require('../../../services/aiPartExecution.cjs');

async function executeQueryTool(toolName, args, internalFetch) {
    switch (toolName) {
        case 'get_coil_specs': {
            const specs = await getJson(internalFetch, '/api/coils/specs', '线圈规格读取失败');
            return { success: true, data: specs };
        }

        case 'get_all_recipes': {
            const recipes = await getJson(internalFetch, '/api/recipes', '配方列表读取失败');
            const summary = recipes.map(r => ({
                id: r.id ?? r.Id,
                name: r.name,
                spec: r.spec,
                savedCost: r.savedTotalCost || 0
            }));
            return { success: true, data: summary };
        }

        case 'get_recent_orders': {
            const limit = args.limit || 10;
            const allOrders = await getJson(internalFetch, '/api/orders', '订单列表读取失败');
            const recentOrders = allOrders.sort((a, b) => (b.id ?? b.Id ?? 0) - (a.id ?? a.Id ?? 0)).slice(0, limit);
            const formattedOrders = recentOrders.map(o => ({
                id: o.id ?? o.Id,
                customer: o.customerName || '未知',
                contract: o.contractNo || '-',
                status: o.status || '未知',
                createdAt: o.createdAt || o.CreatedAt || new Date().toISOString()
            }));
            return { success: true, data: formattedOrders };
        }

        case 'create_part': {
            return executePartCreate(args, {
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

        case 'adjust_coil_stock': {
            return executeCoilStockAdjustment(args, {
                internalFetch,
                getJson,
                postJson,
            });
        }

        case 'search_parts': {
            const { keyword, category } = args;
            const allParts = await getJson(internalFetch, '/api/parts', '零件列表读取失败');
            let results = allParts;
            if (keyword) { results = results.filter(p => (p.model || '').includes(keyword) || (p.category || '').includes(keyword) || (p.subcategory || '').includes(keyword) || (p.supplier || '').includes(keyword)); }
            if (category) { results = results.filter(p => (p.category || '') === category || (p.category || '').includes(category)); }
            return {
                success: true,
                count: results.length,
                parts: results.slice(0, 30).map(p => ({ id: p.id ?? p.Id, model: p.model, category: p.category, subcategory: p.subcategory || '', price: p.price, supplier: p.supplier, stock: p.stock || 0 }))
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
