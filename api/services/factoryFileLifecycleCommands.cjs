const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const {
    beginPersistentExternalCommand,
    CommandExecutionError,
    executePersistentCommand,
    updatePersistentExternalCommand,
} = require('./commandExecution.cjs');
const {
    deleteFactoryFile,
    getFactoryFile,
    inspectFactoryFile,
    storeFactoryFile,
} = require('./factoryFileStore.cjs');
const { parseFactoryFile } = require('./factoryFileParser.cjs');
const {
    assertExpectedUpdatedAt,
    normalizeExpectedUpdatedAt,
} = require('./resourceVersion.cjs');

const UPLOAD_CAPABILITY_ID = requireBusinessCapability('files.upload').capabilityId;
const PARSE_CAPABILITY_ID = requireBusinessCapability('files.parse').capabilityId;
const DELETE_CAPABILITY_ID = requireBusinessCapability('files.delete').capabilityId;
const PARSE_LOCK_TIMEOUT_MS = 15 * 60 * 1000;

function fileLifecycleError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function validFileId(value) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) {
        throw fileLifecycleError('factory_file_id_invalid', '非法文件ID', 400);
    }
    return id;
}

function mapFileError(error, fallbackCode = 'factory_file_command_failed') {
    if (error instanceof CommandExecutionError) return error;
    return fileLifecycleError(
        fallbackCode,
        error?.message || '文件操作失败',
        Number(error?.statusCode) || 400
    );
}

function rawFactoryFile(dependencies, fileId) {
    return dependencies.db.prepare(`
        SELECT id, parser_status, updated_at
        FROM factory_files
        WHERE id = ? AND deleted_at IS NULL
    `).get(fileId);
}

function fileChange(fileId, field, from, to) {
    return {
        resourceType: 'factoryFile',
        resourceId: fileId,
        field,
        from,
        to,
    };
}

function executeFactoryFileUpload(
    dependencies,
    input = {},
    commandContext = {}
) {
    let inspected;
    try {
        inspected = inspectFactoryFile(input);
    } catch (error) {
        throw mapFileError(error, 'factory_file_upload_invalid');
    }
    const sourceType = String(input.sourceType || 'direct_upload');
    const commandInput = {
        originalName: inspected.originalName,
        detectedType: inspected.detectedType,
        mimeType: inspected.mimeType,
        fileSize: inspected.fileSize,
        fileSha256: inspected.fileSha256,
        sourceType,
    };
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: UPLOAD_CAPABILITY_ID,
        input: commandInput,
        warnings: commandContext.warnings || [],
        execute: ({ auditContext }) => {
            let stored;
            try {
                stored = storeFactoryFile({
                    ...input,
                    sourceType,
                }, {
                    dbAccessors: dependencies,
                    auditContext,
                });
            } catch (error) {
                throw mapFileError(error, 'factory_file_upload_failed');
            }
            const file = stored.file;
            return {
                data: {
                    ...file,
                    deduplicated: stored.deduplicated,
                },
                resource: { type: 'factoryFile', ids: [file.id] },
                changes: [
                    fileChange(
                        file.id,
                        stored.deduplicated ? 'duplicateCount' : 'created',
                        stored.deduplicated ? Math.max(1, file.duplicateCount - 1) : null,
                        stored.deduplicated ? file.duplicateCount : true
                    ),
                ],
                auditIds: stored.auditIds,
                requiredAuditCount: 1,
            };
        },
    });
}

function operationAuditIds(dependencies, operationId) {
    return dependencies.db.prepare(`
        SELECT id
        FROM audit_log
        WHERE operation_id = ? AND capability_id = ?
        ORDER BY id
    `).all(operationId, PARSE_CAPABILITY_ID)
        .map(row => Number(row.id))
        .filter(id => Number.isInteger(id) && id > 0);
}

function parseReplayError(receipt) {
    const error = fileLifecycleError(
        receipt.errorCode || 'factory_file_parse_failed',
        receipt.error || '文件解析失败',
        Number(receipt.errorStatusCode) || 400
    );
    error.receipt = receipt;
    return error;
}

