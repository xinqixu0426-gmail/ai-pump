const { db, dbGetAllParts, dbGetAllRecipes, orderRow, loadPartsData, calculateRecipeCost, updateOrderFields } = require('../../../db.cjs');

async function executeOrderTool(toolName, args, internalFetch) {
    switch (toolName) {
        case 'create_order': {
            const { customerName, contractNo = '', remark = '', status = '待采购', items = [] } = args;
            if (!customerName) {
                return { success: false, error: '缺少必要参数：客户名称' };
            }

            let orderItems = [];
            if (items && items.length > 0) {
                const allRecipes = dbGetAllRecipes();
                const { partsCache, partsByModel } = loadPartsData();

                for (const reqItem of items) {
                    const recipe = allRecipes.find(r => (r.name) === reqItem.recipeName || r.Id === Number(reqItem.recipeName) || (r.name || '').includes(reqItem.recipeName));
                    if (recipe) {
                        const partsJson = recipe.parts_json || '[]';
                        let parts = [];
                        try { parts = JSON.parse(partsJson); } catch (e) { }
                        const costRes = calculateRecipeCost(parts, partsCache, partsByModel);
                        const unitCost = parseFloat(costRes.totalCost || 0);
                        const profitMargin = 1.10;
                        const unitPrice = Math.round(unitCost * profitMargin * 100) / 100;
                        orderItems.push({
                            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + orderItems.length,
                            recipeId: recipe.Id,
                            recipeName: recipe.name,
                            spec: recipe.spec,
                            qty: reqItem.qty || 1,
                            partsJson: partsJson,
                            unitCost: unitCost,
                            profitMargin: profitMargin,
                            unitPrice: unitPrice
                        });
                    }
                }
            }

            const now_o = new Date().toISOString();
            const createRes = db.prepare('INSERT INTO orders (customer_name, contract_no, remark, status, items_json, purchase_list_json, todos_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
                customerName, contractNo, remark, status, JSON.stringify(orderItems),
                '[]', '[]', now_o, now_o
            );
            createRes.Id = createRes.lastInsertRowid;
            const newId = createRes?.Id || createRes?.id;
            if (!newId) {
                return { success: false, error: '数据库未返回有效ID，订单创建可能失败' };
            }
            // 回读验证
            try {
                const verify = { list: [orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(newId))].filter(Boolean) };
                if (!verify.list || verify.list.length === 0) {
                    return { success: false, error: `数据库返回了ID=${newId}，但回读验证失败` };
                }
                return {
                    success: true,
                    message: '订单新建成功（已验证入库）',
                    order: {
                        id: newId,
                        customerName,
                        contractNo,
                        remark,
                        status,
                        items: orderItems
                    }
                };
            } catch (verifyErr) {
                return { success: false, error: `创建请求已发送(ID=${newId})，但回读验证异常: ${verifyErr.message}` };
            }
        }

        case 'add_recipe_to_order': {
            const { orderId, recipeName, qty = 1 } = args;

            // 1. 获取配方
            const allRecipes = dbGetAllRecipes();
            const recipe = allRecipes.find(r => (r.name) === recipeName || r.Id === Number(recipeName) || (r.name || '').includes(recipeName));
            if (!recipe) return { success: false, error: '找不到匹配的配方: ' + recipeName };

            // 2. 获取订单
            let targetOrder;
            try {
                const orderData = { list: [orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(orderId)))].filter(Boolean) };
                targetOrder = orderData.list?.[0];
            } catch (e) { }
            if (!targetOrder) return { success: false, error: '找不到订单ID: ' + orderId };

            // 3. 更新型号列表
            let itemsList = [];
            try { itemsList = JSON.parse(targetOrder.itemsJson || '[]'); } catch (e) { }

            const partsJson = recipe.parts_json || '[]';
            let parts = [];
            try { parts = JSON.parse(partsJson); } catch (e) { }
            const { partsCache, partsByModel } = loadPartsData();
            const recipeCostResult = calculateRecipeCost(parts, partsCache, partsByModel);
            const unitCost = parseFloat(recipeCostResult.totalCost || 0);

            const profitMargin = 1.10;
            const finalUnitPrice = Math.round(unitCost * profitMargin * 100) / 100;

            itemsList.push({
                id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
                recipeId: recipe.Id,
                recipeName: recipe.name,
                spec: recipe.spec,
                qty: qty,
                partsJson: partsJson,
                unitCost: unitCost,
                profitMargin: profitMargin,
                unitPrice: finalUnitPrice
            });

            // 4. 更新到数据库
            updateOrderFields(targetOrder.Id, { items_json: JSON.stringify(itemsList) });

            return {
                success: true,
                message: `成功向订单${orderId}追加配方：${recipe.name}(数量: ${qty})`,
                orderId,
                itemName: recipe.name,
                qty,
                itemCost: unitCost,
                itemPrice: finalUnitPrice
            };
        }

        case 'get_order_detail': {
            const { orderId } = args;
            const orderData = { list: [orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(orderId)))].filter(Boolean) };
            const row = orderData.list?.[0];
            if (!row) return { success: false, error: '找不到订单ID: ' + orderId };
            let items = []; try { items = JSON.parse(row.itemsJson || '[]'); } catch (e) { }
            let purchaseList = []; try { purchaseList = JSON.parse(row.purchaseListJson || '[]'); } catch (e) { }
            let todos = []; try { todos = JSON.parse(row.todosJson || '[]'); } catch (e) { }
            // 计算汇总
            let totalCost = 0, totalPrice = 0;
            for (const it of items) { totalCost += (it.unitCost || 0) * (it.qty || 0); totalPrice += (it.unitPrice || 0) * (it.qty || 0); }
            return {
                success: true,
                order: {
                    id: row.Id,
                    customerName: row.customerName,
                    contractNo: row.contractNo || '',
                    remark: row.remark || '',
                    status: row.status || '待采购',
                    items,
                    purchaseList,
                    todos,
                    totalCost: Math.round(totalCost * 100) / 100,
                    totalPrice: Math.round(totalPrice * 100) / 100,
                    totalProfit: Math.round((totalPrice - totalCost) * 100) / 100,
                    createdAt: row.CreatedAt,
                    updatedAt: row.UpdatedAt
                }
            };
        }

        case 'update_order_status': {
            const { orderId, status } = args;
            const validStatuses = ['待采购', '采购中', '已完成'];
            if (!validStatuses.includes(status)) return { success: false, error: `无效状态: ${status}，可选: ${validStatuses.join('/')}` };
            const orderData = { list: [orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(orderId)))].filter(Boolean) };
            const row = orderData.list?.[0];
            if (!row) return { success: false, error: '找不到订单ID: ' + orderId };
            const oldStatus = row.status || '待采购';
            updateOrderFields(row.Id, { status });
            return { success: true, message: `订单${orderId}状态已更新`, orderId, oldStatus, newStatus: status, customerName: row.customerName };
        }

        case 'remove_recipe_from_order': {
            const { orderId, recipeName } = args;
            const orderData = { list: [orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(orderId)))].filter(Boolean) };
            const row = orderData.list?.[0];
            if (!row) return { success: false, error: '找不到订单ID: ' + orderId };
            let items = []; try { items = JSON.parse(row.itemsJson || '[]'); } catch (e) { }
            const before = items.length;
            items = items.filter(it => !(it.recipeName || '').includes(recipeName));
            if (items.length === before) return { success: false, error: `订单${orderId}中未找到包含"${recipeName}"的配方` };
            updateOrderFields(row.Id, { items_json: JSON.stringify(items) });
            return { success: true, message: `已从订单${orderId}中移除"${recipeName}"`, orderId, removed: before - items.length, remaining: items.length };
        }

        case 'update_order_item': {
            const { orderId, recipeName, qty, unitPrice, profitMargin } = args;
            const orderData = { list: [orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(orderId)))].filter(Boolean) };
            const row = orderData.list?.[0];
            if (!row) return { success: false, error: '找不到订单ID: ' + orderId };
            let items = []; try { items = JSON.parse(row.itemsJson || '[]'); } catch (e) { }
            const item = items.find(it => (it.recipeName || '').includes(recipeName));
            if (!item) return { success: false, error: `订单${orderId}中未找到"${recipeName}"` };
            const changes = [];
            if (qty !== undefined) { changes.push(`数量: ${item.qty} → ${qty}`); item.qty = qty; }
            if (unitPrice !== undefined) { changes.push(`出厂价: ${item.unitPrice} → ${unitPrice}`); item.unitPrice = unitPrice; }
            if (profitMargin !== undefined) {
                changes.push(`利润率: ${item.profitMargin} → ${profitMargin}`);
                item.profitMargin = profitMargin;
                if (unitPrice === undefined) { item.unitPrice = Math.round(item.unitCost * profitMargin * 100) / 100; changes.push(`出厂价自动调整为: ${item.unitPrice}`); }
            }
            if (changes.length === 0) return { success: false, error: '没有指定要修改的字段' };
            updateOrderFields(row.Id, { items_json: JSON.stringify(items) });
            return { success: true, message: `订单${orderId}中"${item.recipeName}"已更新`, orderId, recipeName: item.recipeName, changes };
        }

        case 'generate_purchase_list': {
            const { orderId } = args;
            const orderData = { list: [orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(orderId)))].filter(Boolean) };
            const row = orderData.list?.[0];
            if (!row) return { success: false, error: '找不到订单ID: ' + orderId };
            let items = []; try { items = JSON.parse(row.itemsJson || '[]'); } catch (e) { }
            if (items.length === 0) return { success: false, error: '订单中没有任何配方，无法生成采购清单' };

            const allParts = dbGetAllParts();
            const partIndex = {};
            const partByModel = {};
            allParts.forEach(p => {
                const m = (p.model || '').trim();
                const s = (p.supplier || '').trim();
                if (m) { partIndex[`${m}|${s}`] = p; if (!partByModel[m]) partByModel[m] = p; }
            });

            // 汇总零件需求
            const merged = {};
            for (const item of items) {
                let parts = []; try { parts = JSON.parse(item.partsJson || '[]'); } catch (e) { continue; }
                for (const rp of parts) {
                    const key = rp.model;
                    if (merged[key]) { merged[key].totalQty += rp.qty * item.qty; }
                    else { merged[key] = { model: rp.model, name: rp.name || rp.model, supplier: rp.supplier || '', totalQty: rp.qty * item.qty }; }
                }
            }

            const purchaseList = [];
            for (const [, m] of Object.entries(merged)) {
                const dbPart = partIndex[`${m.model}|${m.supplier}`] || partByModel[m.model] || null;
                const currentStock = Number(dbPart?.stock ?? dbPart?.stock ?? 0);
                const needToBuy = Math.max(0, m.totalQty - currentStock);
                purchaseList.push({ model: m.model, name: m.name, supplier: m.supplier, totalQty: m.totalQty, currentStock, needToBuy, purchased: false, partId: dbPart?.Id });
            }
            purchaseList.sort((a, b) => a.supplier.localeCompare(b.supplier));

            // 生成 TODO
            const bySupplier = {};
            for (const p of purchaseList) {
                if (p.needToBuy <= 0) continue;
                if (!bySupplier[p.supplier]) bySupplier[p.supplier] = [];
                bySupplier[p.supplier].push(p);
            }
            const todos = [];
            for (const [supplier, parts] of Object.entries(bySupplier)) {
                const detail = parts.map(p => `${p.model}×${p.needToBuy}`).join(', ');
                todos.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), supplier, description: `联系【${supplier}】采购：${detail}`, done: false });
            }

            // 写入订单
            updateOrderFields(row.Id, { purchase_list_json: JSON.stringify(purchaseList), todos_json: JSON.stringify(todos) });

            return {
                success: true,
                message: `订单${orderId}采购清单已生成`,
                orderId,
                purchaseList,
                todos,
                summary: { totalParts: purchaseList.length, needToBuy: purchaseList.filter(p => p.needToBuy > 0).length, suppliers: [...new Set(purchaseList.filter(p => p.needToBuy > 0).map(p => p.supplier))] }
            };
        }

        case 'delete_order': {
            const { orderId } = args;
            const orderData = { list: [orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(orderId)))].filter(Boolean) };
            const row = orderData.list?.[0];
            if (!row) return { success: false, error: '找不到订单ID: ' + orderId };
            db.prepare('DELETE FROM orders WHERE id = ?').run(row.Id);
            return { success: true, message: `订单${orderId}已删除`, orderId, customerName: row.customerName };
        }

        default:
            return null;
    }
}

const ORDER_TOOLS = new Set([
    'create_order', 'add_recipe_to_order', 'get_order_detail',
    'update_order_status', 'remove_recipe_from_order', 'update_order_item',
    'generate_purchase_list', 'delete_order'
]);

module.exports = { executeOrderTool, ORDER_TOOLS };
