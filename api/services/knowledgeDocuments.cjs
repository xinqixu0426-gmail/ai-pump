const crypto = require('node:crypto');
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
    'knowledge.documents.upload'
).capabilityId;
const DELETE_CAPABILITY_ID = requireBusinessCapability(
    'knowledge.documents.delete'
).capabilityId;
const DOCUMENT_TYPES = new Set([
    'technical_note',
    'pump_performance_test',
    'drawing',
    'spreadsheet',
    'other',
]);

function knowledgeDocumentError(code, message, statusCode = 409) {
    return new CommandExecutionError(code, message, statusCode);
}

function parseTags(value) {
    let items = [];
    if (Array.isArray(value)) {
        items = value;
    } else {
        try {
            const parsed = JSON.parse(value || '[]');
            items = Array.isArray(parsed) ? parsed : [];
        } catch {
            items = String(value || '').split(/[,，\n]/);
        }
    }
    return [...new Set(
        items.map(item => String(item || '').trim()).filter(Boolean)
    )].slice(0, 30);
}

function parseJson(value, fallback) {
    try {
        const parsed = JSON.parse(value || '');
        return parsed ?? fallback;
    } catch {
        return fallback;
    }
}

function knowledgeDocumentResponse(row, knowledgeDocumentRow) {
    const document = knowledgeDocumentRow(row);
    const tags = parseJson(document.tagsJson, []);
    const metadata = parseJson(document.metadataJson, {});
    return {
        id: document.id,
        fileId: document.fileId,
        documentType: document.documentType,
        title: document.title,
        description: document.description,
        contentText: document.contentText,
        tags: Array.isArray(tags) ? tags : [],
        originalName: document.originalName,
        mimeType: document.mimeType,
        fileSize: document.fileSize,
        fileSha256: document.fileSha256,
        parserStatus: document.parserStatus,
        metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata)
            ? metadata
            : {},
        downloadPath: document.originalName
            ? `/api/knowledge/documents/${document.id}/download`
            : '',
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
    };
}

function normalizeDocumentId(value) {
    const id = parsePositiveId(value);
    if (!id) {
        throw knowledgeDocumentError(
            'knowledge_document_id_invalid',
            '非法资料ID',
            400
        );
    }
    return id;
}

function getKnowledgeDocumentRecord(db, idValue) {
    const id = normalizeDocumentId(idValue);
    const row = db.prepare(`
        SELECT *
        FROM knowledge_documents
        WHERE id = ? AND deleted_at IS NULL
    `).get(id);
    if (!row) {
        throw knowledgeDocumentError(
            'knowledge_document_not_found',
            '资料不存在',
            404
        );
    }
    return row;
}

function listKnowledgeDocuments(dependencies) {
    return dependencies.db.prepare(`
        SELECT id, file_id, document_type, title, description, tags_json,
               original_name, mime_type, file_size, file_sha256,
               parser_status, metadata_json, created_at, updated_at
        FROM knowledge_documents
        WHERE deleted_at IS NULL
        ORDER BY updated_at DESC, id DESC
    `).all().map(row => knowledgeDocumentResponse(
        row,
        dependencies.knowledgeDocumentRow
    ));
}

function getKnowledgeDocumentDownload(dependencies, idValue) {
    const id = normalizeDocumentId(idValue);
    const row = dependencies.db.prepare(`
        SELECT d.original_name,
               COALESCE(f.mime_type, d.mime_type) AS mime_type,
               COALESCE(f.file_blob, d.file_blob) AS file_blob
        FROM knowledge_documents d
        LEFT JOIN factory_files f
          ON f.id = d.file_id AND f.deleted_at IS NULL
        WHERE d.id = ? AND d.deleted_at IS NULL
    `).get(id);
    if (!row || !row.file_blob) {
        throw knowledgeDocumentError(
            'knowledge_document_file_not_found',
            '资料文件不存在',
            404
        );
    }
    return {
        originalName: row.original_name,
        mimeType: row.mime_type || 'application/octet-stream',
        buffer: row.file_blob,
    };
}

function normalizeUpload(dependencies, input = {}) {
    const title = String(input.title || '').trim();
    const description = String(input.description || '').trim();
    const contentText = String(input.contentText || '').trim();
    const documentType = String(input.documentType || 'technical_note').trim();
    const tags = parseTags(input.tags);
    if (!title) {
        throw knowledgeDocumentError(
            'knowledge_document_title_required',
            '资料标题不能为空',
            400
        );
    }
    if (title.length > 200) {
        throw knowledgeDocumentError(
            'knowledge_document_title_too_long',
            '资料标题不能超过 200 字',
            400
        );
    }
    if (description.length > 2000) {
        throw knowledgeDocumentError(
            'knowledge_document_description_too_long',
            '资料说明不能超过 2000 字',
            400
        );
    }
    if (contentText.length > 200_000) {
        throw knowledgeDocumentError(
            'knowledge_document_content_too_long',
            '技术内容不能超过 200000 字',
            400
        );
    }
    if (!DOCUMENT_TYPES.has(documentType)) {
        throw knowledgeDocumentError(
            'knowledge_document_type_invalid',
            '资料类型不在允许范围内',
            400
        );
    }
    const hasFile = Buffer.isBuffer(input.buffer) && input.buffer.length > 0;
    if (!hasFile && !contentText) {
        throw knowledgeDocumentError(
            'knowledge_document_content_required',
            '请上传文件或填写技术内容',
            400
        );
    }

    const inspectedFile = hasFile
        ? dependencies.inspectFactoryFile({
            buffer: input.buffer,
            originalName: input.originalName,
            mimeType: input.mimeType,
        })
        : null;
    const originalName = inspectedFile?.originalName || '';
    if (
        originalName
        && !dependencies.allowedDocumentExtensions.has(
            path.extname(originalName).toLowerCase()
        )
    ) {
        throw knowledgeDocumentError(
            'knowledge_document_file_type_invalid',
            '只支持 .txt、.md、.csv、.xls、.xlsx 和 .pdf 文件',
            400
        );
    }
    const parsed = dependencies.parseKnowledgeDocumentFile({
        buffer: hasFile ? input.buffer : undefined,
        originalName,
        documentType,
    });
    return {
        title,
        description,
        contentText,
        documentType,
        tags,
        hasFile,
        inspectedFile,
        originalName,
        parsed,
    };
}

