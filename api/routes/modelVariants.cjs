const { Router } = require('express');
const { db, dbGetAllModelVariants, modelVariantRow, partRow, safeUpdate, softDelete, invalidatePartsCache } = require('../db.cjs');
const { buildLongScrewInventoryParts } = require('../services/longScrewInventory.cjs');

const router = Router();

const VARIANT_FIELDS = [
    'model_name', 'template_id', 'coil_spec', 'coil_sheets', 'coil_material',
    'barrel_length', 'long_screw_extra_length', 'impeller_model', 'impeller_thickness', 'impeller_diameter',
    'impeller_blade_count', 'note', 'custom_fields_json',
];

const VARIANT_ALIASES = {
    modelName: 'model_name',
    templateId: 'template_id',
    coilSpec: 'coil_spec',
    coilSheets: 'coil_sheets',
    coilMaterial: 'coil_material',
    barrelLength: 'barrel_length',
    longScrewExtraLength: 'long_screw_extra_length',
    impellerModel: 'impeller_model',
    impellerThickness: 'impeller_thickness',
    impellerDiameter: 'impeller_diameter',
    impellerBladeCount: 'impeller_blade_count',
    customFieldsJson: 'custom_fields_json',
};

function parseId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function bodyToDb(body) {
    const updates = {};
    for (const field of VARIANT_FIELDS) {
        if (body[field] !== undefined) updates[field] = body[field];
    }
    for (const [camel, snake] of Object.entries(VARIANT_ALIASES)) {
        if (body[camel] !== undefined) updates[snake] = body[camel];
    }
    return updates;
}

function normalizeVariant(body) {
    const b = bodyToDb(body || {});
    const modelName = String(b.model_name || '').trim();
    const templateId = parseId(b.template_id);
    if (!modelName) throw new Error('型号名称为必填项');
    if (!templateId) throw new Error('必须选择泵壳模板');
    let customFieldsJson = '[]';
    if (b.custom_fields_json !== undefined && b.custom_fields_json !== null && b.custom_fields_json !== '') {
        const parsed = JSON.parse(String(b.custom_fields_json));
        if (!Array.isArray(parsed)) throw new Error('自定义字段格式错误');
        customFieldsJson = JSON.stringify(parsed.map(item => ({
            label: String(item?.label || '').trim(),
            value: String(item?.value || '').trim(),
        })).filter(item => item.label || item.value));
    }

    return {
        model_name: modelName,
        template_id: templateId,
        coil_spec: String(b.coil_spec || '').trim(),
        coil_sheets: b.coil_sheets ? Number(b.coil_sheets) : 0,
        coil_material: String(b.coil_material || '钢带').trim() || '钢带',
        barrel_length: b.barrel_length !== undefined && b.barrel_length !== null && b.barrel_length !== '' ? Number(b.barrel_length) : null,
        long_screw_extra_length: b.long_screw_extra_length !== undefined && b.long_screw_extra_length !== null && b.long_screw_extra_length !== '' ? Number(b.long_screw_extra_length) : 0,
        impeller_model: String(b.impeller_model || '').trim(),
        impeller_thickness: b.impeller_thickness !== undefined && b.impeller_thickness !== null && b.impeller_thickness !== '' ? Number(b.impeller_thickness) : null,
        impeller_diameter: b.impeller_diameter !== undefined && b.impeller_diameter !== null && b.impeller_diameter !== '' ? Number(b.impeller_diameter) : null,
        impeller_blade_count: b.impeller_blade_count !== undefined && b.impeller_blade_count !== null && b.impeller_blade_count !== '' ? Number(b.impeller_blade_count) : null,
        note: String(b.note || '').trim(),
        custom_fields_json: customFieldsJson,
    };
}

function partsCatalogRows() {
    return db.prepare(`
        SELECT id AS Id, model, category, price, supplier, stock, remark AS notes
        FROM parts
        WHERE deleted_at IS NULL
    `).all();
}

function autoCreateVariantLongScrews(variant) {
    const template = db.prepare('SELECT * FROM pump_shell_templates WHERE id = ?').get(variant.template_id || variant.templateId);
    if (!template) return [];
    const partsToCreate = buildLongScrewInventoryParts({
        variant,
        template,
        partsCatalog: partsCatalogRows(),
    }).filter(part => !db.prepare(`
        SELECT id FROM parts
        WHERE deleted_at IS NULL AND category = ? AND model = ?
        LIMIT 1
    `).get(part.category, part.model));

    if (partsToCreate.length === 0) return [];
    const now = new Date().toISOString();
    const insert = db.prepare(`
        INSERT INTO parts (model, category, price, supplier, stock, remark, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const created = partsToCreate.map(part => {
        const info = insert.run(part.model, part.category, part.price, part.supplier, part.stock, part.remark, now, now);
        return partRow(db.prepare('SELECT * FROM parts WHERE id = ?').get(info.lastInsertRowid));
    });
    invalidatePartsCache();
    return created;
}

router.get('/', (req, res) => {
    try {
        res.json({ success: true, data: dbGetAllModelVariants() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/', (req, res) => {
    try {
        const b = normalizeVariant(req.body);
        const now = new Date().toISOString();
        const saveVariant = db.transaction(() => {
            const info = db.prepare(`INSERT INTO pump_model_variants (
            model_name, template_id, coil_spec, coil_sheets, coil_material,
            barrel_length, long_screw_extra_length, impeller_model, impeller_thickness, impeller_diameter,
            impeller_blade_count, note, custom_fields_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
                b.model_name, b.template_id, b.coil_spec, b.coil_sheets, b.coil_material,
                b.barrel_length, b.long_screw_extra_length, b.impeller_model, b.impeller_thickness, b.impeller_diameter,
                b.impeller_blade_count, b.note, b.custom_fields_json, now, now
            );
            const row = db.prepare('SELECT * FROM pump_model_variants WHERE id = ?').get(info.lastInsertRowid);
            const createdLongScrewParts = autoCreateVariantLongScrews(row);
            return { variant: modelVariantRow(row), createdLongScrewParts };
        });
        const result = saveVariant();
        res.json({ success: true, data: result.variant, createdLongScrewParts: result.createdLongScrewParts });
    } catch (error) {
        if (error.message.includes('UNIQUE constraint')) return res.status(409).json({ success: false, error: '型号名称已存在' });
        res.status(400).json({ success: false, error: error.message });
    }
});

router.patch('/:id', (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法型号变体ID' });
        const b = normalizeVariant(req.body);
        const saveVariant = db.transaction(() => {
            safeUpdate('pump_model_variants', id, b);
            const row = db.prepare('SELECT * FROM pump_model_variants WHERE id = ?').get(id);
            const createdLongScrewParts = autoCreateVariantLongScrews(row);
            return { variant: modelVariantRow(row), createdLongScrewParts };
        });
        const result = saveVariant();
        res.json({ success: true, data: result.variant, createdLongScrewParts: result.createdLongScrewParts });
    } catch (error) {
        if (error.message.includes('UNIQUE constraint')) return res.status(409).json({ success: false, error: '型号名称已存在' });
        res.status(400).json({ success: false, error: error.message });
    }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法型号变体ID' });
        softDelete('pump_model_variants', id);
        res.json({ success: true, data: { deleted: 1 } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
