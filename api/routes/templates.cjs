const { Router } = require('express');
const { db, dbGetAllTemplates, templateRow, recipeRow, loadPartsData, calculateRecipeCost, safeUpdate, hardDelete } = require('../db.cjs');
const router = Router();

const TEMPLATE_ALIASES = {
    shellModel: 'shell_model',
    partsJson: 'parts_json',
    rotorParamsJson: 'rotor_params_json',
    assemblyWage: 'assembly_wage',
    packingWage: 'packing_wage',
    paintingWage: 'painting_wage',
};

function templateBodyToDb(body) {
    const updates = {};
    for (const f of ['shell_model', 'description', 'parts_json', 'rotor_params_json', 'assembly_wage', 'packing_wage', 'painting_wage']) {
        if (body[f] !== undefined) updates[f] = body[f];
    }
    for (const [camel, snake] of Object.entries(TEMPLATE_ALIASES)) {
        if (body[camel] !== undefined) updates[snake] = body[camel];
    }
    return updates;
}

router.get('/', (req, res) => {
    try { res.json({ success: true, data: dbGetAllTemplates() }); }
    catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/:id', (req, res) => {
    try {
        const record = templateRow(db.prepare('SELECT * FROM pump_shell_templates WHERE id = ?').get(parseInt(req.params.id)));
        if (!record) return res.status(404).json({ success: false, error: '模板不存在' });
        res.json({ success: true, data: record });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/:id/cost', (req, res) => {
    try {
        const tpl = db.prepare('SELECT * FROM pump_shell_templates WHERE id = ?').get(parseInt(req.params.id));
        if (!tpl) return res.status(404).json({ success: false, error: '模板不存在' });
        let tplParts = [];
        try { tplParts = JSON.parse(tpl.parts_json || '[]'); } catch { /* ignore */ }
        const { partsCache, partsByModel } = loadPartsData();
        const result = calculateRecipeCost(tplParts.map(p => ({ ...p, supplier: '' })), partsCache, partsByModel);
        res.json({ success: true, data: { templateId: tpl.id, shellModel: tpl.shell_model, ...result } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/:id/recipes', (req, res) => {
    try {
        const records = db.prepare('SELECT * FROM recipes WHERE template_id = ?').all(parseInt(req.params.id)).map(recipeRow);
        res.json({ success: true, data: records });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/', (req, res) => {
    try {
        const { shell_model, description, parts_json, rotor_params_json, assembly_wage, packing_wage, painting_wage } = templateBodyToDb(req.body);
        if (!shell_model) return res.status(400).json({ success: false, error: '泵壳型号为必填项' });
        const now = new Date().toISOString();
        const pJson = typeof parts_json === 'string' ? parts_json : JSON.stringify(parts_json || []);
        const rJson = typeof rotor_params_json === 'string' ? rotor_params_json : JSON.stringify(rotor_params_json || {});
        const info = db.prepare('INSERT INTO pump_shell_templates (shell_model, description, parts_json, rotor_params_json, assembly_wage, packing_wage, painting_wage, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            shell_model, description || '', pJson, rJson,
            assembly_wage != null ? parseFloat(assembly_wage) : 0,
            packing_wage != null ? parseFloat(packing_wage) : 0,
            painting_wage != null ? parseFloat(painting_wage) : null,
            now, now
        );
        res.json({ success: true, data: templateRow(db.prepare('SELECT * FROM pump_shell_templates WHERE id = ?').get(info.lastInsertRowid)) });
    } catch (error) {
        const body = templateBodyToDb(req.body);
        if (error.message.includes('UNIQUE constraint')) return res.status(409).json({ success: false, error: `泵壳型号 "${body.shell_model}" 已存在` });
        res.status(500).json({ success: false, error: error.message });
    }
});

router.patch('/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const b = templateBodyToDb(req.body);
        const updates = {};
        if (b.shell_model !== undefined) updates.shell_model = b.shell_model;
        if (b.description !== undefined) updates.description = b.description;
        if (b.parts_json !== undefined) updates.parts_json = typeof b.parts_json === 'string' ? b.parts_json : JSON.stringify(b.parts_json);
        if (b.rotor_params_json !== undefined) updates.rotor_params_json = typeof b.rotor_params_json === 'string' ? b.rotor_params_json : JSON.stringify(b.rotor_params_json);
        if (b.assembly_wage !== undefined) updates.assembly_wage = parseFloat(b.assembly_wage);
        if (b.packing_wage !== undefined) updates.packing_wage = parseFloat(b.packing_wage);
        if (b.painting_wage !== undefined) updates.painting_wage = b.painting_wage != null ? parseFloat(b.painting_wage) : null;
        safeUpdate('pump_shell_templates', id, updates);
        const record = templateRow(db.prepare('SELECT * FROM pump_shell_templates WHERE id = ?').get(id));
        if (!record) return res.status(404).json({ success: false, error: '模板不存在' });
        res.json({ success: true, data: record });
    } catch (error) {
        console.error("PATCH Template Error:", error);
        if (error.message.includes('UNIQUE constraint')) return res.status(409).json({ success: false, error: '泵壳型号已存在' });
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const refs = db.prepare('SELECT COUNT(*) as cnt FROM recipes WHERE template_id = ?').get(id);
        if (refs.cnt > 0) return res.status(409).json({ success: false, error: `有 ${refs.cnt} 个配方引用此模板，无法删除` });
        hardDelete('pump_shell_templates', id);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

module.exports = router;
