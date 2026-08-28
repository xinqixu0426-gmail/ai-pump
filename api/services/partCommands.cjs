const crypto = require('node:crypto');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
    requestHash,
} = require('./commandExecution.cjs');
const { standardBusinessChange } = require('./businessChanges.cjs');
const {
    consumeBusinessConfirmation,
    issueBusinessConfirmation,
} = require('./businessConfirmation.cjs');
const {
    assertPreviewHash,
    normalizePreviewHash,
} = require('./previewIntegrity.cjs');
const {
    assertExpectedUpdatedAt,
    normalizeExpectedUpdatedAt,
} = require('./resourceVersion.cjs');
const {
    parseNonNegativeNumber,
    parsePositiveId,
} = require('./validation.cjs');
const {
    normalizeBusinessSettingValue,
} = require('./businessSettingCommands.cjs');

const CREATE_CAPABILITY_ID = requireBusinessCapability('parts.create').capabilityId;
const BATCH_CREATE_CAPABILITY_ID = requireBusinessCapability(
    'parts.batch_create'
).capabilityId;
const UPDATE_CAPABILITY_ID = requireBusinessCapability('parts.update').capabilityId;
const PROFILE_SAVE_CAPABILITY_ID = requireBusinessCapability(
    'parts.save_profile'
).capabilityId;
const DELETE_CAPABILITY_ID = requireBusinessCapability('parts.delete').capabilityId;
const BATCH_DELETE_CAPABILITY_ID = requireBusinessCapability(
    'parts.batch_delete'
).capabilityId;
const BATCH_PRICE_CAPABILITY_ID = requireBusinessCapability(
    'parts.batch_update_prices'
).capabilityId;
const MAX_BATCH_CREATE_PARTS = 100;
const MAX_BATCH_DELETE_PARTS = 100;
const PART_FORM_SETTING_KEYS = new Set([
    'cable_accessories',
    'float_accessory_delta',
]);

function partCommandError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function getPartRecord(db, partId) {
    const record = db.prepare(
        'SELECT * FROM parts WHERE id = ? AND deleted_at IS NULL'
    ).get(partId);
    if (!record) throw partCommandError('part_not_found', '零件不存在', 404);
    return record;
}

function resolvePartDeleteTarget(dependencies, partIdValue, input = {}, options = {}) {
    const partId = parsePositiveId(partIdValue);
    if (!partId) throw partCommandError('part_id_invalid', '非法零件ID', 400);
    const current = getPartRecord(dependencies.db, partId);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    if (options.requireVersion === true && !current.updated_at) {
        throw partCommandError(
            'part_delete_version_missing',
            `零件 #${partId} 缺少版本字段，不能生成删除预览`,
            409
        );
    }
    assertExpectedUpdatedAt(current, expectedUpdatedAt, `零件 #${partId}`);
    return {
        current,
        expectedUpdatedAt: expectedUpdatedAt || current.updated_at || null,
        partId,
    };
}

function partDeletePreviewHash(partId, expectedUpdatedAt) {
    return requestHash({
        capabilityId: DELETE_CAPABILITY_ID,
        partId,
        expectedUpdatedAt,
        action: 'soft_delete',
    });
}

function buildPartDeletePreview(dependencies, partIdValue, input = {}) {
    const target = resolvePartDeleteTarget(
        dependencies,
        partIdValue,
        input,
        { requireVersion: true }
    );
    const normalizedInput = {
        partId: target.partId,
        expectedUpdatedAt: target.expectedUpdatedAt,
    };
    return {
        preview: true,
        capabilityId: DELETE_CAPABILITY_ID,
        normalizedInput,
        target: {
            id: target.partId,
            model: target.current.model,
            supplier: target.current.supplier,
            category: target.current.category,
            price: Number(target.current.price || 0),
            stock: Number(target.current.stock || 0),
            updatedAt: target.expectedUpdatedAt,
        },
        changes: [{
            resourceType: 'part',
            resourceId: target.partId,
            field: 'deletedAt',
            from: null,
            to: 'soft_deleted',
        }],
        impact: {
            deleteMode: 'soft_delete',
            partListVisibility: 'hidden',
            inventoryMovementCreated: false,
            recipeSnapshotsChanged: 0,
            historicalOperationsPreserved: true,
        },
        warnings: [],
        previewHash: partDeletePreviewHash(
            normalizedInput.partId,
            normalizedInput.expectedUpdatedAt
        ),
    };
}

function normalizePartModel(value) {
    const model = String(value || '').trim();
    if (!model) throw partCommandError('part_model_required', '零件型号不能为空', 400);
    return model;
}

function normalizeCreateInput(dependencies, input) {
    const fields = dependencies.extractPartFields(input || {});
    return {
        model: normalizePartModel(fields.model),
        category: String(fields.category || '其他').trim() || '其他',
        subcategory: String(fields.subcategory || '').trim(),
        price: parseNonNegativeNumber(fields.price, 'price'),
        supplier: String(fields.supplier || '-').trim() || '-',
        stock: parseNonNegativeNumber(fields.stock, 'stock'),
        remark: String(fields.remark || '').trim(),
    };
}

