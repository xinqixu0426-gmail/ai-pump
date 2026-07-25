const { getJson, postJson, patchJson, deleteJson } = require('../internalApiClient.cjs');

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

        case 'get_all_parts': {
            const parts = await getJson(internalFetch, '/api/parts', '零件列表读取失败');
            const summary = parts.map(p => ({
                id: p.id ?? p.Id,
                model: p.model,
                category: p.category,
                price: p.price,
                supplier: p.supplier,
                stock: p.stock || 0
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
            const { model, category = '其他', subcategory = '', price, supplier = '-', stock = 0 } = args;
            if (!model || price === undefined) {
                return { success: false, error: '缺少必要参数：型号或单价' };
            }

            const saved = await postJson(internalFetch, '/api/parts', { model, category, subcategory, price, supplier, stock }, '零件新建失败');
            return {
                success: true,
                message: '零件新建成功（已通过标准 API 写入）',
                part: {
                    model: saved.model || model,
                    category: saved.category || category,
                    subcategory: saved.subcategory || subcategory,
                    price: saved.price ?? price,
                    supplier: saved.supplier || supplier,
                    stock: saved.stock ?? stock
                },
                id: saved.id || saved.Id
            };
        }

        case 'update_part': {
            const { model, price, stock, stockDelta, supplier, category, subcategory } = args;
            if (!model) {
                return { success: false, error: '缺少必要参数：零件型号' };
            }
            // 先查找该零件
            const allParts = await getJson(internalFetch, '/api/parts', '零件列表读取失败');
            const target = allParts.find(p => (p.model || '') === model);
            if (!target) {
                return { success: false, error: `未找到型号为"${model}"的零件` };
            }

            const updates = {};
            const changes = [];
            if (price !== undefined) {
                updates.price = price;
                changes.push(`单价: ${target.price || target.price} → ${price}`);
            }
            if (stock !== undefined) {
                updates.stock = stock;
                changes.push(`库存: ${target.stock || target.stock || 0} → ${stock}`);
            } else if (stockDelta !== undefined) {
                const currentStock = Number(target.stock || target.stock || 0);
                const newStock = Math.max(0, currentStock + stockDelta);
                updates.stock = newStock;
                changes.push(`库存: ${currentStock} → ${newStock} (${stockDelta > 0 ? '+' : ''}${stockDelta})`);
            }
            if (supplier !== undefined) {
                updates.supplier = supplier;
                changes.push(`供应商: ${target.supplier || target.supplier} → ${supplier}`);
            }
            if (category !== undefined) {
                updates.category = category;
                changes.push(`类别: ${target.category || target.category} → ${category}`);
            }
            if (subcategory !== undefined) {
                updates.subcategory = subcategory;
                changes.push(`二级分类: ${target.subcategory || '-'} → ${subcategory}`);
            }

            if (changes.length === 0) {
                return { success: false, error: '没有指定任何要修改的字段' };
            }

            const targetId = target.id ?? target.Id;
            const saved = await patchJson(internalFetch, `/api/parts/${targetId}`, updates, '零件修改失败');
            return {
                success: true,
                message: '零件修改成功（已通过标准 API 写入）',
                part: {
                    id: saved.id || saved.Id || targetId,
                    model: saved.model || model,
                    category: saved.category,
                    subcategory: saved.subcategory || '',
                    price: saved.price,
                    supplier: saved.supplier,
                    stock: saved.stock
                },
                changes
            };
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
            const { model } = args;
            const allParts = await getJson(internalFetch, '/api/parts', '零件列表读取失败');
            const target = allParts.find(p => (p.model || '') === model);
            if (!target) return { success: false, error: '找不到零件: ' + model };
            await deleteJson(internalFetch, `/api/parts/${target.id ?? target.Id}`, '零件删除失败');
            return { success: true, message: `零件"${model}"已删除`, model };
        }

        case 'batch_update_prices': {
            const { category, percentChange, absoluteChange } = args;
            if (percentChange === undefined && absoluteChange === undefined) return { success: false, error: '需要指定percentChange或absoluteChange' };
            const allParts = await getJson(internalFetch, '/api/parts', '零件列表读取失败');
            const targets = allParts.filter(p => (p.category || '') === category || (p.category || '').includes(category));
            if (targets.length === 0) return { success: false, error: `没有找到类别包含"${category}"的零件` };

            const updates = [];
            const details = [];
            for (const p of targets) {
                const oldPrice = Number(p.price || 0);
                let newPrice;
                if (percentChange !== undefined) { newPrice = Math.round(oldPrice * (1 + percentChange / 100) * 100) / 100; }
                else { newPrice = Math.round((oldPrice + absoluteChange) * 100) / 100; }
                if (newPrice < 0) newPrice = 0;
                updates.push({ partId: p.id ?? p.Id, price: newPrice });
                details.push({ model: p.model, oldPrice, newPrice });
            }

            const result = await patchJson(internalFetch, '/api/parts/prices', { updates }, '批量调价失败');

            return {
                success: true,
                message: `已批量更新${result.updatedCount ?? targets.length}个"${category}"类零件的价格`,
                category,
                count: result.updatedCount ?? targets.length,
                changeType: percentChange !== undefined ? `${percentChange > 0 ? '+' : ''}${percentChange}%` : `${absoluteChange > 0 ? '+' : ''}${absoluteChange}元`,
                details
            };
        }

        case 'get_dashboard_summary': {
            const summary = await getJson(internalFetch, '/api/workbench/summary', '运营汇总读取失败');
            return { success: true, summary };
        }

        default:
            return null;
    }
}

const QUERY_TOOLS = new Set([
    'get_coil_specs', 'get_all_recipes', 'get_all_parts', 'get_recent_orders',
    'create_part', 'update_part', 'search_parts', 'delete_part', 'batch_update_prices',
    'get_dashboard_summary'
]);

module.exports = { executeQueryTool, QUERY_TOOLS };
