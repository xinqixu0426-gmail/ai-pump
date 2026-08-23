const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    CommandExecutionError,
    executePersistentCommand,
} = require('./commandExecution.cjs');
const { standardBusinessChange } = require('./businessChanges.cjs');
const {
    buildQuotationSavePayloadDraft,
} = require('./quotationDraft.cjs');
const { assertQuotationTransition } = require('./orderWorkflow.cjs');
const {
    assertPreviewHash,
    normalizePreviewHash,
} = require('./previewIntegrity.cjs');
const {
    assertExpectedUpdatedAt,
    normalizeExpectedUpdatedAt,
} = require('./resourceVersion.cjs');
const { parsePositiveId } = require('./validation.cjs');
const { attachQuotationInquiry } = require('./quotationAttachmentSummaries.cjs');

const CREATE_CAPABILITY_ID = requireBusinessCapability('quotations.create').capabilityId;
const UPDATE_CAPABILITY_ID = requireBusinessCapability('quotations.update').capabilityId;
const STATUS_CAPABILITY_ID = requireBusinessCapability(
    'quotations.change_status'
).capabilityId;
const DELETE_CAPABILITY_ID = requireBusinessCapability('quotations.delete').capabilityId;

function quotationCommandError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function getQuotationRecord(db, quotationId) {
    const record = db.prepare(
        'SELECT * FROM quotations WHERE id = ? AND deleted_at IS NULL'
    ).get(quotationId);
    if (!record) {
        throw quotationCommandError('quotation_not_found', '报价单不存在', 404);
    }
    return record;
}

function compatibilityWarnings({
    quotationId,
    expectedUpdatedAt,
    expectedPreviewHash,
    requirePreview,
}) {
    return [
        ...(!expectedUpdatedAt && quotationId ? [{
            code: 'expected_updated_at_missing_compatibility',
            message: `报价 #${quotationId} 未提供 expectedUpdatedAt，并发覆盖保护未启用`,
        }] : []),
        ...(!expectedPreviewHash && requirePreview ? [{
            code: 'preview_hash_missing_compatibility',
            message: '报价保存未绑定 save-payload-draft 预览',
        }] : []),
    ];
}

function normalizedSaveDraft(dependencies, input, forcedStatus) {
    return buildQuotationSavePayloadDraft(dependencies, {
        ...input,
        ...(forcedStatus ? { status: forcedStatus } : {}),
    });
}

function executeQuotationCreate(dependencies, input = {}, commandContext = {}) {
    const expectedPreviewHash = normalizePreviewHash(input.previewHash);
    const draft = normalizedSaveDraft(dependencies, input);
    if (!['草稿', '报价中'].includes(draft.status)) {
        throw quotationCommandError(
            'quotation_create_status_invalid',
            '新报价只能保存为草稿或报价中',
            400
        );
    }
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: CREATE_CAPABILITY_ID,
        businessChange: standardBusinessChange({ domain: 'quotation', eventType: 'created' }),
        input: {
            customerId: draft.customerId,
            status: draft.status,
            previewHash: expectedPreviewHash,
            savePreviewHash: draft.previewHash,
            attachmentFileIds: draft.attachmentFileIds,
            attachmentSummary: draft.attachmentSummary,
            attachmentSourceFileIds: draft.attachmentSourceFileIds,
        },
        warnings: [
            ...(commandContext.warnings || []),
            ...compatibilityWarnings({
                expectedPreviewHash,
                requirePreview: true,
            }),
        ],
        execute: ({ auditContext }) => {
            const currentDraft = normalizedSaveDraft(dependencies, input);
            assertPreviewHash(
                expectedPreviewHash,
                currentDraft.previewHash,
                '报价保存草稿所依据的配方、成本或输入已经变化，请重新预览'
            );
            const now = new Date().toISOString();
            const write = dependencies.safeInsert('quotations', {
                customer_id: currentDraft.customerId,
                status: currentDraft.status,
                items_json: currentDraft.itemsJson,
                total_cost: currentDraft.totalCost,
                total_price: currentDraft.totalPrice,
                remark: currentDraft.remark,
                created_at: now,
                updated_at: now,
            }, auditContext);
            const quotationId = Number(write.lastInsertRowid);
            const quotation = dependencies.quotationRow(
                dependencies.db.prepare(
                    'SELECT * FROM quotations WHERE id = ?'
                ).get(quotationId)
            );
            const inquiry = attachQuotationInquiry(quotationId, currentDraft, {
                dbAccessors: dependencies,
                auditContext,
            });
            return {
                data: { quotation },
                resource: { type: 'quotation', ids: [quotationId] },
                changes: [{
                    resourceType: 'quotation',
                    resourceId: quotationId,
                    field: 'created',
                    from: null,
                    to: {
                        status: quotation.status,
                        customerId: quotation.customerId,
                        totalPrice: quotation.totalPrice,
                    },
                }, ...inquiry.linkIds.map(linkId => ({
                    resourceType: 'factory_file_link',
                    resourceId: linkId,
                    field: 'created',
                    from: null,
                    to: { quotationId, relationRole: 'quotation_source' },
                }))],
                auditIds: [
                    ...(write.auditId ? [write.auditId] : []),
                    ...inquiry.auditIds,
                ],
                requiredAuditCount: 1 + inquiry.expectedAuditCount,
            };
        },
    });
}

