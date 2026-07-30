const { getJson, postJson, putJson, patchJson, deleteJson } = require('../internalApiClient.cjs');
const { recordWorkflowRun } = require('./workflowRunRecorder.cjs');

function parseJsonArray(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function loadRecipes(internalFetch) {
    return getJson(internalFetch, '/api/recipes', '配方列表读取失败');
}

function findRecipe(recipes, recipeName) {
    return (recipes || []).find(r => (r.name) === recipeName || r.id === Number(recipeName) || r.Id === Number(recipeName) || (r.name || '').includes(recipeName));
}

async function resolveRecipeUnitCost(internalFetch, recipe) {
    const savedCost = Number(recipe?.savedTotalCost || 0);
    if (Number.isFinite(savedCost) && savedCost > 0) return savedCost;
    const recipeId = recipe?.id ?? recipe?.Id;
    if (!recipeId) return 0;
    const result = await getJson(internalFetch, `/api/recipes/${recipeId}/cost`, '配方成本计算失败');
    return Number.parseFloat(result.totalCost || 0) || 0;
}

async function buildOrderItemFromRecipe(internalFetch, recipe, qty = 1) {
    const unitCost = await resolveRecipeUnitCost(internalFetch, recipe);
    const profitMargin = 1.10;
    const unitPrice = Math.round(unitCost * profitMargin * 100) / 100;
    return {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        recipeId: recipe.id ?? recipe.Id,
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

async function loadOrder(internalFetch, orderId) {
    const id = Number.parseInt(orderId, 10);
    if (!Number.isFinite(id) || id <= 0) return null;
    try {
        return await getJson(internalFetch, `/api/orders/${id}`, '订单读取失败');
    } catch {
        return null;
    }
}

async function resolveOrderForReadiness(internalFetch, args = {}) {
    const explicitId = Number.parseInt(args.orderId, 10);
    if (Number.isInteger(explicitId) && explicitId > 0) {
        return { orderId: explicitId };
    }

    const query = String(args.orderQuery || '').trim();
    if (!query) return { error: '请提供订单ID、客户名称或合同号' };
    const orders = await getJson(
        internalFetch,
        `/api/orders/lookup?query=${encodeURIComponent(query)}`,
        '订单只读查询失败'
    );
    const normalized = query.toLowerCase();
    const exact = (orders || []).filter(order => (
        String(order.id || '') === query
        || String(order.contractNo || '').trim().toLowerCase() === normalized
        || String(order.customerName || '').trim().toLowerCase() === normalized
    ));
    const partial = exact.length > 0 ? exact : (orders || []).filter(order => (
        String(order.contractNo || '').toLowerCase().includes(normalized)
        || String(order.customerName || '').toLowerCase().includes(normalized)
    ));
    if (partial.length === 0) return { error: `未找到匹配订单：${query}` };
    if (partial.length > 1) {
        return {
            error: `匹配到 ${partial.length} 个订单，请明确订单ID或合同号`,
            candidates: partial.slice(0, 5).map(order => ({
                id: order.id,
                customerName: order.customerName,
                contractNo: order.contractNo || '',
                status: order.status,
            })),
        };
    }
    return { orderId: Number(partial[0].id) };
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
    return patchJson(internalFetch, `/api/orders/${order.id ?? order.Id}`, payload, '订单保存失败');
}

async function executeOrderTool(toolName, args, internalFetch) {
    switch (toolName) {
        case 'save_order_requirement_draft': {
            if (!args.orderId) return { success: false, error: '缺少订单ID' };
            if (!String(args.summaryText || '').trim()) return { success: false, error: '客户要求摘要不能为空' };
            const data = await putJson(
                internalFetch,
                `/api/orders/${args.orderId}/requirements/draft`,
                {
                    summaryText: args.summaryText,
                    sourceFileIds: args.sourceFileIds,
                },
                '客户要求草稿保存失败'
            );
            return {
                success: true,
                message: '客户要求草稿已保存，仍需在订单页面人工确认后才进入知识库。',
                requirement: data,
            };
        }

        case 'create_order': {
            const { customerName, contractNo = '', remark = '', status = '待采购', items = [] } = args;
            if (!customerName) {
                return { success: false, error: '缺少必要参数：客户名称' };
            }

            let orderItems = [];
            if (items && items.length > 0) {
                const allRecipes = await loadRecipes(internalFetch);

                for (const reqItem of items) {
                    const recipe = findRecipe(allRecipes, reqItem.recipeName);
                    if (recipe) {
                        orderItems.push(await buildOrderItemFromRecipe(internalFetch, recipe, reqItem.qty || 1));
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
            const recipe = findRecipe(await loadRecipes(internalFetch), recipeName);
            if (!recipe) return { success: false, error: '找不到匹配的配方: ' + recipeName };

            // 2. 获取订单
            const targetOrder = await loadOrder(internalFetch, orderId);
            if (!targetOrder) return { success: false, error: '找不到订单ID: ' + orderId };

            // 3. 更新型号列表
            let itemsList = [];
            try { itemsList = JSON.parse(targetOrder.itemsJson || '[]'); } catch (e) { }

            const item = await buildOrderItemFromRecipe(internalFetch, recipe, qty);
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
            const row = await loadOrder(internalFetch, orderId);
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
                    id: row.id ?? row.Id,
                    customerName: row.customerName,
                    contractNo: row.contractNo || '',
                    remark: row.remark || '',
                    status: row.status || '待确认',
                    items,
                    purchaseList,
                    todos,
                    totalCost: Math.round(totalCost * 100) / 100,
                    totalPrice: Math.round(totalPrice * 100) / 100,
                    totalProfit: Math.round((totalPrice - totalCost) * 100) / 100,
                    createdAt: row.createdAt ?? row.CreatedAt,
                    updatedAt: row.updatedAt ?? row.UpdatedAt
                }
            };
        }

        case 'check_order_readiness': {
            const resolved = await resolveOrderForReadiness(internalFetch, args);
            if (resolved.error) {
                return {
                    success: false,
                    error: resolved.error,
                    candidates: resolved.candidates || [],
                };
            }
            const data = await getJson(
                internalFetch,
                `/api/orders/${resolved.orderId}/readiness`,
                '订单生产准备检查失败'
            );
            return {
                success: true,
                intent: 'order_readiness',
                summary: data.summary,
                display: { mode: 'compact', title: '订单生产准备' },
                data,
            };
        }

        case 'get_order_readiness_overview': {
            const data = await getJson(
                internalFetch,
                '/api/orders/readiness-overview',
                '订单生产准备总览读取失败'
            );
            return {
                success: true,
                intent: 'order_readiness_overview',
                summary: data.summary,
                display: { mode: 'compact', title: '订单准备总览' },
                data,
            };
        }

        case 'plan_order_readiness_actions': {
            const resolved = await resolveOrderForReadiness(internalFetch, args);
            if (resolved.error) {
                return {
                    success: false,
                    error: resolved.error,
                    candidates: resolved.candidates || [],
                };
            }
            const data = await getJson(
                internalFetch,
                `/api/orders/${resolved.orderId}/readiness-plan`,
                '订单生产准备处理方案生成失败'
            );
            return {
                success: true,
                intent: 'order_readiness_plan',
                summary: data.summary,
                display: { mode: 'compact', title: '订单处理方案' },
                data,
            };
        }

        case 'execute_order_readiness_action': {
            const orderId = Number.parseInt(args.orderId, 10);
            const actionId = String(args.actionId || '').trim();
            if (!Number.isInteger(orderId) || orderId <= 0) {
                return { success: false, error: '订单ID无效' };
            }
            if (!['confirm_order', 'generate_purchase_plan'].includes(actionId)) {
                return { success: false, error: `不支持的订单处理步骤：${actionId}` };
            }
            const startedAt = new Date().toISOString();
            let currentPlan = null;
            try {
                currentPlan = await postJson(
                    internalFetch,
                    '/api/workbench/execution-plan',
                    {
                        workflowType: 'order_readiness',
                        orderId,
                        goal: `处理订单 #${orderId} 的生产准备问题`,
                    },
                    '执行前刷新订单计划失败'
                );
                const step = (Array.isArray(currentPlan.steps) ? currentPlan.steps : [])
                    .find(item => item.id === actionId);
                if (!step || step.status !== 'available' || step.canExecute !== true) {
                    throw new Error(`当前计划中的“${actionId}”步骤已不可执行，请按最新状态处理。`);
                }
                const data = await postJson(
                    internalFetch,
                    `/api/orders/${orderId}/readiness-actions/${encodeURIComponent(actionId)}`,
                    {},
                    '订单处理步骤执行失败'
                );
                const recorded = await recordWorkflowRun(internalFetch, {
                    workflowType: 'order_readiness',
                    subjectType: 'order',
                    subjectId: orderId,
                    actionId,
                    toolName: 'execute_order_readiness_action',
                    status: 'completed',
                    plan: currentPlan,
                    result: {
                        orderId,
                        orderStatus: data.order?.status || '',
                        nextPlanStatus: data.nextPlan?.planStatus || '',
                    },
                    recheck: data.nextPlan || {},
                    outcomeSummary: `订单 #${orderId} 已执行“${data.action?.title || actionId}”`,
                    startedAt,
                });
                return {
                    success: true,
                    intent: 'order_readiness_action',
                    message: `已执行：${data.action?.title || actionId}`,
                    display: { mode: 'compact', title: '订单处理结果' },
                    data: {
                        ...data,
                        executionRun: recorded.run,
                        historyWarning: recorded.warning,
                    },
                };
            } catch (error) {
                const fallbackPlan = currentPlan || {
                    workflowType: 'order_readiness',
                    subject: { type: 'order', id: orderId },
                    steps: [],
                };
                const recorded = await recordWorkflowRun(internalFetch, {
                    workflowType: 'order_readiness',
                    subjectType: 'order',
                    subjectId: orderId,
                    actionId,
                    toolName: 'execute_order_readiness_action',
                    status: 'failed',
                    plan: fallbackPlan,
                    recheck: currentPlan || {},
                    outcomeSummary: '订单处理步骤执行失败',
                    error: error.message,
                    startedAt,
                });
                return {
                    success: false,
                    error: error.message,
                    data: {
                        currentPlan,
                        executionRun: recorded.run,
                        historyWarning: recorded.warning,
                    },
                };
            }
        }

        case 'update_order_status': {
            const { orderId, status, reason } = args;
            const validStatuses = ['待采购', '已关闭', '已取消'];
            if (!validStatuses.includes(status)) return { success: false, error: `无效状态: ${status}，可选: ${validStatuses.join('/')}` };
            const row = await loadOrder(internalFetch, orderId);
            if (!row) return { success: false, error: '找不到订单ID: ' + orderId };
            const oldStatus = row.status || '待确认';
            try {
                await postJson(internalFetch, `/api/orders/${row.id ?? row.Id}/status`, { status, reason }, '订单状态更新失败');
                return { success: true, message: `订单${orderId}状态已更新`, orderId, oldStatus, newStatus: status, customerName: row.customerName };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }

        case 'remove_recipe_from_order': {
            const { orderId, recipeName } = args;
            const row = await loadOrder(internalFetch, orderId);
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
            const row = await loadOrder(internalFetch, orderId);
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
            const row = await loadOrder(internalFetch, orderId);
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
                await patchJson(internalFetch, `/api/orders/${row.id ?? row.Id}`, payload, '采购清单保存失败');
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
            const row = await loadOrder(internalFetch, orderId);
            if (!row) return { success: false, error: '找不到订单ID: ' + orderId };
            await deleteJson(internalFetch, `/api/orders/${row.id ?? row.Id}`, '订单删除失败');
            return { success: true, message: `订单${orderId}已删除`, orderId, customerName: row.customerName };
        }

        default:
            return null;
    }
}

const ORDER_TOOLS = new Set([
    'create_order', 'add_recipe_to_order', 'get_order_detail',
    'update_order_status', 'remove_recipe_from_order', 'update_order_item',
    'generate_purchase_list', 'delete_order', 'get_order_readiness_overview',
    'check_order_readiness', 'plan_order_readiness_actions', 'execute_order_readiness_action'
]);

module.exports = { executeOrderTool, ORDER_TOOLS };