function partIdentity(part) {
    return `${part.model.toLocaleLowerCase()}\u0000${part.supplier.toLocaleLowerCase()}`;
}

function normalizeBatchCreateParts(dependencies, input = {}) {
    const parts = Array.isArray(input.parts) ? input.parts : [];
    if (parts.length === 0) {
        throw partCommandError('parts_required', 'parts 数组不能为空', 400);
    }
    if (parts.length > MAX_BATCH_CREATE_PARTS) {
        throw partCommandError(
            'parts_limit_exceeded',
            `单次最多新增 ${MAX_BATCH_CREATE_PARTS} 个零件`,
            400
        );
    }
    const seen = new Set();
    return parts.map((part, index) => {
        let normalized;
        try {
            normalized = normalizeCreateInput(dependencies, part);
        } catch (error) {
            if (error instanceof CommandExecutionError) {
                throw partCommandError(
                    error.code,
                    `parts[${index}]：${error.message}`,
                    error.statusCode
                );
            }
            throw error;
        }
        const identity = partIdentity(normalized);
        if (seen.has(identity)) {
            throw partCommandError(
                'duplicate_part_in_batch',
                `parts[${index}] 与本批其他项目的型号、供应商重复`,
                400
            );
        }
        seen.add(identity);
        return normalized;
    });
}

function findActivePartByIdentity(db, part) {
    return db.prepare(`
        SELECT *
        FROM parts
        WHERE model = ? COLLATE NOCASE
          AND supplier = ? COLLATE NOCASE
          AND deleted_at IS NULL
        ORDER BY id
        LIMIT 1
    `).get(part.model, part.supplier);
}

function buildPartBatchCreatePreview(dependencies, input = {}, subject) {
    const requested = normalizeBatchCreateParts(dependencies, input);
    const parts = [];
    const skippedExisting = [];
    for (const part of requested) {
        const existing = findActivePartByIdentity(dependencies.db, part);
        if (existing) {
            skippedExisting.push({
                id: existing.id,
                model: existing.model,
                supplier: existing.supplier,
                category: existing.category,
                price: Number(existing.price || 0),
                stock: Number(existing.stock || 0),
            });
            continue;
        }
        parts.push(part);
    }
    if (parts.length === 0) {
        throw partCommandError(
            'no_parts_to_create',
            '本批零件均已存在，没有可新增项目',
            409
        );
    }
    const previewHash = requestHash({ parts });
    const confirmation = issueBusinessConfirmation({
        capabilityId: BATCH_CREATE_CAPABILITY_ID,
        input: { parts, previewHash },
        subject,
    });
    return {
        capabilityId: BATCH_CREATE_CAPABILITY_ID,
        preview: true,
        ...confirmation,
        previewHash,
        suggestedIdempotencyKey: `part-batch-create:${confirmation.operationId}`,
        requestedCount: requested.length,
        createCount: parts.length,
        skippedCount: skippedExisting.length,
        parts,
        skippedExisting,
        changes: parts.map(part => ({
            resourceType: 'part',
            resourceId: null,
            field: 'created',
            from: null,
            to: {
                model: part.model,
                supplier: part.supplier,
                category: part.category,
                price: part.price,
                stock: part.stock,
            },
        })),
        warnings: skippedExisting.map(part => ({
            code: 'part_already_exists_skipped',
            message: `零件「${part.model}」（供应商：${part.supplier}）已存在，已跳过`,
            resourceId: part.id,
        })),
    };
}

function executePartBatchCreate(
    dependencies,
    input = {},
    commandContext = {}
) {
    const parts = normalizeBatchCreateParts(dependencies, input);
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: BATCH_CREATE_CAPABILITY_ID,
        businessChange: standardBusinessChange({ domain: 'part', eventType: 'created' }),
        input: { parts },
        execute: ({ auditContext }) => {
            for (const part of parts) {
                const existing = findActivePartByIdentity(dependencies.db, part);
                if (existing) {
                    throw partCommandError(
                        'part_batch_snapshot_conflict',
                        `零件「${part.model}」（供应商：${part.supplier}）已在预览后创建，请重新预览`,
                        409
                    );
                }
            }
            const created = [];
            const auditIds = [];
            const now = new Date().toISOString();
            for (const part of parts) {
                const write = dependencies.safeInsert('parts', {
                    model: part.model,
                    category: part.category,
                    subcategory: part.subcategory,
                    price: part.price,
                    supplier: part.supplier,
                    stock: part.stock,
                    remark: part.remark,
                    created_at: now,
                    updated_at: now,
                }, auditContext);
                const partId = Number(write.lastInsertRowid);
                if (write.auditId) auditIds.push(write.auditId);
                created.push(dependencies.partRow(
                    dependencies.db.prepare('SELECT * FROM parts WHERE id = ?').get(partId)
                ));
            }
            return {
                data: {
                    createdCount: created.length,
                    parts: created,
                },
                resource: {
                    type: 'part',
                    ids: created.map(part => part.id),
                },
                changes: created.map(part => ({
                    resourceType: 'part',
                    resourceId: part.id,
                    field: 'created',
                    from: null,
                    to: {
                        model: part.model,
                        supplier: part.supplier,
                        price: part.price,
                        stock: part.stock,
                    },
                })),
                auditIds,
                requiredAuditCount: created.length,
            };
        },
    });
}

