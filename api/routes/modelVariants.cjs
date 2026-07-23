const { Router } = require('express');
const { db, dbGetAllModelVariants, modelVariantRow, partRow, safeInsert, safeUpdate, softDelete, invalidatePartsCache } = require('../db.cjs');
const { buildLongScrewInventoryParts } = require('../services/longScrewInventory.cjs');
const { parsePositiveId, parseNonNegativeNumber, stringifyJsonArray } = require('../services/validation.cjs');

const router = Router();
const COIL_SLOT_TYPES = new Set(['小眼', '国标眼']);

const VARIANT_FIELDS = [
    'model_name', 'template_id', 'coil_spec', 'coil_sheets', 'coil_material', 'coil_slot_type',
    'barrel_length', 'long_screw_extra_length', 'impeller_model', 'impeller_thickness', 'impeller_diameter',
    'impeller_blade_count', 'note', 'custom_fields_json',
];

const VARIANT_ALIASES = {
    modelName: 'model_name',
    templateId: 'template_id',
    coilSpec: 'coil_spec',
    coilSheets: 'coil_sheets',
    coilMaterial: 'coil_material',
    coilSlotType: 'coil_slot_type',
    barrelLength: 'barrel_length',
    longScrewExtraLength: 'long_screw_extra_length',
    impellerModel: 'impeller_model',
    impellerThickness: 'impeller_thickness',
    impellerDiameter: 'impeller_diameter',
    impellerBladeCount: 'impeller_blade_count',
    customFieldsJson: 'custom_fields_json',
};

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
    const templateId = parsePositiveId(b.template_id);
    if (!modelName) throw new Error('型号名称为必填项');
    if (!templateId) throw new Error('必须选择泵壳模板');
    let customFieldsJson = '[]';
    if (b.custom_fields_json !== undefined && b.custom_fields_json !== null && b.custom_fields_json !== '') {
        const parsed = JSON.parse(stringifyJsonArray(b.custom_fields_json, 'custom_fields_json'));
        if (!Array.isArray(parsed)) throw new Error('自定义字段格式错误');
        customFieldsJson = JSON.stringify(parsed.map(item => ({
            label: String(item?.label || '').trim(),
            value: String(item?.value || '').trim(),
        })).filter(item => item.label || item.value));
    }

    const coilSlotType = String(b.coil_slot_type || '小眼').trim() || '小眼';
    if (!COIL_SLOT_TYPES.has(coilSlotType)) throw new Error('线圈槽眼仅支持小眼或国标眼');
    return {
        model_name: modelName,
        template_id: templateId,
        coil_spec: String(b.coil_spec || '').trim(),
        coil_sheets: parseNonNegativeNumber(b.coil_sheets, 'coil_sheets'),
        coil_material: String(b.coil_material || '钢带').trim() || '钢带',
        coil_slot_type: coilSlotType,
        barrel_length: b.barrel_length !== undefined && b.barrel_length !== null && b.barrel_length !== '' ? parseNonNegativeNumber(b.barrel_length, 'barrel_length') : null,
        long_screw_extra_length: parseNonNegativeNumber(b.long_screw_extra_length, 'long_screw_extra_length'),
        impeller_model: String(b.impeller_model || '').trim(),
        impeller_thickness: b.impeller_thickness !== undefined && b.impeller_thickness !== null && b.impeller_thickness !== '' ? parseNonNegativeNumber(b.impeller_thickness, 'impeller_thickness') : null,
        impeller_diameter: b.impeller_diameter !== undefined && b.impeller_diameter !== null && b.impeller_diameter !== '' ? parseNonNegativeNumber(b.impeller_diameter, 'impeller_diameter') : null,
        impeller_blade_count: b.impeller_blade_count !== undefined && b.impeller_blade_count !== null && b.impeller_blade_count !== '' ? parseNonNegativeNumber(b.impeller_blade_count, 'impeller_blade_count') : null,
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
    const created = partsToCreate.map(part => {
        const info = safeInsert('parts', { model: part.model, category: part.category, price: part.price, supplier: part.supplier, stock: part.stock, remark: part.remark, created_at: now, updated_at: now });
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
            const info = safeInsert('pump_model_variants', {
                model_name: b.model_name,
                template_id: b.template_id,
                coil_spec: b.coil_spec,
                coil_sheets: b.coil_sheets,
                coil_material: b.coil_material,
                coil_slot_type: b.coil_slot_type,
                barrel_length: b.barrel_length,
                long_screw_extra_length: b.long_screw_extra_length,
                impeller_model: b.impeller_model,
                impeller_thickness: b.impeller_thickness,
                impeller_diameter: b.impeller_diameter,
                impeller_blade_count: b.impeller_blade_count,
                note: b.note,
                custom_fields_json: b.custom_fields_json,
                created_at: now,
                updated_at: now,
            });
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
        const id = parsePositiveId(req.params.id);
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
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法型号变体ID' });
        softDelete('pump_model_variants', id);
        res.json({ success: true, data: { deleted: 1 } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
