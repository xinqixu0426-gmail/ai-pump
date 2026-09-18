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
    archiveFactoryFile,
    deleteFactoryFileLink,
    inspectFactoryFileArchive,
} = require('./factoryFileArchive.cjs');
const { normalizeExpectedUpdatedAt } = require('./resourceVersion.cjs');

const ARCHIVE_CAPABILITY_ID = requireBusinessCapability('files.archive').capabilityId;
const LINK_DELETE_CAPABILITY_ID = requireBusinessCapability(
    'files.links.delete'
).capabilityId;

function factoryFileCommandError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function requireExplicitIdempotency(commandContext, label) {
    if ((commandContext.warnings || []).some(
        warning => warning.code === 'idempotency_key_missing_compatibility'
    )) {
        throw factoryFileCommandError(
            'idempotency_key_required',
            `${label}必须提供 Idempotency-Key 或 idempotencyKey`,
            400
        );
    }
}

function archiveSnapshot(inspection) {
    return {
        file: inspection.file,
        input: inspection.normalizedInput,
        target: inspection.target,
        targetId: inspection.targetId,
        targetUpdatedAt: inspection.targetUpdatedAt,
        knowledgeDocument: inspection.knowledgeDocument,
        link: inspection.link ? {
            id: inspection.link.id,
            updatedAt: inspection.link.updatedAt,
        } : null,
        deletedLink: inspection.deletedLink,
        action: inspection.action,
    };
}

function archivePreviewChanges(inspection) {
    if (inspection.action === 'deduplicated') return [];
    const changes = [];
    if (inspection.action === 'create_document_and_link') {
        changes.push({
            resourceType: 'knowledgeDocument',
            resourceId: null,
            field: 'created',
            from: null,
            to: {
                title: inspection.normalizedInput.title,
                documentType: inspection.normalizedInput.documentType,
            },
        });
    }
    changes.push({
        resourceType: 'factoryFileLink',
        resourceId: inspection.deletedLink?.id || null,
        field: inspection.action === 'restore_link' ? 'deletedAt' : 'created',
        from: inspection.action === 'restore_link'
            ? inspection.deletedLink.deletedAt
            : null,
        to: inspection.action === 'restore_link'
            ? null
            : {
                fileId: inspection.file.id,
                targetType: inspection.normalizedInput.targetType,
                targetId: inspection.targetId,
                relationRole: inspection.normalizedInput.relationRole,
            },
    });
    return changes;
}

function buildFactoryFileArchivePreview(
    dependencies,
    fileId,
    input = {},
    subject
) {
    const inspection = inspectFactoryFileArchive(fileId, input, {
        dbAccessors: dependencies,
    });
    const previewHash = requestHash(archiveSnapshot(inspection));
    const confirmation = issueBusinessConfirmation({
        capabilityId: ARCHIVE_CAPABILITY_ID,
        input: {
            fileId: inspection.file.id,
            archiveInput: inspection.normalizedInput,
            previewHash,
        },
        subject,
    });
    return {
        capabilityId: ARCHIVE_CAPABILITY_ID,
        ...confirmation,
        suggestedIdempotencyKey: `file-archive:${confirmation.operationId}`,
        previewHash,
        file: inspection.file,
        target: inspection.target,
        action: inspection.action,
        changes: archivePreviewChanges(inspection),
        warnings: inspection.action === 'deduplicated'
            ? [{
                code: 'file_link_already_exists',
                message: '该文件已经按相同角色关联到目标，执行不会重复创建记录',
            }]
            : [],
    };
}