function requireExplicitIdempotency(commandContext) {
    if ((commandContext.warnings || []).some(
        warning => warning.code === 'idempotency_key_missing_compatibility'
    )) {
        throw partCommandError(
            'idempotency_key_required',
            '批量新增零件确认后必须提供 Idempotency-Key 或 idempotencyKey',
            400
        );
    }
}

function normalizePartBusinessSettings(input = {}) {
    const requested = Array.isArray(input.businessSettings)
        ? input.businessSettings
        : [];
    if (requested.length > PART_FORM_SETTING_KEYS.size) {
        throw partCommandError(
            'part_business_settings_limit_exceeded',
            `零件保存最多同时更新 ${PART_FORM_SETTING_KEYS.size} 个业务设置`,
            400
        );
    }
    const seen = new Set();
    return requested.map((item, index) => {
        const key = String(item?.key || '').trim();
        if (!PART_FORM_SETTING_KEYS.has(key)) {
            throw partCommandError(
                'part_business_setting_key_invalid',
                `businessSettings[${index}].key 不是零件表单允许更新的设置`,
                400
            );
        }
        if (seen.has(key)) {
            throw partCommandError(
                'part_business_setting_duplicate',
                `设置项 ${key} 在同一次零件保存中重复`,
                400
            );
        }
        seen.add(key);
        return {
            key,
            value: normalizeBusinessSettingValue(key, item?.value),
            expectedUpdatedAt: normalizeExpectedUpdatedAt(
                item?.expectedUpdatedAt,
                `businessSettings[${index}].expectedUpdatedAt`
            ),
        };
    });
}

function inspectPartBusinessSettings(dependencies, settings) {
    return settings.map(setting => {
        const current = dependencies.db.prepare(`
            SELECT key, value, updated_at
            FROM system_settings
            WHERE key = ?
        `).get(setting.key);
        if (current) {
            if (!setting.expectedUpdatedAt) {
                throw partCommandError(
                    'business_setting_version_required',
                    `设置项 ${setting.key} 的 expectedUpdatedAt 为必填项`,
                    400
                );
            }
            assertExpectedUpdatedAt(
                current,
                setting.expectedUpdatedAt,
                `设置项 ${setting.key}`
            );
        } else if (setting.expectedUpdatedAt) {
            throw partCommandError(
                'business_setting_not_found',
                `设置项 "${setting.key}" 不存在`,
                404
            );
        }
        return { setting, current };
    });
}

function applyPartBusinessSettings(dependencies, settings, auditContext) {
    const results = [];
    for (const { setting, current } of inspectPartBusinessSettings(
        dependencies,
        settings
    )) {
        const write = dependencies.setSetting(
            setting.key,
            setting.value,
            auditContext
        );
        results.push({
            key: setting.key,
            value: write.value,
            updatedAt: write.updatedAt,
            previousValue: current?.value ?? null,
            auditId: write.auditId || null,
        });
    }
    return results;
}

function executeConfirmedPartBatchCreate(
    dependencies,
    input = {},
    commandContext = {},
    subject
) {
    requireExplicitIdempotency(commandContext);
    const confirmation = consumeBusinessConfirmation({
        confirmationToken: input.confirmationToken,
        capabilityId: BATCH_CREATE_CAPABILITY_ID,
        subject,
        idempotencyKey: commandContext.idempotencyKey,
    });
    return executePartBatchCreate(
        dependencies,
        { parts: confirmation.input.parts },
        {
            ...commandContext,
            capabilityId: BATCH_CREATE_CAPABILITY_ID,
            operationId: confirmation.operationId,
        }
    );
}

function normalizeUpdateInput(dependencies, input, current) {
    const fields = dependencies.extractPartFields({
        ...input,
        category: input.category ?? current.category,
        subcategory: input.subcategory ?? current.subcategory,
        model: input.model ?? current.model,
        supplier: input.supplier ?? current.supplier,
        notes: input.notes ?? input.remark ?? current.remark,
    });
    return {
        ...(input.model === undefined ? {} : { model: normalizePartModel(fields.model) }),
        ...(input.category === undefined
            ? {}
            : { category: String(fields.category || '其他').trim() || '其他' }),
        ...(input.category === undefined && input.subcategory === undefined
            ? {}
            : { subcategory: String(fields.subcategory || '').trim() }),
        ...(input.price === undefined
            ? {}
            : { price: parseNonNegativeNumber(fields.price, 'price') }),
        ...(input.supplier === undefined
            ? {}
            : { supplier: String(fields.supplier || '-').trim() || '-' }),
        ...(input.stock === undefined
            ? {}
            : { stock: parseNonNegativeNumber(fields.stock, 'stock') }),
        ...(input.notes === undefined && input.remark === undefined
            ? {}
            : { remark: String(fields.remark || '').trim() }),
    };
}

