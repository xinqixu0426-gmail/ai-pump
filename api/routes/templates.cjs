const { Router } = require('express');
const { db, dbGetAllTemplates, templateRow, recipeRow, loadPartsData, calculateRecipeCost, safeUpdate, hardDelete } = require('../db.cjs');
const router = Router();

function parseId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function parseJson(value, fallback) {
    if (!value) return fallback;
    try {
        return typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
        return fallback;
    }
}

function buildTemplateCostParts(tpl, fixedParts) {
    const mode = tpl.cost_mode || 'components';
    if (mode === 'bundle') {
        return [
            { model: tpl.shell_model, name: '泵壳整套', supplier: '', qty: 1, snapshotPrice: Number(tpl.bundle_cost || 0), source: 'pump_shell_template', costSource: 'manual' },
            ...fixedParts.map(p => ({ ...p, supplier: p.supplier || '' })),
        ];
    }
    const components = parseJson(tpl.shell_components_json, [])
        .filter(c => c && c.name && c.included !== false)
        .map(c => ({
            model: c.model || c.name,
            name: c.name,
            supplier: '',
            qty: Number(c.qty || 1),
            snapshotPrice: Number(c.unitCost || 0),
            source: 'pump_shell_template',
            costSource: 'manual',
        }));
    return [...components, ...fixedParts.map(p => ({ ...p, supplier: p.supplier || '' }))];
}

const TEMPLATE_ALIASES = {
    shellModel: 'shell_model',
    partsJson: 'parts_json',
    shellComponentsJson: 'shell_components_json',
    rotorParamsJson: 'rotor_params_json',
    assemblyWage: 'assembly_wage',
    packingWage: 'packing_wage',
    paintingWage: 'painting_wage',
    costMode: 'cost_mode',
    bundleCost: 'bundle_cost',
};

function templateBodyToDb(body) {
    const updates = {};
    for (const f of ['shell_model', 'description', 'parts_json', 'shell_components_json', 'rotor_params_json', 'assembly_wage', 'packing_wage', 'painting_wage', 'cost_mode', 'bundle_cost']) {
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
        const result = calculateRecipeCost(buildTemplateCostParts(tpl, tplParts), partsCache, partsByModel);
        res.json({ success: true, data: { templateId: tpl.id, shellModel: tpl.shell_model, ...result } });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/:id/default-recipe', (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法模板ID' });
        const rawTpl = db.prepare('SELECT * FROM pump_shell_templates WHERE id = ?').get(id);
        const tpl = templateRow(rawTpl);
        if (!tpl) return res.status(404).json({ success: false, error: '模板不存在' });
        const parts = parseJson(tpl.partsJson, []);
        const rotorParams = parseJson(tpl.rotorParamsJson, {});
        const { partsCache, partsByModel } = loadPartsData();
        const cost = calculateRecipeCost(buildTemplateCostParts(rawTpl, parts), partsCache, partsByModel);
        res.json({
            success: true,
            data: {
                template: tpl,
                recipeDraft: {
                    name: tpl.shellModel,
                    spec: tpl.description || '',
                    templateId: tpl.Id,
                    partsJson: JSON.stringify(parts),
                    assemblyWage: tpl.assemblyWage || 0,
                    packingWage: tpl.packingWage || 0,
                    paintingWage: tpl.paintingWage,
                    surfaceTreatmentMode: tpl.paintingWage != null ? 'painting' : 'none',
                    surfaceTreatmentCost: tpl.paintingWage != null ? tpl.paintingWage : 0,
                },
                parts,
                rotorParams,
                cost,
            },
        });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/:id/apply', (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法模板ID' });
        const tpl = templateRow(db.prepare('SELECT * FROM pump_shell_templates WHERE id = ?').get(id));
        if (!tpl) return res.status(404).json({ success: false, error: '模板不存在' });
        const parts = parseJson(tpl.partsJson, []);
        const base = req.body?.recipe || {};
        const applied = {
            ...base,
            templateId: tpl.Id,
            partsJson: JSON.stringify(parts),
            assemblyWage: base.assemblyWage ?? tpl.assemblyWage ?? 0,
            packingWage: base.packingWage ?? tpl.packingWage ?? 0,
            paintingWage: base.paintingWage ?? tpl.paintingWage ?? null,
            surfaceTreatmentMode: base.surfaceTreatmentMode ?? (tpl.paintingWage != null ? 'painting' : 'none'),
            surfaceTreatmentCost: base.surfaceTreatmentCost ?? (tpl.paintingWage != null ? tpl.paintingWage : 0),
        };
        res.json({ success: true, data: { template: tpl, recipeDraft: applied, parts, rotorParams: parseJson(tpl.rotorParamsJson, {}) } });
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
        const { shell_model, description, parts_json, shell_components_json, rotor_params_json, assembly_wage, packing_wage, painting_wage, cost_mode, bundle_cost } = templateBodyToDb(req.body);
        if (!shell_model) return res.status(400).json({ success: false, error: '泵壳型号为必填项' });
        const now = new Date().toISOString();
        const pJson = typeof parts_json === 'string' ? parts_json : JSON.stringify(parts_json || []);
        const cJson = typeof shell_components_json === 'string' ? shell_components_json : JSON.stringify(shell_components_json || []);
        const rJson = typeof rotor_params_json === 'string' ? rotor_params_json : JSON.stringify(rotor_params_json || {});
        const mode = cost_mode === 'bundle' ? 'bundle' : 'components';
        const info = db.prepare('INSERT INTO pump_shell_templates (shell_model, description, parts_json, shell_components_json, rotor_params_json, assembly_wage, packing_wage, painting_wage, cost_mode, bundle_cost, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            shell_model, description || '', pJson, cJson, rJson,
            assembly_wage != null ? parseFloat(assembly_wage) : 0,
            packing_wage != null ? parseFloat(packing_wage) : 0,
            painting_wage != null ? parseFloat(painting_wage) : null,
            mode,
            mode === 'bundle' && bundle_cost != null ? parseFloat(bundle_cost) : 0,
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
        if (b.shell_components_json !== undefined) updates.shell_components_json = typeof b.shell_components_json === 'string' ? b.shell_components_json : JSON.stringify(b.shell_components_json);
        if (b.rotor_params_json !== undefined) updates.rotor_params_json = typeof b.rotor_params_json === 'string' ? b.rotor_params_json : JSON.stringify(b.rotor_params_json);
        if (b.assembly_wage !== undefined) updates.assembly_wage = parseFloat(b.assembly_wage);
        if (b.packing_wage !== undefined) updates.packing_wage = parseFloat(b.packing_wage);
        if (b.painting_wage !== undefined) updates.painting_wage = b.painting_wage != null ? parseFloat(b.painting_wage) : null;
        if (b.cost_mode !== undefined) updates.cost_mode = b.cost_mode === 'bundle' ? 'bundle' : 'components';
        if (b.bundle_cost !== undefined) updates.bundle_cost = b.bundle_cost != null ? parseFloat(b.bundle_cost) : 0;
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