function executeConfirmedFactoryFileArchive(
    dependencies,
    routeFileId,
    input = {},
    commandContext = {},
    subject
) {
    requireExplicitIdempotency(commandContext, '文件归档确认后');
    const confirmation = consumeBusinessConfirmation({
        confirmationToken: input.confirmationToken,
        capabilityId: ARCHIVE_CAPABILITY_ID,
        subject,
        idempotencyKey: commandContext.idempotencyKey,
    });
    if (Number(routeFileId) !== Number(confirmation.input.fileId)) {
        throw factoryFileCommandError(
            'confirmation_payload_mismatch',
            '确认凭证绑定的文件与当前路径不一致，请重新预览',
            409
        );
    }

    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: ARCHIVE_CAPABILITY_ID,
        businessChange: standardBusinessChange({ domain: 'file', eventType: 'updated' }),
        operationId: confirmation.operationId,
        input: confirmation.input,
        execute: ({ auditContext }) => {
            const inspection = inspectFactoryFileArchive(
                confirmation.input.fileId,
                confirmation.input.archiveInput,
                { dbAccessors: dependencies }
            );
            const currentHash = requestHash(archiveSnapshot(inspection));
            if (currentHash !== confirmation.input.previewHash) {
                throw factoryFileCommandError(
                    'factory_file_archive_preview_stale',
                    '文件、业务资料关联目标或现有关联在预览后已变化，请重新预览',
                    409
                );
            }
            const archived = archiveFactoryFile(
                inspection.file.id,
                confirmation.input.archiveInput,
                {
                    dbAccessors: dependencies,
                    auditContext,
                }
            );
            const changes = [];
            if (archived.knowledgeDocumentCreated) {
                changes.push({
                    resourceType: 'knowledgeDocument',
                    resourceId: archived.knowledgeDocument.id,
                    field: 'created',
                    from: null,
                    to: {
                        title: archived.knowledgeDocument.title,
                        documentType: archived.knowledgeDocument.documentType,
                    },
                });
            }
            if (archived.linkAction !== 'deduplicated') {
                changes.push({
                    resourceType: 'factoryFileLink',
                    resourceId: archived.link.id,
                    field: archived.linkAction === 'restored'
                        ? 'deletedAt'
                        : 'created',
                    from: archived.linkAction === 'restored'
                        ? inspection.deletedLink?.deletedAt || 'deleted'
                        : null,
                    to: archived.linkAction === 'restored'
                        ? null
                        : {
                            fileId: archived.link.fileId,
                            targetType: archived.link.targetType,
                            targetId: archived.link.targetId,
                            relationRole: archived.link.relationRole,
                        },
                });
            }
            return {
                data: {
                    link: archived.link,
                    knowledgeDocument: archived.knowledgeDocument,
                    deduplicated: archived.deduplicated,
                },
                resource: {
                    type: 'factoryFileArchive',
                    ids: [
                        archived.link.id,
                        ...(archived.knowledgeDocument
                            ? [archived.knowledgeDocument.id]
                            : []),
                    ],
                },
                changes,
                warnings: archived.deduplicated
                    ? [{
                        code: 'file_link_already_exists',
                        message: '该文件关联已存在，本次未重复写入',
                    }]
                    : [],
                auditIds: archived.auditIds,
                requiredAuditCount: changes.length,
            };
        },
    });
}

function executeFactoryFileLinkDelete(
    dependencies,
    fileId,
    linkId,
    input = {},
    commandContext = {}
) {
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: LINK_DELETE_CAPABILITY_ID,
        businessChange: standardBusinessChange({ domain: 'file', eventType: 'deleted' }),
        input: {
            fileId: Number(fileId),
            linkId: Number(linkId),
            expectedUpdatedAt,
        },
        warnings: [
            ...(commandContext.warnings || []),
            ...(!expectedUpdatedAt ? [{
                code: 'expected_updated_at_missing_compatibility',
                message: `文件关联 #${linkId} 未提供 expectedUpdatedAt，并发保护未启用`,
            }] : []),
        ],
        execute: ({ auditContext }) => {
            const deleted = deleteFactoryFileLink(fileId, linkId, {
                dbAccessors: dependencies,
                expectedUpdatedAt,
                auditContext,
            });
            return {
                data: {
                    deleted: 1,
                    fileId: Number(fileId),
                    linkId: Number(linkId),
                    deletedAt: deleted.deletedAt,
                },
                resource: {
                    type: 'factoryFileLink',
                    ids: [Number(linkId)],
                },
                changes: [{
                    resourceType: 'factoryFileLink',
                    resourceId: Number(linkId),
                    field: 'deletedAt',
                    from: null,
                    to: deleted.deletedAt,
                }],
                auditIds: deleted.auditId ? [deleted.auditId] : [],
                requiredAuditCount: 1,
            };
        },
    });
}

module.exports = {
    ARCHIVE_CAPABILITY_ID,
    LINK_DELETE_CAPABILITY_ID,
    buildFactoryFileArchivePreview,
    executeConfirmedFactoryFileArchive,
    executeFactoryFileLinkDelete,
};
