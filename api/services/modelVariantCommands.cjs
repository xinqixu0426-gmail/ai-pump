const { hydrateCatalogRow } = require('./catalogLiveReferences.cjs');
const { assertCatalogPhysicalUpdate } = require('./catalogPhysicalIdentity.cjs');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
} = require('./commandExecution.cjs');
const { standardBusinessChange } = require('./businessChanges.cjs');
const { buildLongScrewInventoryParts } = require('./longScrewInventory.cjs');
const {
    assertExpectedUpdatedAt,
    normalizeExpectedUpdatedAt,
} = require('./resourceVersion.cjs');
const {
    parseNonNegativeNumber,
    parsePositiveId,
    stringifyJsonArray,
} = require('./validation.cjs');
const { resolvePersistedCoilSelection } = require('./persistedCoilSelection.cjs');

const CREATE_CAPABILITY_ID = requireBusinessCapability(
    'model_variants.create'
).capabilityId;
const UPDATE_CAPABILITY_ID = requireBusinessCapability(
    'model_variants.update'
).capabilityId;
const DELETE_CAPABILITY_ID = requireBusinessCapability(
    'model_variants.delete'
).capabilityId;
const COIL_SLOT_TYPES = new Set(['小眼', '国标眼']);
const VARIANT_FIELDS = [
    'model_name',
    'template_id',
    'coil_id',
    'coil_scheme_family_code',
    'coil_spec',
    'coil_sheets',
    'coil_material',
    'coil_slot_type',
    'barrel_length',
    'long_screw_extra_length',
    'impeller_model',
    'impeller_thickness',
    'impeller_diameter',
    'impeller_blade_count',
    'note',
    'custom_fields_json',
];
const VARIANT_ALIASES = {
    modelName: 'model_name',
    templateId: 'template_id',
    coilId: 'coil_id',
    coilSchemeFamilyCode: 'coil_scheme_family_code',
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

function modelVariantCommandError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function modelVariantBodyToDb(body = {}) {
    const updates = {};
    for (const field of VARIANT_FIELDS) {
        if (body[field] !== undefined) updates[field] = body[field];
    }
    for (const [camel, snake] of Object.entries(VARIANT_ALIASES)) {
        if (body[camel] !== undefined) updates[snake] = body[camel];
    }
    return updates;
}

function optionalNonNegative(value, field) {
    return value === undefined || value === null || value === ''
        ? null
        : parseNonNegativeNumber(value, field);
}

function normalizeModelVariant(input = {}) {
    const body = modelVariantBodyToDb(input);
    const modelName = String(body.model_name || '').trim();
    const templateId = parsePositiveId(body.template_id);
    if (!modelName) {
        throw modelVariantCommandError(
            'model_variant_name_required',
            '型号名称为必填项',
            400
        );
    }
    if (!templateId) {
        throw modelVariantCommandError(
            'model_variant_template_required',
            '必须选择泵壳模板',
            400
        );
    }

    let customFieldsJson = '[]';
    if (
        body.custom_fields_json !== undefined
        && body.custom_fields_json !== null
        && body.custom_fields_json !== ''
    ) {
        const parsed = JSON.parse(
            stringifyJsonArray(body.custom_fields_json, 'custom_fields_json')
        );
        customFieldsJson = JSON.stringify(parsed.map(item => ({
            label: String(item?.label || '').trim(),
            value: String(item?.value || '').trim(),
        })).filter(item => item.label || item.value));
    }

    const coilSlotType = String(body.coil_slot_type || '小眼').trim() || '小眼';
    if (!COIL_SLOT_TYPES.has(coilSlotType)) {
        throw modelVariantCommandError(
            'model_variant_coil_slot_type_invalid',
            '线圈槽眼仅支持小眼或国标眼',
            400
        );
    }

    return {
        model_name: modelName,
        template_id: templateId,
        coil_id: parsePositiveId(body.coil_id),
        coil_scheme_family_code: String(body.coil_scheme_family_code || '').trim().toUpperCase(),
        coil_spec: String(body.coil_spec || '').trim(),
        coil_sheets: parseNonNegativeNumber(body.coil_sheets, 'coil_sheets'),
        coil_material: String(body.coil_material || '钢带').trim() || '钢带',
        coil_slot_type: coilSlotType,
        barrel_length: optionalNonNegative(body.barrel_length, 'barrel_length'),
        long_screw_extra_length: parseNonNegativeNumber(
            body.long_screw_extra_length,
            'long_screw_extra_length'
        ),
        impeller_model: String(body.impeller_model || '').trim(),
        impeller_thickness: optionalNonNegative(
            body.impeller_thickness,
            'impeller_thickness'
        ),
        impeller_diameter: optionalNonNegative(
            body.impeller_diameter,
            'impeller_diameter'
        ),
        impeller_blade_count: optionalNonNegative(
            body.impeller_blade_count,
            'impeller_blade_count'
        ),
        note: String(body.note || '').trim(),
        custom_fields_json: customFieldsJson,
    };
}

function versionWarning(modelVariantId, expectedUpdatedAt) {
    return expectedUpdatedAt ? [] : [{
        code: 'expected_updated_at_missing_compatibility',
        message: `常用配置 #${modelVariantId} 未提供 expectedUpdatedAt，并发覆盖保护未启用`,
    }];
}

function getActiveModelVariant(db, modelVariantId) {
    const row = db.prepare(`
        SELECT *
        FROM pump_model_variants
        WHERE id = ? AND deleted_at IS NULL
    `).get(modelVariantId);
    if (!row) {
        throw modelVariantCommandError(
            'model_variant_not_found',
            '常用配置预设不存在',
            404
        );
    }
    return row;
}

function assertTemplateExists(db, templateId) {
    const template = db.prepare(`
        SELECT id
        FROM pump_shell_templates
        WHERE id = ?
    `).get(templateId);
    if (!template) {
        throw modelVariantCommandError(
            'model_variant_template_not_found',
            '泵壳模板不存在',
            400
        );
    }
}

function assertOfficialCoilBinding(db, variant) {
    const hasCompleteCoilDimensions = Boolean(variant.coil_spec)
        && Number(variant.coil_sheets || 0) > 0;
    if (!hasCompleteCoilDimensions) {
        return { coilId: null, schemeFamilyCode: '' };
    }
    const selection = resolvePersistedCoilSelection(db, variant);
    if (!selection.success) {
        const codeMap = {
            COIL_SELECTION_REQUIRED: 'model_variant_coil_selection_required',
            COIL_SELECTION_MISMATCH: 'model_variant_coil_mismatch',
            COIL_SCHEME_FAMILY_REQUIRED: 'model_variant_coil_scheme_family_required',
            COIL_SCHEME_FAMILY_NOT_FOUND: 'model_variant_coil_scheme_family_not_found',
            COIL_SCHEME_FAMILY_MISMATCH: 'model_variant_coil_scheme_family_mismatch',
        };
        throw modelVariantCommandError(
            codeMap[selection.code] || 'model_variant_coil_selection_invalid',
            selection.message,
            selection.statusCode
        );
    }
    return {
        coilId: selection.data.coilId,
        schemeFamilyCode: selection.data.schemeFamilyCode,
    };
}

function assertUniqueModelName(db, modelName, excludeId = null) {
    const existing = excludeId
        ? db.prepare(`
            SELECT id
            FROM pump_model_variants
            WHERE model_name = ? AND id <> ?
        `).get(modelName, excludeId)
        : db.prepare(`
            SELECT id
            FROM pump_model_variants
            WHERE model_name = ?
        `).get(modelName);
    if (existing) {
        throw modelVariantCommandError(
            'model_variant_name_conflict',
            '型号名称已存在',
            409
        );
    }
}

function partsCatalogRows(db) {
    return db.prepare(`
        SELECT id AS Id, model, category, price, supplier, stock, remark AS notes
        FROM parts
        WHERE deleted_at IS NULL
    `).all();
}

function autoCreateVariantLongScrews(
    dependencies,
    variant,
    auditContext
) {
    const template = dependencies.db.prepare(`
        SELECT *
        FROM pump_shell_templates
        WHERE id = ?
    `).get(variant.template_id || variant.templateId);
    if (!template) return { parts: [], auditIds: [] };

    const partsToCreate = buildLongScrewInventoryParts({
        variant,
        template: hydrateCatalogRow(dependencies.db, 'template', template),
        partsCatalog: partsCatalogRows(dependencies.db),
    }).filter(part => !dependencies.db.prepare(`
        SELECT id
        FROM parts
        WHERE deleted_at IS NULL AND category = ? AND model = ?
        LIMIT 1
    `).get(part.category, part.model));
    if (partsToCreate.length === 0) return { parts: [], auditIds: [] };

    const now = new Date().toISOString();
    const auditIds = [];
    const parts = partsToCreate.map(part => {
        const write = dependencies.safeInsert('parts', {
            model: part.model,
            category: part.category,
            price: part.price,
            supplier: part.supplier,
            stock: part.stock,
            remark: part.remark,
            created_at: now,
            updated_at: now,
        }, auditContext);
        if (write.auditId) auditIds.push(write.auditId);
        return dependencies.partRow(
            dependencies.db.prepare('SELECT * FROM parts WHERE id = ?')
                .get(write.lastInsertRowid)
        );
    });
    dependencies.invalidatePartsCache();
    return { parts, auditIds };
}

function executeModelVariantCreate(
    dependencies,
    input = {},
    commandContext = {}
) {
    const normalized = normalizeModelVariant(input);
    const coilSelection = assertOfficialCoilBinding(dependencies.db, normalized);
    normalized.coil_id = coilSelection.coilId;
    normalized.coil_scheme_family_code = coilSelection.schemeFamilyCode;
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: CREATE_CAPABILITY_ID,
        businessChange: standardBusinessChange({ domain: 'model_variant', eventType: 'created' }),
        input: normalized,
        execute: ({ auditContext }) => {
            assertTemplateExists(dependencies.db, normalized.template_id);
            assertUniqueModelName(dependencies.db, normalized.model_name);
            const now = new Date().toISOString();
            const write = dependencies.safeInsert('pump_model_variants', {
                ...normalized,
                created_at: now,
                updated_at: now,
            }, auditContext);
            const modelVariantId = Number(write.lastInsertRowid);
            const row = getActiveModelVariant(
                dependencies.db,
                modelVariantId
            );
            const longScrews = autoCreateVariantLongScrews(
                dependencies,
                row,
                auditContext
            );
            const variant = dependencies.modelVariantRow(row);
            const auditIds = [
                write.auditId,
                ...longScrews.auditIds,
            ].filter(Boolean);
            return {
                data: {
                    variant,
                    createdLongScrewParts: longScrews.parts,
                },
                resource: {
                    type: 'pumpModelVariant',
                    ids: [modelVariantId],
                },
                changes: [{
                    resourceType: 'pumpModelVariant',
                    resourceId: modelVariantId,
                    field: 'created',
                    from: null,
                    to: { modelName: variant.modelName },
                }, ...longScrews.parts.map(part => ({
                    resourceType: 'part',
                    resourceId: part.id,
                    field: 'autoCreatedLongScrew',
                    from: null,
                    to: { model: part.model },
                }))],
                auditIds,
                requiredAuditCount: 1 + longScrews.parts.length,
            };
        },
    });
}

