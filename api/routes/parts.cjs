const { Router } = require('express');
const { db, dbGetAllParts, partRow, extractPartFields } = require('../db.cjs');
const router = Router();

router.get('/', async (req, res) => {
    try { res.json({ success: true, data: dbGetAllParts() }); }
    catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/', async (req, res) => {
    try {
        const f = extractPartFields(req.body);
        const now = new Date().toISOString();
        const info = db.prepare('INSERT INTO parts (model, category, price, supplier, stock, remark, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(f.model, f.category, f.price, f.supplier, f.stock, f.remark, now, now);
        res.json({ success: true, data: partRow(db.prepare('SELECT * FROM parts WHERE id = ?').get(info.lastInsertRowid)) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.patch('/', async (req, res) => {
    try {
        const id = req.body.Id || req.body.id;
        const f = extractPartFields(req.body);
        const now = new Date().toISOString();
        const sets = [], vals = [];
        if (req.body.model !== undefined) { sets.push('model = ?'); vals.push(f.model); }
        if (req.body.category !== undefined) { sets.push('category = ?'); vals.push(f.category); }
        if (req.body.price !== undefined) { sets.push('price = ?'); vals.push(f.price); }
        if (req.body.supplier !== undefined) { sets.push('supplier = ?'); vals.push(f.supplier); }
        if (req.body.stock !== undefined) { sets.push('stock = ?'); vals.push(f.stock); }
        if (req.body.notes !== undefined || req.body.remark !== undefined || req.body.备注 !== undefined) { sets.push('remark = ?'); vals.push(f.remark); }
        sets.push('updated_at = ?'); vals.push(now); vals.push(id);
        db.prepare(`UPDATE parts SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        res.json({ success: true, data: partRow(db.prepare('SELECT * FROM parts WHERE id = ?').get(id)) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.delete('/', async (req, res) => {
    try {
        const items = Array.isArray(req.body) ? req.body : [req.body];
        for (const item of items) { db.prepare('DELETE FROM parts WHERE id = ?').run(item.Id || item.id); }
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
