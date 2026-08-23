const crypto = require('node:crypto');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
    requestHash,
} = require('./commandExecution.cjs');
const { standardBusinessChange } = require('./businessChanges.cjs');
const {
    assertRecipeBomPrices,
    buildRecipeCostDraft,
} = require('./costEngine.cjs');
const { buildLongScrewInventoryPartsFromRecipe } = require('./longScrewInventory.cjs');
const { inferPackagingSemantics } = require('./packagingSemantics.cjs');
const {
    assertPreviewHash,
    normalizePreviewHash,
} = require('./previewIntegrity.cjs');
const {
    assertExpectedUpdatedAt,
    normalizeExpectedUpdatedAt,
} = require('./resourceVersion.cjs');
const {
    parseJsonArray,
    parseNonNegativeInteger,
    parseNonNegativeNumber,
    parsePositiveId,
    parsePositiveNumber,
} = require('./validation.cjs');
const {
    stringifyRecipeConfigurationPolicy,
} = require('./recipeConfigurationPolicy.cjs');

const CREATE_CAPABILITY_ID = requireBusinessCapability('recipes.create').capabilityId;
const UPDATE_CAPABILITY_ID = requireBusinessCapability('recipes.update').capabilityId;
const DELETE_CAPABILITY_ID = requireBusinessCapability('recipes.delete').capabilityId;
const COIL_SLOT_TYPES = new Set(['小眼', '国标眼']);

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
    'configuration_policy_json',
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
    configurationPolicyJson: 'configuration_policy_json',
};

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

function recipeCommandError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function recipeBodyToDb(body = {}) {
    const updates = {};
    for (const field of RECIPE_FIELDS) {
        if (body[field] !== undefined) updates[field] = body[field];
    }
    for (const [camel, snake] of Object.entries(RECIPE_ALIASES)) {
        if (body[camel] !== undefined) updates[snake] = body[camel];
    }
    return updates;
}

function recipeSelectionRows(parts, packaging = false) {
    if (!Array.isArray(parts)) return [];
    return parts
        .filter(part => String(part?.model || '').trim())
        .map((part, index) => {
            const semantics = packaging ? inferPackagingSemantics(part) : null;
            return {
                ...(parsePositiveId(part.partId) ? { partId: parsePositiveId(part.partId) } : {}),
                model: String(part.model || '').trim(),
                supplier: String(part.supplier || '').trim(),
                qty: parsePositiveNumber(part.qty, `parts[${index}].qty`, { defaultValue: 1 }),
                ...(semantics || {}),
                ...(part.costSource === 'manual'
                    ? {
                        snapshotPrice: parseNonNegativeNumber(
                            part.snapshotPrice,
                            `parts[${index}].snapshotPrice`
                        ),
                        costSource: 'manual',
                    }
                    : {}),
            };
        });
}

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
        if (text) customFields.push({
            id: `custom_${key}`,
            label: key,
            value: text,
            unit: '',
        });
    });

    if (customFields.length > 0) cleaned.customFields = customFields;
    return JSON.stringify(cleaned);
}

function normalizeOptionalNumber(value, field) {
    if (value === '' || value === null || value === undefined) return null;
    return parseNonNegativeNumber(value, field);
}

function normalizeBooleanFlag(value) {
    return value === true || value === 1 || value === '1' ? 1 : 0;
}

function normalizeJsonObjectString(value, field) {
    if (value === undefined || value === null || value === '') return '{}';
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return JSON.stringify(value);
    }
    try {
        const parsed = JSON.parse(String(value));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        return JSON.stringify(parsed);
    } catch {
        throw recipeCommandError('recipe_json_invalid', `${field} 必须是 JSON 对象`, 400);
    }
}