function executeModelVariantUpdate(
    dependencies,
    modelVariantIdValue,
    input = {},
    commandContext = {}
) {
    const modelVariantId = parsePositiveId(modelVariantIdValue);
    if (!modelVariantId) {
        throw modelVariantCommandError(
            'model_variant_id_invalid',
            '非法常用配置预设编号',
            400
        );
    }
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const normalized = normalizeModelVariant(input);
    const coilSelection = assertOfficialCoilBinding(dependencies.db, normalized);
    normalized.coil_id = coilSelection.coilId;
    normalized.coil_scheme_family_code = coilSelection.schemeFamilyCode;
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: UPDATE_CAPABILITY_ID,
        businessChange: standardBusinessChange({ domain: 'model_variant', eventType: 'updated' }),
        input: { modelVariantId, expectedUpdatedAt, updates: normalized },
        warnings: [
            ...(commandContext.warnings || []),
            ...versionWarning(modelVariantId, expectedUpdatedAt),
        ],
        execute: ({ auditContext }) => {
            const current = getActiveModelVariant(
                dependencies.db,
                modelVariantId
            );
            assertExpectedUpdatedAt(
                current,
                expectedUpdatedAt,
                `常用配置 #${modelVariantId}`
            );
            assertTemplateExists(dependencies.db, normalized.template_id);
            assertUniqueModelName(
                dependencies.db,
                normalized.model_name,
                modelVariantId
            );
            assertCatalogPhysicalUpdate(dependencies.db, 'modelVariant', current, normalized);
            const write = dependencies.safeUpdate(
                'pump_model_variants',
                modelVariantId,
                normalized,
                auditContext
            );
            const row = getActiveModelVariant(
                dependencies.db,
                modelVariantId
            );
            const longScrews = autoCreateVariantLongScrews(
                dependencies,
                row,
                auditContext
            );
            const variant = dependencies.modelVariantRow(row);
            const auditIds = [
                write.auditId,
                ...longScrews.auditIds,
            ].filter(Boolean);
            return {
                data: {
                    variant,
                    createdLongScrewParts: longScrews.parts,
                },
                resource: {
                    type: 'pumpModelVariant',
                    ids: [modelVariantId],
                },
                changes: [{
                    resourceType: 'pumpModelVariant',
                    resourceId: modelVariantId,
                    field: 'fields',
                    from: null,
                    to: Object.keys(normalized),
                }, ...longScrews.parts.map(part => ({
                    resourceType: 'part',
                    resourceId: part.id,
                    field: 'autoCreatedLongScrew',
                    from: null,
                    to: { model: part.model },
                }))],
                auditIds,
                requiredAuditCount: 1 + longScrews.parts.length,
            };
        },
    });
}