function executeQuotationUpdate(
    dependencies,
    quotationIdValue,
    input = {},
    commandContext = {}
) {
    const quotationId = parsePositiveId(quotationIdValue);
    if (!quotationId) {
        throw quotationCommandError('quotation_id_invalid', '非法报价ID', 400);
    }
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const expectedPreviewHash = normalizePreviewHash(input.previewHash);
    const hasItems = input.items !== undefined || input.itemsJson !== undefined;
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: UPDATE_CAPABILITY_ID,
        businessChange: standardBusinessChange({ domain: 'quotation', eventType: 'updated' }),
        input: {
            quotationId,
            expectedUpdatedAt,
            previewHash: expectedPreviewHash,
            request: input,
        },
        warnings: [
            ...(commandContext.warnings || []),
            ...compatibilityWarnings({
                quotationId,
                expectedUpdatedAt,
                expectedPreviewHash,
                requirePreview: hasItems,
            }),
        ],
        execute: ({ auditContext }) => {
            const record = getQuotationRecord(dependencies.db, quotationId);
            assertExpectedUpdatedAt(
                record,
                expectedUpdatedAt,
                `报价 #${quotationId}`
            );
            if (record.converted_order_id || record.status === '已转订单') {
                throw quotationCommandError(
                    'quotation_already_converted',
                    '已转订单的报价不能再修改',
                    409
                );
            }
            let updates;
            if (hasItems) {
                if (!['草稿', '报价中'].includes(record.status)) {
                    throw quotationCommandError(
                        'quotation_core_update_status_conflict',
                        '只有草稿或报价中的报价可以修改核心明细',
                        409
                    );
                }
                const draft = normalizedSaveDraft(
                    dependencies,
                    {
                        customerId: input.customerId ?? record.customer_id,
                        items: input.items,
                        itemsJson: input.itemsJson,
                        remark: input.remark ?? record.remark,
                    },
                    record.status
                );
                assertPreviewHash(
                    expectedPreviewHash,
                    draft.previewHash,
                    '报价保存草稿所依据的配方、成本或输入已经变化，请重新预览'
                );
                updates = {
                    customer_id: draft.customerId,
                    status: draft.status,
                    items_json: draft.itemsJson,
                    total_cost: draft.totalCost,
                    total_price: draft.totalPrice,
                    remark: draft.remark,
                };
            } else {
                updates = {};
                if (input.status !== undefined) {
                    const status = String(input.status);
                    try {
                        assertQuotationTransition(record.status, status);
                    } catch (error) {
                        throw quotationCommandError(
                            'quotation_status_transition_conflict',
                            error.message,
                            409
                        );
                    }
                    updates.status = status;
                }
                if (input.remark !== undefined) {
                    updates.remark = String(input.remark || '');
                }
                if (Object.keys(updates).length === 0) {
                    return {
                        data: { quotation: dependencies.quotationRow(record) },
                        resource: { type: 'quotation', ids: [quotationId] },
                        changes: [],
                        auditIds: [],
                        requiredAuditCount: 0,
                        warnings: [{
                            code: 'quotation_update_noop',
                            message: '没有可保存的报价字段，未执行写入',
                        }],
                    };
                }
            }
            const write = dependencies.safeUpdate(
                'quotations',
                quotationId,
                updates,
                auditContext
            );
            const quotation = dependencies.quotationRow(
                dependencies.db.prepare(
                    'SELECT * FROM quotations WHERE id = ?'
                ).get(quotationId)
            );
            return {
                data: { quotation },
                resource: { type: 'quotation', ids: [quotationId] },
                changes: [{
                    resourceType: 'quotation',
                    resourceId: quotationId,
                    field: hasItems ? 'savePayload' : 'fields',
                    from: null,
                    to: Object.keys(updates),
                }],
                auditIds: write.auditId ? [write.auditId] : [],
                requiredAuditCount: 1,
            };
        },
    });
}

