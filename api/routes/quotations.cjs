const express = require('express');
const { db, dbGetAllQuotations, safeUpdate, softDelete } = require('../db.cjs');
const router = express.Router();

function expireOverdueQuotations() {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 1);
    const rows = db.prepare('SELECT id FROM quotations WHERE deleted_at IS NULL AND status = ? AND created_at <= ?').all('报价中', cutoff.toISOString());
    rows.forEach((row) => {
        safeUpdate('quotations', row.id, { status: '已过时' });
    });
}

router.get('/', (req, res) => {
    try {
        expireOverdueQuotations();
        res.json({ success: true, data: dbGetAllQuotations() });
    }
    catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/', (req, res) => {
    const { customerId, status, itemsJson, totalCost, totalPrice, remark } = req.body;
    if (!customerId) return res.status(400).json({ success: false, error: 'Missing customerId' });
    const now = new Date().toISOString();
    try {
        const stmt = db.prepare('INSERT INTO quotations (customer_id, status, items_json, total_cost, total_price, remark, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        const info = stmt.run(customerId, status || '报价中', itemsJson || '[]', totalCost || 0, totalPrice || 0, remark || '', now, now);
        res.json({ success: true, data: { id: info.lastInsertRowid }, id: info.lastInsertRowid });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.patch('/:id', (req, res) => {
    try {
        safeUpdate('quotations', Number(req.params.id), {
            customer_id: req.body.customerId,
            status: req.body.status,
            items_json: req.body.itemsJson,
            total_cost: req.body.totalCost,
            total_price: req.body.totalPrice,
            remark: req.body.remark
        });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.delete('/:id', (req, res) => {
    try {
        softDelete('quotations', Number(req.params.id));
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