function normalizeRecipePayload(dependencies, input = {}, existingRecord = null) {
    const source = {
        ...(existingRecord || {}),
        ...recipeBodyToDb(input),
    };
    const name = String(source.name || '').trim();
    if (!name) throw recipeCommandError('recipe_name_required', '配方名称不能为空', 400);

    const parts = parseJsonArray(source.parts_json);
    if (parts.length === 0) {
        throw recipeCommandError('recipe_bom_required', '配方 BOM 不能为空', 400);
    }

    const surfaceTreatmentMode = String(source.surface_treatment_mode || 'none');
    const coilSlotType = String(source.coil_slot_type || '').trim() || '小眼';
    if (!COIL_SLOT_TYPES.has(coilSlotType)) {
        throw recipeCommandError(
            'recipe_coil_slot_type_invalid',
            'coilSlotType 仅支持小眼或国标眼',
            400
        );
    }
    const customBarrelLength = normalizeOptionalNumber(
        source.custom_barrel_length,
        'customBarrelLength'
    );
    const longScrewExtraLength = parseNonNegativeNumber(
        source.long_screw_extra_length,
        'longScrewExtraLength'
    );
    const canonicalCost = buildRecipeCostDraft({
        parts,
        assemblyWage: parseNonNegativeNumber(source.assembly_wage, 'assemblyWage'),
        packingWage: parseNonNegativeNumber(source.packing_wage, 'packingWage'),
        surfaceTreatmentMode,
        surfaceTreatmentCost: surfaceTreatmentMode === 'none'
            ? 0
            : parseNonNegativeNumber(source.surface_treatment_cost, 'surfaceTreatmentCost'),
        managementFee: parseNonNegativeNumber(source.management_fee, 'managementFee'),
        coilMaterial: String(source.coil_material || '').trim() || '钢带',
        customBarrelLength,
        longScrewExtraLength,
        enableLongScrewByBarrelLength: parts.some(
            part => part?.dynamicRule === 'longScrewByBarrelLength'
        ),
    }, {
        partsCatalog: dependencies.dbGetAllParts(),
        requireStablePartIdentity: true,
    });
    assertRecipeBomPrices(canonicalCost.parts);

    return {
        name,
        spec: String(source.spec || '').trim(),
        parts_json: JSON.stringify(canonicalCost.parts),
        saved_total_cost: canonicalCost.savedTotalCost,
        saved_cost_details: canonicalCost.savedCostDetails,
        template_id: parsePositiveId(source.template_id),
        coil_spec: String(source.coil_spec || '').trim(),
        coil_sheets: parseNonNegativeNumber(source.coil_sheets, 'coilSheets'),
        coil_material: String(source.coil_material || '').trim() || '钢带',
        coil_slot_type: coilSlotType,
        coil_wire_weight: normalizeOptionalNumber(source.coil_wire_weight, 'coilWireWeight'),
        has_float: normalizeBooleanFlag(source.has_float),
        float_wire: String(source.float_wire || '').trim(),
        float_accessory_type: String(source.float_accessory_type || 'standard'),
        has_cable: normalizeBooleanFlag(source.has_cable),
        cable_length: parseNonNegativeNumber(source.cable_length, 'cableLength'),
        cable_wire: String(source.cable_wire || '').trim(),
        cable_accessory_type: String(source.cable_accessory_type || 'standard'),
        box_type: String(source.box_type || ''),
        extra_parts_json: JSON.stringify(parseJsonArray(source.extra_parts_json)),
        packing_parts_json: JSON.stringify(parseJsonArray(source.packing_parts_json)),
        assembly_wage: parseNonNegativeNumber(source.assembly_wage, 'assemblyWage'),
        packing_wage: parseNonNegativeNumber(source.packing_wage, 'packingWage'),
        painting_wage: null,
        surface_treatment_mode: surfaceTreatmentMode,
        surface_treatment_cost: surfaceTreatmentMode === 'none'
            ? 0
            : parseNonNegativeNumber(source.surface_treatment_cost, 'surfaceTreatmentCost'),
        management_fee: parseNonNegativeNumber(source.management_fee, 'managementFee'),
        custom_barrel_length: customBarrelLength,
        long_screw_extra_length: longScrewExtraLength,
        model_variant_id: parsePositiveId(source.model_variant_id),
        impeller_model: String(source.impeller_model || '').trim(),
        impeller_thickness: normalizeOptionalNumber(source.impeller_thickness, 'impellerThickness'),
        impeller_diameter: normalizeOptionalNumber(source.impeller_diameter, 'impellerDiameter'),
        impeller_blade_count: source.impeller_blade_count === ''
            || source.impeller_blade_count === null
            || source.impeller_blade_count === undefined
            ? null
            : parseNonNegativeInteger(source.impeller_blade_count, 'impellerBladeCount'),
        technical_data_json: normalizeJsonObjectString(
            source.technical_data_json,
            'technicalDataJson'
        ),
        configuration_policy_json: stringifyRecipeConfigurationPolicy(
            source.configuration_policy_json,
            'configurationPolicyJson'
        ),
    };
}

