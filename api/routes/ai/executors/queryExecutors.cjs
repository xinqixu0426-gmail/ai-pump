const { db, dbGetAllParts, dbGetAllRecipes, dbGetAllOrders, dbGetAllCoils, partRow, invalidatePartsCache, safeUpdate, softDelete } = require('../../../db.cjs');
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
                savedCost: r.saved_total_cost || 0
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

            // 1. 发起创建请求
            const now = new Date().toISOString();
            const createRes = db.prepare('INSERT INTO parts (model, category, price, supplier, stock, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(model, category, price, supplier, stock, now, now);
            invalidatePartsCache();
            createRes.Id = createRes.lastInsertRowid;

            const newId = createRes?.Id || createRes?.id;
            if (!newId) {
                return { success: false, error: '数据库未返回有效ID，录入可能失败。返回内容: ' + JSON.stringify(createRes).slice(0, 200) };
            }

            // 2. 回读验证：确认记录真的写入了数据库
            try {
                const verify = { list: [partRow(db.prepare('SELECT * FROM parts WHERE id = ?').get(newId))].filter(Boolean) };
                if (!verify.list || verify.list.length === 0) {
                    return { success: false, error: `数据库返回了ID=${newId}，但回读验证失败，记录不存在` };
                }
                const saved = verify.list[0];
                return {
                    success: true,
                    message: '零件新建成功（已验证入库）',
                    part: {
                        model: saved.model || model,
                        category: saved.category || category,
                        price: saved.price || price,
                        supplier: saved.supplier || supplier,
                        stock: saved.stock ?? stock
                    },
                    id: newId
                };
            } catch (verifyErr) {
                return { success: false, error: `创建请求已发送(ID=${newId})，但回读验证异常: ${verifyErr.message}` };
            }
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

            safeUpdate('parts', target.Id, updates);
            invalidatePartsCache();

            // 回读验证
            try {
                const verify = { list: [partRow(db.prepare('SELECT * FROM parts WHERE id = ?').get(target.Id))].filter(Boolean) };
                if (!verify.list || verify.list.length === 0) {
                    return { success: false, error: '回读验证失败，记录不存在' };
                }
                const saved = verify.list[0];
                return {
                    success: true,
                    message: '零件修改成功（已验证）',
                    part: {
                        id: target.Id,
                        model: saved.model || model,
                        category: saved.category,
                        price: saved.price,
                        supplier: saved.supplier,
                        stock: saved.stock
                    },
                    changes
                };
            } catch (verifyErr) {
                return { success: false, error: `修改请求已发送，但回读验证异常: ${verifyErr.message}` };
            }
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
            softDelete('parts', target.Id);
            invalidatePartsCache();
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
                updates.push({ Id: p.Id, price: newPrice });
                details.push({ model: p.model, oldPrice, newPrice });
            }

            for (const u of updates) {
                safeUpdate('parts', u.Id, { price: u.price });
            }
            invalidatePartsCache();

            return {
                success: true,
                message: `已批量更新${targets.length}个"${category}"类零件的价格`,
                category,
                count: targets.length,
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
