const express = require('express');
const { db, dbGetAllCustomers, customerRow, safeInsert, safeUpdate, softDelete } = require('../db.cjs');
const { parsePositiveId } = require('../services/validation.cjs');
const router = express.Router();

router.get('/', (req, res) => {
    try { res.json({ success: true, data: dbGetAllCustomers() }); }
    catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/', (req, res) => {
    const { name, contactInfo, defaultMargin, remark } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Missing name' });
    const now = new Date().toISOString();
    try {
        const info = safeInsert('customers', { name, contact_info: contactInfo || '', default_margin: defaultMargin || 0, remark: remark || '', created_at: now, updated_at: now });
        const record = customerRow(db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid));
        res.json({ success: true, data: record });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.patch('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法客户ID' });
        safeUpdate('customers', id, {
            name: req.body.name,
            contact_info: req.body.contactInfo,
            default_margin: req.body.defaultMargin,
            remark: req.body.remark
        });
        res.json({ success: true, data: customerRow(db.prepare('SELECT * FROM customers WHERE id = ?').get(id)) });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法客户ID' });
        softDelete('customers', id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
