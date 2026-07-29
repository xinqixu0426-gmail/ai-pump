const crypto = require('node:crypto');
const path = require('node:path');
const { isUtf8 } = require('node:buffer');
const XLSX = require('@e965/xlsx');

const MAX_FACTORY_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_FILE_EXTENSIONS = new Set([
    '.pdf',
    '.xls',
    '.xlsx',
    '.csv',
    '.txt',
    '.md',
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
]);
const SOURCE_TYPES = new Set([
    'direct_upload',
    'knowledge_document',
    'recipe_technical_file',
]);
const PARSER_STATUSES = new Set([
    'pending',
    'processing',
    'parsed',
    'metadata_only',
    'failed',
]);
const PARSER_STATUS_RANK = {
    failed: 0,
    pending: 1,
    processing: 1,
    metadata_only: 2,
    parsed: 3,
};
const DANGEROUS_NAME_SEGMENT_RE = /\.(?:exe|com|bat|cmd|ps1|sh|js|mjs|cjs|jar|msi|app|dmg)(?:\.|$)/i;

function loadDbAccessors() {
    return require('../db.cjs');
}

function text(value) {
    return String(value ?? '').trim();
}

function normalizeUploadName(value) {
    const raw = String(value || '').replace(/\u0000/g, '');
    const decoded = Buffer.from(raw, 'latin1').toString('utf8');
    const candidate = decoded.includes('\uFFFD') ? raw : decoded;
    const baseName = path.basename(candidate)
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim();
    if (!baseName) throw new Error('文件名不能为空');
    if (baseName.length > 255) throw new Error('文件名不能超过 255 个字符');
    if (DANGEROUS_NAME_SEGMENT_RE.test(baseName)) {
        throw new Error('文件名包含不允许的可执行扩展名');
    }
    return baseName;
}

function startsWith(buffer, bytes) {
    if (buffer.length < bytes.length) return false;
    return bytes.every((value, index) => buffer[index] === value);
}

function validateSpreadsheet(buffer, extension) {
    if (extension === '.xls') {
        if (!startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
            throw new Error('文件扩展名与实际 Excel 格式不一致');
        }
        return 'ole_compound';
    }
    if (extension === '.xlsx') {
        if (!startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) {
            throw new Error('文件扩展名与实际 Excel 格式不一致');
        }
        let workbook;
        try {
            workbook = XLSX.read(buffer, { type: 'buffer', bookSheets: true });
        } catch {
            throw new Error('Excel 文件结构无效或已损坏');
        }
        if (!Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
            throw new Error('Excel 文件中没有工作表');
        }
        return 'office_open_xml';
    }
    return '';
}

function inspectFactoryFile(input = {}) {
    const buffer = input.buffer;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error('请选择非空文件');
    }
    if (buffer.length > MAX_FACTORY_FILE_SIZE) {
        throw new Error('文件不能超过 10MB');
    }
    const originalName = normalizeUploadName(input.originalName);
    const extension = path.extname(originalName).toLowerCase();
    if (!ALLOWED_FILE_EXTENSIONS.has(extension)) {
        throw new Error('只支持 PDF、Excel、CSV、TXT、Markdown、PNG、JPG 和 WebP 文件');
    }

    let detectedType = '';
    let mimeType = '';
    let contentSignature = '';
    if (extension === '.pdf') {
        if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
            throw new Error('文件扩展名与实际 PDF 内容不一致');
        }
        detectedType = 'pdf';
        mimeType = 'application/pdf';
        contentSignature = 'pdf';
    } else if (['.xls', '.xlsx'].includes(extension)) {
        detectedType = 'spreadsheet';
        mimeType = extension === '.xls'
            ? 'application/vnd.ms-excel'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        contentSignature = validateSpreadsheet(buffer, extension);
    } else if (extension === '.png') {
        if (!startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
            throw new Error('文件扩展名与实际 PNG 内容不一致');
        }
        detectedType = 'image';
        mimeType = 'image/png';
        contentSignature = 'png';
    } else if (['.jpg', '.jpeg'].includes(extension)) {
        if (!startsWith(buffer, [0xff, 0xd8, 0xff])) {
            throw new Error('文件扩展名与实际 JPEG 内容不一致');
        }
        detectedType = 'image';
        mimeType = 'image/jpeg';
        contentSignature = 'jpeg';
    } else if (extension === '.webp') {
        const validWebp = buffer.length >= 12
            && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
            && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
        if (!validWebp) throw new Error('文件扩展名与实际 WebP 内容不一致');
        detectedType = 'image';
        mimeType = 'image/webp';
        contentSignature = 'webp';
    } else {
        if (!isUtf8(buffer) || buffer.includes(0)) {
            throw new Error('文本文件必须是有效的 UTF-8 内容');
        }
        detectedType = extension === '.csv' ? 'spreadsheet' : 'text';
        mimeType = extension === '.csv' ? 'text/csv' : 'text/plain; charset=utf-8';
        contentSignature = 'utf8_text';
    }

    return {
        originalName,
        extension,
        detectedType,
        mimeType,
        fileSize: buffer.length,
        fileSha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        security: {
            contentSignature,
            extensionVerified: true,
            clientMimeType: text(input.mimeType) || 'application/octet-stream',
        },
    };
}

