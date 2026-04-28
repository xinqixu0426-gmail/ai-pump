const { Router } = require('express');
const { db, dbGetAllParts, partRow, extractPartFields, safeUpdate, softDelete, invalidatePartsCache } = require('../db.cjs');
const router = Router();

router.get('/', (req, res) => {
    try { res.json({ success: true, data: dbGetAllParts() }); }
    catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/', (req, res) => {
    try {
        const f = extractPartFields(req.body);
        const now = new Date().toISOString();
        const info = db.prepare('INSERT INTO parts (model, category, price, supplier, stock, remark, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(f.model, f.category, f.price, f.supplier, f.stock, f.remark, now, now);
        res.json({ success: true, data: partRow(db.prepare('SELECT * FROM parts WHERE id = ?').get(info.lastInsertRowid)) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.patch('/', (req, res) => {
    try {
        const id = req.body.Id || req.body.id;
        const f = extractPartFields(req.body);
        const updates = {};
        if (req.body.model !== undefined) updates.model = f.model;
        if (req.body.category !== undefined) updates.category = f.category;
        if (req.body.price !== undefined) updates.price = f.price;
        if (req.body.supplier !== undefined) updates.supplier = f.supplier;
        if (req.body.stock !== undefined) updates.stock = f.stock;
        if (req.body.notes !== undefined || req.body.remark !== undefined) updates.remark = f.remark;
        safeUpdate('parts', id, updates);
        res.json({ success: true, data: partRow(db.prepare('SELECT * FROM parts WHERE id = ?').get(id)) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.delete('/', (req, res) => {
    try {
        const items = Array.isArray(req.body) ? req.body : [req.body];
        for (const item of items) {
            const id = item.Id || item.id;
            if (!id || isNaN(Number(id))) continue;
            softDelete('parts', Number(id));
        }
        invalidatePartsCache();
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/batch-stock', (req, res) => {
    try {
        const { operations } = req.body;
        if (!Array.isArray(operations) || operations.length === 0) {
            return res.status(400).json({ success: false, error: 'operations 数组不能为空' });
        }
        const now = new Date().toISOString();
        const stmt = db.prepare('UPDATE parts SET stock = MAX(0, stock + ?), updated_at = ? WHERE id = ?');
        const batch = db.transaction((ops) => { for (const op of ops) { stmt.run(op.delta, now, op.partId); } });
        batch(operations);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

module.exports = router;
