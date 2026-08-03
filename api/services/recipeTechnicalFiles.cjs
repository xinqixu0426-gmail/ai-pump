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
const { parsePositiveId } = require('./validation.cjs');

const UPLOAD_CAPABILITY_ID = requireBusinessCapability(
    'recipes.technical_files.upload'
).capabilityId;
const DELETE_CAPABILITY_ID = requireBusinessCapability(
    'recipes.technical_files.delete'
).capabilityId;
const ALLOWED_EXTENSIONS = new Set(['.xls', '.xlsx']);

function technicalFileError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function parseJsonObject(value) {
    try {
        const parsed = JSON.parse(value || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : {};
    } catch {
        return {};
    }
}

function technicalFileResponse(row, recipeTechnicalFileRow) {
    const file = recipeTechnicalFileRow(row);
    return {
        id: file.id,
        recipeId: file.recipeId,
        fileId: file.fileId,
        originalName: file.originalName,
        mimeType: file.mimeType,
        fileSize: file.fileSize,
        fileSha256: file.fileSha256,
        reportType: file.reportType,
        summary: parseJsonObject(file.summaryJson),
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
    };
}

function getRecipeRecord(db, recipeId) {
    const row = db.prepare(`
        SELECT id, updated_at
        FROM recipes
        WHERE id = ? AND deleted_at IS NULL
    `).get(recipeId);
    if (!row) throw technicalFileError('recipe_not_found', '配方不存在', 404);
    return row;
}

function getTechnicalFileRecord(db, recipeId, fileId) {
    const row = db.prepare(`
        SELECT *
        FROM recipe_technical_files
        WHERE id = ? AND recipe_id = ? AND deleted_at IS NULL
    `).get(fileId, recipeId);
    if (!row) {
        throw technicalFileError(
            'recipe_technical_file_not_found',
            '测试报告不存在',
            404
        );
    }
    return row;
}

function normalizeRecipeId(value) {
    const recipeId = parsePositiveId(value);
    if (!recipeId) {
        throw technicalFileError('recipe_id_invalid', '非法配方ID', 400);
    }
    return recipeId;
}

function normalizeTechnicalFileId(value) {
    const fileId = parsePositiveId(value);
    if (!fileId) {
        throw technicalFileError(
            'recipe_technical_file_id_invalid',
            '非法测试报告ID',
            400
        );
    }
    return fileId;
}

function buildCompatibilityWarnings(expectedUpdatedAt, label) {
    if (expectedUpdatedAt) return [];
    return [{
        code: 'expected_updated_at_missing_compatibility',
        message: `${label}未提供 expectedUpdatedAt，并发保护未启用`,
    }];
}

function listRecipeTechnicalFiles(dependencies, recipeIdValue) {
    const recipeId = normalizeRecipeId(recipeIdValue);
    getRecipeRecord(dependencies.db, recipeId);
    return dependencies.db.prepare(`
        SELECT id, recipe_id, file_id, original_name, mime_type, file_size,
               file_sha256, report_type, summary_json, parsed_json,
               extracted_text, created_at, updated_at
        FROM recipe_technical_files
        WHERE recipe_id = ? AND deleted_at IS NULL
        ORDER BY id DESC
    `).all(recipeId).map(row => technicalFileResponse(
        row,
        dependencies.recipeTechnicalFileRow
    ));
}

function getRecipeTechnicalFileDownload(
    dependencies,
    recipeIdValue,
    fileIdValue
) {
    const recipeId = normalizeRecipeId(recipeIdValue);
    const fileId = normalizeTechnicalFileId(fileIdValue);
    getRecipeRecord(dependencies.db, recipeId);
    const row = dependencies.db.prepare(`
        SELECT r.original_name,
               COALESCE(f.mime_type, r.mime_type) AS mime_type,
               COALESCE(f.file_blob, r.file_blob) AS file_blob
        FROM recipe_technical_files r
        LEFT JOIN factory_files f
          ON f.id = r.file_id AND f.deleted_at IS NULL
        WHERE r.id = ? AND r.recipe_id = ? AND r.deleted_at IS NULL
    `).get(fileId, recipeId);
    if (!row) {
        throw technicalFileError(
            'recipe_technical_file_not_found',
            '测试报告不存在',
            404
        );
    }
    return {
        originalName: row.original_name,
        mimeType: row.mime_type || 'application/octet-stream',
        buffer: row.file_blob,
    };
}

function executeRecipeTechnicalFileUpload(
    dependencies,
    recipeIdValue,
    input = {},
    commandContext = {}
) {
    const recipeId = normalizeRecipeId(recipeIdValue);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    const inspected = dependencies.inspectFactoryFile({
        buffer: input.buffer,
        originalName: input.originalName,
        mimeType: input.mimeType,
    });
    if (!ALLOWED_EXTENSIONS.has(path.extname(inspected.originalName).toLowerCase())) {
        throw technicalFileError(
            'recipe_technical_file_type_invalid',
            '只支持 .xls 和 .xlsx 测试报告',
            400
        );
    }
    const report = dependencies.parsePumpTestReport(
        input.buffer,
        inspected.originalName
    );

    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        input: {
            recipeId,
            expectedUpdatedAt,
            originalName: inspected.originalName,
            mimeType: inspected.mimeType,
            fileSize: inspected.fileSize,
            fileSha256: inspected.fileSha256,
        },
        warnings: [
            ...(commandContext.warnings || []),
            ...buildCompatibilityWarnings(
                expectedUpdatedAt,
                `配方 #${recipeId}`
            ),
        ],
        execute: ({ auditContext }) => {
            const recipe = getRecipeRecord(dependencies.db, recipeId);
            assertExpectedUpdatedAt(
                recipe,
                expectedUpdatedAt,
                `配方 #${recipeId}`
            );
            const existing = dependencies.db.prepare(`
                SELECT *
                FROM recipe_technical_files
                WHERE recipe_id = ?
                  AND file_sha256 = ?
                  AND deleted_at IS NULL
                ORDER BY id DESC
                LIMIT 1
            `).get(recipeId, inspected.fileSha256);
            if (existing) {
                return {
                    data: {
                        technicalFile: technicalFileResponse(
                            existing,
                            dependencies.recipeTechnicalFileRow
                        ),
                        deduplicated: true,
                    },
                    resource: {
                        type: 'recipeTechnicalFile',
                        ids: [Number(existing.id)],
                    },
                    changes: [],
                    warnings: [{
                        code: 'recipe_technical_file_already_attached',
                        message: '相同测试报告已关联到该配方，返回现有记录',
                    }],
                    auditIds: [],
                    requiredAuditCount: 0,
                };
            }

            const now = new Date().toISOString();
            const stored = dependencies.storeFactoryFile({
                buffer: input.buffer,
                originalName: inspected.originalName,
                mimeType: inspected.mimeType,
                sourceType: 'recipe_technical_file',
                parserStatus: 'parsed',
                now,
            }, {
                auditContext,
            });
            const write = dependencies.safeInsert(
                'recipe_technical_files',
                {
                    recipe_id: recipeId,
                    file_id: stored.file.id,
                    original_name: inspected.originalName,
                    mime_type: stored.file.mimeType,
                    file_size: stored.file.fileSize,
                    file_sha256: stored.file.fileSha256,
                    file_blob: input.buffer,
                    report_type: 'pump_performance_test',
                    summary_json: JSON.stringify(report.summary),
                    parsed_json: JSON.stringify(report.parsed),
                    extracted_text: report.extractedText,
                    created_at: now,
                    updated_at: now,
                },
                auditContext
            );
            const fileId = Number(write.lastInsertRowid);
            const row = getTechnicalFileRecord(
                dependencies.db,
                recipeId,
                fileId
            );
            const auditIds = [
                ...(stored.auditIds || []),
                ...(write.auditId ? [write.auditId] : []),
            ];
            return {
                data: {
                    technicalFile: technicalFileResponse(
                        row,
                        dependencies.recipeTechnicalFileRow
                    ),
                    deduplicated: Boolean(stored.deduplicated),
                },
                resource: {
                    type: 'recipeTechnicalFile',
                    ids: [fileId],
                    parent: { type: 'recipe', id: recipeId },
                },
                changes: [{
                    resourceType: 'recipeTechnicalFile',
                    resourceId: fileId,
                    field: 'created',
                    from: null,
                    to: {
                        recipeId,
                        fileSha256: inspected.fileSha256,
                        originalName: inspected.originalName,
                    },
                }],
                auditIds,
                requiredAuditCount: 1 + (stored.auditIds || []).length,
            };
        },
    });
}

