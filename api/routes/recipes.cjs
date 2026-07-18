const { Router } = require('express');
const { db, dbGetAllCoils, dbGetAllParts, dbGetAllRecipes, partRow, recipeRow, safeInsert, safeUpdate, softDelete, templateRow, modelVariantRow, invalidatePartsCache } = require('../db.cjs');
const { buildRecipeCostDraft } = require('../services/costEngine.cjs');
const { buildRecipeBomDraft } = require('../services/recipeBomEngine.cjs');
const { buildLongScrewInventoryPartsFromRecipe } = require('../services/longScrewInventory.cjs');
const { parsePositiveId, parseJsonArray, parseNonNegativeNumber, parsePositiveNumber, parseNonNegativeInteger } = require('../services/validation.cjs');
const router = Router();

const RECIPE_FIELDS = [
    'name', 'spec', 'parts_json', 'saved_total_cost', 'saved_cost_details',
    'template_id', 'coil_spec', 'coil_sheets', 'coil_material', 'coil_wire_weight',
    'has_float', 'float_wire', 'float_accessory_type', 'has_cable', 'cable_length', 'cable_wire', 'cable_accessory_type',
    'box_type', 'extra_parts_json', 'packing_parts_json',
    'assembly_wage', 'packing_wage', 'painting_wage',
    'surface_treatment_mode', 'surface_treatment_cost',
    'management_fee', 'custom_barrel_length',
    'model_variant_id', 'impeller_model', 'impeller_thickness', 'impeller_diameter', 'impeller_blade_count',
    'technical_data_json',
];