function versionCompatibilityWarning(partId, expectedUpdatedAt) {
    return partId && !expectedUpdatedAt ? [{
        code: 'expected_updated_at_missing_compatibility',
        message: `零件 #${partId} 未提供 expectedUpdatedAt，并发覆盖保护未启用`,
    }] : [];
}

function cascadePumpShellTemplateModel(dependencies, current, updates, auditContext) {
    const nextModel = updates.model ?? current.model;
    const nextCategory = updates.category ?? current.category;
    if (current.category !== '泵壳'
        || nextCategory !== '泵壳'
        || nextModel === current.model) {
        return [];
    }
    const oldModelStillExists = dependencies.db.prepare(`
        SELECT 1
        FROM parts
        WHERE id != ?
          AND model = ? COLLATE NOCASE
          AND category = '泵壳'
          AND deleted_at IS NULL
        LIMIT 1
    `).get(current.id, current.model);
    if (oldModelStillExists) return [];

    const templates = dependencies.db.prepare(`
        SELECT id, shell_model
        FROM pump_shell_templates
        WHERE shell_model = ? COLLATE NOCASE
        ORDER BY id
    `).all(current.model);
    return templates.map(template => {
        const write = dependencies.safeUpdate(
            'pump_shell_templates',
            template.id,
            { shell_model: nextModel },
            auditContext
        );
        return {
            templateId: Number(template.id),
            from: template.shell_model,
            to: nextModel,
            auditId: write.auditId,
        };
    });
}

function executePartCreate(dependencies, input = {}, commandContext = {}) {
    const normalized = normalizeCreateInput(dependencies, input);
    const businessSettings = normalizePartBusinessSettings(input);
    const duplicatePolicy = input.duplicatePolicy === 'reject' ? 'reject' : 'allow';
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: CREATE_CAPABILITY_ID,
        businessChange: standardBusinessChange({ domain: 'part', eventType: 'created' }),
        input: { ...normalized, duplicatePolicy, businessSettings },
        execute: ({ auditContext }) => {
            const existing = duplicatePolicy === 'reject'
                ? findActivePartByIdentity(dependencies.db, normalized)
                : null;
            if (existing) {
                throw partCommandError(
                    'part_identity_conflict',
                    `零件“${normalized.model}”（供应商：${normalized.supplier}）已存在于“${existing.category}”分类，请直接使用现有记录`,
                    409
                );
            }
            const now = new Date().toISOString();
            const write = dependencies.safeInsert('parts', {
                model: normalized.model,
                category: normalized.category,
                subcategory: normalized.subcategory,
                price: normalized.price,
                supplier: normalized.supplier,
                stock: normalized.stock,
                remark: normalized.remark,
                created_at: now,
                updated_at: now,
            }, auditContext);
            const partId = Number(write.lastInsertRowid);
            const part = dependencies.partRow(
                dependencies.db.prepare('SELECT * FROM parts WHERE id = ?').get(partId)
            );
            const settings = applyPartBusinessSettings(
                dependencies,
                businessSettings,
                auditContext
            );
            return {
                data: { part, businessSettings: settings },
                resource: {
                    type: 'part',
                    ids: [partId],
                    related: settings.map(setting => ({
                        type: 'businessSetting',
                        id: setting.key,
                    })),
                },
                changes: [{
                    resourceType: 'part',
                    resourceId: partId,
                    field: 'created',
                    from: null,
                    to: {
                        model: part.model,
                        price: part.price,
                        stock: part.stock,
                    },
                }, ...settings.map(setting => ({
                    resourceType: 'businessSetting',
                    resourceId: setting.key,
                    field: 'value',
                    from: setting.previousValue,
                    to: setting.value,
                }))],
                auditIds: [write.auditId, ...settings.map(setting => setting.auditId)]
                    .filter(Boolean),
                requiredAuditCount: 1 + settings.length,
            };
        },
    });
}

