const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
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
    buildFcParams,
    normalizeDrawingName,
} = require('./rotorParameters.cjs');
const { parsePositiveId } = require('./validation.cjs');

const SAVE_CAPABILITY_ID = requireBusinessCapability(
    'drawings.rotor.save_parameters'
).capabilityId;
const RENAME_CAPABILITY_ID = requireBusinessCapability(
    'drawings.rotor.rename_history'
).capabilityId;
const LINK_CAPABILITY_ID = requireBusinessCapability(
    'drawings.rotor.link_history'
).capabilityId;
const DELETE_CAPABILITY_ID = requireBusinessCapability(
    'drawings.rotor.delete_history'
).capabilityId;

function rotorCommandError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function normalizeHistoryId(value) {
    const historyId = parsePositiveId(value);
    if (!historyId) {
        throw rotorCommandError(
            'rotor_history_id_invalid',
            '非法记录ID',
            400
        );
    }
    return historyId;
}

function getHistoryRecord(db, historyId) {
    const row = db.prepare(
        'SELECT * FROM rotor_drawings WHERE id = ?'
    ).get(historyId);
    if (!row) {
        throw rotorCommandError(
            'rotor_history_not_found',
            '记录不存在',
            404
        );
    }
    return row;
}

function buildCompatibilityWarnings(expectedUpdatedAt, historyId) {
    if (expectedUpdatedAt) return [];
    return [{
        code: 'expected_updated_at_missing_compatibility',
        message: `转子出图记录 #${historyId} 未提供 expectedUpdatedAt，并发保护未启用`,
    }];
}

function commandParams(input = {}) {
    const {
        idempotencyKey: _idempotencyKey,
        expectedUpdatedAt: _expectedUpdatedAt,
        ...params
    } = input;
    return params;
}

function validateRotorParams(input = {}) {
    const params = commandParams(input);
    if (!params || Object.keys(params).length === 0) {
        throw rotorCommandError(
            'rotor_parameters_missing',
            '缺少参数，请至少提供一项转子参数',
            400
        );
    }
    const built = buildFcParams(params);
    if (built.errors.length > 0) {
        throw rotorCommandError(
            'rotor_parameters_invalid',
            built.errors.join('; '),
            400
        );
    }
    if (Object.keys(built.fcParams).filter(key => !key.startsWith('_')).length === 0) {
        throw rotorCommandError(
            'rotor_parameters_empty',
            '未提取到有效参数',
            400
        );
    }
    return { params, fcParams: built.fcParams };
}

function executeRotorParameterSave(
    dependencies,
    input = {},
    commandContext = {}
) {
    const normalized = validateRotorParams(input);
    const drawingName = normalizeDrawingName(
        input.drawingName ?? input.drawing_name,
        '暂存转子参数'
    );

    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        input: {
            params: normalized.params,
            drawingName,
            fcParams: normalized.fcParams,
        },
        warnings: commandContext.warnings || [],
        execute: ({ auditContext }) => {
            const jobId = `saved-${crypto.randomUUID()}`;
            const now = new Date().toISOString();
            const write = dependencies.safeInsert(
                'rotor_drawings',
                {
                    job_id: jobId,
                    drawing_name: drawingName,
                    nl_input: `[SAVED] ${JSON.stringify(normalized.params)}`,
                    params_json: JSON.stringify(normalized.params),
                    fc_params_json: JSON.stringify(normalized.fcParams),
                    status: 'saved',
                    created_at: now,
                    updated_at: now,
                },
                auditContext
            );
            const historyId = Number(write.lastInsertRowid);
            return {
                data: {
                    historyId,
                    jobId,
                    drawingName,
                    params: normalized.fcParams,
                    updatedAt: now,
                },
                resource: {
                    type: 'rotorDrawing',
                    ids: [historyId],
                },
                changes: [{
                    resourceType: 'rotorDrawing',
                    resourceId: historyId,
                    field: 'created',
                    from: null,
                    to: {
                        jobId,
                        drawingName,
                        status: 'saved',
                    },
                }],
                auditIds: write.auditId ? [write.auditId] : [],
                requiredAuditCount: 1,
            };
        },
    });
}

function executeRotorHistoryRename(
    dependencies,
    historyIdValue,
    input = {},
    commandContext = {}
) {
    const historyId = normalizeHistoryId(historyIdValue);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt
    );
    const drawingName = normalizeDrawingName(
        input.drawingName ?? input.drawing_name
    );

    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        input: { historyId, drawingName, expectedUpdatedAt },
        warnings: [
            ...(commandContext.warnings || []),
            ...buildCompatibilityWarnings(expectedUpdatedAt, historyId),
        ],
        execute: ({ auditContext }) => {
            const current = getHistoryRecord(dependencies.db, historyId);
            assertExpectedUpdatedAt(
                current,
                expectedUpdatedAt,
                `转子出图记录 #${historyId}`
            );
            const write = dependencies.safeUpdate(
                'rotor_drawings',
                historyId,
                { drawing_name: drawingName },
                auditContext
            );
            const updated = getHistoryRecord(dependencies.db, historyId);
            return {
                data: {
                    history: dependencies.rotorHistoryRow(updated),
                    drawingName,
                },
                resource: {
                    type: 'rotorDrawing',
                    ids: [historyId],
                },
                changes: [{
                    resourceType: 'rotorDrawing',
                    resourceId: historyId,
                    field: 'drawingName',
                    from: current.drawing_name || '',
                    to: drawingName,
                }],
                auditIds: write.auditId ? [write.auditId] : [],
                requiredAuditCount: 1,
            };
        },
    });
}

