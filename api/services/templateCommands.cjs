const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
} = require('./commandExecution.cjs');
const {
    assertExpectedUpdatedAt,
    normalizeExpectedUpdatedAt,
} = require('./resourceVersion.cjs');
const {
    parseNonNegativeNumber,
    parsePositiveNumber,
    parsePositiveId,
    stringifyJsonArray,
    stringifyJsonObject,
} = require('./validation.cjs');

const CREATE_CAPABILITY_ID = requireBusinessCapability('templates.create').capabilityId;
const UPDATE_CAPABILITY_ID = requireBusinessCapability('templates.update').capabilityId;
const DELETE_CAPABILITY_ID = requireBusinessCapability('templates.delete').capabilityId;
const SHELL_COMPONENT_CATEGORY = '泵壳搭配';
const SHELL_COMPONENT_TYPES = new Set([
    'standard',
    'stainlessStretchBarrel',
    'subassembly',
]);
const MAX_SHELL_COMPONENTS = 50;
const MAX_SUBASSEMBLY_CONTENTS = 30;
const TEMPLATE_SURFACE_TREATMENTS = new Set([
    'none',
    'painting',
    'electrophoresis',
    'electrophoresis_powder_coating',
    'powder_coating',
]);
const TEMPLATE_ALIASES = {
    shellModel: 'shell_model',
    partsJson: 'parts_json',
    shellComponentsJson: 'shell_components_json',
    rotorParamsJson: 'rotor_params_json',
    assemblyWage: 'assembly_wage',
    packingWage: 'packing_wage',
    paintingWage: 'painting_wage',
    surfaceTreatmentMode: 'surface_treatment_mode',
    surfaceTreatmentCost: 'surface_treatment_cost',
    costMode: 'cost_mode',
    bundleCost: 'bundle_cost',
    bundleNote: 'bundle_note',
};