function executePartUpdate(
    dependencies,
    partIdValue,
    input = {},
    commandContext = {}
) {
    const partId = parsePositiveId(partIdValue);
    if (!partId) throw partCommandError('part_id_invalid', '非法零件ID', 400);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const current = getPartRecord(dependencies.db, partId);
    const updates = normalizeUpdateInput(dependencies, input, current);
    const businessSettings = normalizePartBusinessSettings(input);
    const includesStock = Object.hasOwn(updates, 'stock');
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: UPDATE_CAPABILITY_ID,
        businessChange: standardBusinessChange({ domain: 'part', eventType: 'updated' }),
        input: { partId, expectedUpdatedAt, updates, businessSettings },
        warnings: [
            ...(commandContext.warnings || []),
            ...versionCompatibilityWarning(partId, expectedUpdatedAt),
            ...(includesStock ? [{
                code: 'part_stock_patch_compatibility',
                message: '普通零件 PATCH 的库存字段仅为兼容；新库存增减调用必须使用 /api/parts/batch-stock，资料页整单保存使用 /api/parts/:id/save',
            }] : []),
        ],
        execute: ({ auditContext }) => {
            const record = getPartRecord(dependencies.db, partId);
            assertExpectedUpdatedAt(record, expectedUpdatedAt, `零件 #${partId}`);
            if (Object.keys(updates).length === 0 && businessSettings.length === 0) {
                return {
                    data: { part: dependencies.partRow(record) },
                    resource: { type: 'part', ids: [partId] },
                    changes: [],
                    auditIds: [],
                    requiredAuditCount: 0,
                    warnings: [{
                        code: 'part_update_noop',
                        message: '没有可保存的零件字段，未执行写入',
                    }],
                };
            }
            const write = Object.keys(updates).length > 0
                ? dependencies.safeUpdate('parts', partId, updates, auditContext)
                : { auditId: null };
            const linkedTemplates = cascadePumpShellTemplateModel(
                dependencies,
                record,
                updates,
                auditContext
            );
            const part = dependencies.partRow(
                dependencies.db.prepare('SELECT * FROM parts WHERE id = ?').get(partId)
            );
            const settings = applyPartBusinessSettings(
                dependencies,
                businessSettings,
                auditContext
            );
            return {
                data: {
                    part,
                    linkedTemplateIds: linkedTemplates.map(item => item.templateId),
                    businessSettings: settings,
                },
                resource: { type: 'part', ids: [partId] },
                changes: [{
                    resourceType: 'part',
                    resourceId: partId,
                    field: includesStock ? 'fieldsIncludingStock' : 'fields',
                    from: null,
                    to: Object.keys(updates),
                }, ...linkedTemplates.map(item => ({
                    resourceType: 'pump_shell_template',
                    resourceId: item.templateId,
                    field: 'shellModel',
                    from: item.from,
                    to: item.to,
                })), ...settings.map(setting => ({
                    resourceType: 'businessSetting',
                    resourceId: setting.key,
                    field: 'value',
                    from: setting.previousValue,
                    to: setting.value,
                }))],
                auditIds: [
                    write.auditId,
                    ...linkedTemplates.map(item => item.auditId),
                    ...settings.map(setting => setting.auditId),
                ]
                    .filter(Boolean),
                requiredAuditCount:
                    (Object.keys(updates).length > 0 ? 1 : 0)
                    + linkedTemplates.length
                    + settings.length,
            };
        },
    });
}

function normalizeBatchDeleteItems(value) {
    if (!Array.isArray(value) || value.length === 0) {
        throw partCommandError('parts_required', 'parts 数组不能为空', 400);
    }
    if (value.length > MAX_BATCH_DELETE_PARTS) {
        throw partCommandError(
            'parts_limit_exceeded',
            `单次最多删除 ${MAX_BATCH_DELETE_PARTS} 个零件`,
            400
        );
    }
    const seen = new Set();
    return value.map((item, index) => {
        const partId = parsePositiveId(item?.partId);
        if (!partId) {
            throw partCommandError(
                'part_id_invalid',
                `parts[${index}].partId 必须是正整数`,
                400
            );
        }
        if (seen.has(partId)) {
            throw partCommandError(
                'duplicate_part_delete',
                `零件 #${partId} 在同一批删除中重复`,
                400
            );
        }
        seen.add(partId);
        const expectedUpdatedAt = normalizeExpectedUpdatedAt(
            item?.expectedUpdatedAt,
            `parts[${index}].expectedUpdatedAt`
        );
        if (!expectedUpdatedAt) {
            throw partCommandError(
                'expected_updated_at_required',
                `parts[${index}].expectedUpdatedAt 为必填项`,
                400
            );
        }
        return { partId, expectedUpdatedAt };
    });
}

function buildPartBatchDeletePreview(dependencies, input = {}, subject) {
    const parts = normalizeBatchDeleteItems(input.parts).map(item => {
        const record = getPartRecord(dependencies.db, item.partId);
        assertExpectedUpdatedAt(record, item.expectedUpdatedAt, `零件 #${item.partId}`);
        return {
            ...item,
            model: record.model,
            supplier: record.supplier,
        };
    });
    const previewHash = requestHash({
        parts: parts.map(({ partId, expectedUpdatedAt }) => ({ partId, expectedUpdatedAt })),
    });
    const confirmation = issueBusinessConfirmation({
        capabilityId: BATCH_DELETE_CAPABILITY_ID,
        input: {
            parts: parts.map(({ partId, expectedUpdatedAt }) => ({
                partId,
                expectedUpdatedAt,
            })),
            previewHash,
        },
        subject,
    });
    return {
        capabilityId: BATCH_DELETE_CAPABILITY_ID,
        preview: true,
        ...confirmation,
        previewHash,
        suggestedIdempotencyKey: `part-batch-delete:${confirmation.operationId}`,
        deleteCount: parts.length,
        parts,
        changes: parts.map(part => ({
            resourceType: 'part',
            resourceId: part.partId,
            field: 'deletedAt',
            from: null,
            to: 'pending',
        })),
        warnings: [],
    };
}

