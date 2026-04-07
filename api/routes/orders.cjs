const { Router } = require('express');
const { db, dbGetAllOrders, orderRow } = require('../db.cjs');
const router = Router();

router.get('/', async (req, res) => {
    try { res.json({ success: true, data: dbGetAllOrders() }); }
    catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/:id', async (req, res) => {
    try {
        const record = orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(parseInt(req.params.id)));
        if (!record) return res.status(404).json({ success: false, error: '订单不存在' });
        res.json({ success: true, data: record });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/', async (req, res) => {
    try {
        const b = req.body;
        const now = new Date().toISOString();
        const info = db.prepare('INSERT INTO orders (customer_name, contract_no, remark, status, items_json, purchase_list_json, todos_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            b.客户名称 || b.customer_name || '', b.合同号 || b.contract_no || '', b.备注 || b.remark || '',
            b.订单状态 || b.status || '待采购', b.型号列表JSON || b.items_json || '[]',
            b.采购清单JSON || b.purchase_list_json || '[]', b.采购TodoJSON || b.todos_json || '[]', now, now
        );
        res.json({ success: true, data: orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid)) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.patch('/', async (req, res) => {
    try {
        const b = req.body;
        const id = b.Id || b.id;
        const now = new Date().toISOString();
        const sets = [], vals = [];
        if (b.客户名称 !== undefined || b.customer_name !== undefined) { sets.push('customer_name = ?'); vals.push(b.客户名称 || b.customer_name); }
        if (b.合同号 !== undefined || b.contract_no !== undefined) { sets.push('contract_no = ?'); vals.push(b.合同号 || b.contract_no); }
        if (b.备注 !== undefined || b.remark !== undefined) { sets.push('remark = ?'); vals.push(b.备注 || b.remark); }
        if (b.订单状态 !== undefined || b.status !== undefined) { sets.push('status = ?'); vals.push(b.订单状态 || b.status); }
        if (b.型号列表JSON !== undefined || b.items_json !== undefined) { sets.push('items_json = ?'); vals.push(b.型号列表JSON || b.items_json); }
        if (b.采购清单JSON !== undefined || b.purchase_list_json !== undefined) { sets.push('purchase_list_json = ?'); vals.push(b.采购清单JSON || b.purchase_list_json); }
        if (b.采购TodoJSON !== undefined || b.todos_json !== undefined) { sets.push('todos_json = ?'); vals.push(b.采购TodoJSON || b.todos_json); }
        sets.push('updated_at = ?'); vals.push(now); vals.push(id);
        db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        res.json({ success: true, data: orderRow(db.prepare('SELECT * FROM orders WHERE id = ?').get(id)) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.delete('/', async (req, res) => {
    try {
        const items = Array.isArray(req.body) ? req.body : [req.body];
        for (const item of items) { db.prepare('DELETE FROM orders WHERE id = ?').run(item.Id || item.id); }
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

module.exports = router;