function templateCommandError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function templateBodyToDb(body = {}) {
    const updates = {};
    for (const field of [
        'shell_model',
        'description',
        'parts_json',
        'shell_components_json',
        'rotor_params_json',
        'assembly_wage',
        'packing_wage',
        'painting_wage',
        'surface_treatment_mode',
        'surface_treatment_cost',
        'cost_mode',
        'bundle_cost',
        'bundle_note',
    ]) {
        if (body[field] !== undefined) updates[field] = body[field];
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

function normalizeSurfaceTreatmentMode(value, paintingWage = null) {
    const fallback = paintingWage != null ? 'painting' : 'none';
    return TEMPLATE_SURFACE_TREATMENTS.has(value) ? value : fallback;
}

function normalizeShellModel(value, required = false) {
    const model = String(value || '').trim();
    if (required && !model) {
        throw templateCommandError(
            'template_shell_model_required',
            '泵壳型号为必填项',
            400
        );
    }
    return model;
}

function normalizeSubassemblyContents(value, field) {
    const contents = JSON.parse(stringifyJsonArray(value, field));
    if (contents.length > MAX_SUBASSEMBLY_CONTENTS) {
        throw templateCommandError(
            'template_subassembly_contents_limit',
            `每个供应商小套件最多包含 ${MAX_SUBASSEMBLY_CONTENTS} 个组成项`,
            400
        );
    }
    return contents.map((item, index) => {
        const name = String(item?.name || '').trim();
        if (!name) {
            throw templateCommandError(
                'template_subassembly_content_name_required',
                `${field}[${index}].name 为必填项`,
                400
            );
        }
        const referenceUnitPrice = optionalNonNegative(
            item?.referenceUnitPrice,
            `${field}[${index}].referenceUnitPrice`
        );
        return {
            name,
            qty: parsePositiveNumber(
                item?.qty ?? 1,
                `${field}[${index}].qty`
            ),
            ...(referenceUnitPrice == null ? {} : { referenceUnitPrice }),
            ...(String(item?.note || '').trim()
                ? { note: String(item.note).trim() }
                : {}),
        };
    });
}

function normalizeShellComponentsJsonValue(value) {
    const components = JSON.parse(stringifyJsonArray(
        value,
        'shell_components_json'
    ));
    if (components.length > MAX_SHELL_COMPONENTS) {
        throw templateCommandError(
            'template_shell_components_limit',
            `自由搭配最多包含 ${MAX_SHELL_COMPONENTS} 个计价项`,
            400
        );
    }
    return JSON.stringify(components.map((component, index) => {
        const componentType = component?.componentType
            || (component?.isStainlessStretchBarrel
                ? 'stainlessStretchBarrel'
                : 'standard');
        if (!SHELL_COMPONENT_TYPES.has(componentType)) {
            throw templateCommandError(
                'template_component_type_invalid',
                `shell_components_json[${index}].componentType 不受支持`,
                400
            );
        }
        const included = component?.included !== false;
        const normalized = {
            name: String(component?.name || '').trim(),
            model: String(component?.model || '').trim(),
            supplier: String(component?.supplier || '').trim(),
            qty: (included ? parsePositiveNumber : parseNonNegativeNumber)(
                component?.qty ?? 1,
                `shell_components_json[${index}].qty`
            ),
            unitCost: parseNonNegativeNumber(
                component?.unitCost ?? 0,
                `shell_components_json[${index}].unitCost`
            ),
            pricingMode: componentType === 'stainlessStretchBarrel'
                ? 'lengthCm'
                : 'fixed',
            included,
            optional: component?.optional === true,
            componentType,
            note: String(component?.note || '').trim(),
        };
        if (componentType === 'subassembly') {
            const contents = normalizeSubassemblyContents(
                component?.subassemblyContents,
                `shell_components_json[${index}].subassemblyContents`
            );
            if (normalized.included && contents.length === 0) {
                throw templateCommandError(
                    'template_subassembly_contents_required',
                    `供应商小套件「${normalized.name || normalized.model || index + 1}」至少需要一个组成项`,
                    400
                );
            }
            normalized.subassemblyContents = contents;
        }
        return normalized;
    }));
}

function normalizeShellComponentsJson(value) {
    try {
        return normalizeShellComponentsJsonValue(value);
    } catch (error) {
        if (error instanceof CommandExecutionError) throw error;
        throw templateCommandError(
            'template_shell_components_invalid',
            error?.message || 'shell_components_json 不合法',
            400
        );
    }
}

function validateShellComponents(db, costMode, componentsJson) {
    if (costMode !== 'components') return;
    const components = JSON.parse(componentsJson || '[]');
    const allowedModels = new Set(db.prepare(`
        SELECT model
        FROM parts
        WHERE category = ? AND deleted_at IS NULL
    `).all(SHELL_COMPONENT_CATEGORY)
        .map(row => String(row.model || '').trim())
        .filter(Boolean));
    const invalid = components.find(component => (
        component?.included !== false
        && !allowedModels.has(String(component?.model || '').trim())
    ));
    if (invalid) {
        throw templateCommandError(
            'template_component_model_invalid',
            `自由搭配组件「${invalid.name || '未命名组件'}」的零件型号只能选择“${SHELL_COMPONENT_CATEGORY}”类别中的零件`,
            400
        );
    }
}

function normalizeCreateInput(input = {}) {
    const body = templateBodyToDb(input);
    const paintingWage = optionalNonNegative(body.painting_wage, 'painting_wage');
    const surfaceMode = normalizeSurfaceTreatmentMode(
        body.surface_treatment_mode,
        paintingWage
    );
    const costMode = body.cost_mode === 'bundle' ? 'bundle' : 'components';
    return {
        shell_model: normalizeShellModel(body.shell_model, true),
        description: String(body.description || ''),
        parts_json: stringifyJsonArray(body.parts_json, 'parts_json'),
        shell_components_json: normalizeShellComponentsJson(
            body.shell_components_json
        ),
        rotor_params_json: stringifyJsonObject(
            body.rotor_params_json,
            'rotor_params_json'
        ),
        assembly_wage: parseNonNegativeNumber(body.assembly_wage, 'assembly_wage'),
        packing_wage: parseNonNegativeNumber(body.packing_wage, 'packing_wage'),
        painting_wage: paintingWage,
        surface_treatment_mode: surfaceMode,
        surface_treatment_cost: surfaceMode === 'none'
            ? 0
            : parseNonNegativeNumber(
                body.surface_treatment_cost ?? paintingWage,
                'surface_treatment_cost'
            ),
        cost_mode: costMode,
        bundle_cost: costMode === 'bundle'
            ? parseNonNegativeNumber(body.bundle_cost, 'bundle_cost')
            : 0,
        bundle_note: costMode === 'bundle'
            ? String(body.bundle_note || '').trim()
            : '',
    };
}

function normalizeUpdateInput(input = {}) {
    const body = templateBodyToDb(input);
    const updates = {};
    if (body.shell_model !== undefined) {
        updates.shell_model = normalizeShellModel(body.shell_model, true);
    }
    if (body.description !== undefined) updates.description = String(body.description || '');
    if (body.parts_json !== undefined) {
        updates.parts_json = stringifyJsonArray(body.parts_json, 'parts_json');
    }
    if (body.shell_components_json !== undefined) {
        updates.shell_components_json = normalizeShellComponentsJson(
            body.shell_components_json
        );
    }
    if (body.rotor_params_json !== undefined) {
        updates.rotor_params_json = stringifyJsonObject(
            body.rotor_params_json,
            'rotor_params_json'
        );
    }
    if (body.assembly_wage !== undefined) {
        updates.assembly_wage = parseNonNegativeNumber(
            body.assembly_wage,
            'assembly_wage'
        );
    }
    if (body.packing_wage !== undefined) {
        updates.packing_wage = parseNonNegativeNumber(
            body.packing_wage,
            'packing_wage'
        );
    }
    if (body.painting_wage !== undefined) {
        updates.painting_wage = optionalNonNegative(
            body.painting_wage,
            'painting_wage'
        );
    }
    if (body.surface_treatment_mode !== undefined) {
        updates.surface_treatment_mode = normalizeSurfaceTreatmentMode(
            body.surface_treatment_mode,
            body.painting_wage
        );
    }
    if (body.surface_treatment_cost !== undefined) {
        updates.surface_treatment_cost = parseNonNegativeNumber(
            body.surface_treatment_cost,
            'surface_treatment_cost'
        );
    }
    if (body.cost_mode !== undefined) {
        updates.cost_mode = body.cost_mode === 'bundle' ? 'bundle' : 'components';
    }
    if (body.bundle_cost !== undefined) {
        updates.bundle_cost = parseNonNegativeNumber(
            body.bundle_cost,
            'bundle_cost'
        );
    }
    if (body.bundle_note !== undefined) {
        updates.bundle_note = String(body.bundle_note || '').trim();
    }
    return updates;
}

function versionWarning(templateId, expectedUpdatedAt) {
    return expectedUpdatedAt ? [] : [{
        code: 'expected_updated_at_missing_compatibility',
        message: `泵壳模板 #${templateId} 未提供 expectedUpdatedAt，并发覆盖保护未启用`,
    }];
}

function getTemplateRecord(db, templateId) {
    const record = db.prepare(
        'SELECT * FROM pump_shell_templates WHERE id = ?'
    ).get(templateId);
    if (!record) {
        throw templateCommandError('template_not_found', '模板不存在', 404);
    }
    return record;
}

function assertUniqueShellModel(db, shellModel, excludeId = null) {
    if (!shellModel) return;
    const existing = excludeId
        ? db.prepare(`
            SELECT id FROM pump_shell_templates
            WHERE shell_model = ? AND id <> ?
        `).get(shellModel, excludeId)
        : db.prepare(`
            SELECT id FROM pump_shell_templates WHERE shell_model = ?
        `).get(shellModel);
    if (existing) {
        throw templateCommandError(
            'template_shell_model_conflict',
            `泵壳型号 "${shellModel}" 已存在`,
            409
        );
    }
}

function executeTemplateCreate(dependencies, input = {}, commandContext = {}) {
    const normalized = normalizeCreateInput(input);
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: CREATE_CAPABILITY_ID,
        input: normalized,
        execute: ({ auditContext }) => {
            assertUniqueShellModel(dependencies.db, normalized.shell_model);
            validateShellComponents(
                dependencies.db,
                normalized.cost_mode,
                normalized.shell_components_json
            );
            const now = new Date().toISOString();
            const write = dependencies.safeInsert('pump_shell_templates', {
                ...normalized,
                created_at: now,
                updated_at: now,
            }, auditContext);
            const templateId = Number(write.lastInsertRowid);
            const template = dependencies.templateRow(
                getTemplateRecord(dependencies.db, templateId)
            );
            return {
                data: { template },
                resource: { type: 'pumpShellTemplate', ids: [templateId] },
                changes: [{
                    resourceType: 'pumpShellTemplate',
                    resourceId: templateId,
                    field: 'created',
                    from: null,
                    to: { shellModel: template.shellModel },
                }],
                auditIds: write.auditId ? [write.auditId] : [],
                requiredAuditCount: 1,
            };
        },
    });
}