function executePartBatchDelete(dependencies, input = {}, commandContext = {}) {
    const parts = normalizeBatchDeleteItems(input.parts);
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: BATCH_DELETE_CAPABILITY_ID,
        businessChange: standardBusinessChange({ domain: 'part', eventType: 'deleted' }),
        input: { parts },
        execute: ({ auditContext }) => {
            const records = parts.map(item => {
                const record = getPartRecord(dependencies.db, item.partId);
                assertExpectedUpdatedAt(record, item.expectedUpdatedAt, `零件 #${item.partId}`);
                return record;
            });
            const deletedAt = new Date().toISOString();
            const auditIds = [];
            for (const record of records) {
                const write = dependencies.safeUpdate(
                    'parts',
                    record.id,
                    { deleted_at: deletedAt },
                    auditContext
                );
                if (write.auditId) auditIds.push(write.auditId);
            }
            return {
                data: {
                    deletedCount: records.length,
                    partIds: records.map(record => Number(record.id)),
                    deletedAt,
                },
                resource: {
                    type: 'part',
                    ids: records.map(record => Number(record.id)),
                },
                changes: records.map(record => ({
                    resourceType: 'part',
                    resourceId: Number(record.id),
                    field: 'deletedAt',
                    from: null,
                    to: deletedAt,
                })),
                auditIds,
                requiredAuditCount: records.length,
            };
        },
    });
}

function executeConfirmedPartBatchDelete(
    dependencies,
    input = {},
    commandContext = {},
    subject
) {
    requireExplicitIdempotency(commandContext);
    const confirmation = consumeBusinessConfirmation({
        confirmationToken: input.confirmationToken,
        capabilityId: BATCH_DELETE_CAPABILITY_ID,
        subject,
        idempotencyKey: commandContext.idempotencyKey,
    });
    return executePartBatchDelete(
        dependencies,
        { parts: confirmation.input.parts },
        {
            ...commandContext,
            capabilityId: BATCH_DELETE_CAPABILITY_ID,
            operationId: confirmation.operationId,
        }
    );
}

function executePartDelete(
    dependencies,
    partIdValue,
    input = {},
    commandContext = {}
) {
    const partId = parsePositiveId(partIdValue);
    if (!partId) throw partCommandError('part_id_invalid', '非法零件ID', 400);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const expectedPreviewHash = normalizePreviewHash(input.previewHash);
    if (!expectedUpdatedAt) {
        throw partCommandError(
            'part_delete_version_required',
            '删除零件前必须先取得正式预览并提交 expectedUpdatedAt',
            400
        );
    }
    if (!expectedPreviewHash) {
        throw partCommandError(
            'part_delete_preview_required',
            '删除零件前必须先取得正式预览并提交 previewHash',
            400
        );
    }
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: DELETE_CAPABILITY_ID,
        businessChange: standardBusinessChange({ domain: 'part', eventType: 'deleted' }),
        input: { partId, expectedUpdatedAt, previewHash: expectedPreviewHash },
        warnings: [...(commandContext.warnings || [])],
        execute: ({ auditContext }) => {
            const target = resolvePartDeleteTarget(
                dependencies,
                partId,
                { expectedUpdatedAt }
            );
            assertPreviewHash(
                expectedPreviewHash,
                partDeletePreviewHash(partId, target.expectedUpdatedAt),
                '零件删除预览已经变化，请重新预览并确认'
            );
            const deletedAt = new Date().toISOString();
            const write = dependencies.safeUpdate(
                'parts',
                partId,
                { deleted_at: deletedAt },
                auditContext
            );
            return {
                data: { deleted: 1, partId, deletedAt },
                resource: { type: 'part', ids: [partId] },
                changes: [{
                    resourceType: 'part',
                    resourceId: partId,
                    field: 'deletedAt',
                    from: null,
                    to: deletedAt,
                }],
                auditIds: write.auditId ? [write.auditId] : [],
                requiredAuditCount: 1,
            };
        },
    });
}

function normalizedPartProfileSave(dependencies, partIdValue, input = {}) {
    const partId = parsePositiveId(partIdValue);
    if (!partId) throw partCommandError('part_id_invalid', '非法零件ID', 400);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    if (!expectedUpdatedAt) {
        throw partCommandError(
            'expected_updated_at_required',
            'expectedUpdatedAt 为必填项',
            400
        );
    }
    const current = getPartRecord(dependencies.db, partId);
    const updates = normalizeUpdateInput(dependencies, input, current);
    if (!Object.hasOwn(updates, 'stock')) {
        throw partCommandError(
            'part_target_stock_required',
            '零件资料保存必须提供目标库存 stock',
            400
        );
    }
    const businessSettings = normalizePartBusinessSettings(input);
    return { partId, expectedUpdatedAt, current, updates, businessSettings };
}

