const { Router } = require('express');
const { randomUUID } = require('crypto');
const { db, dbGetAllOrders, dbGetAllParts, orderRow, safeInsert, safeUpdate, softDelete, invalidatePartsCache } = require('../db.cjs');
const { buildOrderPlan, buildBalancedOrderPlans } = require('../services/orderPlanning.cjs');
const {
    ORDER_STATUSES,
    TERMINAL_ORDER_STATUSES,
    normalizePurchaseItem,
    validatePurchaseProgress,
    deriveProcurementStatus,
    assertOrderTransition,
} = require('../services/orderWorkflow.cjs');
const { parsePositiveId, parseJsonArray, parseNonNegativeNumber, parsePositiveNumber } = require('../services/validation.cjs');
const router = Router();

const ORDER_FIELDS = ['customer_name', 'contract_no', 'remark', 'items_json', 'purchase_list_json', 'todos_json'];
const ORDER_ALIASES = {
    customerName: 'customer_name',
    contractNo: 'contract_no',
    itemsJson: 'items_json',
    purchaseListJson: 'purchase_list_json',
    todosJson: 'todos_json',
};
const ACTIVE_ORDERS_SQL = `
    SELECT * FROM orders
    WHERE deleted_at IS NULL AND status NOT IN ('已关闭', '已取消')
    ORDER BY created_at, id
`;

function orderBodyToDb(body) {
    const updates = {};
    for (const f of ORDER_FIELDS) {
        if (body[f] !== undefined) updates[f] = body[f];
    }
    for (const [camel, snake] of Object.entries(ORDER_ALIASES)) {
        if (body[camel] !== undefined) updates[snake] = body[camel];
    }
    return updates;
}