function payloadToCamelCase(payload) {
    return Object.fromEntries(Object.entries(payload).map(([key, value]) => {
        const camel = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
        return [camel, value];
    }));
}

function recipeSavePreviewHash(capabilityId, recipeId, payload) {
    return requestHash({
        capabilityId,
        recipeId: recipeId || null,
        payload,
    });
}

function getRecipeRecord(db, recipeId) {
    const record = db.prepare(
        'SELECT * FROM recipes WHERE id = ? AND deleted_at IS NULL'
    ).get(recipeId);
    if (!record) throw recipeCommandError('recipe_not_found', '配方不存在', 404);
    return record;
}

function buildRecipeSavePayloadDraft(dependencies, body = {}) {
    const form = body.form || {};
    if (typeof dependencies.buildRecipeBomDraft !== 'function') {
        throw new Error('配方保存服务缺少权威 BOM 草稿依赖');
    }
    const recipeId = parsePositiveId(body.recipeId);
    const capabilityId = recipeId ? UPDATE_CAPABILITY_ID : CREATE_CAPABILITY_ID;
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        body.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const existingRecord = recipeId ? getRecipeRecord(dependencies.db, recipeId) : null;
    if (existingRecord) {
        assertExpectedUpdatedAt(existingRecord, expectedUpdatedAt, `配方 #${recipeId}`);
    }

    const templateId = parsePositiveId(form.templateId);
    const templatePolicy = !existingRecord && templateId
        ? dependencies.db.prepare(
            'SELECT configuration_policy_json FROM pump_shell_templates WHERE id = ?'
        ).get(templateId)?.configuration_policy_json
        : null;
    const configurationPolicyJson = form.configurationPolicyJson !== undefined
        ? form.configurationPolicyJson
        : (existingRecord?.configuration_policy_json ?? templatePolicy);
    const packingParts = recipeSelectionRows(body.packingParts, true);
    const optionalParts = recipeSelectionRows(body.optionalParts);
    const authoritativeBom = dependencies.buildRecipeBomDraft({
        requireStablePartIdentity: true,
        templateId,
        modelVariantId: parsePositiveId(form.modelVariantId),
        customBarrelLength: normalizeOptionalNumber(
            form.customBarrelLength,
            'form.customBarrelLength'
        ),
        longScrewExtraLength: parseNonNegativeNumber(
            form.longScrewExtraLength,
            'form.longScrewExtraLength'
        ),
        coilSpec: String(form.coilSpec || '').trim(),
        coilSheets: parseNonNegativeNumber(form.coilSheets, 'form.coilSheets'),
        coilMaterial: String(form.coilMaterial || '').trim() || '钢带',
        coilSlotType: String(form.coilSlotType || '').trim() || '小眼',
        coilWireWeight: normalizeOptionalNumber(form.coilWireWeight, 'form.coilWireWeight'),
        hasFloat: Boolean(form.hasFloat),
        floatWire: String(form.floatWire || '').trim(),
        floatAccessoryType: form.floatAccessoryType || 'standard',
        hasCable: Boolean(form.hasCable),
        cableLength: parseNonNegativeNumber(form.cableLength, 'form.cableLength'),
        cableWire: String(form.cableWire || '').trim(),
        cableAccessoryType: form.cableAccessoryType || 'standard',
        packingParts,
        optionalParts,
    });
    const initialPayload = {
        name: String(form.name || '').trim(),
        spec: String(form.spec || '').trim(),
        partsJson: JSON.stringify(authoritativeBom.parts || []),
        templateId,
        coilSpec: String(form.coilSpec || '').trim(),
        coilSheets: parseNonNegativeNumber(form.coilSheets, 'form.coilSheets'),
        coilMaterial: String(form.coilMaterial || '').trim() || '钢带',
        coilSlotType: String(form.coilSlotType || '').trim() || '小眼',
        coilWireWeight: normalizeOptionalNumber(form.coilWireWeight, 'form.coilWireWeight'),
        hasFloat: form.hasFloat ? 1 : 0,
        floatWire: String(form.floatWire || '').trim(),
        floatAccessoryType: form.floatAccessoryType || 'standard',
        hasCable: form.hasCable ? 1 : 0,
        cableLength: parseNonNegativeNumber(form.cableLength, 'form.cableLength'),
        cableWire: String(form.cableWire || '').trim(),
        cableAccessoryType: form.cableAccessoryType || 'standard',
        packingPartsJson: JSON.stringify(packingParts),
        extraPartsJson: JSON.stringify(optionalParts),
        customBarrelLength: normalizeOptionalNumber(
            form.customBarrelLength,
            'form.customBarrelLength'
        ),
        longScrewExtraLength: parseNonNegativeNumber(
            form.longScrewExtraLength,
            'form.longScrewExtraLength'
        ),
        modelVariantId: parsePositiveId(form.modelVariantId),
        impellerModel: String(form.impellerModel || '').trim(),
        impellerThickness: normalizeOptionalNumber(
            form.impellerThickness,
            'form.impellerThickness'
        ),
        impellerDiameter: normalizeOptionalNumber(
            form.impellerDiameter,
            'form.impellerDiameter'
        ),
        impellerBladeCount: form.impellerBladeCount === ''
            || form.impellerBladeCount === null
            || form.impellerBladeCount === undefined
            ? null
            : parseNonNegativeInteger(form.impellerBladeCount, 'form.impellerBladeCount'),
        technicalDataJson: stringifyTechnicalData(body.technicalData),
        assemblyWage: parseNonNegativeNumber(form.assemblyWage, 'form.assemblyWage'),
        packingWage: parseNonNegativeNumber(form.packingWage, 'form.packingWage'),
        paintingWage: null,
        surfaceTreatmentMode: form.surfaceTreatmentMode || 'none',
        surfaceTreatmentCost: (form.surfaceTreatmentMode || 'none') === 'none'
            ? 0
            : parseNonNegativeNumber(form.surfaceTreatmentCost, 'form.surfaceTreatmentCost'),
        managementFee: parseNonNegativeNumber(form.managementFee, 'form.managementFee'),
        configurationPolicyJson,
    };
    const payload = payloadToCamelCase(
        normalizeRecipePayload(dependencies, initialPayload, existingRecord)
    );
    const effectiveExpectedUpdatedAt = existingRecord
        ? expectedUpdatedAt || existingRecord.updated_at
        : null;
    const previewHash = recipeSavePreviewHash(capabilityId, recipeId, payload);

    return {
        ...payload,
        capabilityId,
        preview: true,
        requiresConfirmation: true,
        suggestedIdempotencyKey: recipeId
            ? `recipe-update:${recipeId}:${crypto.randomUUID()}`
            : `recipe-create:${crypto.randomUUID()}`,
        previewHash,
        ...(recipeId ? {
            recipeId,
            expectedUpdatedAt: effectiveExpectedUpdatedAt,
        } : {}),
        changes: [{
            resourceType: 'recipe',
            ...(recipeId ? { resourceId: recipeId } : {}),
            field: recipeId ? 'snapshot' : 'created',
            from: recipeId
                ? {
                    name: existingRecord.name,
                    updatedAt: existingRecord.updated_at,
                }
                : null,
            to: {
                name: payload.name,
                bomItemCount: parseJsonArray(payload.partsJson).length,
                savedTotalCost: payload.savedTotalCost,
            },
        }],
        warnings: [],
    };
}