function executeKnowledgeDocumentUpload(
    dependencies,
    input = {},
    commandContext = {}
) {
    const normalized = normalizeUpload(dependencies, input);
    const contentSha256 = crypto.createHash('sha256')
        .update(normalized.contentText, 'utf8')
        .digest('hex');

    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        input: {
            documentType: normalized.documentType,
            title: normalized.title,
            description: normalized.description,
            contentSha256,
            tags: normalized.tags,
            originalName: normalized.originalName,
            fileSize: normalized.inspectedFile?.fileSize || 0,
            fileSha256: normalized.inspectedFile?.fileSha256 || '',
        },
        execute: ({ auditContext }) => {
            const now = new Date().toISOString();
            const stored = normalized.hasFile
                ? dependencies.storeFactoryFile({
                    buffer: input.buffer,
                    originalName: normalized.originalName,
                    mimeType: input.mimeType,
                    sourceType: 'knowledge_document',
                    parserStatus: ['parsed', 'metadata_only'].includes(
                        normalized.parsed.parserStatus
                    )
                        ? normalized.parsed.parserStatus
                        : 'pending',
                    now,
                }, { auditContext })
                : null;
            const write = dependencies.safeInsert(
                'knowledge_documents',
                {
                    file_id: stored?.file.id || null,
                    document_type: normalized.documentType,
                    title: normalized.title,
                    description: normalized.description,
                    content_text: normalized.contentText,
                    tags_json: JSON.stringify(normalized.tags),
                    original_name: normalized.originalName,
                    mime_type: stored?.file.mimeType || 'application/octet-stream',
                    file_size: stored?.file.fileSize || 0,
                    file_sha256: stored?.file.fileSha256 || '',
                    file_blob: null,
                    parser_status: normalized.parsed.parserStatus,
                    extracted_text: normalized.parsed.extractedText,
                    metadata_json: JSON.stringify(normalized.parsed.metadata),
                    created_at: now,
                    updated_at: now,
                },
                auditContext
            );
            const documentId = Number(write.lastInsertRowid);
            const row = getKnowledgeDocumentRecord(
                dependencies.db,
                documentId
            );
            const auditIds = [
                ...(stored?.auditIds || []),
                ...(write.auditId ? [write.auditId] : []),
            ];
            return {
                data: {
                    document: knowledgeDocumentResponse(
                        row,
                        dependencies.knowledgeDocumentRow
                    ),
                    deduplicatedFile: Boolean(stored?.deduplicated),
                },
                resource: {
                    type: 'knowledgeDocument',
                    ids: [documentId],
                },
                changes: [{
                    resourceType: 'knowledgeDocument',
                    resourceId: documentId,
                    field: 'created',
                    from: null,
                    to: {
                        title: normalized.title,
                        documentType: normalized.documentType,
                        fileSha256: normalized.inspectedFile?.fileSha256 || '',
                        contentSha256,
                    },
                }],
                auditIds,
                requiredAuditCount: 1 + (stored?.auditIds || []).length,
            };
        },
    });
}

function executeKnowledgeDocumentDelete(
    dependencies,
    idValue,
    input = {},
    commandContext = {}
) {
    const id = normalizeDocumentId(idValue);
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(
        input.expectedUpdatedAt,
        'expectedUpdatedAt'
    );
    return executePersistentCommand({
        db: dependencies.db,
        ...commandContext,
        input: { id, expectedUpdatedAt },
        warnings: expectedUpdatedAt
            ? []
            : [{
                code: 'expected_updated_at_missing_compatibility',
                message: `资料 #${id} 未提供 expectedUpdatedAt，并发保护未启用`,
            }],
        execute: ({ auditContext }) => {
            const current = getKnowledgeDocumentRecord(dependencies.db, id);
            assertExpectedUpdatedAt(
                current,
                expectedUpdatedAt,
                `资料 #${id}`
            );
            const deletedAt = new Date().toISOString();
            const write = dependencies.safeUpdate(
                'knowledge_documents',
                id,
                { deleted_at: deletedAt },
                auditContext
            );
            return {
                data: {
                    deleted: 1,
                    knowledgeDocumentId: id,
                    deletedAt,
                },
                resource: {
                    type: 'knowledgeDocument',
                    ids: [id],
                },
                changes: [{
                    resourceType: 'knowledgeDocument',
                    resourceId: id,
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
    DOCUMENT_TYPES,
    UPLOAD_CAPABILITY_ID,
    executeKnowledgeDocumentDelete,
    executeKnowledgeDocumentUpload,
    getKnowledgeDocumentDownload,
    knowledgeDocumentResponse,
    listKnowledgeDocuments,
    parseTags,
};
