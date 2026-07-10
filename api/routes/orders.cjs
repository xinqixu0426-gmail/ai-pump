const { Router } = require('express');
const { db, dbGetAllOrders, dbGetAllParts, orderRow, safeInsert, safeUpdate, softDelete, invalidatePartsCache } = require('../db.cjs');
const { buildOrderPlan } = require('../services/orderPlanning.cjs');
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
        : buildOrderPlan(items, dbGetAllParts());

    return {
        customerName,
        contractNo: String(body?.contractNo || '').trim(),
        remark: String(body?.remark || ''),
        status: body?.status || '待采购',
        itemsJson: JSON.stringify(items),
        purchaseListJson: JSON.stringify(plan.purchaseList || []),
        todosJson: JSON.stringify(plan.todos || []),
    };
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
        const purchaseList = parseOrderJsonArray(record, 'purchase_list_json');
        const additions = [];

        for (const item of purchaseList) {
            const partId = parsePositiveId(item.partId);
            const addQty = Number(item.needToBuy || 0);
            if (!partId || addQty <= 0) continue;
            const current = db.prepare('SELECT stock FROM parts WHERE id = ? AND deleted_at IS NULL').get(partId);
            if (!current) continue;
            const stock = Math.max(0, Number(current.stock || 0) + addQty);
            safeUpdate('parts', partId, { stock });
            additions.push({ partId, addQty });
        }

        safeUpdate('orders', orderId, {
            status: '已完成',
            purchase_list_json: JSON.stringify(purchaseList.map(item => ({ ...item, purchased: true }))),
        });

        return {
            order: orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)),
            additions,
        };
    });
    const result = action(id);
    invalidatePartsCache();
    return result;
}

router.get('/', (req, res) => {
    try { res.json({ success: true, data: dbGetAllOrders() }); }
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
        const code = error.message === '订单不存在' ? 404 : 400;
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
        const code = error.message === '订单不存在' ? 404 : 400;
        res.status(code).json({ success: false, error: error.message });
    }
});

router.get('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法订单ID' });
        const record = orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
        if (!record) return res.status(404).json({ success: false, error: '订单不存在' });
        res.json({ success: true, data: record });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/', (req, res) => {
    try {
        const b = orderBodyToDb(req.body);
        const now = new Date().toISOString();
        const info = safeInsert('orders', {
            customer_name: b.customer_name || '',
            contract_no: b.contract_no || '',
            remark: b.remark || '',
            status: b.status || '待采购',
            items_json: b.items_json || '[]',
            purchase_list_json: b.purchase_list_json || '[]',
            todos_json: b.todos_json || '[]',
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