function executeTemplateUpdate(
    dependencies,
    templateIdValue,
    input = {},
    commandContext = {}
) {
    const templateId = parsePositiveId(templateIdValue);
    if (!templateId) {
        throw templateCommandError('template_id_invalid', '非法模板ID', 400);
    }
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const updates = normalizeUpdateInput(input);
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: UPDATE_CAPABILITY_ID,
        input: { templateId, expectedUpdatedAt, updates },
        warnings: [
            ...(commandContext.warnings || []),
            ...versionWarning(templateId, expectedUpdatedAt),
        ],
        execute: ({ auditContext }) => {
            const current = getTemplateRecord(dependencies.db, templateId);
            assertExpectedUpdatedAt(
                current,
                expectedUpdatedAt,
                `泵壳模板 #${templateId}`
            );
            if (updates.shell_model) {
                assertUniqueShellModel(
                    dependencies.db,
                    updates.shell_model,
                    templateId
                );
            }
            validateShellComponents(
                dependencies.db,
                updates.cost_mode ?? current.cost_mode,
                updates.shell_components_json ?? current.shell_components_json
            );
            if (Object.keys(updates).length === 0) {
                return {
                    data: { template: dependencies.templateRow(current) },
                    resource: { type: 'pumpShellTemplate', ids: [templateId] },
                    changes: [],
                    auditIds: [],
                    requiredAuditCount: 0,
                    warnings: [{
                        code: 'template_update_noop',
                        message: '没有可保存的模板字段，未执行写入',
                    }],
                };
            }
            const write = dependencies.safeUpdate(
                'pump_shell_templates',
                templateId,
                updates,
                auditContext
            );
            const template = dependencies.templateRow(
                getTemplateRecord(dependencies.db, templateId)
            );
            return {
                data: { template },
                resource: { type: 'pumpShellTemplate', ids: [templateId] },
                changes: [{
                    resourceType: 'pumpShellTemplate',
                    resourceId: templateId,
                    field: 'fields',
                    from: null,
                    to: Object.keys(updates),
                }],
                auditIds: write.auditId ? [write.auditId] : [],
                requiredAuditCount: 1,
            };
        },
    });
}

