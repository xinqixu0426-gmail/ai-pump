const express = require('express');
const { db, dbGetAllCustomers, safeUpdate, softDelete } = require('../db.cjs');
const router = express.Router();

function parseId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

router.get('/', (req, res) => res.json({ success: true, data: dbGetAllCustomers() }));

router.post('/', (req, res) => {
    const { name, contactInfo, defaultMargin, remark } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const margin = Number(defaultMargin || 0);
    if (!Number.isFinite(margin) || margin < 0) return res.status(400).json({ success: false, error: 'defaultMargin 必须是非负数字' });
    const now = new Date().toISOString();
    try {
        const stmt = db.prepare('INSERT INTO customers (name, contact_info, default_margin, remark, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
        const info = stmt.run(name, contactInfo || '', margin, remark || '', now, now);
        res.json({ success: true, data: { id: info.lastInsertRowid } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法客户ID' });
        if (req.body.defaultMargin !== undefined) {
            const margin = Number(req.body.defaultMargin);
            if (!Number.isFinite(margin) || margin < 0) return res.status(400).json({ success: false, error: 'defaultMargin 必须是非负数字' });
        }
        safeUpdate('customers', id, {
            name: req.body.name,
            contact_info: req.body.contactInfo,
            default_margin: req.body.defaultMargin,
            remark: req.body.remark
        });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法客户ID' });
        softDelete('customers', id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
