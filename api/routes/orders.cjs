const { Router } = require('express');
const { randomUUID } = require('crypto');
const { db, dbGetAllOrders, dbGetAllParts, orderRow, safeInsert, safeUpdate, softDelete, invalidatePartsCache } = require('../db.cjs');
const { buildOrderPlan, buildBalancedOrderPlans } = require('../services/orderPlanning.cjs');
const { parsePositiveId, parseJsonArray, parseNonNegativeNumber, parsePositiveNumber } = require('../services/validation.cjs');
const router = Router();

const ORDER_FIELDS = ['customer_name', 'contract_no', 'remark', 'status', 'items_json', 'purchase_list_json', 'todos_json'];
const ORDER_ALIASES = {
    customerName: 'customer_name',
    contractNo: 'contract_no',
    itemsJson: 'items_json',
    purchaseListJson: 'purchase_list_json',
    todosJson: 'todos_json',
};
const ORDER_STATUSES = new Set(['待采购', '采购中', '已完成']);

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
            const activeOrders = db.prepare('SELECT * FROM orders WHERE deleted_at IS NULL AND status != ? ORDER BY created_at, id').all('已完成');
            const draftOrder = { id: -1, created_at: new Date().toISOString(), items, purchase_list_json: '[]' };
            return buildBalancedOrderPlans([...activeOrders, draftOrder], dbGetAllParts()).get(-1);
        })();
    const status = body?.status || '待采购';
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
    const records = db.prepare('SELECT * FROM orders WHERE deleted_at IS NULL AND status != ? ORDER BY created_at, id').all('已完成');
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
    const updates = orderBodyToDb(body);
    safeUpdate('orders', id, updates);
    return orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
}

function setOrderStatus(id, status) {
    if (!ORDER_STATUSES.has(status)) throw new Error('非法订单状态');
    getOrderRecord(id);
    safeUpdate('orders', id, { status });
    return orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
}

function togglePurchaseItem(id, body) {
    const record = getOrderRecord(id);
    const model = String(body?.model || '').trim();
    const supplier = String(body?.supplier || '');
    if (!model) throw new Error('采购型号不能为空');
    const purchaseList = parseOrderJsonArray(record, 'purchase_list_json').map(item => {
        if (item.model === model && String(item.supplier || '') === supplier && Number(item.needToBuy || 0) > 0) {
            return { ...item, purchased: body?.purchased === undefined ? !item.purchased : Boolean(body.purchased) };
        }
        return item;
    });
    safeUpdate('orders', id, { purchase_list_json: JSON.stringify(purchaseList) });
    return orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
}

function applyPurchaseItemsByTask(body) {
    const model = String(body?.model || '').trim();
    const supplier = String(body?.supplier || '');
    const purchased = Boolean(body?.purchased);
    if (!model) throw new Error('采购型号不能为空');

    const action = db.transaction(() => {
        const records = db.prepare('SELECT * FROM orders WHERE deleted_at IS NULL AND status != ?').all('已完成');
        const updatedOrders = [];

        for (const record of records) {
            let changed = false;
            const purchaseList = parseOrderJsonArray(record, 'purchase_list_json').map(item => {
                if (item.model === model && String(item.supplier || '') === supplier && Number(item.needToBuy || 0) > 0) {
                    changed = true;
                    return { ...item, purchased };
                }
                return item;
            });

            if (!changed) continue;
            safeUpdate('orders', record.id, {
                status: purchased && record.status === '待采购' ? '采购中' : record.status,
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
        if (record.purchase_completed_at || record.purchase_receipt_id || record.status === '已完成') {
            const error = new Error('该订单采购已经入库，不能重复执行');
            error.statusCode = 409;
            throw error;
        }
        const plans = syncBalancedPurchasePlans();
        const purchaseList = plans.get(orderId)?.purchaseList || parseOrderJsonArray(getOrderRecord(orderId), 'purchase_list_json');
        const inboundItems = purchaseList.filter(item => Number(item.needToBuy || 0) > 0);
        const invalidItems = inboundItems.filter(item => !parsePositiveId(item.partId));
        if (invalidItems.length > 0) {
            const error = new Error(`以下采购项没有对应零件，无法入库：${invalidItems.map(item => `${item.model}${item.supplier ? `（${item.supplier}）` : ''}`).join('、')}`);
            error.statusCode = 400;
            throw error;
        }
        const additions = [];

        for (const item of inboundItems) {
            const partId = parsePositiveId(item.partId);
            const addQty = Number(item.needToBuy || 0);
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
        safeUpdate('orders', orderId, {
            status: '已完成',
            purchase_list_json: JSON.stringify(purchaseList.map(item => ({ ...item, purchased: true }))),
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
        res.json({ success: true, data: setOrderStatus(id, req.body?.status) });
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
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.patch('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        res.json({ success: true, data: updateOrderRecord(id, req.body) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        softDelete('orders', id);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

module.exports = router;
