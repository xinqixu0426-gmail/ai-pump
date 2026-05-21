const { Router } = require('express');
const { db, dbGetAllParts, partRow, extractPartFields, safeUpdate, softDelete, invalidatePartsCache } = require('../db.cjs');
const router = Router();

function parseId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function updatePartRecord(id, body) {
    const f = extractPartFields(body);
    const updates = {};
    if (body.model !== undefined) updates.model = f.model;
    if (body.category !== undefined) updates.category = f.category;
    if (body.price !== undefined) updates.price = f.price;
    if (body.supplier !== undefined) updates.supplier = f.supplier;
    if (body.stock !== undefined) updates.stock = f.stock;
    if (body.notes !== undefined || body.remark !== undefined) updates.remark = f.remark;
    safeUpdate('parts', id, updates);
    invalidatePartsCache();
    return partRow(db.prepare('SELECT * FROM parts WHERE id = ?').get(id));
}

router.get('/', (req, res) => {
    try { res.json({ success: true, data: dbGetAllParts() }); }
    catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/', (req, res) => {
    try {
        const f = extractPartFields(req.body);
        const now = new Date().toISOString();
        const info = db.prepare('INSERT INTO parts (model, category, price, supplier, stock, remark, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(f.model, f.category, f.price, f.supplier, f.stock, f.remark, now, now);
        invalidatePartsCache();
        res.json({ success: true, data: partRow(db.prepare('SELECT * FROM parts WHERE id = ?').get(info.lastInsertRowid)) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.patch('/', (req, res) => {
    try {
        const id = req.body.Id || req.body.id;
        if (!parseId(id)) return res.status(400).json({ success: false, error: '非法零件ID' });
        res.json({ success: true, data: updatePartRecord(Number(id), req.body) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.patch('/:id', (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法零件ID' });
        res.json({ success: true, data: updatePartRecord(id, req.body) });
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

router.delete('/:id', (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法零件ID' });
        softDelete('parts', id);
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
        for (const op of operations) {
            if (!Number.isInteger(Number(op.partId)) || !Number.isFinite(Number(op.delta))) {
                return res.status(400).json({ success: false, error: 'partId 和 delta 必须是有效数字' });
            }
        }
        const batch = db.transaction((ops) => {
            for (const op of ops) {
                const partId = Number(op.partId);
                const current = db.prepare('SELECT stock FROM parts WHERE id = ? AND deleted_at IS NULL').get(partId);
                if (!current) continue;
                safeUpdate('parts', partId, { stock: Math.max(0, Number(current.stock || 0) + Number(op.delta)) });
            }
        });
        batch(operations);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

module.exports = router;