function partsCatalogRows(db) {
    return db.prepare(`
        SELECT id AS Id, model, category, price, supplier, stock, remark AS notes
        FROM parts
        WHERE deleted_at IS NULL
    `).all();
}

function autoCreateRecipeLongScrews(dependencies, recipeLike, auditContext) {
    const partsToCreate = buildLongScrewInventoryPartsFromRecipe({
        recipeName: recipeLike.name,
        parts: parseJsonArray(recipeLike.parts_json || recipeLike.partsJson),
        partsCatalog: partsCatalogRows(dependencies.db),
    }).filter(part => !dependencies.db.prepare(`
        SELECT id FROM parts
        WHERE deleted_at IS NULL AND category = ? AND model = ?
        LIMIT 1
    `).get(part.category, part.model));

    if (partsToCreate.length === 0) return { items: [], auditIds: [] };
    const now = new Date().toISOString();
    const auditIds = [];
    const items = partsToCreate.map(part => {
        const info = dependencies.safeInsert('parts', {
            model: part.model,
            category: part.category,
            price: part.price,
            supplier: part.supplier,
            stock: part.stock,
            remark: part.remark,
            created_at: now,
            updated_at: now,
        }, auditContext);
        if (info.auditId) auditIds.push(info.auditId);
        return dependencies.partRow(
            dependencies.db.prepare('SELECT * FROM parts WHERE id = ?').get(info.lastInsertRowid)
        );
    });
    dependencies.invalidatePartsCache();
    return { items, auditIds };
}