function buildPartProfileSavePreview(dependencies, partIdValue, input = {}, subject) {
    const normalized = normalizedPartProfileSave(dependencies, partIdValue, input);
    assertExpectedUpdatedAt(
        normalized.current,
        normalized.expectedUpdatedAt,
        `零件 #${normalized.partId}`
    );
    const settingSnapshots = inspectPartBusinessSettings(
        dependencies,
        normalized.businessSettings
    );
    const commandInput = {
        partId: normalized.partId,
        expectedUpdatedAt: normalized.expectedUpdatedAt,
        updates: normalized.updates,
        businessSettings: normalized.businessSettings,
    };
    const previewHash = requestHash(commandInput);
    const confirmation = issueBusinessConfirmation({
        capabilityId: PROFILE_SAVE_CAPABILITY_ID,
        input: { ...commandInput, previewHash },
        subject,
    });
    const fieldChanges = Object.entries(normalized.updates)
        .filter(([field, value]) => normalized.current[field] !== value)
        .map(([field, value]) => ({
            resourceType: 'part',
            resourceId: normalized.partId,
            field,
            from: normalized.current[field] ?? null,
            to: value,
        }));
    return {
        capabilityId: PROFILE_SAVE_CAPABILITY_ID,
        preview: true,
        ...confirmation,
        previewHash,
        suggestedIdempotencyKey: `part-profile-save:${confirmation.operationId}`,
        partId: normalized.partId,
        model: normalized.current.model,
        changes: [
            ...fieldChanges,
            ...settingSnapshots.map(({ setting, current }) => ({
                resourceType: 'businessSetting',
                resourceId: setting.key,
                field: 'value',
                from: current?.value ?? null,
                to: setting.value,
            })),
        ],
        warnings: [],
    };
}

function executePartProfileSave(
    dependencies,
    input = {},
    commandContext = {}
) {
    const partId = parsePositiveId(input.partId);
    if (!partId) throw partCommandError('part_id_invalid', '非法零件ID', 400);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const updates = input.updates || {};
    const businessSettings = normalizePartBusinessSettings({
        businessSettings: input.businessSettings,
    });
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: PROFILE_SAVE_CAPABILITY_ID,
        businessChange: standardBusinessChange({ domain: 'part', eventType: 'updated' }),
        input: { partId, expectedUpdatedAt, updates, businessSettings },
        execute: ({ auditContext }) => {
            const record = getPartRecord(dependencies.db, partId);
            assertExpectedUpdatedAt(record, expectedUpdatedAt, `零件 #${partId}`);
            inspectPartBusinessSettings(dependencies, businessSettings);
            const write = dependencies.safeUpdate('parts', partId, updates, auditContext);
            const linkedTemplates = cascadePumpShellTemplateModel(
                dependencies,
                record,
                updates,
                auditContext
            );
            const settings = applyPartBusinessSettings(
                dependencies,
                businessSettings,
                auditContext
            );
            const part = dependencies.partRow(
                dependencies.db.prepare('SELECT * FROM parts WHERE id = ?').get(partId)
            );
            const auditIds = [
                write.auditId,
                ...linkedTemplates.map(item => item.auditId),
                ...settings.map(setting => setting.auditId),
            ].filter(Boolean);
            return {
                data: {
                    part,
                    linkedTemplateIds: linkedTemplates.map(item => item.templateId),
                    businessSettings: settings,
                },
                resource: {
                    type: 'part',
                    ids: [partId],
                    related: settings.map(setting => ({
                        type: 'businessSetting',
                        id: setting.key,
                    })),
                },
                changes: [{
                    resourceType: 'part',
                    resourceId: partId,
                    field: 'profileIncludingTargetStock',
                    from: null,
                    to: Object.keys(updates),
                }, ...linkedTemplates.map(item => ({
                    resourceType: 'pump_shell_template',
                    resourceId: item.templateId,
                    field: 'shellModel',
                    from: item.from,
                    to: item.to,
                })), ...settings.map(setting => ({
                    resourceType: 'businessSetting',
                    resourceId: setting.key,
                    field: 'value',
                    from: setting.previousValue,
                    to: setting.value,
                }))],
                auditIds,
                requiredAuditCount: 1 + linkedTemplates.length + settings.length,
            };
        },
    });
}

function executeConfirmedPartProfileSave(
    dependencies,
    partIdValue,
    input = {},
    commandContext = {},
    subject
) {
    requireExplicitIdempotency(commandContext);
    const confirmation = consumeBusinessConfirmation({
        confirmationToken: input.confirmationToken,
        capabilityId: PROFILE_SAVE_CAPABILITY_ID,
        subject,
        idempotencyKey: commandContext.idempotencyKey,
    });
    const requestedPartId = parsePositiveId(partIdValue);
    if (!requestedPartId || requestedPartId !== confirmation.input.partId) {
        throw partCommandError(
            'part_profile_confirmation_resource_mismatch',
            '确认凭证与零件资源不匹配，请重新预览',
            409
        );
    }
    return executePartProfileSave(
        dependencies,
        confirmation.input,
        {
            ...commandContext,
            capabilityId: PROFILE_SAVE_CAPABILITY_ID,
            operationId: confirmation.operationId,
        }
    );
}