const RECIPE_ALIASES = {
    partsJson: 'parts_json',
    savedTotalCost: 'saved_total_cost',
    savedCostDetails: 'saved_cost_details',
    templateId: 'template_id',
    coilSpec: 'coil_spec',
    coilSheets: 'coil_sheets',
    coilMaterial: 'coil_material',
    coilWireWeight: 'coil_wire_weight',
    hasFloat: 'has_float',
    floatWire: 'float_wire',
    floatAccessoryType: 'float_accessory_type',
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
    modelVariantId: 'model_variant_id',
    impellerModel: 'impeller_model',
    impellerThickness: 'impeller_thickness',
    impellerDiameter: 'impeller_diameter',
    impellerBladeCount: 'impeller_blade_count',
    technicalDataJson: 'technical_data_json',
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

function numberValue(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function buildRecipeProductionChecks(recipeRecord, produceQty) {
    const qty = parsePositiveNumber(produceQty, 'produceQty', { defaultValue: 1 });
    const recipeParts = parseJsonArray(recipeRecord?.parts_json || recipeRecord?.partsJson);
    const allParts = db.prepare('SELECT * FROM parts WHERE deleted_at IS NULL').all();

    return recipeParts.map(recipePart => {
        const model = String(recipePart?.model || '').trim();
        const supplier = String(recipePart?.supplier || '').trim();
        const qtyNeeded = numberValue(recipePart?.qty) * qty;
        const matchedPart = allParts.find(part => part.model === model && String(part.supplier || '') === supplier)
            || allParts.find(part => part.model === model);
        const currentStock = matchedPart ? Number(matchedPart.stock || 0) : 0;

        return {
            name: String(recipePart?.name || model),
            model,
            supplier,
            qtyNeeded,
            currentStock,
            sufficient: Boolean(matchedPart) && currentStock >= qtyNeeded,
            partId: matchedPart?.id,
        };
    });
}

function productionChecksError(checks) {
    const missing = checks.filter(check => !check.partId);
    if (missing.length > 0) {
        return `以下配件在零件表中不存在：${missing.map(check => check.name).join('、')}`;
    }

    const insufficient = checks.filter(check => !check.sufficient);
    if (insufficient.length > 0) {
        return `库存不足：${insufficient.map(check => `${check.name}(需${check.qtyNeeded}，仅${check.currentStock})`).join('、')}`;
    }

    return '';
}

function buildRecipeProductionDraft(id, body) {
    const recipe = db.prepare('SELECT * FROM recipes WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!recipe) throw new Error('配方不存在');
    const produceQty = parsePositiveNumber(body?.produceQty ?? body?.qty, 'produceQty', { defaultValue: 1 });
    const checks = buildRecipeProductionChecks(recipe, produceQty);
    const error = productionChecksError(checks);

    return {
        recipe: recipeRow(recipe),
        produceQty,
        checks,
        deductions: checks.filter(check => check.partId).map(check => ({ partId: check.partId, deductQty: check.qtyNeeded })),
        canProduce: !error,
        error,
    };
}

function produceRecipe(id, body) {
    const action = db.transaction(() => {
        const draft = buildRecipeProductionDraft(id, body);
        if (!draft.canProduce) throw new Error(draft.error || '库存预检失败');

        for (const deduction of draft.deductions) {
            const current = db.prepare('SELECT stock FROM parts WHERE id = ? AND deleted_at IS NULL').get(deduction.partId);
            if (!current) throw new Error('扣减库存时零件不存在');
            const stock = Number(current.stock || 0) - Number(deduction.deductQty || 0);
            if (stock < 0) throw new Error('库存不足，无法扣减');
            safeUpdate('parts', deduction.partId, { stock });
        }

        return draft;
    });

    const result = action();
    invalidatePartsCache();
    return result;
}

function numberOrNull(value) {
    if (value === '' || value == null) return null;
    return parseNonNegativeNumber(value, 'value');
}

function intOrNull(value) {
    if (value === '' || value == null) return null;
    return parseNonNegativeInteger(Number(value), 'value');
}

function recipeSelectionRows(parts, packaging = false) {
    if (!Array.isArray(parts)) return [];
    return parts
        .filter(part => String(part?.model || '').trim())
        .map((part, index) => ({
            model: String(part.model || '').trim(),
            supplier: String(part.supplier || '').trim(),
            qty: parsePositiveNumber(part.qty, `parts[${index}].qty`, { defaultValue: 1 }),
            ...(packaging ? { packagingMaterial: String(part.packagingMaterial || '').trim() || '纸箱' } : {}),
            ...(part.costSource === 'manual'
                ? { snapshotPrice: parseNonNegativeNumber(part.snapshotPrice, `parts[${index}].snapshotPrice`), costSource: 'manual' }
                : {}),
        }));
}

const TECHNICAL_DATA_KEYS = [
    'rotorLength',
    'rotorDiameter',
    'shaftDiameter',
    'power',
    'voltage',
    'current',
    'frequency',
    'testReportNo',
    'testDate',
    'testSummary',
];

function stringifyTechnicalData(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const cleaned = {};

    TECHNICAL_DATA_KEYS.forEach(key => {
        const text = String(source[key] ?? '').trim();
        if (text) cleaned[key] = text;
    });

    const customFields = [];
    if (Array.isArray(source.customFields)) {
        source.customFields.forEach((field, index) => {
            if (!field || typeof field !== 'object') return;
            const label = String(field.label || '').trim();
            const text = String(field.value || '').trim();
            const unit = String(field.unit || '').trim();
            if (!label && !text && !unit) return;
            customFields.push({
                id: String(field.id || `custom_${index}`),
                label,
                value: text,
                unit,
            });
        });
    }

    Object.entries(source).forEach(([key, raw]) => {
        if (key === 'customFields' || TECHNICAL_DATA_KEYS.includes(key)) return;
        const text = String(raw ?? '').trim();
        if (text) customFields.push({ id: `custom_${key}`, label: key, value: text, unit: '' });
    });

    if (customFields.length > 0) cleaned.customFields = customFields;
    return JSON.stringify(cleaned);
}

function buildRecipeSavePayloadDraft(body) {
    const form = body?.form || {};
    const costDraft = body?.costDraft || {};
    const parts = Array.isArray(costDraft.parts) ? costDraft.parts : [];
    if (!String(form.name || '').trim()) throw new Error('配方名称不能为空');
    if (parts.length === 0) throw new Error('配方 BOM 不能为空');

    const surfaceTreatmentMode = form.surfaceTreatmentMode || 'none';
    return {
        name: String(form.name || '').trim(),
        spec: String(form.spec || '').trim(),
        partsJson: JSON.stringify(parts),
        savedTotalCost: parseNonNegativeNumber(costDraft.savedTotalCost, 'costDraft.savedTotalCost'),
        savedCostDetails: String(costDraft.savedCostDetails || ''),
        templateId: parsePositiveId(form.templateId),
        coilSpec: String(form.coilSpec || '').trim(),
        coilSheets: parseNonNegativeNumber(form.coilSheets, 'form.coilSheets'),
        coilMaterial: String(form.coilMaterial || '').trim() || '钢带',
        coilWireWeight: form.coilWireWeight === '' || form.coilWireWeight == null ? null : parseNonNegativeNumber(form.coilWireWeight, 'form.coilWireWeight'),
        hasFloat: form.hasFloat ? 1 : 0,
        floatWire: String(form.floatWire || '').trim(),
        floatAccessoryType: form.floatAccessoryType || 'standard',
        hasCable: form.hasCable ? 1 : 0,
        cableLength: parseNonNegativeNumber(form.cableLength, 'form.cableLength'),
        cableWire: String(form.cableWire || '').trim(),
        cableAccessoryType: form.cableAccessoryType || 'standard',
        packingPartsJson: JSON.stringify(recipeSelectionRows(body?.packingParts, true)),
        extraPartsJson: JSON.stringify(recipeSelectionRows(body?.optionalParts)),
        customBarrelLength: form.customBarrelLength === '' || form.customBarrelLength == null ? null : parseNonNegativeNumber(form.customBarrelLength, 'form.customBarrelLength'),
        modelVariantId: parsePositiveId(form.modelVariantId),
        impellerModel: String(form.impellerModel || '').trim(),
        impellerThickness: form.impellerThickness === '' || form.impellerThickness == null ? null : parseNonNegativeNumber(form.impellerThickness, 'form.impellerThickness'),
        impellerDiameter: form.impellerDiameter === '' || form.impellerDiameter == null ? null : parseNonNegativeNumber(form.impellerDiameter, 'form.impellerDiameter'),
        impellerBladeCount: form.impellerBladeCount === '' || form.impellerBladeCount == null ? null : parseNonNegativeInteger(form.impellerBladeCount, 'form.impellerBladeCount'),
        technicalDataJson: stringifyTechnicalData(body?.technicalData),
        assemblyWage: parseNonNegativeNumber(form.assemblyWage, 'form.assemblyWage'),
        packingWage: parseNonNegativeNumber(form.packingWage, 'form.packingWage'),
        paintingWage: null,
        surfaceTreatmentMode,
        surfaceTreatmentCost: surfaceTreatmentMode === 'none' ? 0 : parseNonNegativeNumber(form.surfaceTreatmentCost, 'form.surfaceTreatmentCost'),
        managementFee: parseNonNegativeNumber(form.managementFee, 'form.managementFee'),
    };
}

function partsCatalogRows() {
    return db.prepare(`
        SELECT id AS Id, model, category, price, supplier, stock, remark AS notes
        FROM parts
        WHERE deleted_at IS NULL
    `).all();
}

function autoCreateRecipeLongScrews(recipeLike) {
    const partsToCreate = buildLongScrewInventoryPartsFromRecipe({
        recipeName: recipeLike.name,
        parts: parseJsonArray(recipeLike.parts_json || recipeLike.partsJson),
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

function updateRecipeRecord(id, body) {
    const updates = recipeBodyToDb(body);
    safeUpdate('recipes', id, updates);
    const record = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id);
    const createdLongScrewParts = autoCreateRecipeLongScrews(record);
    return { recipe: recipeRow(record), createdLongScrewParts };
}

router.get('/', (req, res) => {
    try { res.json({ success: true, data: dbGetAllRecipes() }); }
    catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/cost-draft', (req, res) => {
    try {
        const data = buildRecipeCostDraft(req.body || {}, { partsCatalog: dbGetAllParts() });
        res.json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

function loadTemplateContext(templateId) {
    const id = parsePositiveId(templateId);
    if (!id) return { template: null, shellMeta: null };
    const template = templateRow(db.prepare('SELECT * FROM pump_shell_templates WHERE id = ?').get(id));
    if (!template) return { template: null, shellMeta: null };
    const shellPart = db.prepare('SELECT * FROM parts WHERE model = ? AND category = ? AND deleted_at IS NULL ORDER BY id LIMIT 1').get(template.shellModel, '泵壳');
    let shellMeta = null;
    try { shellMeta = shellPart?.remark ? JSON.parse(shellPart.remark) : null; } catch { shellMeta = null; }
    return { template, shellMeta };
}

router.post('/bom-draft', (req, res) => {
    try {
        const body = req.body || {};
        const variantId = parsePositiveId(body.modelVariantId);
        const variant = variantId
            ? modelVariantRow(db.prepare('SELECT * FROM pump_model_variants WHERE id = ? AND deleted_at IS NULL').get(variantId))
            : null;
        const templateId = body.templateId ?? variant?.templateId;
        const { template, shellMeta } = loadTemplateContext(templateId);
        const data = buildRecipeBomDraft(body, {
            template,
            variant,
            shellMeta,
            partsCatalog: dbGetAllParts(),
            coils: dbGetAllCoils(),
        });
        res.json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/model-variant-draft', (req, res) => {
    try {
        const modelVariantId = parsePositiveId(req.body?.modelVariantId);
        if (!modelVariantId) return res.status(400).json({ success: false, error: '非法型号变体ID' });

        const variant = modelVariantRow(db.prepare('SELECT * FROM pump_model_variants WHERE id = ? AND deleted_at IS NULL').get(modelVariantId));
        if (!variant) return res.status(404).json({ success: false, error: '型号变体不存在' });

        const { template } = loadTemplateContext(variant.templateId);
        const paintingWage = template?.paintingWage ?? null;
        const recipeDraft = {
            name: variant.modelName || '',
            spec: variant.note || '',
            templateId: variant.templateId,
            modelVariantId: variant.id,
            coilSpec: variant.coilSpec || '',
            coilSheets: variant.coilSheets || 0,
            coilMaterial: variant.coilMaterial || '钢带',
            customBarrelLength: variant.barrelLength ?? null,
            longScrewExtraLength: variant.longScrewExtraLength || 0,
            impellerModel: variant.impellerModel || '',
            impellerThickness: variant.impellerThickness ?? null,
            impellerDiameter: variant.impellerDiameter ?? null,
            impellerBladeCount: variant.impellerBladeCount ?? null,
            assemblyWage: template?.assemblyWage || 0,
            packingWage: template?.packingWage || 0,
            paintingWage,
            surfaceTreatmentMode: template?.surfaceTreatmentMode || (paintingWage != null ? 'painting' : 'none'),
            surfaceTreatmentCost: template?.surfaceTreatmentCost ?? (paintingWage != null ? Number(paintingWage) || 0 : 0),
        };

        res.json({ success: true, data: { recipeDraft, variant, template } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/save-payload-draft', (req, res) => {
    try {
        const data = buildRecipeSavePayloadDraft(req.body || {});
        res.json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/:id/production-check', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法配方ID' });
        res.json({ success: true, data: buildRecipeProductionDraft(id, req.body || {}) });
    } catch (error) {
        const code = error.message === '配方不存在' ? 404 : 400;
        res.status(code).json({ success: false, error: error.message });
    }
});

router.post('/:id/produce', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法配方ID' });
        res.json({ success: true, data: produceRecipe(id, req.body || {}) });
    } catch (error) {
        const code = error.message === '配方不存在' ? 404 : 400;
        res.status(code).json({ success: false, error: error.message });
    }
});

router.get('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法配方ID' });
        const record = recipeRow(db.prepare('SELECT * FROM recipes WHERE id = ?').get(id));
        if (!record) return res.status(404).json({ success: false, error: '配方不存在' });
        res.json({ success: true, data: record });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/', (req, res) => {
    try {
        const b = recipeBodyToDb(req.body);
        const now = new Date().toISOString();
        const saveRecipe = db.transaction(() => {
            const info = safeInsert('recipes', {
                name: b.name || '',
                spec: b.spec || '',
                parts_json: b.parts_json || '[]',
                saved_total_cost: b.saved_total_cost ?? 0,
                saved_cost_details: b.saved_cost_details || '[]',
                template_id: b.template_id || null,
                coil_spec: b.coil_spec || '',
                coil_sheets: b.coil_sheets || 0,
                coil_material: b.coil_material || '钢带',
                has_float: b.has_float || 0,
                float_wire: b.float_wire || '',
                float_accessory_type: b.float_accessory_type || 'standard',
                has_cable: b.has_cable || 0,
                cable_length: b.cable_length || 0,
                cable_wire: b.cable_wire || '',
                cable_accessory_type: b.cable_accessory_type || 'standard',
                box_type: b.box_type || '',
                extra_parts_json: b.extra_parts_json || '[]',
                packing_parts_json: b.packing_parts_json || '[]',
                assembly_wage: b.assembly_wage || 0,
                packing_wage: b.packing_wage || 0,
                painting_wage: b.painting_wage != null ? b.painting_wage : null,
                surface_treatment_mode: b.surface_treatment_mode || (b.painting_wage != null ? 'painting' : 'none'),
                surface_treatment_cost: b.surface_treatment_cost != null ? b.surface_treatment_cost : (b.painting_wage != null ? b.painting_wage : 0),
                management_fee: b.management_fee || 0,
                custom_barrel_length: b.custom_barrel_length != null ? b.custom_barrel_length : null,
                model_variant_id: b.model_variant_id || null,
                impeller_model: b.impeller_model || '',
                impeller_thickness: b.impeller_thickness != null ? b.impeller_thickness : null,
                impeller_diameter: b.impeller_diameter != null ? b.impeller_diameter : null,
                impeller_blade_count: b.impeller_blade_count != null ? b.impeller_blade_count : null,
                technical_data_json: b.technical_data_json || '{}',
                created_at: now,
                updated_at: now,
            });
            const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(info.lastInsertRowid);
            const createdLongScrewParts = autoCreateRecipeLongScrews(row);
            return { recipe: recipeRow(row), createdLongScrewParts };
        });
        const result = saveRecipe();
        res.json({ success: true, data: result.recipe, createdLongScrewParts: result.createdLongScrewParts });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法配方ID' });
        softDelete('recipes', id);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.patch('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法配方ID' });
        const result = db.transaction(() => updateRecipeRecord(id, req.body))();
        res.json({ success: true, data: result.recipe, createdLongScrewParts: result.createdLongScrewParts });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

module.exports = router;
