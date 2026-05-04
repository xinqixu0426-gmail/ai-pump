const express = require('express');
const { db, dbGetAllCustomers, safeUpdate, softDelete } = require('../db.cjs');
const router = express.Router();

router.get('/', (req, res) => res.json(dbGetAllCustomers()));

router.post('/', (req, res) => {
    const { name, contactInfo, defaultMargin, remark } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const now = new Date().toISOString();
    try {
        const stmt = db.prepare('INSERT INTO customers (name, contact_info, default_margin, remark, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
        const info = stmt.run(name, contactInfo || '', defaultMargin || 0, remark || '', now, now);
        res.json({ success: true, id: info.lastInsertRowid });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', (req, res) => {
    safeUpdate('customers', Number(req.params.id), {
        name: req.body.name,
        contact_info: req.body.contactInfo,
        default_margin: req.body.defaultMargin,
        remark: req.body.remark
    });
    res.json({ success: true });
});

router.delete('/:id', (req, res) => {
    softDelete('customers', Number(req.params.id));
    res.json({ success: true });
});

module.exports = router;
