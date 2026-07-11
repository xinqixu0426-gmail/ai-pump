const { db, dbGetAllRecipes, orderRow, loadPartsData, calculateRecipeCost } = require('../../../db.cjs');
const { resolveRecipeLockedUnitCost } = require('../../../services/orderCostLock.cjs');

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

function parseJsonArray(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function buildOrderItemFromRecipe(recipe, qty = 1) {
    const { partsCache, partsByModel } = loadPartsData();
    const unitCost = resolveRecipeLockedUnitCost(recipe, partsCache, partsByModel, calculateRecipeCost);
    const profitMargin = 1.10;
    const unitPrice = Math.round(unitCost * profitMargin * 100) / 100;
    return {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        recipeId: recipe.Id,
        recipeName: recipe.name,
        spec: recipe.spec,
        qty,
        partsJson: recipe.partsJson || '[]',
        unitCost,
        profitMargin,
        unitPrice
    };
}

async function buildOrderSavePayload(internalFetch, orderLike) {
    return postJson(internalFetch, '/api/orders/save-payload-draft', {
        customerName: orderLike.customerName,
        contractNo: orderLike.contractNo || '',
        remark: orderLike.remark || '',
        status: orderLike.status || '待采购',
        items: orderLike.items || [],
        purchaseList: orderLike.purchaseList,
        todos: orderLike.todos,
    }, '生成订单保存草稿失败');
}

async function saveExistingOrder(internalFetch, order, items, options = {}) {
    const payload = await buildOrderSavePayload(internalFetch, {
        customerName: order.customerName,
        contractNo: order.contractNo || '',
        remark: order.remark || '',
        status: options.status || order.status || '待采购',
        items,
        purchaseList: options.purchaseList,
        todos: options.todos,
    });
    return patchJson(internalFetch, `/api/orders/${order.Id}`, payload, '订单保存失败');
}

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

                for (const reqItem of items) {
                    const recipe = allRecipes.find(r => (r.name) === reqItem.recipeName || r.Id === Number(reqItem.recipeName) || (r.name || '').includes(reqItem.recipeName));
                    if (recipe) {
                        orderItems.push(buildOrderItemFromRecipe(recipe, reqItem.qty || 1));
                    }
                }
            }

            try {
                const payload = await buildOrderSavePayload(internalFetch, { customerName, contractNo, remark, status, items: orderItems });
                const saved = await postJson(internalFetch, '/api/orders', payload, '订单创建失败');
                return {
                    success: true,
                    message: '订单新建成功（已通过标准 API 写入）',
                    order: {
                        id: saved.id || saved.Id,
                        customerName: saved.customerName || customerName,
                        contractNo: saved.contractNo || contractNo,
                        remark: saved.remark || remark,
                        status: saved.status || status,
                        items: orderItems
                    }
                };
            } catch (error) {
                return { success: false, error: error.message };
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

            const item = buildOrderItemFromRecipe(recipe, qty);
            itemsList.push(item);

            try {
                await saveExistingOrder(internalFetch, targetOrder, itemsList);
                return {
                    success: true,
                    message: `成功向订单${orderId}追加配方：${recipe.name}(数量: ${qty})`,
                    orderId,
                    itemName: recipe.name,
                    qty,
                    itemCost: item.unitCost,
                    itemPrice: item.unitPrice
                };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }

        case 'get_order_detail': {
            const { orderId } = args;
            const orderData = { list: [orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(orderId)))].filter(Boolean) };
            const row = orderData.list?.[0];
            if (!row) return { success: false, error: '找不到订单ID: ' + orderId };
            let items = parseJsonArray(row.itemsJson);
            let purchaseList = parseJsonArray(row.purchaseListJson);
            let todos = parseJsonArray(row.todosJson);
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
            try {
                await postJson(internalFetch, `/api/orders/${row.Id}/status`, { status }, '订单状态更新失败');
                return { success: true, message: `订单${orderId}状态已更新`, orderId, oldStatus, newStatus: status, customerName: row.customerName };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }

        case 'remove_recipe_from_order': {
            const { orderId, recipeName } = args;
            const orderData = { list: [orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(orderId)))].filter(Boolean) };
            const row = orderData.list?.[0];
            if (!row) return { success: false, error: '找不到订单ID: ' + orderId };
            let items = parseJsonArray(row.itemsJson);
            const before = items.length;
            items = items.filter(it => !(it.recipeName || '').includes(recipeName));
            if (items.length === before) return { success: false, error: `订单${orderId}中未找到包含"${recipeName}"的配方` };
            try {
                await saveExistingOrder(internalFetch, row, items);
                return { success: true, message: `已从订单${orderId}中移除"${recipeName}"`, orderId, removed: before - items.length, remaining: items.length };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }

        case 'update_order_item': {
            const { orderId, recipeName, qty, unitPrice, profitMargin } = args;
            const orderData = { list: [orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(orderId)))].filter(Boolean) };
            const row = orderData.list?.[0];
            if (!row) return { success: false, error: '找不到订单ID: ' + orderId };
            let items = parseJsonArray(row.itemsJson);
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
            try {
                await saveExistingOrder(internalFetch, row, items);
                return { success: true, message: `订单${orderId}中"${item.recipeName}"已更新`, orderId, recipeName: item.recipeName, changes };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }

        case 'generate_purchase_list': {
            const { orderId } = args;
            const orderData = { list: [orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(orderId)))].filter(Boolean) };
            const row = orderData.list?.[0];
            if (!row) return { success: false, error: '找不到订单ID: ' + orderId };
            let items = parseJsonArray(row.itemsJson);
            if (items.length === 0) return { success: false, error: '订单中没有任何配方，无法生成采购清单' };

            try {
                const payload = await buildOrderSavePayload(internalFetch, {
                    customerName: row.customerName,
                    contractNo: row.contractNo || '',
                    remark: row.remark || '',
                    status: row.status || '待采购',
                    items,
                });
                await patchJson(internalFetch, `/api/orders/${row.Id}`, payload, '采购清单保存失败');
                const purchaseList = parseJsonArray(payload.purchaseListJson);
                const todos = parseJsonArray(payload.todosJson);
                return {
                    success: true,
                    message: `订单${orderId}采购清单已生成`,
                    orderId,
                    purchaseList,
                    todos,
                    summary: { totalParts: purchaseList.length, needToBuy: purchaseList.filter(p => p.needToBuy > 0).length, suppliers: [...new Set(purchaseList.filter(p => p.needToBuy > 0).map(p => p.supplier))] }
                };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }

        case 'delete_order': {
            const { orderId } = args;
            const orderData = { list: [orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(orderId)))].filter(Boolean) };
            const row = orderData.list?.[0];
            if (!row) return { success: false, error: '找不到订单ID: ' + orderId };
            const response = await internalFetch(`/api/orders/${row.Id}`, { method: 'DELETE' });
            const result = await response.json();
            if (!result.success) {
                return { success: false, error: result.error || '订单删除失败' };
            }
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