function refreshRecipeRuleLearningIfNeeded(
    dependencies,
    recipeId,
    actor,
    auditContext = null
) {
    const hasLearningFeedback = dependencies.db.prepare(`
        SELECT 1 FROM recipe_analysis_feedback
        WHERE recipe_id = ?
          AND finding_type = 'peer_pattern'
          AND decision IN ('confirmed', 'special_case', 'ignored')
        LIMIT 1
    `).get(recipeId);
    if (!hasLearningFeedback || typeof dependencies.refreshFactoryRuleCandidates !== 'function') {
        return [];
    }

    const auditIds = [];
    const trackedInsert = (table, values) => {
        const write = dependencies.safeInsert(table, values, auditContext || {});
        if (write.auditId) auditIds.push(write.auditId);
        return write;
    };
    const trackedUpdate = (table, id, updates) => {
        const write = dependencies.safeUpdate(table, id, updates, auditContext || {});
        if (write.auditId) auditIds.push(write.auditId);
        return write;
    };
    dependencies.refreshFactoryRuleCandidates({
        actor,
        db: dependencies.db,
        safeInsert: trackedInsert,
        safeUpdate: trackedUpdate,
    });
    return auditIds;
}

function createCompatibilityWarnings(input, resourceId = null) {
    const warnings = [];
    if (!normalizePreviewHash(input.previewHash)) {
        warnings.push({
            code: 'preview_hash_missing_compatibility',
            message: `${resourceId ? `配方 #${resourceId}` : '配方'}未提供 previewHash，保存内容与确认预览未绑定`,
            ...(resourceId ? { resourceId } : {}),
        });
    }
    return warnings;
}

