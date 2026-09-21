function loadDbAccessors() {
    return require('../db.cjs');
}

function positiveId(value, label = 'ID') {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        const error = new Error(`${label}无效`);
        error.statusCode = 400;
        throw error;
    }
    return parsed;
}

function parseFileIds(value) {
    let source = value;
    if (typeof value === 'string') {
        try {
            source = JSON.parse(value);
        } catch {
            source = value.split(/[,，\s]+/);
        }
    }
    if (!Array.isArray(source)) return [];
    return [...new Set(source.map(Number)
        .filter(item => Number.isInteger(item) && item > 0))];
}

function normalizeSummaryText(value) {
    const result = String(value ?? '').trim();
    if (!result) {
        const error = new Error('报价附件摘要不能为空');
        error.statusCode = 400;
        throw error;
    }
    if (result.length > 20_000) {
        const error = new Error('报价附件摘要不能超过 20000 字');
        error.statusCode = 400;
        throw error;
    }
    return result;
}

function requireQuotation(quotationId, accessors) {
    const quotation = accessors.db.prepare(`
        SELECT q.id, q.customer_id, q.status, c.name AS customer_name
        FROM quotations q
        LEFT JOIN customers c ON c.id = q.customer_id
        WHERE q.id = ? AND q.deleted_at IS NULL
    `).get(quotationId);
    if (!quotation) {
        const error = new Error('报价不存在');
        error.statusCode = 404;
        throw error;
    }
    return quotation;
}

function listQuotationFiles(quotationId, accessors) {
    return accessors.db.prepare(`
        SELECT f.id, f.original_name, f.extension, f.detected_type,
               f.mime_type, f.file_size, f.parser_status,
               l.updated_at AS linked_at
        FROM factory_file_links l
        JOIN factory_files f ON f.id = l.file_id
        WHERE l.target_type = 'quotation'
          AND l.target_id = ?
          AND l.relation_role = 'quotation_source'
          AND l.deleted_at IS NULL
          AND f.deleted_at IS NULL
        ORDER BY l.updated_at DESC, l.id DESC
    `).all(quotationId).map(row => ({
        id: Number(row.id),
        originalName: row.original_name,
        extension: row.extension,
        detectedType: row.detected_type,
        mimeType: row.mime_type,
        fileSize: Number(row.file_size || 0),
        parserStatus: row.parser_status,
        linkedAt: row.linked_at,
        downloadPath: `/api/files/${Number(row.id)}/download`,
    }));
}

function validateSourceFileIds(value, availableFiles) {
    const requested = parseFileIds(value);
    if (requested.length > 4) {
        const error = new Error('一次最多选择 4 个附件进行 AI 汇总');
        error.statusCode = 400;
        throw error;
    }
    const availableIds = new Set(availableFiles.map(file => file.id));
    const invalid = requested.filter(id => !availableIds.has(id));
    if (invalid.length) {
        const error = new Error(`文件未关联当前报价：${invalid.join(', ')}`);
        error.statusCode = 400;
        throw error;
    }
    return requested;
}

function validateAttachmentFileIds(value, accessors) {
    const requested = parseFileIds(value);
    if (requested.length > 20) {
        const error = new Error('一张报价最多关联 20 个询价附件');
        error.statusCode = 400;
        throw error;
    }
    if (!requested.length) return [];
    const placeholders = requested.map(() => '?').join(', ');
    const files = accessors.db.prepare(`
        SELECT id, original_name
        FROM factory_files
        WHERE id IN (${placeholders}) AND deleted_at IS NULL
    `).all(...requested);
    const rowsById = new Map(files.map(row => [Number(row.id), row]));
    const missing = requested.filter(id => !rowsById.has(id));
    if (missing.length) {
        const error = new Error(`询价附件不存在或已删除：${missing.join(', ')}`);
        error.statusCode = 400;
        throw error;
    }
    return requested.map(id => rowsById.get(id));
}

function normalizeQuotationInquiryInput(input = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const files = validateAttachmentFileIds(input.attachmentFileIds, accessors);
    const attachmentFileIds = files.map(row => Number(row.id));
    const attachmentSourceFileIds = validateSourceFileIds(
        input.attachmentSourceFileIds,
        files.map(row => ({ id: Number(row.id) }))
    );
    const attachmentSummary = String(input.attachmentSummary || '').trim()
        ? normalizeSummaryText(input.attachmentSummary)
        : '';
    if (attachmentSourceFileIds.length && !attachmentSummary) {
        const error = new Error('选择 AI 汇总来源后必须保存附件摘要');
        error.statusCode = 400;
        throw error;
    }
    return {
        attachmentFileIds,
        attachmentSourceFileIds,
        attachmentSummary,
        files,
    };
}

function attachQuotationInquiry(quotationIdValue, input = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const quotationId = positiveId(quotationIdValue, '报价ID');
    requireQuotation(quotationId, accessors);
    const inquiry = normalizeQuotationInquiryInput(input, {
        dbAccessors: accessors,
    });
    const files = inquiry.files;
    const sourceFileIds = inquiry.attachmentSourceFileIds;
    const draftText = inquiry.attachmentSummary;
    const now = new Date().toISOString();
    const auditIds = [];
    const linkIds = [];

    files.forEach(file => {
        const write = accessors.safeInsert('factory_file_links', {
            file_id: Number(file.id),
            target_type: 'quotation',
            target_id: quotationId,
            relation_role: 'quotation_source',
            title: file.original_name || '',
            note: '',
            source: 'business_page',
            created_at: now,
            updated_at: now,
            deleted_at: null,
        }, options.auditContext);
        linkIds.push(Number(write.lastInsertRowid));
        if (write.auditId) auditIds.push(write.auditId);
    });

    let summaryId = null;
    if (draftText) {
        const write = accessors.safeInsert('quotation_attachment_summaries', {
            quotation_id: quotationId,
            draft_text: draftText,
            source_file_ids_json: JSON.stringify(sourceFileIds),
            created_at: now,
            updated_at: now,
        }, options.auditContext);
        summaryId = Number(write.lastInsertRowid);
        if (write.auditId) auditIds.push(write.auditId);
    }
    return {
        auditIds,
        expectedAuditCount: files.length + (draftText ? 1 : 0),
        linkIds,
        summaryId,
        sourceFileIds,
    };
}

function summaryResult(quotation, row, availableFiles) {
    return {
        id: row ? Number(row.id) : null,
        quotationId: Number(quotation.id),
        customerName: quotation.customer_name || '',
        quotationStatus: quotation.status || '',
        hasRecord: Boolean(row),
        draftText: row?.draft_text || '',
        sourceFileIds: parseFileIds(row?.source_file_ids_json),
        createdAt: row?.created_at || null,
        updatedAt: row?.updated_at || null,
        availableFiles,
    };
}

function getQuotationAttachmentSummary(quotationIdValue, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const quotationId = positiveId(quotationIdValue, '报价ID');
    const quotation = requireQuotation(quotationId, accessors);
    const row = accessors.db.prepare(`
        SELECT * FROM quotation_attachment_summaries WHERE quotation_id = ?
    `).get(quotationId);
    return summaryResult(quotation, row, listQuotationFiles(quotationId, accessors));
}

module.exports = {
    attachQuotationInquiry,
    getQuotationAttachmentSummary,
    listQuotationFiles,
    normalizeQuotationInquiryInput,
    parseFileIds,
};
