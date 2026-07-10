const { Router } = require('express');
const { db, dbGetAllTemplates, templateRow, recipeRow, loadPartsData, calculateRecipeCost, safeInsert, safeUpdate, hardDelete } = require('../db.cjs');
const { parsePositiveId, parseNonNegativeNumber, stringifyJsonArray, stringifyJsonObject } = require('../services/validation.cjs');
const router = Router();

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

function optionalNonNegative(value, field) {
    return value === undefined || value === null || value === ''
        ? null
        : parseNonNegativeNumber(value, field);
}

function normalizeTemplateJsonFields(body) {
    return {
        partsJson: stringifyJsonArray(body.parts_json, 'parts_json'),
        shellComponentsJson: stringifyJsonArray(body.shell_components_json, 'shell_components_json'),
        rotorParamsJson: stringifyJsonObject(body.rotor_params_json, 'rotor_params_json'),
    };
}

router.get('/', (req, res) => {
    try { res.json({ success: true, data: dbGetAllTemplates() }); }
    catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法模板ID' });
        const record = templateRow(db.prepare('SELECT * FROM pump_shell_templates WHERE id = ?').get(id));
        if (!record) return res.status(404).json({ success: false, error: '模板不存在' });
        res.json({ success: true, data: record });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.get('/:id/cost', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法模板ID' });
        const tpl = db.prepare('SELECT * FROM pump_shell_templates WHERE id = ?').get(id);
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
        const id = parsePositiveId(req.params.id);
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
                    templateId: tpl.id,
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
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法模板ID' });
        const tpl = templateRow(db.prepare('SELECT * FROM pump_shell_templates WHERE id = ?').get(id));
        if (!tpl) return res.status(404).json({ success: false, error: '模板不存在' });
        const parts = parseJson(tpl.partsJson, []);
        const base = req.body?.recipe || {};
        const applied = {
            ...base,
            templateId: tpl.id,
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
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法模板ID' });
        const records = db.prepare('SELECT * FROM recipes WHERE template_id = ?').all(id).map(recipeRow);
        res.json({ success: true, data: records });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/', (req, res) => {
    try {
        const { shell_model, description, parts_json, shell_components_json, rotor_params_json, assembly_wage, packing_wage, painting_wage, cost_mode, bundle_cost } = templateBodyToDb(req.body);
        if (!shell_model) return res.status(400).json({ success: false, error: '泵壳型号为必填项' });
        const now = new Date().toISOString();
        const json = normalizeTemplateJsonFields({ parts_json, shell_components_json, rotor_params_json });
        const mode = cost_mode === 'bundle' ? 'bundle' : 'components';
        const info = safeInsert('pump_shell_templates', {
            shell_model,
            description: description || '',
            parts_json: json.partsJson,
            shell_components_json: json.shellComponentsJson,
            rotor_params_json: json.rotorParamsJson,
            assembly_wage: parseNonNegativeNumber(assembly_wage, 'assembly_wage'),
            packing_wage: parseNonNegativeNumber(packing_wage, 'packing_wage'),
            painting_wage: optionalNonNegative(painting_wage, 'painting_wage'),
            cost_mode: mode,
            bundle_cost: mode === 'bundle' ? parseNonNegativeNumber(bundle_cost, 'bundle_cost') : 0,
            created_at: now,
            updated_at: now,
        });
        res.json({ success: true, data: templateRow(db.prepare('SELECT * FROM pump_shell_templates WHERE id = ?').get(info.lastInsertRowid)) });
    } catch (error) {
        const body = templateBodyToDb(req.body);
        if (error.message.includes('UNIQUE constraint')) return res.status(409).json({ success: false, error: `泵壳型号 "${body.shell_model}" 已存在` });
        res.status(500).json({ success: false, error: error.message });
    }
});

router.patch('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法模板ID' });
        const b = templateBodyToDb(req.body);
        const updates = {};
        if (b.shell_model !== undefined) updates.shell_model = b.shell_model;
        if (b.description !== undefined) updates.description = b.description;
        if (b.parts_json !== undefined) updates.parts_json = stringifyJsonArray(b.parts_json, 'parts_json');
        if (b.shell_components_json !== undefined) updates.shell_components_json = stringifyJsonArray(b.shell_components_json, 'shell_components_json');
        if (b.rotor_params_json !== undefined) updates.rotor_params_json = stringifyJsonObject(b.rotor_params_json, 'rotor_params_json');
        if (b.assembly_wage !== undefined) updates.assembly_wage = parseNonNegativeNumber(b.assembly_wage, 'assembly_wage');
        if (b.packing_wage !== undefined) updates.packing_wage = parseNonNegativeNumber(b.packing_wage, 'packing_wage');
        if (b.painting_wage !== undefined) updates.painting_wage = optionalNonNegative(b.painting_wage, 'painting_wage');
        if (b.cost_mode !== undefined) updates.cost_mode = b.cost_mode === 'bundle' ? 'bundle' : 'components';
        if (b.bundle_cost !== undefined) updates.bundle_cost = parseNonNegativeNumber(b.bundle_cost, 'bundle_cost');
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
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法模板ID' });
        const refs = db.prepare('SELECT COUNT(*) as cnt FROM recipes WHERE template_id = ?').get(id);
        if (refs.cnt > 0) return res.status(409).json({ success: false, error: `有 ${refs.cnt} 个配方引用此模板，无法删除` });
        hardDelete('pump_shell_templates', id);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

module.exports = router;