function getOrderRecord(id) {
    const record = db.prepare('SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!record) throw new Error('订单不存在');
    return record;
}

function parseOrderJsonArray(record, field) {
    return parseJsonArray(record?.[field]);
}

function roundMoney(value) {
    return Math.round(value * 100) / 100;
}

function normalizeOrderItems(items) {
    if (!Array.isArray(items)) return [];
    return items
        .filter(item => item && (item.recipeName || item.recipeId || item.partsJson))
        .map((item, index) => {
            const unitCost = parseNonNegativeNumber(item.unitCost, `items[${index}].unitCost`);
            const unitPrice = parseNonNegativeNumber(item.unitPrice, `items[${index}].unitPrice`);
            return {
                id: String(item.id || `order-item-${Date.now()}-${index}`),
                recipeId: parsePositiveId(item.recipeId) || undefined,
                recipeName: String(item.recipeName || '未命名产品'),
                spec: String(item.spec || ''),
                qty: parsePositiveNumber(item.qty, `items[${index}].qty`, { defaultValue: 1 }),
                unitCost: roundMoney(unitCost),
                unitPrice: roundMoney(unitPrice),
                profitMargin: unitCost > 0 ? roundMoney(unitPrice / unitCost) : parsePositiveNumber(item.profitMargin, `items[${index}].profitMargin`, { defaultValue: 1.1 }),
                partsJson: String(item.partsJson || '[]'),
            };
        });
}

function buildOrderSavePayloadDraft(body) {
    const customerName = String(body?.customerName || '').trim();
    if (!customerName) throw new Error('客户名称不能为空');
    const items = normalizeOrderItems(body?.items);
    if (items.length === 0) throw new Error('至少添加一个订单产品');

    const providedPurchaseList = parseJsonArray(body?.purchaseList);
    const providedTodos = parseJsonArray(body?.todos);
    const plan = (providedPurchaseList.length > 0 || providedTodos.length > 0)
        ? { purchaseList: providedPurchaseList, todos: providedTodos }
        : (() => {
            const activeOrders = db.prepare(ACTIVE_ORDERS_SQL).all();
            const draftOrder = { id: -1, created_at: new Date().toISOString(), items, purchase_list_json: '[]' };
            return buildBalancedOrderPlans([...activeOrders, draftOrder], dbGetAllParts()).get(-1);
        })();
    const status = body?.status || '待确认';
    if (!ORDER_STATUSES.has(status)) throw new Error('非法订单状态');

    return {
        customerName,
        contractNo: String(body?.contractNo || '').trim(),
        remark: String(body?.remark || ''),
        status,
        itemsJson: JSON.stringify(items),
        purchaseListJson: JSON.stringify(plan.purchaseList || []),
        todosJson: JSON.stringify(plan.todos || []),
    };
}

function syncBalancedPurchasePlans() {
    const records = db.prepare(ACTIVE_ORDERS_SQL).all();
    const plans = buildBalancedOrderPlans(records, dbGetAllParts());
    for (const record of records) {
        const plan = plans.get(record.id);
        if (!plan) continue;
        const nextJson = JSON.stringify(plan.purchaseList);
        if (nextJson !== String(record.purchase_list_json || '[]')) {
            safeUpdate('orders', record.id, { purchase_list_json: nextJson });
        }
    }
    return plans;
}

function updateOrderRecord(id, body) {
    const record = getOrderRecord(id);
    if (record.status !== '待确认') {
        const error = new Error('订单确认后不能修改核心明细，只能通过采购和状态动作继续处理');
        error.statusCode = 409;
        throw error;
    }
    const updates = orderBodyToDb(body);
    delete updates.status;
    safeUpdate('orders', id, updates);
    return orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
}

function setOrderStatus(id, status, reason = '') {
    const record = getOrderRecord(id);
    assertOrderTransition(record.status, status, { reason });
    const now = new Date().toISOString();
    const purchaseList = parseOrderJsonArray(record, 'purchase_list_json').map(normalizePurchaseItem);
    const nextStatus = status === '待采购'
        ? deriveProcurementStatus('待采购', purchaseList)
        : status;
    safeUpdate('orders', id, {
        status: nextStatus,
        status_reason: String(reason || '').trim(),
        status_changed_at: now,
        closed_at: nextStatus === '已关闭' ? now : record.closed_at,
        cancelled_at: nextStatus === '已取消' ? now : record.cancelled_at,
        purchase_list_json: JSON.stringify(purchaseList),
    });
    return orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
}

function purchaseItemMatches(item, body) {
    const identityKey = String(body?.identityKey || '').trim();
    if (identityKey) return String(item.identityKey || '') === identityKey;
    const model = String(body?.model || '').trim();
    const supplier = String(body?.supplier || '');
    return item.model === model && String(item.supplier || '') === supplier;
}

function updatePurchaseItemProgress(id, body) {
    const action = db.transaction((orderId) => {
        const record = getOrderRecord(orderId);
        if (record.status === '待确认') throw new Error('请先确认订单，再登记采购进度');
        if (TERMINAL_ORDER_STATUSES.has(record.status) || record.status === '采购完成') {
            const error = new Error('当前订单状态不允许修改采购进度');
            error.statusCode = 409;
            throw error;
        }

        const purchaseList = parseOrderJsonArray(record, 'purchase_list_json').map(normalizePurchaseItem);
        const index = purchaseList.findIndex(item => purchaseItemMatches(item, body));
        if (index < 0) throw new Error('采购项不存在');
        const currentItem = purchaseList[index];
        const quantities = validatePurchaseProgress(currentItem, body);
        const stockDelta = quantities.stockedQty - Number(currentItem.stockedQty || 0);
        const now = new Date().toISOString();
        let receiptId = null;

        if (stockDelta > 0) {
            const partId = parsePositiveId(currentItem.partId);
            if (!partId) throw new Error(`采购项「${currentItem.model}」没有对应零件，无法入库`);
            const part = db.prepare('SELECT model, stock FROM parts WHERE id = ? AND deleted_at IS NULL').get(partId);
            if (!part || String(part.model || '') !== String(currentItem.model || '')) {
                throw new Error(`采购项「${currentItem.model}」对应零件不存在或已变化`);
            }
            safeUpdate('parts', partId, { stock: Math.max(0, Number(part.stock || 0) + stockDelta) });
            receiptId = randomUUID();
        }

        const nextItem = normalizePurchaseItem({
            ...currentItem,
            ...quantities,
            purchasePrice: body.purchasePrice === undefined
                ? currentItem.purchasePrice
                : parseNonNegativeNumber(body.purchasePrice, 'purchasePrice'),
            actualSupplier: body.actualSupplier === undefined
                ? currentItem.actualSupplier
                : String(body.actualSupplier || '').trim(),
            orderedAt: quantities.orderedQty > 0 ? currentItem.orderedAt || now : null,
            receivedAt: quantities.receivedQty > 0 ? currentItem.receivedAt || now : null,
            stockedAt: quantities.stockedQty > 0 ? currentItem.stockedAt || now : null,
            stockInHistory: stockDelta > 0
                ? [...currentItem.stockInHistory, { receiptId, qty: stockDelta, at: now }]
                : currentItem.stockInHistory,
        });
        purchaseList[index] = nextItem;

        const nextStatus = deriveProcurementStatus(record.status, purchaseList);
        const completedNow = nextStatus === '采购完成' && record.status !== '采购完成';
        safeUpdate('orders', orderId, {
            status: nextStatus,
            status_changed_at: nextStatus !== record.status ? now : record.status_changed_at,
            purchase_list_json: JSON.stringify(purchaseList),
            purchase_completed_at: completedNow ? now : record.purchase_completed_at,
            purchase_receipt_id: completedNow ? randomUUID() : record.purchase_receipt_id,
        });

        return {
            order: orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)),
            stockAddition: stockDelta > 0 ? { partId: currentItem.partId, addQty: stockDelta, receiptId } : null,
        };
    });
    const result = action(id);
    if (result.stockAddition) invalidatePartsCache();
    return result;
}