function executeQuotationStatus(
    dependencies,
    quotationIdValue,
    input = {},
    commandContext = {}
) {
    const quotationId = parsePositiveId(quotationIdValue);
    if (!quotationId) {
        throw quotationCommandError('quotation_id_invalid', '非法报价ID', 400);
    }
    const status = String(input.status || '');
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: STATUS_CAPABILITY_ID,
        businessChange: standardBusinessChange({ domain: 'quotation', eventType: 'status_changed' }),
        input: { quotationId, status, expectedUpdatedAt },
        warnings: [
            ...(commandContext.warnings || []),
            ...compatibilityWarnings({ quotationId, expectedUpdatedAt }),
        ],
        execute: ({ auditContext }) => {
            const record = getQuotationRecord(dependencies.db, quotationId);
            assertExpectedUpdatedAt(
                record,
                expectedUpdatedAt,
                `报价 #${quotationId}`
            );
            try {
                assertQuotationTransition(record.status, status);
            } catch (error) {
                throw quotationCommandError(
                    'quotation_status_transition_conflict',
                    error.message,
                    409
                );
            }
            const write = dependencies.safeUpdate(
                'quotations',
                quotationId,
                { status },
                auditContext
            );
            const quotation = dependencies.quotationRow(
                dependencies.db.prepare(
                    'SELECT * FROM quotations WHERE id = ?'
                ).get(quotationId)
            );
            return {
                data: { quotation },
                resource: { type: 'quotation', ids: [quotationId] },
                changes: [{
                    resourceType: 'quotation',
                    resourceId: quotationId,
                    field: 'status',
                    from: record.status,
                    to: status,
                }],
                auditIds: write.auditId ? [write.auditId] : [],
                requiredAuditCount: 1,
            };
        },
    });
}

function executeQuotationDelete(
    dependencies,
    quotationIdValue,
    input = {},
    commandContext = {}
) {
    const quotationId = parsePositiveId(quotationIdValue);
    if (!quotationId) {
        throw quotationCommandError('quotation_id_invalid', '非法报价ID', 400);
    }
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: DELETE_CAPABILITY_ID,
        businessChange: standardBusinessChange({ domain: 'quotation', eventType: 'deleted' }),
        input: { quotationId, expectedUpdatedAt },
        warnings: [
            ...(commandContext.warnings || []),
            ...compatibilityWarnings({ quotationId, expectedUpdatedAt }),
        ],
        execute: ({ auditContext }) => {
            const record = getQuotationRecord(dependencies.db, quotationId);
            assertExpectedUpdatedAt(
                record,
                expectedUpdatedAt,
                `报价 #${quotationId}`
            );
            if (!['草稿', '已拒绝', '已过时'].includes(record.status)) {
                throw quotationCommandError(
                    'quotation_delete_status_conflict',
                    '只有草稿、已拒绝或已过时报价可以删除',
                    409
                );
            }
            const deletedAt = new Date().toISOString();
            const write = dependencies.safeUpdate(
                'quotations',
                quotationId,
                { deleted_at: deletedAt },
                auditContext
            );
            return {
                data: { deleted: 1, quotationId, deletedAt },
                resource: { type: 'quotation', ids: [quotationId] },
                changes: [{
                    resourceType: 'quotation',
                    resourceId: quotationId,
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

module.exports = {
    CREATE_CAPABILITY_ID,
    DELETE_CAPABILITY_ID,
    STATUS_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID,
    executeQuotationCreate,
    executeQuotationDelete,
    executeQuotationStatus,
    executeQuotationUpdate,
};