function factoryFileRow(row) {
    if (!row) return null;
    let metadata = {};
    let parsed = {};
    try {
        metadata = JSON.parse(row.metadata_json || '{}');
    } catch {
        metadata = {};
    }
    try {
        parsed = JSON.parse(row.parsed_json || '{}');
    } catch {
        parsed = {};
    }
    return {
        id: Number(row.id),
        originalName: row.original_name,
        extension: row.extension,
        detectedType: row.detected_type,
        mimeType: row.mime_type,
        fileSize: Number(row.file_size || 0),
        fileSha256: row.file_sha256,
        parserStatus: row.parser_status,
        sourceType: row.source_type,
        duplicateCount: Number(row.duplicate_count || 1),
        metadata,
        parsedTextPreview: String(row.parsed_text || '').slice(0, 1_000),
        parserSummary: {
            version: parsed.version || '',
            parser: parsed.parser || '',
            pageCount: Number(parsed.pageCount || 0),
            parsedPageCount: Number(parsed.parsedPageCount || 0),
            sheetCount: Number(parsed.sheetCount || 0),
            parsedSheetCount: Number(parsed.parsedSheetCount || 0),
            rowCount: Number(parsed.rowCount || 0),
            scannedRowCount: Number(parsed.scannedRowCount || 0),
            cellCount: Number(parsed.cellCount || 0),
            tableCount: Number(parsed.tableCount || 0),
            formulaCount: Number(parsed.formulaCount || 0),
            truncated: Boolean(parsed.truncated),
            requiresOcr: Boolean(parsed.requiresOcr),
            ocrApplied: Boolean(parsed.ocrApplied),
            confidence: Number(parsed.confidence || 0),
            needsReview: Boolean(parsed.needsReview),
            drawingCandidateCount: Number(parsed.drawingCandidateCount || 0),
        },
        parserError: row.parser_error || '',
        parsedAt: row.parsed_at || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        deletedAt: row.deleted_at,
        downloadPath: `/api/files/${row.id}/download`,
    };
}

function storeFactoryFile(input = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, safeInsert, safeUpdate } = accessors;
    const inspected = inspectFactoryFile(input);
    const sourceType = SOURCE_TYPES.has(text(input.sourceType))
        ? text(input.sourceType)
        : 'direct_upload';
    const parserStatus = PARSER_STATUSES.has(text(input.parserStatus))
        ? text(input.parserStatus)
        : 'pending';
    const now = text(input.now) || new Date().toISOString();
    const existing = db.prepare(
        'SELECT * FROM factory_files WHERE file_sha256 = ?'
    ).get(inspected.fileSha256);
    if (existing) {
        const updates = {
            duplicate_count: Number(existing.duplicate_count || 1) + 1,
            updated_at: now,
        };
        if (
            (PARSER_STATUS_RANK[parserStatus] || 0)
            > (PARSER_STATUS_RANK[existing.parser_status] || 0)
        ) {
            updates.parser_status = parserStatus;
        }
        if (existing.deleted_at) {
            Object.assign(updates, {
                original_name: inspected.originalName,
                extension: inspected.extension,
                detected_type: inspected.detectedType,
                mime_type: inspected.mimeType,
                file_size: inspected.fileSize,
                file_blob: input.buffer,
                parser_status: parserStatus,
                source_type: sourceType,
                metadata_json: JSON.stringify({ security: inspected.security }),
                deleted_at: null,
            });
        }
        safeUpdate('factory_files', existing.id, updates);
        return {
            file: factoryFileRow(
                db.prepare('SELECT * FROM factory_files WHERE id = ?').get(existing.id)
            ),
            deduplicated: true,
        };
    }

    const info = safeInsert('factory_files', {
        original_name: inspected.originalName,
        extension: inspected.extension,
        detected_type: inspected.detectedType,
        mime_type: inspected.mimeType,
        file_size: inspected.fileSize,
        file_sha256: inspected.fileSha256,
        file_blob: input.buffer,
        parser_status: parserStatus,
        source_type: sourceType,
        duplicate_count: 1,
        metadata_json: JSON.stringify({ security: inspected.security }),
        created_at: now,
        updated_at: now,
    });
    return {
        file: factoryFileRow(
            db.prepare('SELECT * FROM factory_files WHERE id = ?').get(Number(info.lastInsertRowid))
        ),
        deduplicated: false,
    };
}