function togglePurchaseItem(id, body) {
    const record = getOrderRecord(id);
    const model = String(body?.model || '').trim();
    const supplier = String(body?.supplier || '');
    if (!model) throw new Error('采购型号不能为空');
    const item = parseOrderJsonArray(record, 'purchase_list_json')
        .map(normalizePurchaseItem)
        .find(candidate => candidate.model === model && String(candidate.supplier || '') === supplier);
    if (!item) throw new Error('采购项不存在');
    const purchased = body?.purchased === undefined ? !item.purchased : Boolean(body.purchased);
    return updatePurchaseItemProgress(id, {
        identityKey: item.identityKey,
        model,
        supplier,
        orderedQty: purchased ? item.plannedQty : 0,
    }).order;
}

function applyPurchaseItemsByTask(body) {
    const model = String(body?.model || '').trim();
    const supplier = String(body?.supplier || '');
    const purchased = Boolean(body?.purchased);
    if (!model) throw new Error('采购型号不能为空');

    const action = db.transaction(() => {
        const records = db.prepare(ACTIVE_ORDERS_SQL).all();
        const updatedOrders = [];

        for (const record of records) {
            if (record.status === '待确认' || record.status === '采购完成') continue;
            let changed = false;
            const purchaseList = parseOrderJsonArray(record, 'purchase_list_json').map(normalizePurchaseItem).map(item => {
                if (item.model === model && String(item.supplier || '') === supplier && item.plannedQty > 0) {
                    if (!purchased && (item.receivedQty > 0 || item.stockedQty > 0)) {
                        throw new Error(`采购项「${model}」已有到货或入库记录，不能取消下单`);
                    }
                    changed = true;
                    return normalizePurchaseItem({
                        ...item,
                        orderedQty: purchased ? item.plannedQty : 0,
                        orderedAt: purchased ? item.orderedAt || new Date().toISOString() : null,
                    });
                }
                return item;
            });

            if (!changed) continue;
            const nextStatus = deriveProcurementStatus(record.status, purchaseList);
            safeUpdate('orders', record.id, {
                status: nextStatus,
                status_changed_at: nextStatus !== record.status ? new Date().toISOString() : record.status_changed_at,
                purchase_list_json: JSON.stringify(purchaseList),
            });
            updatedOrders.push(orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(record.id)));
        }

        return updatedOrders;
    });

    return action();
}

function toggleTodoItem(id, body) {
    const record = getOrderRecord(id);
    const todoId = String(body?.todoId || '').trim();
    if (!todoId) throw new Error('待办 ID 不能为空');
    const todos = parseOrderJsonArray(record, 'todos_json').map(item => (
        String(item.id) === todoId
            ? { ...item, done: body?.done === undefined ? !item.done : Boolean(body.done) }
            : item
    ));
    safeUpdate('orders', id, { todos_json: JSON.stringify(todos) });
    return orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
}