async function executeFactoryFileParse(
    dependencies,
    id,
    input = {},
    commandContext = {}
) {
    const fileId = validFileId(id);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const started = beginPersistentExternalCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: PARSE_CAPABILITY_ID,
        input: { fileId, expectedUpdatedAt },
        warnings: [
            ...(commandContext.warnings || []),
            ...(!expectedUpdatedAt ? [{
                code: 'resource_version_missing_compatibility',
                message: '兼容调用未提供 expectedUpdatedAt；建议刷新文件版本后再重新解析',
            }] : []),
        ],
        execute: ({ auditContext }) => {
            const row = rawFactoryFile(dependencies, fileId);
            if (!row) {
                throw fileLifecycleError(
                    'factory_file_not_found',
                    '文件不存在',
                    404
                );
            }
            assertExpectedUpdatedAt(row, expectedUpdatedAt, '文件');
            const updatedAtMs = Date.parse(row.updated_at || '');
            if (
                row.parser_status === 'processing'
                && Number.isFinite(updatedAtMs)
                && Date.now() - updatedAtMs < PARSE_LOCK_TIMEOUT_MS
            ) {
                throw fileLifecycleError(
                    'factory_file_parse_in_progress',
                    '文件正在解析，请稍后使用原 idempotencyKey 查询结果',
                    409
                );
            }
            const now = new Date().toISOString();
            const write = dependencies.safeUpdate(
                'factory_files',
                fileId,
                {
                    parser_status: 'processing',
                    parser_error: '',
                    updated_at: now,
                },
                auditContext
            );
            return {
                data: {
                    id: fileId,
                    parserStatus: 'processing',
                    updatedAt: now,
                },
                resource: { type: 'factoryFile', ids: [fileId] },
                changes: [
                    fileChange(fileId, 'parserStatus', row.parser_status, 'processing'),
                ],
                auditIds: write?.auditId ? [write.auditId] : [],
                requiredAuditCount: 1,
            };
        },
    });
    if (!started.shouldExecute) {
        if (started.receipt.status === 'failed') {
            throw parseReplayError(started.receipt);
        }
        const getFile = dependencies.getFactoryFile || getFactoryFile;
        const current = getFile(fileId, { dbAccessors: dependencies });
        const currentStatus = current?.parserStatus;
        if (['parsed', 'metadata_only', 'failed'].includes(currentStatus)) {
            const auditIds = operationAuditIds(
                dependencies,
                started.receipt.operationId
            );
            const terminalStatus = currentStatus === 'failed'
                ? 'failed'
                : 'completed';
            const recovered = updatePersistentExternalCommand({
                db: dependencies.db,
                operationId: started.receipt.operationId,
                status: terminalStatus,
                terminal: true,
                data: {
                    ...current,
                    resource: { type: 'factoryFile', ids: [fileId] },
                    changes: [
                        ...(started.receipt.changes || []),
                        fileChange(
                            fileId,
                            'parserStatus',
                            'processing',
                            currentStatus
                        ),
                    ],
                    warnings: [
                        ...(started.receipt.warnings || []),
                        {
                            code: 'parse_receipt_recovered',
                            message: '已根据当前文件状态恢复解析终态回执',
                        },
                    ],
                    auditId: auditIds[0] || started.receipt.auditId || null,
                    auditIds: auditIds.length > 0
                        ? auditIds
                        : (started.receipt.auditIds || []),
                    idempotentReplay: true,
                    ...(terminalStatus === 'failed' ? {
                        errorCode: 'factory_file_parse_failed',
                        errorStatusCode: 400,
                        error: current?.parserError || '文件解析失败',
                        message: '文件解析失败',
                    } : {
                        message: '文件解析完成',
                    }),
                },
            });
            if (terminalStatus === 'failed') throw parseReplayError(recovered);
            return recovered;
        }
        const updatedAtMs = Date.parse(current?.updatedAt || '');
        const parseLockFresh = currentStatus === 'processing'
            && Number.isFinite(updatedAtMs)
            && Date.now() - updatedAtMs < PARSE_LOCK_TIMEOUT_MS;
        if (parseLockFresh) {
            return updatePersistentExternalCommand({
                db: dependencies.db,
                operationId: started.receipt.operationId,
                status: 'processing',
                terminal: false,
                data: {
                    ...current,
                    idempotentReplay: true,
                },
            });
        }
        if (currentStatus !== 'processing') {
            return started.receipt;
        }
    }

    const activeReceipt = updatePersistentExternalCommand({
        db: dependencies.db,
        operationId: started.receipt.operationId,
        status: 'processing',
        terminal: false,
        data: {
            parserStatus: 'processing',
            idempotentReplay: !started.shouldExecute,
        },
    });
    const auditIds = operationAuditIds(
        dependencies,
        activeReceipt.operationId
    );
    const auditContext = {
        requireAudit: true,
        user: commandContext.actorKey,
        requestId: commandContext.requestId || null,
        operationId: activeReceipt.operationId,
        capabilityId: PARSE_CAPABILITY_ID,
    };
    const parse = dependencies.parseFactoryFile || parseFactoryFile;
    const getFile = dependencies.getFactoryFile || getFactoryFile;
    try {
        await parse(fileId, {
            dbAccessors: dependencies,
            skipProcessingWrite: true,
            transactionalWrites: true,
            auditContext,
            onWrite: write => {
                if (write?.auditId) auditIds.push(Number(write.auditId));
            },
        });
        const file = getFile(fileId, { dbAccessors: dependencies });
        return updatePersistentExternalCommand({
            db: dependencies.db,
            operationId: activeReceipt.operationId,
            status: 'completed',
            terminal: true,
            data: {
                ...file,
                resource: { type: 'factoryFile', ids: [fileId] },
                changes: [
                    ...(activeReceipt.changes || []),
                    fileChange(fileId, 'parserStatus', 'processing', file?.parserStatus),
                ],
                auditId: auditIds[0] || null,
                auditIds: [...new Set(auditIds)],
                idempotentReplay: !started.shouldExecute,
                message: '文件解析完成',
            },
        });
    } catch (error) {
        const mapped = mapFileError(error, 'factory_file_parse_failed');
        const file = getFile(fileId, { dbAccessors: dependencies });
        const receipt = updatePersistentExternalCommand({
            db: dependencies.db,
            operationId: activeReceipt.operationId,
            status: 'failed',
            terminal: true,
            data: {
                ...file,
                resource: { type: 'factoryFile', ids: [fileId] },
                changes: [
                    ...(activeReceipt.changes || []),
                    fileChange(fileId, 'parserStatus', 'processing', 'failed'),
                ],
                auditId: auditIds[0] || null,
                auditIds: [...new Set(auditIds)],
                idempotentReplay: !started.shouldExecute,
                errorCode: mapped.code,
                errorStatusCode: mapped.statusCode,
                error: mapped.message,
                message: '文件解析失败',
            },
        });
        mapped.receipt = receipt;
        throw mapped;
    }
}