function executeModelVariantDelete(
    dependencies,
    modelVariantIdValue,
    input = {},
    commandContext = {}
) {
    const modelVariantId = parsePositiveId(modelVariantIdValue);
    if (!modelVariantId) {
        throw modelVariantCommandError(
            'model_variant_id_invalid',
            '非法常用配置预设编号',
            400
        );
    }
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: DELETE_CAPABILITY_ID,
        businessChange: standardBusinessChange({ domain: 'model_variant', eventType: 'deleted' }),
        input: { modelVariantId, expectedUpdatedAt },
        warnings: [
            ...(commandContext.warnings || []),
            ...versionWarning(modelVariantId, expectedUpdatedAt),
        ],
        execute: ({ auditContext }) => {
            const current = getActiveModelVariant(
                dependencies.db,
                modelVariantId
            );
            assertExpectedUpdatedAt(
                current,
                expectedUpdatedAt,
                `常用配置 #${modelVariantId}`
            );
            const write = dependencies.safeUpdate(
                'pump_model_variants',
                modelVariantId,
                { deleted_at: new Date().toISOString() },
                auditContext
            );
            return {
                data: { deleted: 1, modelVariantId },
                resource: {
                    type: 'pumpModelVariant',
                    ids: [modelVariantId],
                },
                changes: [{
                    resourceType: 'pumpModelVariant',
                    resourceId: modelVariantId,
                    field: 'deleted',
                    from: false,
                    to: true,
                }],
                auditIds: write.auditId ? [write.auditId] : [],
                requiredAuditCount: 1,
            };
        },
    });
}

module.exports = {
    CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID,
    VARIANT_ALIASES,
    autoCreateVariantLongScrews,
    executeModelVariantCreate,
    executeModelVariantDelete,
    executeModelVariantUpdate,
    modelVariantBodyToDb,
    normalizeModelVariant,
};
