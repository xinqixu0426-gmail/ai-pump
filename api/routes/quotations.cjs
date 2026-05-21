const express = require('express');
const { db, dbGetAllQuotations, safeUpdate, softDelete } = require('../db.cjs');
const router = express.Router();

function parseId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function parseNonNegativeNumber(value, field) {
    if (value === undefined) return undefined;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error(`${field} 必须是非负数字`);
    return number;
}

router.get('/', (req, res) => res.json({ success: true, data: dbGetAllQuotations() }));

router.post('/', (req, res) => {
    const { customerId, status, itemsJson, totalCost, totalPrice, remark } = req.body;
    const id = parseId(customerId);
    if (!id) return res.status(400).json({ success: false, error: 'Missing customerId' });
    try {
        const now = new Date().toISOString();
        const stmt = db.prepare('INSERT INTO quotations (customer_id, status, items_json, total_cost, total_price, remark, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        const info = stmt.run(id, status || '报价中', itemsJson || '[]', parseNonNegativeNumber(totalCost || 0, 'totalCost'), parseNonNegativeNumber(totalPrice || 0, 'totalPrice'), remark || '', now, now);
        res.json({ success: true, data: { id: info.lastInsertRowid } });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.patch('/:id', (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法报价单ID' });
        const customerId = req.body.customerId === undefined ? undefined : parseId(req.body.customerId);
        if (req.body.customerId !== undefined && !customerId) return res.status(400).json({ success: false, error: '非法客户ID' });
        safeUpdate('quotations', id, {
            customer_id: customerId,
            status: req.body.status,
            items_json: req.body.itemsJson,
            total_cost: parseNonNegativeNumber(req.body.totalCost, 'totalCost'),
            total_price: parseNonNegativeNumber(req.body.totalPrice, 'totalPrice'),
            remark: req.body.remark
        });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法报价单ID' });
        softDelete('quotations', id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