function executeTemplateDelete(
    dependencies,
    templateIdValue,
    input = {},
    commandContext = {}
) {
    const templateId = parsePositiveId(templateIdValue);
    if (!templateId) {
        throw templateCommandError('template_id_invalid', '非法模板ID', 400);
    }
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: DELETE_CAPABILITY_ID,
        input: { templateId, expectedUpdatedAt },
        warnings: [
            ...(commandContext.warnings || []),
            ...versionWarning(templateId, expectedUpdatedAt),
        ],
        execute: ({ auditContext }) => {
            const current = getTemplateRecord(dependencies.db, templateId);
            assertExpectedUpdatedAt(
                current,
                expectedUpdatedAt,
                `泵壳模板 #${templateId}`
            );
            const refs = dependencies.db.prepare(
                'SELECT COUNT(*) AS count FROM recipes WHERE template_id = ?'
            ).get(templateId);
            if (Number(refs.count || 0) > 0) {
                throw templateCommandError(
                    'template_in_use',
                    `有 ${refs.count} 个配方引用此模板，无法删除`,
                    409
                );
            }
            const write = dependencies.hardDelete(
                'pump_shell_templates',
                templateId,
                auditContext
            );
            return {
                data: { deleted: 1, templateId },
                resource: { type: 'pumpShellTemplate', ids: [templateId] },
                changes: [{
                    resourceType: 'pumpShellTemplate',
                    resourceId: templateId,
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
    SHELL_COMPONENT_CATEGORY,
    TEMPLATE_ALIASES,
    UPDATE_CAPABILITY_ID,
    executeTemplateCreate,
    executeTemplateDelete,
    executeTemplateUpdate,
    normalizeShellComponentsJson,
    normalizeSurfaceTreatmentMode,
    templateBodyToDb,
    validateShellComponents,
};