function executeRecipeCreate(dependencies, input = {}, commandContext = {}) {
    const payload = normalizeRecipePayload(dependencies, input);
    const camelPayload = payloadToCamelCase(payload);
    const expectedPreviewHash = normalizePreviewHash(input.previewHash);
    const currentPreviewHash = recipeSavePreviewHash(
        CREATE_CAPABILITY_ID,
        null,
        camelPayload
    );

    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        businessChange: standardBusinessChange({ domain: 'recipe', eventType: 'created' }),
        input: {
            payload: camelPayload,
            previewHash: expectedPreviewHash,
        },
        warnings: [
            ...(commandContext.warnings || []),
            ...createCompatibilityWarnings(input),
        ],
        execute: ({ auditContext }) => {
            assertPreviewHash(
                expectedPreviewHash,
                currentPreviewHash,
                '配方保存草稿已经变化，请重新预览并确认'
            );
            const now = new Date().toISOString();
            const write = dependencies.safeInsert('recipes', {
                ...payload,
                created_at: now,
                updated_at: now,
            }, auditContext);
            const recipeId = Number(write.lastInsertRowid);
            const record = dependencies.db.prepare(
                'SELECT * FROM recipes WHERE id = ?'
            ).get(recipeId);
            const longScrews = autoCreateRecipeLongScrews(
                dependencies,
                record,
                auditContext
            );
            const auditIds = [
                ...(write.auditId ? [write.auditId] : []),
                ...longScrews.auditIds,
            ];
            return {
                data: {
                    recipe: dependencies.recipeRow(record),
                    createdLongScrewParts: longScrews.items,
                },
                resource: {
                    type: 'recipe',
                    ids: [recipeId],
                },
                changes: [{
                    resourceType: 'recipe',
                    resourceId: recipeId,
                    field: 'created',
                    from: null,
                    to: {
                        name: record.name,
                        savedTotalCost: record.saved_total_cost,
                    },
                }, ...longScrews.items.map(part => ({
                    resourceType: 'part',
                    resourceId: part.id,
                    field: 'createdFromRecipeLongScrew',
                    from: null,
                    to: part.model,
                }))],
                auditIds,
                requiredAuditCount: 1 + longScrews.items.length,
            };
        },
    });
}

function executeRecipeUpdate(
    dependencies,
    recipeIdValue,
    input = {},
    commandContext = {}
) {
    const recipeId = parsePositiveId(recipeIdValue);
    if (!recipeId) throw recipeCommandError('recipe_id_invalid', '非法配方ID', 400);
    const recordBefore = getRecipeRecord(dependencies.db, recipeId);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const payload = normalizeRecipePayload(dependencies, input, recordBefore);
    const camelPayload = payloadToCamelCase(payload);
    const expectedPreviewHash = normalizePreviewHash(input.previewHash);
    const currentPreviewHash = recipeSavePreviewHash(
        UPDATE_CAPABILITY_ID,
        recipeId,
        camelPayload
    );
    const compatibilityWarnings = createCompatibilityWarnings(input, recipeId);
    if (!expectedUpdatedAt) {
        compatibilityWarnings.push({
            code: 'expected_updated_at_missing_compatibility',
            message: `配方 #${recipeId} 未提供 expectedUpdatedAt，并发覆盖保护未启用`,
            resourceId: recipeId,
        });
    }

    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        businessChange: standardBusinessChange({ domain: 'recipe', eventType: 'updated' }),
        input: {
            recipeId,
            payload: camelPayload,
            expectedUpdatedAt,
            previewHash: expectedPreviewHash,
        },
        warnings: [
            ...(commandContext.warnings || []),
            ...compatibilityWarnings,
        ],
        execute: ({ auditContext }) => {
            const current = getRecipeRecord(dependencies.db, recipeId);
            assertExpectedUpdatedAt(current, expectedUpdatedAt, `配方 #${recipeId}`);
            assertPreviewHash(
                expectedPreviewHash,
                currentPreviewHash,
                '配方保存草稿已经变化，请重新预览并确认'
            );
            const write = dependencies.safeUpdate(
                'recipes',
                recipeId,
                payload,
                auditContext
            );
            const updated = dependencies.db.prepare(
                'SELECT * FROM recipes WHERE id = ?'
            ).get(recipeId);
            const longScrews = autoCreateRecipeLongScrews(
                dependencies,
                updated,
                auditContext
            );
            const learningAuditIds = refreshRecipeRuleLearningIfNeeded(
                dependencies,
                recipeId,
                commandContext.actorKey || 'system',
                auditContext
            );
            const auditIds = [
                ...(write.auditId ? [write.auditId] : []),
                ...longScrews.auditIds,
                ...learningAuditIds,
            ];
            return {
                data: {
                    recipe: dependencies.recipeRow(updated),
                    createdLongScrewParts: longScrews.items,
                },
                resource: {
                    type: 'recipe',
                    ids: [recipeId],
                },
                changes: [{
                    resourceType: 'recipe',
                    resourceId: recipeId,
                    field: 'snapshot',
                    from: {
                        name: current.name,
                        savedTotalCost: current.saved_total_cost,
                        updatedAt: current.updated_at,
                    },
                    to: {
                        name: updated.name,
                        savedTotalCost: updated.saved_total_cost,
                        updatedAt: updated.updated_at,
                    },
                }, ...longScrews.items.map(part => ({
                    resourceType: 'part',
                    resourceId: part.id,
                    field: 'createdFromRecipeLongScrew',
                    from: null,
                    to: part.model,
                }))],
                auditIds,
                requiredAuditCount: 1 + longScrews.items.length + learningAuditIds.length,
            };
        },
    });
}

