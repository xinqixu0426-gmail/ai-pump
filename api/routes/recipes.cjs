const { Router } = require('express');
const path = require('path');
const multer = require('multer');
const { db, dbGetAllCoils, dbGetAllParts, dbGetAllRecipes, partRow, recipeRow, recipeTechnicalFileRow, safeInsert, safeUpdate, softDelete, templateRow, modelVariantRow, invalidatePartsCache } = require('../db.cjs');
const { buildRecipeCostDraft, assertRecipeBomPrices } = require('../services/costEngine.cjs');
const { collapseLegacyCableParts } = require('../services/cableAccessory.cjs');
const { buildRecipeBomDraft } = require('../services/recipeBomEngine.cjs');
const { buildLongScrewInventoryPartsFromRecipe } = require('../services/longScrewInventory.cjs');
const { parsePumpTestReport } = require('../services/pumpTestReport.cjs');
const { parsePositiveId, parseJsonArray, parseNonNegativeNumber, parsePositiveNumber, parseNonNegativeInteger } = require('../services/validation.cjs');
const { inferPackagingSemantics } = require('../services/packagingSemantics.cjs');
const { refreshFactoryRuleCandidates } = require('../services/factoryRuleCandidates.cjs');
const { inspectFactoryFile, storeFactoryFile } = require('../services/factoryFileStore.cjs');
const router = Router();
const technicalFileUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const ALLOWED_TECHNICAL_FILE_EXTENSIONS = new Set(['.xls', '.xlsx']);
const COIL_SLOT_TYPES = new Set(['小眼', '国标眼']);

function technicalFileResponse(row) {
    const file = recipeTechnicalFileRow(row);
    return {
        id: file.id,
        recipeId: file.recipeId,
        fileId: file.fileId,
        originalName: file.originalName,
        mimeType: file.mimeType,
        fileSize: file.fileSize,
        fileSha256: file.fileSha256,
        reportType: file.reportType,
        summary: parseJsonObject(file.summaryJson),
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
    };
}

