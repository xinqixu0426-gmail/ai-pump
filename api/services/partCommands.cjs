const crypto = require('node:crypto');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
    requestHash,
} = require('./commandExecution.cjs');
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

const CREATE_CAPABILITY_ID = requireBusinessCapability('parts.create').capabilityId;
const BATCH_CREATE_CAPABILITY_ID = requireBusinessCapability(
    'parts.batch_create'
).capabilityId;
const UPDATE_CAPABILITY_ID = requireBusinessCapability('parts.update').capabilityId;
const DELETE_CAPABILITY_ID = requireBusinessCapability('parts.delete').capabilityId;
const BATCH_PRICE_CAPABILITY_ID = requireBusinessCapability(
    'parts.batch_update_prices'
).capabilityId;
const MAX_BATCH_CREATE_PARTS = 100;

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
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: CREATE_CAPABILITY_ID,
        input: normalized,
        execute: ({ auditContext }) => {
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
            return {
                data: { part },
                resource: { type: 'part', ids: [partId] },
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
                }],
                auditIds: write.auditId ? [write.auditId] : [],
                requiredAuditCount: 1,
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
    const includesStock = Object.hasOwn(updates, 'stock');
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: UPDATE_CAPABILITY_ID,
        input: { partId, expectedUpdatedAt, updates },
        warnings: [
            ...(commandContext.warnings || []),
            ...versionCompatibilityWarning(partId, expectedUpdatedAt),
            ...(includesStock ? [{
                code: 'part_stock_patch_compatibility',
                message: '普通零件 PATCH 的库存字段仅为兼容；新调用必须使用 /api/parts/batch-stock',
            }] : []),
        ],
        execute: ({ auditContext }) => {
            const record = getPartRecord(dependencies.db, partId);
            assertExpectedUpdatedAt(record, expectedUpdatedAt, `零件 #${partId}`);
            if (Object.keys(updates).length === 0) {
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
            const write = dependencies.safeUpdate(
                'parts',
                partId,
                updates,
                auditContext
            );
            const linkedTemplates = cascadePumpShellTemplateModel(
                dependencies,
                record,
                updates,
                auditContext
            );
            const part = dependencies.partRow(
                dependencies.db.prepare('SELECT * FROM parts WHERE id = ?').get(partId)
            );
            return {
                data: {
                    part,
                    linkedTemplateIds: linkedTemplates.map(item => item.templateId),
                },
                resource: { type: 'part', ids: [partId] },
                changes: [{
                    resourceType: 'part',
                    resourceId: partId,
                    field: includesStock ? 'fieldsIncludingLegacyStock' : 'fields',
                    from: null,
                    to: Object.keys(updates),
                }, ...linkedTemplates.map(item => ({
                    resourceType: 'pump_shell_template',
                    resourceId: item.templateId,
                    field: 'shellModel',
                    from: item.from,
                    to: item.to,
                }))],
                auditIds: [write.auditId, ...linkedTemplates.map(item => item.auditId)]
                    .filter(Boolean),
                requiredAuditCount: 1 + linkedTemplates.length,
            };
        },
    });
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
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: DELETE_CAPABILITY_ID,
        input: { partId, expectedUpdatedAt },
        warnings: [
            ...(commandContext.warnings || []),
            ...versionCompatibilityWarning(partId, expectedUpdatedAt),
        ],
        execute: ({ auditContext }) => {
            const record = getPartRecord(dependencies.db, partId);
            assertExpectedUpdatedAt(record, expectedUpdatedAt, `零件 #${partId}`);
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
    BATCH_CREATE_CAPABILITY_ID,
    BATCH_PRICE_CAPABILITY_ID,
    CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID,
    buildPartBatchCreatePreview,
    buildPartPricePreview,
    executeConfirmedPartBatchCreate,
    executePartBatchCreate,
    executePartCreate,
    executePartDelete,
    executePartPriceBatch,
    executePartUpdate,
    normalizeBatchCreateParts,
};
