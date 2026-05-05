const { Router } = require('express');
const { db, dbGetAllOrders, orderRow, safeUpdate, softDelete } = require('../db.cjs');
const router = Router();

const ORDER_FIELDS = ['customer_name', 'contract_no', 'remark', 'status', 'items_json', 'purchase_list_json', 'todos_json'];
const ORDER_ALIASES = {
    customerName: 'customer_name',
    contractNo: 'contract_no',
    itemsJson: 'items_json',
    purchaseListJson: 'purchase_list_json',
    todosJson: 'todos_json',
};

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

router.get('/:id', (req, res) => {
    try {
        const record = orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(req.params.id)));
        if (!record) return res.status(404).json({ success: false, error: '订单不存在' });
        res.json({ success: true, data: record });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/', (req, res) => {
    try {
        const b = orderBodyToDb(req.body);
        const now = new Date().toISOString();
        const info = db.prepare('INSERT INTO orders (customer_name, contract_no, remark, status, items_json, purchase_list_json, todos_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            b.customer_name || '', b.contract_no || '', b.remark || '',
            b.status || '待采购', b.items_json || '[]',
            b.purchase_list_json || '[]', b.todos_json || '[]', now, now
        );
        res.json({ success: true, data: orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid)) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.patch('/', (req, res) => {
    try {
        const b = req.body;
        const id = b.Id || b.id;
        const updates = orderBodyToDb(b);
        safeUpdate('orders', id, updates);
        res.json({ success: true, data: orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(id)) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.delete('/', (req, res) => {
    try {
        const items = Array.isArray(req.body) ? req.body : [req.body];
        for (const item of items) {
            const id = item.Id || item.id;
            if (!id || isNaN(Number(id))) continue;
            softDelete('orders', Number(id));
        }
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

module.exports = router;