function getFactoryFile(id, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const row = accessors.db.prepare(`
        SELECT * FROM factory_files
        WHERE id = ? AND deleted_at IS NULL
    `).get(Number(id));
    return factoryFileRow(row);
}

function getFactoryFileBlob(id, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    return accessors.db.prepare(`
        SELECT id, original_name, mime_type, file_size, file_blob
        FROM factory_files
        WHERE id = ? AND deleted_at IS NULL
    `).get(Number(id)) || null;
}

function getFactoryFileContent(id, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const row = accessors.db.prepare(`
        SELECT id, parser_status, parsed_text, parsed_json, parser_error, parsed_at
        FROM factory_files
        WHERE id = ? AND deleted_at IS NULL
    `).get(Number(id));
    if (!row) return null;
    let parsed = {};
    try {
        parsed = JSON.parse(row.parsed_json || '{}');
    } catch {
        parsed = {};
    }
    return {
        id: Number(row.id),
        parserStatus: row.parser_status,
        parsedText: row.parsed_text || '',
        parsed,
        parserError: row.parser_error || '',
        parsedAt: row.parsed_at || null,
    };
}

function listFactoryFiles(params = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const detectedType = ['pdf', 'spreadsheet', 'image', 'text'].includes(text(params.detectedType))
        ? text(params.detectedType)
        : '';
    const sourceType = SOURCE_TYPES.has(text(params.sourceType)) ? text(params.sourceType) : '';
    const requestedLimit = Number(params.limit);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 100)
        : 30;
    const rows = accessors.db.prepare(`
        SELECT *
        FROM factory_files
        WHERE deleted_at IS NULL
          AND (? = '' OR detected_type = ?)
          AND (? = '' OR source_type = ?)
        ORDER BY updated_at DESC, id DESC
        LIMIT ?
    `).all(detectedType, detectedType, sourceType, sourceType, limit);
    return rows.map(factoryFileRow);
}

function deleteFactoryFile(id, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const fileId = Number(id);
    const row = accessors.db.prepare(`
        SELECT id FROM factory_files WHERE id = ? AND deleted_at IS NULL
    `).get(fileId);
    if (!row) throw new Error('文件不存在');
    const knowledgeReference = accessors.db.prepare(`
        SELECT id FROM knowledge_documents
        WHERE file_id = ? AND deleted_at IS NULL
        LIMIT 1
    `).get(fileId);
    const recipeReference = accessors.db.prepare(`
        SELECT id FROM recipe_technical_files
        WHERE file_id = ? AND deleted_at IS NULL
        LIMIT 1
    `).get(fileId);
    const hasFactoryFileLinks = Boolean(accessors.db.prepare(`
        SELECT 1 FROM sqlite_schema
        WHERE type = 'table' AND name = 'factory_file_links'
    `).get());
    const businessReference = hasFactoryFileLinks
        ? accessors.db.prepare(`
            SELECT id FROM factory_file_links
            WHERE file_id = ? AND deleted_at IS NULL
            LIMIT 1
        `).get(fileId)
        : null;
    const hasConversationMessages = Boolean(accessors.db.prepare(`
        SELECT 1 FROM sqlite_schema
        WHERE type = 'table' AND name = 'ai_conversation_messages'
    `).get());
    const conversationReference = hasConversationMessages
        && accessors.db.prepare(`
            SELECT id, metadata_json
            FROM ai_conversation_messages
            WHERE metadata_json LIKE ?
        `).all(`%"id":${fileId}%`).some(row => {
            try {
                const metadata = JSON.parse(row.metadata_json || '{}');
                return Array.isArray(metadata.attachments)
                    && metadata.attachments.some(attachment => Number(attachment?.id) === fileId);
            } catch {
                return false;
            }
        });
    if (knowledgeReference || recipeReference || businessReference || conversationReference) {
        const error = new Error('文件仍被业务资料引用，不能直接删除');
        error.statusCode = 409;
        throw error;
    }
    accessors.softDelete('factory_files', fileId);
}

module.exports = {
    ALLOWED_FILE_EXTENSIONS,
    MAX_FACTORY_FILE_SIZE,
    PARSER_STATUSES,
    SOURCE_TYPES,
    deleteFactoryFile,
    factoryFileRow,
    getFactoryFile,
    getFactoryFileBlob,
    getFactoryFileContent,
    inspectFactoryFile,
    listFactoryFiles,
    normalizeUploadName,
    storeFactoryFile,
};