function completePurchaseOrder(id) {
    const action = db.transaction((orderId) => {
        const record = getOrderRecord(orderId);
        if (record.purchase_completed_at || record.status === '采购完成' || record.status === '已关闭') {
            const error = new Error('该订单采购已经入库，不能重复执行');
            error.statusCode = 409;
            throw error;
        }
        const plans = syncBalancedPurchasePlans();
        if (record.status === '待确认' || record.status === '已取消') {
            const error = new Error('当前订单状态不允许采购入库');
            error.statusCode = 409;
            throw error;
        }
        const purchaseList = (plans.get(orderId)?.purchaseList || parseOrderJsonArray(getOrderRecord(orderId), 'purchase_list_json'))
            .map(normalizePurchaseItem);
        const inboundItems = purchaseList.filter(item => Math.max(item.plannedQty, item.orderedQty) > item.stockedQty);
        const invalidItems = inboundItems.filter(item => !parsePositiveId(item.partId));
        if (invalidItems.length > 0) {
            const error = new Error(`以下采购项没有对应零件，无法入库：${invalidItems.map(item => `${item.model}${item.supplier ? `（${item.supplier}）` : ''}`).join('、')}`);
            error.statusCode = 400;
            throw error;
        }
        const additions = [];

        for (const item of inboundItems) {
            const partId = parsePositiveId(item.partId);
            const addQty = Math.max(Number(item.plannedQty || 0), Number(item.orderedQty || 0))
                - Number(item.stockedQty || 0);
            if (!Number.isFinite(addQty) || addQty <= 0) throw new Error(`采购项「${item.model}」入库数量无效`);
            const current = db.prepare('SELECT model, supplier, stock FROM parts WHERE id = ? AND deleted_at IS NULL').get(partId);
            if (!current) throw new Error(`采购项「${item.model}」对应零件不存在`);
            if (String(current.model || '') !== String(item.model || '')) throw new Error(`采购项「${item.model}」与零件库记录不一致`);
            const stock = Math.max(0, Number(current.stock || 0) + addQty);
            safeUpdate('parts', partId, { stock });
            additions.push({ partId, addQty });
        }

        const completedAt = new Date().toISOString();
        const receiptId = randomUUID();
        const completedPurchaseList = purchaseList.map(item => {
            if (item.plannedQty <= 0) return item;
            const targetQty = Math.max(item.plannedQty, item.orderedQty);
            const delta = Math.max(0, targetQty - item.stockedQty);
            return normalizePurchaseItem({
                ...item,
                orderedQty: targetQty,
                receivedQty: Math.max(item.receivedQty, targetQty),
                stockedQty: Math.max(item.stockedQty, targetQty),
                orderedAt: item.orderedAt || completedAt,
                receivedAt: item.receivedAt || completedAt,
                stockedAt: item.stockedAt || completedAt,
                stockInHistory: delta > 0
                    ? [...item.stockInHistory, { receiptId, qty: delta, at: completedAt }]
                    : item.stockInHistory,
            });
        });
        safeUpdate('orders', orderId, {
            status: '采购完成',
            status_changed_at: completedAt,
            purchase_list_json: JSON.stringify(completedPurchaseList),
            purchase_completed_at: completedAt,
            purchase_receipt_id: receiptId,
        });

        return {
            order: orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)),
            additions,
            receiptId,
            completedAt,
        };
    });
    const result = action(id);
    invalidatePartsCache();
    return result;
}

