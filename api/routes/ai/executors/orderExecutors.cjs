const { getJson, postJson, putJson, patchJson, deleteJson } = require('../internalApiClient.cjs');
const { recordWorkflowRun } = require('./workflowRunRecorder.cjs');
const { canonicalApiResource } = require('./formalResource.cjs');
const {
    executeOrderReadinessAction,
} = require('../../../services/aiOrderReadinessExecution.cjs');

function parseJsonArray(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function requireEditReason(value) {
    const reason = String(value || '').trim();
    if (!reason) {
        const error = new Error('修改订单必须先向用户确认并填写修改原因');
        error.code = 'order_edit_reason_required';
        throw error;
    }
    return reason;
}

function resolveOrderItem(items, args = {}) {
    const orderItemId = String(args.orderItemId || '').trim();
    const recipeName = String(args.recipeName || '').trim();
    if (orderItemId) {
        const matchIndex = items.findIndex(item => String(item?.id || '').trim() === orderItemId);
        if (matchIndex < 0) {
            return { error: `订单中未找到产品明细 ID：${orderItemId}`, code: 'order_item_not_found' };
        }
        const item = items[matchIndex];
        if (recipeName && String(item?.recipeName || '').trim() !== recipeName) {
            return {
                error: `产品明细 ${orderItemId} 与型号“${recipeName}”不一致`,
                code: 'order_item_identity_mismatch',
            };
        }
        return { item, index: matchIndex };
    }
    return { error: '请提供 orderItemId', code: 'order_item_identity_required' };
}

async function loadRecipes(internalFetch) {
    return getJson(internalFetch, '/api/recipes', '配方列表读取失败');
}

function findRecipe(recipes, recipeName) {
    return (recipes || []).find(r => (r.name) === recipeName || r.id === Number(recipeName) || r.Id === Number(recipeName) || (r.name || '').includes(recipeName));
}

function resolveRecipeUnitCost(recipe) {
    const savedCost = Number(recipe?.savedTotalCost || 0);
    if (Number.isFinite(savedCost) && savedCost > 0) return savedCost;
    throw new Error(`配方“${recipe?.name || recipe?.id || recipe?.Id || ''}”缺少完整保存成本，请先重新保存配方`);
}

async function buildOrderItemFromRecipe(internalFetch, recipe, qty = 1) {
    const unitCost = resolveRecipeUnitCost(recipe);
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
        orderId: orderLike.orderId,
        customerName: orderLike.customerName,
        contractNo: orderLike.contractNo || '',
        remark: orderLike.remark || '',
        status: orderLike.status || '待采购',
        items: orderLike.items || [],
        purchaseList: orderLike.purchaseList,
        todos: orderLike.todos,
        editReason: orderLike.editReason,
    }, '生成订单保存草稿失败');
}

async function loadOrder(internalFetch, orderId) {
    const id = Number.parseInt(orderId, 10);
    if (!Number.isFinite(id) || id <= 0) return null;
    try {
        return await getJson(internalFetch, `/api/orders/${id}`, '订单读取失败');
    } catch (error) {
        if (error.code === 'AI_RESOURCE_NOT_FOUND') return null;
        throw error;
    }
}

async function resolveOrderTarget(internalFetch, args = {}) {
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
        orderId: order.id ?? order.Id,
        customerName: order.customerName,
        contractNo: order.contractNo || '',
        remark: order.remark || '',
        status: options.status || order.status || '待采购',
        items,
        purchaseList: options.purchaseList,
        todos: options.todos,
        editReason: options.editReason,
    });
    return patchJson(internalFetch, `/api/orders/${order.id ?? order.Id}`, {
        ...payload,
        expectedUpdatedAt: order.updatedAt || order.UpdatedAt,
    }, '订单保存失败');
}