function normalizePriceUpdates(value) {
    if (!Array.isArray(value) || value.length === 0) {
        throw partCommandError('price_updates_required', 'updates 数组不能为空', 400);
    }
    const seen = new Set();
    return value.map((item, index) => {
        const partId = parsePositiveId(item?.partId);
        if (!partId) {
            throw partCommandError(
                'part_id_invalid',
                `updates[${index}].partId 必须是正整数`,
                400
            );
        }
        if (seen.has(partId)) {
            throw partCommandError(
                'duplicate_part_price_update',
                `零件 #${partId} 在同一批调价中重复`,
                400
            );
        }
        seen.add(partId);
        return {
            partId,
            price: parseNonNegativeNumber(item?.price, `updates[${index}].price`),
            expectedUpdatedAt: normalizeExpectedUpdatedAt(
                item?.expectedUpdatedAt,
                `updates[${index}].expectedUpdatedAt`
            ),
        };
    });
}

function buildPartPricePreview(dependencies, input = {}) {
    const requested = normalizePriceUpdates(input.updates);
    const changes = [];
    const updates = [];
    const warnings = [];
    for (const item of requested) {
        const record = dependencies.db.prepare(
            'SELECT * FROM parts WHERE id = ? AND deleted_at IS NULL'
        ).get(item.partId);
        if (!record) {
            warnings.push({
                code: 'part_not_found_skipped',
                message: `零件 #${item.partId} 不存在，已跳过`,
                resourceId: item.partId,
            });
            continue;
        }
        const expectedUpdatedAt = item.expectedUpdatedAt || record.updated_at;
        updates.push({
            partId: item.partId,
            price: item.price,
            expectedUpdatedAt,
        });
        changes.push({
            resourceType: 'part',
            resourceId: item.partId,
            field: 'price',
            from: Number(record.price || 0),
            to: item.price,
        });
    }
    if (updates.length === 0) {
        throw partCommandError('no_parts_to_update', '没有可调价的有效零件', 404);
    }
    const previewHash = requestHash({ updates });
    return {
        capabilityId: BATCH_PRICE_CAPABILITY_ID,
        preview: true,
        previewHash,
        suggestedIdempotencyKey: `part-prices:${crypto.randomUUID()}`,
        updates,
        updatedCount: updates.length,
        changes,
        warnings,
    };
}

function executePartPriceBatch(
    dependencies,
    input = {},
    commandContext = {}
) {
    const expectedPreviewHash = normalizePreviewHash(input.previewHash);
    const requestedUpdates = normalizePriceUpdates(input.updates);
    const missingVersions = requestedUpdates.filter(item => !item.expectedUpdatedAt);
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: BATCH_PRICE_CAPABILITY_ID,
        businessChange: standardBusinessChange({ domain: 'part', eventType: 'updated' }),
        input: {
            updates: requestedUpdates,
            previewHash: expectedPreviewHash,
        },
        warnings: [
            ...(commandContext.warnings || []),
            ...(!expectedPreviewHash ? [{
                code: 'preview_hash_missing_compatibility',
                message: '批量调价未绑定正式预览',
            }] : []),
            ...(missingVersions.length > 0 ? [{
                code: 'expected_versions_missing_compatibility',
                message: `${missingVersions.length} 个零件未由调用方提供版本，已按执行时版本兼容处理`,
            }] : []),
        ],
        execute: ({ auditContext }) => {
            const currentDraft = buildPartPricePreview(dependencies, {
                updates: requestedUpdates,
            });
            assertPreviewHash(
                expectedPreviewHash,
                currentDraft.previewHash,
                '零件价格或版本已经变化，请重新预览批量调价'
            );
            const parts = [];
            const auditIds = [];
            for (const item of currentDraft.updates) {
                const record = getPartRecord(dependencies.db, item.partId);
                assertExpectedUpdatedAt(
                    record,
                    item.expectedUpdatedAt,
                    `零件 #${item.partId}`
                );
                const write = dependencies.safeUpdate(
                    'parts',
                    item.partId,
                    { price: item.price },
                    auditContext
                );
                if (write.auditId) auditIds.push(write.auditId);
                parts.push(dependencies.partRow(
                    dependencies.db.prepare(
                        'SELECT * FROM parts WHERE id = ?'
                    ).get(item.partId)
                ));
            }
            return {
                data: {
                    updatedCount: parts.length,
                    parts,
                },
                resource: {
                    type: 'part',
                    ids: parts.map(part => part.id),
                },
                changes: currentDraft.changes,
                auditIds,
                requiredAuditCount: parts.length,
                warnings: currentDraft.warnings,
            };
        },
    });
}

module.exports = {
    BATCH_DELETE_CAPABILITY_ID,
    BATCH_CREATE_CAPABILITY_ID,
    BATCH_PRICE_CAPABILITY_ID,
    CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID,
    PROFILE_SAVE_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID,
    buildPartBatchCreatePreview,
    buildPartBatchDeletePreview,
    buildPartDeletePreview,
    buildPartPricePreview,
    buildPartProfileSavePreview,
    executeConfirmedPartBatchCreate,
    executeConfirmedPartBatchDelete,
    executeConfirmedPartProfileSave,
    executePartBatchCreate,
    executePartCreate,
    executePartDelete,
    executePartBatchDelete,
    executePartPriceBatch,
    executePartProfileSave,
    executePartUpdate,
    normalizeBatchCreateParts,
};
