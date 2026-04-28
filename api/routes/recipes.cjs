const { Router } = require('express');
const { db, dbGetAllRecipes, recipeRow, safeUpdate, softDelete } = require('../db.cjs');
const router = Router();

router.get('/', (req, res) => {
    try { res.json({ success: true, data: dbGetAllRecipes() }); }
    catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/:id', (req, res) => {
    try {
        const record = recipeRow(db.prepare('SELECT * FROM recipes WHERE id = ?').get(parseInt(req.params.id)));
        if (!record) return res.status(404).json({ success: false, error: '配方不存在' });
        res.json({ success: true, data: record });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/', (req, res) => {
    try {
        const b = req.body;
        const now = new Date().toISOString();
        const info = db.prepare(`INSERT INTO recipes (
            name, spec, parts_json, saved_total_cost, saved_cost_details,
            template_id, coil_spec, coil_sheets,
            has_float, float_wire, has_cable, cable_length, cable_wire,
            box_type, extra_parts_json,
            assembly_wage, packing_wage, painting_wage,
            management_fee, custom_barrel_length,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            b.name || '', b.spec || '', b.parts_json || '[]',
            b.saved_total_cost ?? 0, b.saved_cost_details || '[]',
            b.template_id || null, b.coil_spec || '', b.coil_sheets || 0,
            b.has_float || 0, b.float_wire || '', b.has_cable || 0, b.cable_length || 0, b.cable_wire || '',
            b.box_type || '', b.extra_parts_json || '[]',
            b.assembly_wage || 0, b.packing_wage || 0, b.painting_wage != null ? b.painting_wage : null,
            b.management_fee || 0, b.custom_barrel_length != null ? b.custom_barrel_length : null,
            now, now
        );
        res.json({ success: true, data: recipeRow(db.prepare('SELECT * FROM recipes WHERE id = ?').get(info.lastInsertRowid)) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.delete('/', (req, res) => {
    try {
        const items = Array.isArray(req.body) ? req.body : [req.body];
        for (const item of items) {
            const id = item.Id || item.id;
            if (!id || isNaN(Number(id))) continue;
            softDelete('recipes', Number(id));
        }
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.patch('/', (req, res) => {
    try {
        const b = req.body;
        const id = b.Id || b.id;
        const RECIPE_FIELDS = [
            'name', 'spec', 'parts_json', 'saved_total_cost', 'saved_cost_details',
            'template_id', 'coil_spec', 'coil_sheets',
            'has_float', 'float_wire', 'has_cable', 'cable_length', 'cable_wire',
            'box_type', 'extra_parts_json',
            'assembly_wage', 'packing_wage', 'painting_wage',
            'management_fee', 'custom_barrel_length',
        ];
        const updates = {};
        for (const f of RECIPE_FIELDS) { if (b[f] !== undefined) updates[f] = b[f]; }
        safeUpdate('recipes', id, updates);
        res.json({ success: true, data: recipeRow(db.prepare('SELECT * FROM recipes WHERE id = ?').get(id)) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

module.exports = router;
