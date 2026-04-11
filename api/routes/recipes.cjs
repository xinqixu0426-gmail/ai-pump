const { Router } = require('express');
const { db, dbGetAllRecipes, recipeRow } = require('../db.cjs');
const router = Router();

router.get('/', async (req, res) => {
    try { res.json({ success: true, data: dbGetAllRecipes() }); }
    catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/:id', async (req, res) => {
    try {
        const record = recipeRow(db.prepare('SELECT * FROM recipes WHERE id = ?').get(parseInt(req.params.id)));
        if (!record) return res.status(404).json({ success: false, error: '配方不存在' });
        res.json({ success: true, data: record });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/', async (req, res) => {
    try {
        const b = req.body;
        const now = new Date().toISOString();
        const info = db.prepare(`INSERT INTO recipes (
            name, spec, parts_json, saved_total_cost, saved_cost_details,
            template_id, coil_spec, coil_sheets,
            has_float, float_wire, has_cable, cable_length, cable_wire,
            box_type, extra_parts_json,
            assembly_wage, packing_wage, painting_wage,
            management_fee,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            b.name || b.配方名称 || '', b.spec || b.规格 || '', b.parts_json || b.配件JSON || '[]',
            b.saved_total_cost ?? b.保存时总成本 ?? 0, b.saved_cost_details || b.保存时成本明细 || '[]',
            b.template_id || null, b.coil_spec || '', b.coil_sheets || 0,
            b.has_float || 0, b.float_wire || '', b.has_cable || 0, b.cable_length || 0, b.cable_wire || '',
            b.box_type || '', b.extra_parts_json || '[]',
            b.assembly_wage || 0, b.packing_wage || 0, b.painting_wage != null ? b.painting_wage : null,
            b.management_fee || 0,
            now, now
        );
        res.json({ success: true, data: recipeRow(db.prepare('SELECT * FROM recipes WHERE id = ?').get(info.lastInsertRowid)) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.delete('/', async (req, res) => {
    try {
        const items = Array.isArray(req.body) ? req.body : [req.body];
        for (const item of items) { db.prepare('DELETE FROM recipes WHERE id = ?').run(item.Id || item.id); }
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.patch('/', async (req, res) => {
    try {
        const b = req.body;
        const id = b.Id || b.id;
        const now = new Date().toISOString();
        const sets = [], vals = [];
        if (b.配方名称 !== undefined || b.name !== undefined) { sets.push('name = ?'); vals.push(b.配方名称 || b.name); }
        if (b.规格 !== undefined || b.spec !== undefined) { sets.push('spec = ?'); vals.push(b.规格 || b.spec); }
        if (b.配件JSON !== undefined || b.parts_json !== undefined) { sets.push('parts_json = ?'); vals.push(b.配件JSON || b.parts_json); }
        if (b.saved_total_cost !== undefined || b.保存时总成本 !== undefined) { sets.push('saved_total_cost = ?'); vals.push(b.saved_total_cost ?? b.保存时总成本); }
        if (b.saved_cost_details !== undefined || b.保存时成本明细 !== undefined) { sets.push('saved_cost_details = ?'); vals.push(b.saved_cost_details || b.保存时成本明细); }
        if (b.template_id !== undefined) { sets.push('template_id = ?'); vals.push(b.template_id); }
        if (b.coil_spec !== undefined) { sets.push('coil_spec = ?'); vals.push(b.coil_spec); }
        if (b.coil_sheets !== undefined) { sets.push('coil_sheets = ?'); vals.push(b.coil_sheets); }
        if (b.has_float !== undefined) { sets.push('has_float = ?'); vals.push(b.has_float); }
        if (b.float_wire !== undefined) { sets.push('float_wire = ?'); vals.push(b.float_wire); }
        if (b.has_cable !== undefined) { sets.push('has_cable = ?'); vals.push(b.has_cable); }
        if (b.cable_length !== undefined) { sets.push('cable_length = ?'); vals.push(b.cable_length); }
        if (b.cable_wire !== undefined) { sets.push('cable_wire = ?'); vals.push(b.cable_wire); }
        if (b.box_type !== undefined) { sets.push('box_type = ?'); vals.push(b.box_type); }
        if (b.extra_parts_json !== undefined) { sets.push('extra_parts_json = ?'); vals.push(b.extra_parts_json); }
        if (b.assembly_wage !== undefined) { sets.push('assembly_wage = ?'); vals.push(b.assembly_wage); }
        if (b.packing_wage !== undefined) { sets.push('packing_wage = ?'); vals.push(b.packing_wage); }
        if (b.painting_wage !== undefined) { sets.push('painting_wage = ?'); vals.push(b.painting_wage); }
        if (b.management_fee !== undefined) { sets.push('management_fee = ?'); vals.push(b.management_fee); }
        sets.push('updated_at = ?'); vals.push(now); vals.push(id);
        if (sets.length > 1) db.prepare(`UPDATE recipes SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        res.json({ success: true, data: recipeRow(db.prepare('SELECT * FROM recipes WHERE id = ?').get(id)) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

module.exports = router;