function executeRecipeTechnicalFileDelete(
    dependencies,
    recipeIdValue,
    fileIdValue,
    input = {},
    commandContext = {}
) {
    const recipeId = normalizeRecipeId(recipeIdValue);
    const fileId = normalizeTechnicalFileId(fileIdValue);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );

    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        input: {
            recipeId,
            fileId,
            expectedUpdatedAt,
        },
        warnings: [
            ...(commandContext.warnings || []),
            ...buildCompatibilityWarnings(
                expectedUpdatedAt,
                `测试报告 #${fileId}`
            ),
        ],
        execute: ({ auditContext }) => {
            getRecipeRecord(dependencies.db, recipeId);
            const current = getTechnicalFileRecord(
                dependencies.db,
                recipeId,
                fileId
            );
            assertExpectedUpdatedAt(
                current,
                expectedUpdatedAt,
                `测试报告 #${fileId}`
            );
            const deletedAt = new Date().toISOString();
            const write = dependencies.safeUpdate(
                'recipe_technical_files',
                fileId,
                { deleted_at: deletedAt },
                auditContext
            );
            return {
                data: {
                    deleted: 1,
                    recipeId,
                    technicalFileId: fileId,
                    deletedAt,
                },
                resource: {
                    type: 'recipeTechnicalFile',
                    ids: [fileId],
                    parent: { type: 'recipe', id: recipeId },
                },
                changes: [{
                    resourceType: 'recipeTechnicalFile',
                    resourceId: fileId,
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
    DELETE_CAPABILITY_ID,
    UPLOAD_CAPABILITY_ID,
    executeRecipeTechnicalFileDelete,
    executeRecipeTechnicalFileUpload,
    getRecipeTechnicalFileDownload,
    listRecipeTechnicalFiles,
    technicalFileResponse,
};