function executeFactoryFileDelete(
    dependencies,
    id,
    input = {},
    commandContext = {}
) {
    const fileId = validFileId(id);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        capabilityId: DELETE_CAPABILITY_ID,
        input: { fileId, expectedUpdatedAt },
        warnings: [
            ...(commandContext.warnings || []),
            ...(!expectedUpdatedAt ? [{
                code: 'resource_version_missing_compatibility',
                message: '兼容调用未提供 expectedUpdatedAt；本次仍执行引用检查和软删除',
            }] : []),
        ],
        execute: ({ auditContext }) => {
            const row = rawFactoryFile(dependencies, fileId);
            if (!row) {
                throw fileLifecycleError(
                    'factory_file_not_found',
                    '文件不存在',
                    404
                );
            }
            assertExpectedUpdatedAt(row, expectedUpdatedAt, '文件');
            let deleted;
            try {
                deleted = deleteFactoryFile(fileId, {
                    dbAccessors: dependencies,
                    auditContext,
                });
            } catch (error) {
                throw mapFileError(error, 'factory_file_delete_failed');
            }
            return {
                data: deleted,
                resource: { type: 'factoryFile', ids: [fileId] },
                changes: [
                    fileChange(fileId, 'deletedAt', null, 'soft-deleted'),
                ],
                auditIds: deleted.auditIds,
                requiredAuditCount: 1,
            };
        },
    });
}

module.exports = {
    DELETE_CAPABILITY_ID,
    PARSE_CAPABILITY_ID,
    PARSE_LOCK_TIMEOUT_MS,
    UPLOAD_CAPABILITY_ID,
    executeFactoryFileDelete,
    executeFactoryFileParse,
    executeFactoryFileUpload,
};
