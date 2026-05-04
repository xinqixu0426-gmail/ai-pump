const express = require('express');
const { db, dbGetAllQuotations, safeUpdate, softDelete } = require('../db.cjs');
const router = express.Router();

router.get('/', (req, res) => res.json(dbGetAllQuotations()));

router.post('/', (req, res) => {
    const { customerId, status, itemsJson, totalCost, totalPrice, remark } = req.body;
    if (!customerId) return res.status(400).json({ error: 'Missing customerId' });
    const now = new Date().toISOString();
    try {
        const stmt = db.prepare('INSERT INTO quotations (customer_id, status, items_json, total_cost, total_price, remark, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        const info = stmt.run(customerId, status || '报价中', itemsJson || '[]', totalCost || 0, totalPrice || 0, remark || '', now, now);
        res.json({ success: true, id: info.lastInsertRowid });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', (req, res) => {
    safeUpdate('quotations', Number(req.params.id), {
        customer_id: req.body.customerId,
        status: req.body.status,
        items_json: req.body.itemsJson,
        total_cost: req.body.totalCost,
        total_price: req.body.totalPrice,
        remark: req.body.remark
    });
    res.json({ success: true });
});

router.delete('/:id', (req, res) => {
    softDelete('quotations', Number(req.params.id));
    res.json({ success: true });
});

module.exports = router;
