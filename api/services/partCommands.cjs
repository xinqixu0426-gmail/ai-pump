const crypto = require('node:crypto');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
    requestHash,
} = require('./commandExecution.cjs');
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
const UPDATE_CAPABILITY_ID = requireBusinessCapability('parts.update').capabilityId;
const DELETE_CAPABILITY_ID = requireBusinessCapability('parts.delete').capabilityId;
const BATCH_PRICE_CAPABILITY_ID = requireBusinessCapability(
    'parts.batch_update_prices'
).capabilityId;

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
            const part = dependencies.partRow(
                dependencies.db.prepare('SELECT * FROM parts WHERE id = ?').get(partId)
            );
            return {
                data: { part },
                resource: { type: 'part', ids: [partId] },
                changes: [{
                    resourceType: 'part',
                    resourceId: partId,
                    field: includesStock ? 'fieldsIncludingLegacyStock' : 'fields',
                    from: null,
                    to: Object.keys(updates),
                }],
                auditIds: write.auditId ? [write.auditId] : [],
                requiredAuditCount: 1,
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
    BATCH_PRICE_CAPABILITY_ID,
    CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID,
    buildPartPricePreview,
    executePartCreate,
    executePartDelete,
    executePartPriceBatch,
    executePartUpdate,
};