router.get('/', (req, res) => {
    try {
        syncBalancedPurchasePlans();
        res.json({ success: true, data: dbGetAllOrders() });
    }
    catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/history-price/:recipeName', (req, res) => {
    try {
        const recipeName = decodeURIComponent(req.params.recipeName);
        // 在 SQLite 层搜索，避免全量加载所有订单到内存
        const orders = db.prepare('SELECT * FROM orders WHERE deleted_at IS NULL ORDER BY updated_at DESC').all();
        for (const row of orders) {
            try {
                const items = JSON.parse(row.items_json || '[]');
                for (const item of items) {
                    if (item.recipeName === recipeName && item.unitPrice > 0) {
                        return res.json({
                            success: true,
                            data: {
                                unitPrice: item.unitPrice,
                                unitCost: item.unitCost || 0,
                                profitMargin: item.profitMargin || 1.10,
                                customerName: row.customer_name,
                                date: row.updated_at,
                            }
                        });
                    }
                }
            } catch { /* 跳过 JSON 解析错误的订单 */ }
        }
        res.json({ success: true, data: null });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/purchase-plan', (req, res) => {
    try {
        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        res.json({ success: true, data: buildOrderPlan(items, dbGetAllParts()) });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/save-payload-draft', (req, res) => {
    try {
        res.json({ success: true, data: buildOrderSavePayloadDraft(req.body || {}) });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/purchase-items/batch', (req, res) => {
    try {
        syncBalancedPurchasePlans();
        const updatedOrders = applyPurchaseItemsByTask(req.body || {});
        res.json({ success: true, data: { updatedCount: updatedOrders.length, updatedOrders } });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/:id/status', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        res.json({ success: true, data: setOrderStatus(id, req.body?.status, req.body?.reason) });
    } catch (error) {
        const code = error.statusCode || (error.message === '订单不存在' ? 404 : 400);
        res.status(code).json({ success: false, error: error.message });
    }
});

router.post('/:id/purchase-items/progress', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        syncBalancedPurchasePlans();
        res.json({ success: true, data: updatePurchaseItemProgress(id, req.body || {}) });
    } catch (error) {
        const code = error.statusCode || (error.message === '订单不存在' ? 404 : 400);
        res.status(code).json({ success: false, error: error.message });
    }
});

router.post('/:id/purchase-items/toggle', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        res.json({ success: true, data: togglePurchaseItem(id, req.body || {}) });
    } catch (error) {
        const code = error.message === '订单不存在' ? 404 : 400;
        res.status(code).json({ success: false, error: error.message });
    }
});

router.post('/:id/todos/toggle', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        res.json({ success: true, data: toggleTodoItem(id, req.body || {}) });
    } catch (error) {
        const code = error.message === '订单不存在' ? 404 : 400;
        res.status(code).json({ success: false, error: error.message });
    }
});

router.post('/:id/complete-purchase', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        res.json({ success: true, data: completePurchaseOrder(id) });
    } catch (error) {
        const code = error.statusCode || (error.message === '订单不存在' ? 404 : 400);
        res.status(code).json({ success: false, error: error.message });
    }
});

router.get('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        syncBalancedPurchasePlans();
        const record = orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
        if (!record) return res.status(404).json({ success: false, error: '订单不存在' });
        res.json({ success: true, data: record });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/', (req, res) => {
    try {
        const payload = buildOrderSavePayloadDraft({
            ...req.body,
            customerName: req.body.customerName ?? req.body.customer_name,
            contractNo: req.body.contractNo ?? req.body.contract_no,
            items: req.body.items ?? parseJsonArray(req.body.itemsJson ?? req.body.items_json),
            purchaseList: req.body.purchaseList ?? parseJsonArray(req.body.purchaseListJson ?? req.body.purchase_list_json),
            todos: req.body.todos ?? parseJsonArray(req.body.todosJson ?? req.body.todos_json),
            status: '待确认',
        });
        const now = new Date().toISOString();
        const info = safeInsert('orders', {
            customer_name: payload.customerName,
            contract_no: payload.contractNo,
            remark: payload.remark,
            status: payload.status,
            items_json: payload.itemsJson,
            purchase_list_json: payload.purchaseListJson,
            todos_json: payload.todosJson,
            created_at: now,
            updated_at: now,
        });
        res.json({ success: true, data: orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid)) });
    } catch (error) { res.status(error.statusCode || 400).json({ success: false, error: error.message }); }
});

router.patch('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        res.json({ success: true, data: updateOrderRecord(id, req.body) });
    } catch (error) { res.status(error.statusCode || (error.message === '订单不存在' ? 404 : 400)).json({ success: false, error: error.message }); }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        const record = getOrderRecord(id);
        if (record.status !== '待确认' && record.status !== '已取消') {
            return res.status(409).json({ success: false, error: '只有待确认或已取消订单可以删除' });
        }
        softDelete('orders', id);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

module.exports = router;
