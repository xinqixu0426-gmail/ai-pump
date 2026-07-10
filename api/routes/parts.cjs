const { Router } = require('express');
const { db, dbGetAllParts, partRow, extractPartFields, safeInsert, safeUpdate, softDelete, invalidatePartsCache } = require('../db.cjs');
const { parsePositiveId, parseFiniteNumber } = require('../services/validation.cjs');
const router = Router();

function partUpdatesFromBody(body) {
    const f = extractPartFields(body);
    const updates = {};
    if (body.model !== undefined) updates.model = f.model;
    if (body.category !== undefined) updates.category = f.category;
    if (body.price !== undefined) updates.price = f.price;
    if (body.supplier !== undefined) updates.supplier = f.supplier;
    if (body.stock !== undefined) updates.stock = f.stock;
    if (body.notes !== undefined || body.remark !== undefined) updates.remark = f.remark;
    return updates;
}

function updatePartRecord(id, body) {
    const updates = partUpdatesFromBody(body || {});
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
        const info = safeInsert('parts', { model: f.model, category: f.category, price: f.price, supplier: f.supplier, stock: f.stock, remark: f.remark, created_at: now, updated_at: now });
        invalidatePartsCache();
        res.json({ success: true, data: partRow(db.prepare('SELECT * FROM parts WHERE id = ?').get(info.lastInsertRowid)) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.patch('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法零件ID' });
        res.json({ success: true, data: updatePartRecord(id, req.body) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法零件ID' });
        softDelete('parts', id);
        invalidatePartsCache();
        res.json({ success: true, data: { deleted: 1 } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/batch-stock', (req, res) => {
    try {
        const { operations } = req.body;
        if (!Array.isArray(operations) || operations.length === 0) {
            return res.status(400).json({ success: false, error: 'operations 数组不能为空' });
        }
        for (const op of operations) {
            const id = parsePositiveId(op.partId);
            if (!id) return res.status(400).json({ success: false, error: 'partId 必须是正整数' });
            try { parseFiniteNumber(op.delta, 'delta'); }
            catch (error) { return res.status(400).json({ success: false, error: error.message }); }
        }
        const batch = db.transaction((ops) => {
            for (const op of ops) {
                const id = parsePositiveId(op.partId);
                const delta = parseFiniteNumber(op.delta, 'delta');
                const current = db.prepare('SELECT stock FROM parts WHERE id = ? AND deleted_at IS NULL').get(id);
                if (!current) continue;
                const stock = Math.max(0, Number(current.stock || 0) + delta);
                safeUpdate('parts', id, { stock });
            }
        });
        batch(operations);
        invalidatePartsCache();
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

module.exports = router;