function executeRotorHistoryLink(
    dependencies,
    historyIdValue,
    input = {},
    commandContext = {}
) {
    const historyId = normalizeHistoryId(historyIdValue);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt
    );
    const rawValue = input.linkedPumpModel ?? input.linked_pump_model;
    if (typeof rawValue !== 'string') {
        throw rotorCommandError(
            'linked_pump_model_missing',
            '缺少 linkedPumpModel 参数',
            400
        );
    }
    const linkedPumpModel = rawValue.trim().slice(0, 200);

    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        input: { historyId, linkedPumpModel, expectedUpdatedAt },
        warnings: [
            ...(commandContext.warnings || []),
            ...buildCompatibilityWarnings(expectedUpdatedAt, historyId),
        ],
        execute: ({ auditContext }) => {
            const current = getHistoryRecord(dependencies.db, historyId);
            assertExpectedUpdatedAt(
                current,
                expectedUpdatedAt,
                `转子出图记录 #${historyId}`
            );
            const write = dependencies.safeUpdate(
                'rotor_drawings',
                historyId,
                { linked_pump_model: linkedPumpModel },
                auditContext
            );
            const updated = getHistoryRecord(dependencies.db, historyId);
            return {
                data: {
                    history: dependencies.rotorHistoryRow(updated),
                    linkedPumpModel,
                },
                resource: {
                    type: 'rotorDrawing',
                    ids: [historyId],
                },
                changes: [{
                    resourceType: 'rotorDrawing',
                    resourceId: historyId,
                    field: 'linkedPumpModel',
                    from: current.linked_pump_model || '',
                    to: linkedPumpModel,
                }],
                auditIds: write.auditId ? [write.auditId] : [],
                requiredAuditCount: 1,
            };
        },
    });
}

function resolveDrawingFile(publicDir, fileUrl) {
    const normalizedUrl = String(fileUrl || '').replace(/\\/g, '/');
    if (!/^\/drawings\/[^/]+$/.test(normalizedUrl)) return null;
    const drawingsRoot = path.resolve(publicDir, 'drawings');
    const filePath = path.resolve(drawingsRoot, path.basename(normalizedUrl));
    if (!filePath.startsWith(`${drawingsRoot}${path.sep}`)) return null;
    return filePath;
}

function cleanupDrawingFile(publicDir, fileUrl, fileSystem = fs) {
    if (!fileUrl) return { status: 'not_applicable' };
    const filePath = resolveDrawingFile(publicDir, fileUrl);
    if (!filePath) {
        return {
            status: 'skipped',
            warning: {
                code: 'rotor_file_path_rejected',
                message: '历史文件路径不在受控 drawings 目录，已跳过物理文件清理',
            },
        };
    }
    try {
        if (!fileSystem.existsSync(filePath)) {
            return { status: 'already_absent' };
        }
        fileSystem.unlinkSync(filePath);
        return { status: 'deleted' };
    } catch (error) {
        return {
            status: 'failed',
            warning: {
                code: 'rotor_file_cleanup_failed',
                message: `数据库记录已删除，但 PDF 清理失败：${error.message}`,
            },
        };
    }
}

function executeRotorHistoryDelete(
    dependencies,
    historyIdValue,
    input = {},
    commandContext = {}
) {
    const historyId = normalizeHistoryId(historyIdValue);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt
    );
    const receipt = executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        input: { historyId, expectedUpdatedAt },
        warnings: [
            ...(commandContext.warnings || []),
            ...buildCompatibilityWarnings(expectedUpdatedAt, historyId),
        ],
        execute: ({ auditContext }) => {
            const current = getHistoryRecord(dependencies.db, historyId);
            assertExpectedUpdatedAt(
                current,
                expectedUpdatedAt,
                `转子出图记录 #${historyId}`
            );
            const write = dependencies.hardDelete(
                'rotor_drawings',
                historyId,
                auditContext
            );
            return {
                data: {
                    deleted: 1,
                    historyId,
                    jobId: current.job_id,
                    fileUrl: current.file_url || '',
                },
                resource: {
                    type: 'rotorDrawing',
                    ids: [historyId],
                },
                changes: [{
                    resourceType: 'rotorDrawing',
                    resourceId: historyId,
                    field: 'deleted',
                    from: {
                        jobId: current.job_id,
                        fileUrl: current.file_url || '',
                    },
                    to: true,
                }],
                auditIds: write.auditId ? [write.auditId] : [],
                requiredAuditCount: 1,
            };
        },
    });

    const fileCleanup = cleanupDrawingFile(
        dependencies.publicDir,
        receipt.fileUrl,
        dependencies.fileSystem || fs
    );
    return {
        ...receipt,
        fileCleanup: fileCleanup.status,
        warnings: [
            ...(receipt.warnings || []),
            ...(fileCleanup.warning ? [fileCleanup.warning] : []),
        ],
    };
}

module.exports = {
    DELETE_CAPABILITY_ID,
    LINK_CAPABILITY_ID,
    RENAME_CAPABILITY_ID,
    SAVE_CAPABILITY_ID,
    cleanupDrawingFile,
    executeRotorHistoryDelete,
    executeRotorHistoryLink,
    executeRotorHistoryRename,
    executeRotorParameterSave,
    resolveDrawingFile,
};
