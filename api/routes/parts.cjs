const { Router } = require('express');
const { db, dbGetAllParts, partRow, extractPartFields, safeInsert, safeUpdate, softDelete, invalidatePartsCache } = require('../db.cjs');
const { parsePositiveId, parseFiniteNumber } = require('../services/validation.cjs');
const router = Router();

function partUpdatesFromBody(body, current) {
    const f = extractPartFields({
        ...body,
        category: body.category ?? current.category,
        subcategory: body.subcategory ?? current.subcategory,
        model: body.model ?? current.model,
        supplier: body.supplier ?? current.supplier,
        notes: body.notes ?? body.remark ?? current.remark,
    });
    const updates = {};
    if (body.model !== undefined) updates.model = f.model;
    if (body.category !== undefined) updates.category = f.category;
    if (body.category !== undefined || body.subcategory !== undefined) updates.subcategory = f.subcategory;
    if (body.price !== undefined) updates.price = f.price;
    if (body.supplier !== undefined) updates.supplier = f.supplier;
    if (body.stock !== undefined) updates.stock = f.stock;
    if (body.notes !== undefined || body.remark !== undefined) updates.remark = f.remark;
    return updates;
}

function updatePartRecord(id, body) {
    const current = db.prepare('SELECT * FROM parts WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!current) throw new Error('零件不存在');
    const updates = partUpdatesFromBody(body || {}, current);
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
        const info = safeInsert('parts', { model: f.model, category: f.category, subcategory: f.subcategory, price: f.price, supplier: f.supplier, stock: f.stock, remark: f.remark, created_at: now, updated_at: now });
        invalidatePartsCache();
        res.json({ success: true, data: partRow(db.prepare('SELECT * FROM parts WHERE id = ?').get(info.lastInsertRowid)) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.patch('/prices', (req, res) => {
    try {
        const { updates } = req.body || {};
        if (!Array.isArray(updates) || updates.length === 0) {
            return res.status(400).json({ success: false, error: 'updates 数组不能为空' });
        }
        const normalized = updates.map((item, index) => {
            const partId = parsePositiveId(item?.partId);
            if (!partId) throw new Error(`updates[${index}].partId 必须是正整数`);
            const price = parseFiniteNumber(item?.price, `updates[${index}].price`);
            if (price < 0) throw new Error(`updates[${index}].price 必须大于等于 0`);
            return { partId, price };
        });

        const batch = db.transaction((rows) => {
            const updated = [];
            for (const row of rows) {
                const exists = db.prepare('SELECT id FROM parts WHERE id = ? AND deleted_at IS NULL').get(row.partId);
                if (!exists) continue;
                safeUpdate('parts', row.partId, { price: row.price });
                updated.push(partRow(db.prepare('SELECT * FROM parts WHERE id = ?').get(row.partId)));
            }
            return updated;
        });
        const updatedParts = batch(normalized);
        invalidatePartsCache();
        res.json({ success: true, data: { updatedCount: updatedParts.length, parts: updatedParts } });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
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