function executeRecipeDelete(
    dependencies,
    recipeIdValue,
    input = {},
    commandContext = {}
) {
    const recipeId = parsePositiveId(recipeIdValue);
    if (!recipeId) throw recipeCommandError('recipe_id_invalid', '非法配方ID', 400);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const compatibilityWarnings = [];
    if (!expectedUpdatedAt) {
        compatibilityWarnings.push({
            code: 'expected_updated_at_missing_compatibility',
            message: `配方 #${recipeId} 未提供 expectedUpdatedAt，并发删除保护未启用`,
            resourceId: recipeId,
        });
    }

    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        businessChange: standardBusinessChange({ domain: 'recipe', eventType: 'deleted' }),
        input: {
            recipeId,
            expectedUpdatedAt,
        },
        warnings: [
            ...(commandContext.warnings || []),
            ...compatibilityWarnings,
        ],
        execute: ({ auditContext }) => {
            const current = getRecipeRecord(dependencies.db, recipeId);
            assertExpectedUpdatedAt(current, expectedUpdatedAt, `配方 #${recipeId}`);
            const deletedAt = new Date().toISOString();
            const write = dependencies.safeUpdate(
                'recipes',
                recipeId,
                { deleted_at: deletedAt },
                auditContext
            );
            const learningAuditIds = refreshRecipeRuleLearningIfNeeded(
                dependencies,
                recipeId,
                commandContext.actorKey || 'system',
                auditContext
            );
            const auditIds = [
                ...(write.auditId ? [write.auditId] : []),
                ...learningAuditIds,
            ];
            return {
                data: {
                    deleted: 1,
                    recipeId,
                    deletedAt,
                },
                resource: {
                    type: 'recipe',
                    ids: [recipeId],
                },
                changes: [{
                    resourceType: 'recipe',
                    resourceId: recipeId,
                    field: 'deletedAt',
                    from: null,
                    to: deletedAt,
                }],
                auditIds,
                requiredAuditCount: 1 + learningAuditIds.length,
            };
        },
    });
}

module.exports = {
    CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID,
    buildRecipeSavePayloadDraft,
    executeRecipeCreate,
    executeRecipeDelete,
    executeRecipeUpdate,
    normalizeRecipePayload,
    recipeSavePreviewHash,
    refreshRecipeRuleLearningIfNeeded,
};
