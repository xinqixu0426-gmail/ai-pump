const { Router } = require('express');
const { db, dbGetAllRecipes, recipeRow, safeUpdate, softDelete } = require('../db.cjs');
const router = Router();

const RECIPE_FIELDS = [
    'name', 'spec', 'parts_json', 'saved_total_cost', 'saved_cost_details',
    'template_id', 'coil_spec', 'coil_sheets', 'coil_material',
    'has_float', 'float_wire', 'has_cable', 'cable_length', 'cable_wire', 'cable_accessory_type',
    'box_type', 'extra_parts_json', 'packing_parts_json',
    'assembly_wage', 'packing_wage', 'painting_wage',
    'surface_treatment_mode', 'surface_treatment_cost',
    'management_fee', 'custom_barrel_length',
];

const RECIPE_ALIASES = {
    partsJson: 'parts_json',
    savedTotalCost: 'saved_total_cost',
    savedCostDetails: 'saved_cost_details',
    templateId: 'template_id',
    coilSpec: 'coil_spec',
    coilSheets: 'coil_sheets',
    coilMaterial: 'coil_material',
    hasFloat: 'has_float',
    floatWire: 'float_wire',
    hasCable: 'has_cable',
    cableLength: 'cable_length',
    cableWire: 'cable_wire',
    cableAccessoryType: 'cable_accessory_type',
    boxType: 'box_type',
    extraPartsJson: 'extra_parts_json',
    packingPartsJson: 'packing_parts_json',
    assemblyWage: 'assembly_wage',
    packingWage: 'packing_wage',
    paintingWage: 'painting_wage',
    surfaceTreatmentMode: 'surface_treatment_mode',
    surfaceTreatmentCost: 'surface_treatment_cost',
    managementFee: 'management_fee',
    customBarrelLength: 'custom_barrel_length',
};

function recipeBodyToDb(body) {
    const updates = {};
    for (const f of RECIPE_FIELDS) {
        if (body[f] !== undefined) updates[f] = body[f];
    }
    for (const [camel, snake] of Object.entries(RECIPE_ALIASES)) {
        if (body[camel] !== undefined) updates[snake] = body[camel];
    }
    return updates;
}

function parseId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function updateRecipeRecord(id, body) {
    const updates = recipeBodyToDb(body);
    safeUpdate('recipes', id, updates);
    return recipeRow(db.prepare('SELECT * FROM recipes WHERE id = ?').get(id));
}

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
        const b = recipeBodyToDb(req.body);
        const now = new Date().toISOString();
        const info = db.prepare(`INSERT INTO recipes (
            name, spec, parts_json, saved_total_cost, saved_cost_details,
            template_id, coil_spec, coil_sheets, coil_material,
            has_float, float_wire, has_cable, cable_length, cable_wire, cable_accessory_type,
            box_type, extra_parts_json, packing_parts_json,
            assembly_wage, packing_wage, painting_wage,
            surface_treatment_mode, surface_treatment_cost,
            management_fee, custom_barrel_length,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            b.name || '', b.spec || '', b.parts_json || '[]',
            b.saved_total_cost ?? 0, b.saved_cost_details || '[]',
            b.template_id || null, b.coil_spec || '', b.coil_sheets || 0, b.coil_material || '钢带',
            b.has_float || 0, b.float_wire || '', b.has_cable || 0, b.cable_length || 0, b.cable_wire || '', b.cable_accessory_type || 'standard',
            b.box_type || '', b.extra_parts_json || '[]', b.packing_parts_json || '[]',
            b.assembly_wage || 0, b.packing_wage || 0, b.painting_wage != null ? b.painting_wage : null,
            b.surface_treatment_mode || (b.painting_wage != null ? 'painting' : 'none'),
            b.surface_treatment_cost != null ? b.surface_treatment_cost : (b.painting_wage != null ? b.painting_wage : 0),
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

router.delete('/:id', (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法配方ID' });
        softDelete('recipes', id);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.patch('/', (req, res) => {
    try {
        const b = req.body;
        const id = b.Id || b.id;
        if (!parseId(id)) return res.status(400).json({ success: false, error: '非法配方ID' });
        res.json({ success: true, data: updateRecipeRecord(Number(id), b) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.patch('/:id', (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法配方ID' });
        res.json({ success: true, data: updateRecipeRecord(id, req.body) });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

module.exports = router;