function parseJsonObject(value) {
    try {
        const parsed = JSON.parse(value || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

const RECIPE_FIELDS = [
    'name', 'spec', 'parts_json', 'saved_total_cost', 'saved_cost_details',
    'template_id', 'coil_spec', 'coil_sheets', 'coil_material', 'coil_slot_type', 'coil_wire_weight',
    'has_float', 'float_wire', 'float_accessory_type', 'has_cable', 'cable_length', 'cable_wire', 'cable_accessory_type',
    'box_type', 'extra_parts_json', 'packing_parts_json',
    'assembly_wage', 'packing_wage', 'painting_wage',
    'surface_treatment_mode', 'surface_treatment_cost',
    'management_fee', 'custom_barrel_length', 'long_screw_extra_length',
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
    coilSlotType: 'coil_slot_type',
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
    longScrewExtraLength: 'long_screw_extra_length',
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
    if (updates.long_screw_extra_length !== undefined) {
        updates.long_screw_extra_length = parseNonNegativeNumber(updates.long_screw_extra_length, 'longScrewExtraLength');
    }
    return updates;
}

function buildRecipeInventoryStatus(id) {
    const recipeRecord = db.prepare('SELECT * FROM recipes WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!recipeRecord) throw new Error('配方不存在');
    const recipeParts = collapseLegacyCableParts(parseJsonArray(recipeRecord?.parts_json || recipeRecord?.partsJson));
    const allParts = db.prepare('SELECT * FROM parts WHERE deleted_at IS NULL').all();

    const items = recipeParts.map(recipePart => {
        const model = String(recipePart?.model || '').trim();
        const supplier = String(recipePart?.supplier || '').trim();
        if (String(recipePart?.name || '').trim() === '线圈转子') {
            const coil = db.prepare(`
                SELECT id, stock
                FROM coils
                WHERE spec = ?
                  AND sheets = ?
                  AND material = ?
                  AND slot_type = ?
                  AND scheme_status = 'official'
                ORDER BY id DESC
                LIMIT 1
            `).get(
                String(recipeRecord.coil_spec || '').trim(),
                Number(recipeRecord.coil_sheets || 0),
                String(recipeRecord.coil_material || '钢带').trim() || '钢带',
                String(recipeRecord.coil_slot_type || '小眼').trim() || '小眼'
            );
            const currentStock = coil ? Number(coil.stock || 0) : 0;
            return {
                name: '线圈转子',
                model,
                supplier: '',
                currentStock,
                coilId: coil?.id,
                inventoryType: 'coil',
                status: !coil ? 'missing' : currentStock > 0 ? 'in_stock' : 'out_of_stock',
            };
        }
        const matchedPart = allParts.find(part => part.model === model && String(part.supplier || '') === supplier)
            || allParts.find(part => part.model === model);
        const currentStock = matchedPart ? Number(matchedPart.stock || 0) : 0;

        return {
            name: String(recipePart?.name || model),
            model,
            supplier,
            currentStock,
            partId: matchedPart?.id,
            inventoryType: 'part',
            status: !matchedPart ? 'missing' : currentStock > 0 ? 'in_stock' : 'out_of_stock',
        };
    });

    return {
        recipe: recipeRow(recipeRecord),
        items,
    };
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
        .map((part, index) => {
            const semantics = packaging ? inferPackagingSemantics(part) : null;
            return {
                model: String(part.model || '').trim(),
                supplier: String(part.supplier || '').trim(),
                qty: parsePositiveNumber(part.qty, `parts[${index}].qty`, { defaultValue: 1 }),
                ...(semantics ? semantics : {}),
                ...(part.costSource === 'manual'
                    ? { snapshotPrice: parseNonNegativeNumber(part.snapshotPrice, `parts[${index}].snapshotPrice`), costSource: 'manual' }
                    : {}),
            };
        });
}

const TECHNICAL_DATA_KEYS = [
    'rotorLength',
    'rotorDiameter',
    'shaftDiameter',
    'upperBearing',
    'lowerBearing',
    'pieceCount',
    'bearingSpan',
    'stackOffset',
    'oilSealDiameter',
    'impellerBoreDiameter',
    'impellerSpan',
    'impellerDepth',
    'threadLength',
    'threadDiameter',
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
    assertRecipeBomPrices(parts);

    const surfaceTreatmentMode = form.surfaceTreatmentMode || 'none';
    const coilSlotType = String(form.coilSlotType || '').trim() || '小眼';
    if (!COIL_SLOT_TYPES.has(coilSlotType)) throw new Error('form.coilSlotType 仅支持小眼或国标眼');
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
        coilSlotType,
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
        longScrewExtraLength: parseNonNegativeNumber(form.longScrewExtraLength, 'form.longScrewExtraLength'),
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

function refreshRecipeRuleLearningIfNeeded(recipeId, actor) {
    const hasLearningFeedback = db.prepare(`
        SELECT 1
        FROM recipe_analysis_feedback
        WHERE recipe_id = ?
          AND finding_type = 'peer_pattern'
          AND decision IN ('confirmed', 'special_case', 'ignored')
        LIMIT 1
    `).get(recipeId);
    if (!hasLearningFeedback) return;
    refreshFactoryRuleCandidates({ actor });
}

function updateRecipeRecord(id, body, actor) {
    const updates = recipeBodyToDb(body);
    if (updates.parts_json !== undefined) assertRecipeBomPrices(parseJsonArray(updates.parts_json));
    safeUpdate('recipes', id, updates);
    const record = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id);
    const createdLongScrewParts = autoCreateRecipeLongScrews(record);
    refreshRecipeRuleLearningIfNeeded(id, actor);
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
            coilSlotType: variant.coilSlotType || '小眼',
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

router.get('/:id/inventory-status', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法配方ID' });
        res.json({ success: true, data: buildRecipeInventoryStatus(id) });
    } catch (error) {
        const code = error.message === '配方不存在' ? 404 : 400;
        res.status(code).json({ success: false, error: error.message });
    }
});

router.get('/:id/technical-files', (req, res) => {
    try {
        const recipeId = parsePositiveId(req.params.id);
        if (!recipeId) return res.status(400).json({ success: false, error: '非法配方ID' });
        if (!db.prepare('SELECT id FROM recipes WHERE id = ? AND deleted_at IS NULL').get(recipeId)) {
            return res.status(404).json({ success: false, error: '配方不存在' });
        }
        const rows = db.prepare(`
            SELECT id, recipe_id, file_id, original_name, mime_type, file_size, file_sha256,
                   report_type, summary_json, parsed_json, extracted_text, created_at, updated_at
            FROM recipe_technical_files
            WHERE recipe_id = ? AND deleted_at IS NULL
            ORDER BY id DESC
        `).all(recipeId);
        res.json({ success: true, data: rows.map(technicalFileResponse) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/:id/technical-files', (req, res) => {
    technicalFileUpload.single('file')(req, res, error => {
        if (error) {
            const message = error.code === 'LIMIT_FILE_SIZE' ? '测试报告不能超过 10MB' : error.message;
            return res.status(400).json({ success: false, error: message });
        }
        try {
            const recipeId = parsePositiveId(req.params.id);
            if (!recipeId) return res.status(400).json({ success: false, error: '非法配方ID' });
            if (!db.prepare('SELECT id FROM recipes WHERE id = ? AND deleted_at IS NULL').get(recipeId)) {
                return res.status(404).json({ success: false, error: '配方不存在' });
            }
            if (!req.file?.buffer?.length) return res.status(400).json({ success: false, error: '请选择测试报告文件' });
            const inspectedFile = inspectFactoryFile({
                buffer: req.file.buffer,
                originalName: req.file.originalname,
                mimeType: req.file.mimetype,
            });
            const originalName = inspectedFile.originalName;
            const extension = path.extname(originalName).toLowerCase();
            if (!ALLOWED_TECHNICAL_FILE_EXTENSIONS.has(extension)) {
                return res.status(400).json({ success: false, error: '只支持 .xls 和 .xlsx 测试报告' });
            }

            const report = parsePumpTestReport(req.file.buffer, originalName);
            const now = new Date().toISOString();
            const saveTechnicalFile = db.transaction(() => {
                const stored = storeFactoryFile({
                    buffer: req.file.buffer,
                    originalName,
                    mimeType: req.file.mimetype,
                    sourceType: 'recipe_technical_file',
                    parserStatus: 'parsed',
                    now,
                });
                const info = safeInsert('recipe_technical_files', {
                    recipe_id: recipeId,
                    file_id: stored.file.id,
                    original_name: originalName,
                    mime_type: stored.file.mimeType,
                    file_size: stored.file.fileSize,
                    file_sha256: stored.file.fileSha256,
                    file_blob: req.file.buffer,
                    report_type: 'pump_performance_test',
                    summary_json: JSON.stringify(report.summary),
                    parsed_json: JSON.stringify(report.parsed),
                    extracted_text: report.extractedText,
                    created_at: now,
                    updated_at: now,
                });
                return db.prepare('SELECT * FROM recipe_technical_files WHERE id = ?')
                    .get(info.lastInsertRowid);
            });
            const row = saveTechnicalFile();
            res.json({ success: true, data: technicalFileResponse(row) });
        } catch (parseError) {
            res.status(400).json({ success: false, error: parseError.message });
        }
    });
});

router.get('/:id/technical-files/:fileId/download', (req, res) => {
    try {
        const recipeId = parsePositiveId(req.params.id);
        const fileId = parsePositiveId(req.params.fileId);
        if (!recipeId || !fileId) return res.status(400).json({ success: false, error: '非法配方或文件ID' });
        const row = db.prepare(`
            SELECT r.original_name,
                   COALESCE(f.mime_type, r.mime_type) AS mime_type,
                   COALESCE(f.file_blob, r.file_blob) AS file_blob
            FROM recipe_technical_files r
            LEFT JOIN factory_files f ON f.id = r.file_id AND f.deleted_at IS NULL
            WHERE r.id = ? AND r.recipe_id = ? AND r.deleted_at IS NULL
        `).get(fileId, recipeId);
        if (!row) return res.status(404).json({ success: false, error: '测试报告不存在' });
        res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
        res.setHeader('Content-Length', row.file_blob.length);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.original_name)}`);
        res.send(row.file_blob);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/:id/technical-files/:fileId', (req, res) => {
    try {
        const recipeId = parsePositiveId(req.params.id);
        const fileId = parsePositiveId(req.params.fileId);
        if (!recipeId || !fileId) return res.status(400).json({ success: false, error: '非法配方或文件ID' });
        const row = db.prepare('SELECT id FROM recipe_technical_files WHERE id = ? AND recipe_id = ? AND deleted_at IS NULL').get(fileId, recipeId);
        if (!row) return res.status(404).json({ success: false, error: '测试报告不存在' });
        softDelete('recipe_technical_files', fileId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
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
        assertRecipeBomPrices(parseJsonArray(b.parts_json || '[]'));
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
                coil_slot_type: b.coil_slot_type || '小眼',
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
                long_screw_extra_length: b.long_screw_extra_length ?? 0,
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
    } catch (error) { res.status(error.statusCode || 500).json({ success: false, error: error.message }); }
});

router.delete('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法配方ID' });
        db.transaction(() => {
            softDelete('recipes', id);
            refreshRecipeRuleLearningIfNeeded(id, req.user?.role || 'system');
        })();
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

router.patch('/:id', (req, res) => {
    try {
        const id = parsePositiveId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: '非法配方ID' });
        const result = db.transaction(() => updateRecipeRecord(id, req.body, req.user?.role || 'system'))();
        res.json({ success: true, data: result.recipe, createdLongScrewParts: result.createdLongScrewParts });
    } catch (error) { res.status(error.statusCode || 500).json({ success: false, error: error.message }); }
});

module.exports = router;
