const { dbGetAllParts, dbGetAllRecipes, dbGetAllOrders, dbGetAllCoils } = require('../../../db.cjs');
const { buildBusinessSummary } = require('../../../services/businessSummary.cjs');

async function executeQueryTool(toolName, args, internalFetch) {
    switch (toolName) {
        case 'get_coil_specs': {
            const allCoils = dbGetAllCoils();
            const specsMap = {};
            allCoils.forEach(c => {
                const spec = c.spec;
                const material = c.material || '钢带';
                if (!specsMap[spec]) specsMap[spec] = { spec, material, materials: [], unitPrice: c.unitPrice, sheets: [], count: 0 };
                if (!specsMap[spec].materials.includes(material)) specsMap[spec].materials.push(material);
                if (material === '钢带') {
                    specsMap[spec].material = material;
                    specsMap[spec].unitPrice = c.unitPrice;
                }
                if (!specsMap[spec].sheets.includes(parseInt(c.sheets))) specsMap[spec].sheets.push(parseInt(c.sheets));
                specsMap[spec].count++;
            });
            Object.values(specsMap).forEach(s => s.sheets.sort((a, b) => a - b));
            return { success: true, data: Object.values(specsMap) };
        }

        case 'get_all_recipes': {
            const recipes = dbGetAllRecipes();
            const summary = recipes.map(r => ({
                id: r.Id,
                name: r.name,
                spec: r.spec,
                savedCost: r.savedTotalCost || 0
            }));
            return { success: true, data: summary };
        }

        case 'get_all_parts': {
            const parts = dbGetAllParts();
            const summary = parts.map(p => ({
                id: p.Id,
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
            const allOrders = dbGetAllOrders();
            const recentOrders = allOrders.sort((a, b) => b.Id - a.Id).slice(0, limit);
            const formattedOrders = recentOrders.map(o => ({
                id: o.Id,
                customer: o.customerName || '未知',
                contract: o.contractNo || '-',
                status: o.status || '未知',
                createdAt: o.CreatedAt || o.created_at || new Date().toISOString()
            }));
            return { success: true, data: formattedOrders };
        }

        case 'create_part': {
            const { model, category = '其他', price, supplier = '-', stock = 0 } = args;
            if (!model || price === undefined) {
                return { success: false, error: '缺少必要参数：型号或单价' };
            }

            const response = await internalFetch('/api/parts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model,
                    category,
                    price,
                    supplier,
                    stock,
                }),
            });
            const result = await response.json();
            if (!result.success || !result.data) {
                return { success: false, error: result.error || '零件新建失败' };
            }

            const saved = result.data;
            return {
                success: true,
                message: '零件新建成功（已通过标准 API 写入）',
                part: {
                    model: saved.model || model,
                    category: saved.category || category,
                    price: saved.price ?? price,
                    supplier: saved.supplier || supplier,
                    stock: saved.stock ?? stock
                },
                id: saved.id || saved.Id
            };
        }

        case 'update_part': {
            const { model, price, stock, stockDelta, supplier, category } = args;
            if (!model) {
                return { success: false, error: '缺少必要参数：零件型号' };
            }
            // 先查找该零件
            const allParts = dbGetAllParts();
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

            if (changes.length === 0) {
                return { success: false, error: '没有指定任何要修改的字段' };
            }

            const response = await internalFetch(`/api/parts/${target.Id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
            });
            const result = await response.json();
            if (!result.success || !result.data) {
                return { success: false, error: result.error || '零件修改失败' };
            }

            const saved = result.data;
            return {
                success: true,
                message: '零件修改成功（已通过标准 API 写入）',
                part: {
                    id: saved.id || saved.Id || target.Id,
                    model: saved.model || model,
                    category: saved.category,
                    price: saved.price,
                    supplier: saved.supplier,
                    stock: saved.stock
                },
                changes
            };
        }

        case 'search_parts': {
            const { keyword, category } = args;
            const allParts = dbGetAllParts();
            let results = allParts;
            if (keyword) { results = results.filter(p => (p.model || '').includes(keyword) || (p.category || '').includes(keyword) || (p.supplier || '').includes(keyword)); }
            if (category) { results = results.filter(p => (p.category || '') === category || (p.category || '').includes(category)); }
            return {
                success: true,
                count: results.length,
                parts: results.slice(0, 30).map(p => ({ id: p.Id, model: p.model, category: p.category, price: p.price, supplier: p.supplier, stock: p.stock || 0 }))
            };
        }

        case 'delete_part': {
            const { model } = args;
            const allParts = dbGetAllParts();
            const target = allParts.find(p => (p.model || '') === model);
            if (!target) return { success: false, error: '找不到零件: ' + model };
            const response = await internalFetch(`/api/parts/${target.Id}`, { method: 'DELETE' });
            const result = await response.json();
            if (!result.success) {
                return { success: false, error: result.error || '零件删除失败' };
            }
            return { success: true, message: `零件"${model}"已删除`, model };
        }

        case 'batch_update_prices': {
            const { category, percentChange, absoluteChange } = args;
            if (percentChange === undefined && absoluteChange === undefined) return { success: false, error: '需要指定percentChange或absoluteChange' };
            const allParts = dbGetAllParts();
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
                updates.push({ partId: p.Id, price: newPrice });
                details.push({ model: p.model, oldPrice, newPrice });
            }

            const response = await internalFetch('/api/parts/prices', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updates }),
            });
            const result = await response.json();
            if (!result.success) {
                return { success: false, error: result.error || '批量调价失败' };
            }

            return {
                success: true,
                message: `已批量更新${result.data?.updatedCount ?? targets.length}个"${category}"类零件的价格`,
                category,
                count: result.data?.updatedCount ?? targets.length,
                changeType: percentChange !== undefined ? `${percentChange > 0 ? '+' : ''}${percentChange}%` : `${absoluteChange > 0 ? '+' : ''}${absoluteChange}元`,
                details
            };
        }

        case 'get_dashboard_summary': {
            return { success: true, summary: buildBusinessSummary() };
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