async function executeOrderTool(toolName, args, internalFetch) {
    switch (toolName) {
        case 'get_purchase_overview': {
            const query = new URLSearchParams();
            for (const field of ['limit', 'supplier', 'pendingOnly']) {
                const value = String(args[field] ?? '').trim();
                if (value) query.set(field, value);
            }
            const data = await getJson(
                internalFetch,
                `/api/orders/purchase-overview${query.size ? `?${query.toString()}` : ''}`,
                '采购总览读取失败'
            );
            const returnedCount = Number(data.returnedCount ?? data.tasks?.length ?? 0);
            const totalCount = Number(data.summary?.taskCount ?? returnedCount);
            const appliedFilters = Object.fromEntries(
                Object.entries(data.filters || {
                    supplier: String(args.supplier || '').trim(),
                    pendingOnly: Boolean(args.pendingOnly),
                    limit: args.limit == null ? null : Number(args.limit),
                }).filter(([, value]) => value !== '' && value !== null && value !== undefined)
            );
            return {
                success: true,
                data,
                queryReceipt: {
                    appliedFilters,
                    totalCount,
                    returnedCount,
                    truncated: Boolean(data.truncated),
                    possiblyTruncated: args.limit != null
                        && returnedCount >= Number(args.limit),
                    authoritative: true,
                },
                selectionBoundary: 'data 已由正式采购总览 API 按 filters 聚合；不能补充未返回的采购任务。',
            };
        }

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

        case 'save_order_execution_draft': {
            if (!args.orderId) return { success: false, error: '缺少订单ID' };
            if (!String(args.summaryText || '').trim()) return { success: false, error: '执行事实说明不能为空' };
            const data = await postJson(
                internalFetch,
                `/api/orders/${args.orderId}/execution-records`,
                {
                    phase: args.phase,
                    recordType: args.recordType,
                    title: args.title,
                    summaryText: args.summaryText,
                    occurredAt: args.occurredAt,
                    sourceFileIds: args.sourceFileIds,
                },
                '订单执行档案草稿保存失败'
            );
            return {
                success: true,
                message: '订单执行档案草稿已保存，仍需在订单页面人工确认后才进入知识库。',
                executionRecord: data,
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
            const editReason = requireEditReason(args.reason);

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
                await saveExistingOrder(internalFetch, targetOrder, itemsList, {
                    editReason,
                });
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
            const resolved = await resolveOrderTarget(internalFetch, args);
            if (resolved.error) {
                return {
                    success: false,
                    error: resolved.error,
                    candidates: resolved.candidates || [],
                };
            }
            const row = await loadOrder(internalFetch, resolved.orderId);
            if (!row) {
                return {
                    success: false,
                    code: 'AI_RESOURCE_NOT_FOUND',
                    error: '找不到订单ID: ' + resolved.orderId,
                };
            }
            const canonicalOrder = canonicalApiResource(row);
            const items = parseJsonArray(canonicalOrder.itemsJson);
            const purchaseList = parseJsonArray(canonicalOrder.purchaseListJson);
            const todos = parseJsonArray(canonicalOrder.todosJson);
            // 计算汇总
            let totalCost = 0, totalPrice = 0;
            for (const it of items) { totalCost += (it.unitCost || 0) * (it.qty || 0); totalPrice += (it.unitPrice || 0) * (it.qty || 0); }
            return {
                success: true,
                order: {
                    ...canonicalOrder,
                    items,
                    purchaseList,
                    todos,
                    totalCost: Math.round(totalCost * 100) / 100,
                    totalPrice: Math.round(totalPrice * 100) / 100,
                    totalProfit: Math.round((totalPrice - totalCost) * 100) / 100,
                }
            };
        }

        case 'get_order_knowledge_package': {
            const resolved = await resolveOrderTarget(internalFetch, args);
            if (resolved.error) {
                return {
                    success: false,
                    error: resolved.error,
                    candidates: resolved.candidates || [],
                };
            }
            const data = await getJson(
                internalFetch,
                `/api/orders/${resolved.orderId}/knowledge-package`,
                '订单知识包读取失败'
            );
            return {
                success: true,
                intent: 'order_knowledge_package',
                summary: `已读取订单 #${resolved.orderId} 的实时业务状态和人工确认事实。`,
                display: { mode: 'compact', title: '订单知识包' },
                data,
            };
        }

        case 'check_order_readiness': {
            const resolved = await resolveOrderTarget(internalFetch, args);
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
            const resolved = await resolveOrderTarget(internalFetch, args);
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
            return executeOrderReadinessAction(args, {
                internalFetch,
                getJson,
                postJson,
                recordWorkflowRun,
            });
        }

        case 'update_order_status': {
            const {
                orderId,
                status,
                reason,
                inventoryDisposition,
                inventoryDispositionNote,
            } = args;
            const validStatuses = ['待采购', '已关闭', '已取消'];
            if (!validStatuses.includes(status)) return { success: false, error: `无效状态: ${status}，可选: ${validStatuses.join('/')}` };
            const row = await loadOrder(internalFetch, orderId);
            if (!row) return { success: false, error: '找不到订单ID: ' + orderId };
            const oldStatus = row.status || '待确认';
            try {
                const draft = await postJson(
                    internalFetch,
                    `/api/orders/${row.id ?? row.Id}/status-draft`,
                    {
                        status,
                        reason,
                        inventoryDisposition,
                        inventoryDispositionNote,
                    },
                    '订单状态预览生成失败'
                );
                await postJson(internalFetch, `/api/orders/${row.id ?? row.Id}/status`, {
                    status,
                    reason,
                    inventoryDisposition,
                    inventoryDispositionNote,
                    expectedUpdatedAt: draft.expectedUpdatedAt,
                    previewHash: draft.previewHash,
                }, '订单状态更新失败');
                return { success: true, message: `订单${orderId}状态已更新`, orderId, oldStatus, newStatus: status, customerName: row.customerName };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }

        case 'remove_recipe_from_order': {
            const { orderId } = args;
            const editReason = requireEditReason(args.reason);
            const row = await loadOrder(internalFetch, orderId);
            if (!row) return { success: false, error: '找不到订单ID: ' + orderId };
            const items = parseJsonArray(row.itemsJson);
            const resolved = resolveOrderItem(items, args);
            if (resolved.error) return { success: false, ...resolved };
            const [removedItem] = items.splice(resolved.index, 1);
            try {
                await saveExistingOrder(internalFetch, row, items, {
                    editReason,
                });
                return {
                    success: true,
                    message: `已从订单${orderId}中移除“${removedItem.recipeName || removedItem.id}”`,
                    orderId,
                    orderItemId: String(removedItem.id || ''),
                    recipeName: removedItem.recipeName || '',
                    removed: 1,
                    remaining: items.length,
                };
            } catch (error) {
                return {
                    success: false,
                    code: error.code || 'order_update_failed',
                    error: error.message,
                };
            }
        }

        case 'update_order_item': {
            const { orderId, qty, unitPrice, profitMargin } = args;
            const editReason = requireEditReason(args.reason);
            const row = await loadOrder(internalFetch, orderId);
            if (!row) return { success: false, error: '找不到订单ID: ' + orderId };
            let items = parseJsonArray(row.itemsJson);
            const resolved = resolveOrderItem(items, args);
            if (resolved.error) return { success: false, ...resolved };
            const item = resolved.item;
            const changes = [];
            if (qty !== undefined) { changes.push(`数量: ${item.qty} → ${qty}`); item.qty = qty; }
            if (unitPrice !== undefined) { changes.push(`销售单价: ${item.unitPrice} → ${unitPrice}`); item.unitPrice = unitPrice; }
            if (profitMargin !== undefined) {
                changes.push(`利润率: ${item.profitMargin} → ${profitMargin}`);
                item.profitMargin = profitMargin;
                if (unitPrice === undefined) { item.unitPrice = Math.round(item.unitCost * profitMargin * 100) / 100; changes.push(`销售单价自动调整为: ${item.unitPrice}`); }
            }
            if (changes.length === 0) return { success: false, error: '没有指定要修改的字段' };
            try {
                await saveExistingOrder(internalFetch, row, items, {
                    editReason,
                });
                return {
                    success: true,
                    message: `订单${orderId}中“${item.recipeName}”已更新`,
                    orderId,
                    orderItemId: String(item.id || ''),
                    recipeName: item.recipeName,
                    changes,
                };
            } catch (error) {
                return {
                    success: false,
                    code: error.code || 'order_update_failed',
                    error: error.message,
                };
            }
        }

        case 'generate_purchase_list': {
            const { orderId } = args;
            const editReason = requireEditReason(args.reason);
            const row = await loadOrder(internalFetch, orderId);
            if (!row) return { success: false, error: '找不到订单ID: ' + orderId };
            let items = parseJsonArray(row.itemsJson);
            if (items.length === 0) return { success: false, error: '订单中没有任何配方，无法生成采购清单' };

            try {
                const payload = await buildOrderSavePayload(internalFetch, {
                    orderId: row.id ?? row.Id,
                    customerName: row.customerName,
                    contractNo: row.contractNo || '',
                    remark: row.remark || '',
                    status: row.status || '待采购',
                    items,
                    editReason,
                });
                await patchJson(internalFetch, `/api/orders/${row.id ?? row.Id}`, {
                    ...payload,
                    expectedUpdatedAt: row.updatedAt || row.UpdatedAt,
                }, '采购清单保存失败');
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
            await deleteJson(
                internalFetch,
                `/api/orders/${row.id ?? row.Id}`,
                '订单删除失败',
                { expectedUpdatedAt: row.updatedAt || row.UpdatedAt }
            );
            return { success: true, message: `订单${orderId}已删除`, orderId, customerName: row.customerName };
        }

        default:
            return null;
    }
}

module.exports = { executeOrderTool };
