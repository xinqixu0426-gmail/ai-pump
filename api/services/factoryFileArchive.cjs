const path = require('node:path');
const { assertExpectedUpdatedAt } = require('./resourceVersion.cjs');

const TARGET_TYPES = new Set([
    'customer',
    'quotation',
    'order',
    'recipe',
    'recipe_analysis_feedback',
    'ai_answer_feedback',
    'knowledge_document',
]);
const SEARCHABLE_TARGET_TYPES = new Set([
    'customer',
    'quotation',
    'order',
    'recipe',
    'recipe_analysis_feedback',
    'ai_answer_feedback',
]);
const RELATION_ROLES = new Set([
    'attachment',
    'customer_requirement',
    'execution_evidence',
    'technical_reference',
    'quotation_source',
    'quality_evidence',
    'knowledge_source',
]);
const SOURCES = new Set(['manual', 'ai_chat', 'business_page']);
const DOCUMENT_TYPES = new Set([
    'technical_note',
    'pump_performance_test',
    'drawing',
    'spreadsheet',
    'other',
]);
const DEFAULT_ROLES = {
    customer: 'attachment',
    quotation: 'quotation_source',
    order: 'customer_requirement',
    recipe: 'technical_reference',
    recipe_analysis_feedback: 'quality_evidence',
    ai_answer_feedback: 'quality_evidence',
    knowledge_document: 'knowledge_source',
};

function loadDbAccessors() {
    return require('../db.cjs');
}

function text(value, maxLength = 500) {
    return String(value ?? '').trim().slice(0, maxLength);
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

function notFound(message) {
    const error = new Error(message);
    error.statusCode = 404;
    return error;
}

function parseJson(value, fallback) {
    try {
        return JSON.parse(value || '');
    } catch {
        return fallback;
    }
}

function normalizeTags(value) {
    const source = Array.isArray(value)
        ? value
        : String(value || '').split(/[,，\n]/);
    return [...new Set(source.map(item => text(item, 40)).filter(Boolean))].slice(0, 20);
}

function defaultDocumentType(file) {
    if (file.detected_type === 'spreadsheet') return 'spreadsheet';
    if (file.detected_type === 'image') return 'drawing';
    if (file.detected_type === 'text') return 'technical_note';
    return 'other';
}

function archiveTargetVersion(targetType, targetId, accessors) {
    if (!targetId) return null;
    const statements = {
        customer: 'SELECT updated_at FROM customers WHERE id = ?',
        quotation: 'SELECT updated_at FROM quotations WHERE id = ?',
        order: 'SELECT updated_at FROM orders WHERE id = ?',
        recipe: 'SELECT updated_at FROM recipes WHERE id = ?',
        recipe_analysis_feedback: 'SELECT updated_at FROM recipe_analysis_feedback WHERE id = ?',
        ai_answer_feedback: 'SELECT updated_at FROM ai_answer_feedback WHERE id = ?',
        knowledge_document: 'SELECT updated_at FROM knowledge_documents WHERE id = ?',
    };
    const statement = statements[targetType];
    if (!statement) return null;
    return accessors.db.prepare(statement).get(targetId)?.updated_at || null;
}

function targetSummary(targetType, targetId, accessors) {
    let row;
    switch (targetType) {
        case 'customer':
            row = accessors.db.prepare(`
                SELECT id, name, contact_info
                FROM customers
                WHERE id = ? AND deleted_at IS NULL
            `).get(targetId);
            return row ? {
                id: Number(row.id),
                targetType,
                label: row.name || `客户 ${row.id}`,
                detail: text(row.contact_info, 160),
            } : null;
        case 'quotation':
            row = accessors.db.prepare(`
                SELECT q.id, q.status, q.updated_at, c.name AS customer_name
                FROM quotations q
                JOIN customers c ON c.id = q.customer_id
                WHERE q.id = ? AND q.deleted_at IS NULL
            `).get(targetId);
            return row ? {
                id: Number(row.id),
                targetType,
                label: `${row.customer_name || '未知客户'} · 报价`,
                detail: [row.status, row.updated_at ? `更新于 ${row.updated_at}` : ''].filter(Boolean).join(' · '),
            } : null;
        case 'order':
            row = accessors.db.prepare(`
                SELECT id, customer_name, contract_no, status, updated_at
                FROM orders
                WHERE id = ? AND deleted_at IS NULL
            `).get(targetId);
            return row ? {
                id: Number(row.id),
                targetType,
                label: [row.customer_name || '未知客户', row.contract_no || `订单 ${row.id}`].join(' · '),
                detail: [row.status, row.updated_at ? `更新于 ${row.updated_at}` : ''].filter(Boolean).join(' · '),
            } : null;
        case 'recipe':
            row = accessors.db.prepare(`
                SELECT id, name, spec
                FROM recipes
                WHERE id = ? AND deleted_at IS NULL
            `).get(targetId);
            return row ? {
                id: Number(row.id),
                targetType,
                label: row.name || `配方 ${row.id}`,
                detail: text(row.spec, 160),
            } : null;
        case 'recipe_analysis_feedback':
            row = accessors.db.prepare(`
                SELECT f.id, f.finding_type, f.finding_key, f.decision, f.note, r.name AS recipe_name
                FROM recipe_analysis_feedback f
                JOIN recipes r ON r.id = f.recipe_id
                WHERE f.id = ? AND r.deleted_at IS NULL
            `).get(targetId);
            return row ? {
                id: Number(row.id),
                targetType,
                label: `${row.recipe_name || '配方'} · ${row.finding_type || row.finding_key || '检查问题'}`,
                detail: [row.decision, text(row.note, 120)].filter(Boolean).join(' · '),
            } : null;
        case 'ai_answer_feedback':
            row = accessors.db.prepare(`
                SELECT id, rating, status, question_text, note
                FROM ai_answer_feedback
                WHERE id = ?
            `).get(targetId);
            return row ? {
                id: Number(row.id),
                targetType,
                label: text(row.question_text, 80) || `AI 回答问题 ${row.id}`,
                detail: [row.rating, row.status, text(row.note, 120)].filter(Boolean).join(' · '),
            } : null;
        case 'knowledge_document':
            row = accessors.db.prepare(`
                SELECT id, title, document_type
                FROM knowledge_documents
                WHERE id = ? AND deleted_at IS NULL
            `).get(targetId);
            return row ? {
                id: Number(row.id),
                targetType,
                label: row.title || `知识资料 ${row.id}`,
                detail: row.document_type || '',
            } : null;
        default:
            return null;
    }
}

function targetSearchRows(targetType, accessors) {
    switch (targetType) {
        case 'customer':
            return accessors.db.prepare(`
                SELECT id FROM customers
                WHERE deleted_at IS NULL
                ORDER BY updated_at DESC, id DESC
                LIMIT 200
            `).all();
        case 'quotation':
            return accessors.db.prepare(`
                SELECT id FROM quotations
                WHERE deleted_at IS NULL
                ORDER BY updated_at DESC, id DESC
                LIMIT 200
            `).all();
        case 'order':
            return accessors.db.prepare(`
                SELECT id FROM orders
                WHERE deleted_at IS NULL
                ORDER BY updated_at DESC, id DESC
                LIMIT 200
            `).all();
        case 'recipe':
            return accessors.db.prepare(`
                SELECT id FROM recipes
                WHERE deleted_at IS NULL
                ORDER BY updated_at DESC, id DESC
                LIMIT 200
            `).all();
        case 'recipe_analysis_feedback':
            return accessors.db.prepare(`
                SELECT f.id
                FROM recipe_analysis_feedback f
                JOIN recipes r ON r.id = f.recipe_id
                WHERE r.deleted_at IS NULL
                ORDER BY f.updated_at DESC, f.id DESC
                LIMIT 200
            `).all();
        case 'ai_answer_feedback':
            return accessors.db.prepare(`
                SELECT id FROM ai_answer_feedback
                ORDER BY updated_at DESC, id DESC
                LIMIT 200
            `).all();
        default:
            return [];
    }
}

function searchFactoryFileArchiveTargets(params = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const targetType = text(params.targetType, 60);
    if (!SEARCHABLE_TARGET_TYPES.has(targetType)) {
        throw new Error('不支持的归档目标类型');
    }
    const requestedLimit = Number(params.limit);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 50)
        : 20;
    const query = text(params.query, 100).toLocaleLowerCase('zh-CN');
    return targetSearchRows(targetType, accessors)
        .map(row => targetSummary(targetType, Number(row.id), accessors))
        .filter(Boolean)
        .filter(target => {
            if (!query) return true;
            return `${target.id} ${target.label} ${target.detail}`.toLocaleLowerCase('zh-CN').includes(query);
        })
        .slice(0, limit);
}

function factoryFileLinkRow(row, accessors) {
    if (!row) return null;
    return {
        id: Number(row.id),
        fileId: Number(row.file_id),
        targetType: row.target_type,
        targetId: Number(row.target_id),
        relationRole: row.relation_role,
        title: row.title || '',
        note: row.note || '',
        source: row.source || 'manual',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        target: targetSummary(row.target_type, Number(row.target_id), accessors),
        file: row.original_name ? {
            id: Number(row.file_id),
            originalName: row.original_name,
            extension: row.extension || '',
            detectedType: row.detected_type,
            mimeType: row.mime_type,
            fileSize: Number(row.file_size || 0),
        } : undefined,
    };
}

function listFactoryFileLinks(params = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const fileId = params.fileId ? positiveId(params.fileId, '文件ID') : null;
    const targetType = text(params.targetType, 60);
    const targetId = params.targetId ? positiveId(params.targetId, '业务对象ID') : null;
    if (!fileId && (!TARGET_TYPES.has(targetType) || !targetId)) {
        throw new Error('请指定文件或有效的业务对象');
    }
    const rows = fileId
        ? accessors.db.prepare(`
            SELECT l.*
            FROM factory_file_links l
            WHERE l.file_id = ? AND l.deleted_at IS NULL
            ORDER BY l.updated_at DESC, l.id DESC
        `).all(fileId)
        : accessors.db.prepare(`
            SELECT l.*, f.original_name, f.extension, f.detected_type, f.mime_type, f.file_size
            FROM factory_file_links l
            JOIN factory_files f ON f.id = l.file_id
            WHERE l.target_type = ? AND l.target_id = ?
              AND l.deleted_at IS NULL AND f.deleted_at IS NULL
            ORDER BY l.updated_at DESC, l.id DESC
        `).all(targetType, targetId);
    return rows.map(row => factoryFileLinkRow(row, accessors));
}

function inspectFactoryFileArchive(fileIdValue, input = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const fileId = positiveId(fileIdValue, '文件ID');
    const targetType = text(input.targetType, 60);
    if (!TARGET_TYPES.has(targetType)) throw new Error('不支持的归档目标类型');
    const relationRole = RELATION_ROLES.has(text(input.relationRole, 60))
        ? text(input.relationRole, 60)
        : DEFAULT_ROLES[targetType];
    const file = accessors.db.prepare(`
        SELECT *
        FROM factory_files
        WHERE id = ? AND deleted_at IS NULL
    `).get(fileId);
    if (!file) throw notFound('文件不存在');

    const normalizedInput = {
        targetType,
        relationRole,
        title: text(input.title, 160),
        note: text(input.note, 1000),
        source: SOURCES.has(text(input.source, 40))
            ? text(input.source, 40)
            : 'manual',
    };
    let targetId = null;
    let target = null;
    let knowledgeDocument = null;
    if (targetType === 'knowledge_document') {
        if (!['parsed', 'metadata_only'].includes(file.parser_status)) {
            const error = new Error('文件尚未解析完成，不能归档到知识库');
            error.statusCode = 409;
            throw error;
        }
        normalizedInput.documentType = DOCUMENT_TYPES.has(text(input.documentType, 60))
            ? text(input.documentType, 60)
            : defaultDocumentType(file);
        normalizedInput.tags = normalizeTags(input.tags);
        normalizedInput.title = normalizedInput.title
            || text(path.basename(file.original_name, file.extension || path.extname(file.original_name)), 160)
            || `工厂资料 ${file.id}`;
        knowledgeDocument = accessors.db.prepare(`
            SELECT *
            FROM knowledge_documents
            WHERE file_id = ? AND deleted_at IS NULL
            ORDER BY id DESC
            LIMIT 1
        `).get(fileId) || null;
        if (knowledgeDocument) {
            targetId = Number(knowledgeDocument.id);
            target = targetSummary(targetType, targetId, accessors);
        } else {
            target = {
                id: null,
                targetType,
                label: normalizedInput.title,
                detail: normalizedInput.documentType,
            };
        }
    } else {
        targetId = positiveId(input.targetId, '业务对象ID');
        normalizedInput.targetId = targetId;
        target = targetSummary(targetType, targetId, accessors);
        if (!target) throw notFound('归档目标不存在或已删除');
    }

    const activeLink = targetId
        ? accessors.db.prepare(`
            SELECT *
            FROM factory_file_links
            WHERE file_id = ? AND target_type = ? AND target_id = ?
              AND relation_role = ? AND deleted_at IS NULL
            LIMIT 1
        `).get(fileId, targetType, targetId, relationRole) || null
        : null;
    const deletedLink = !activeLink && targetId
        ? accessors.db.prepare(`
            SELECT *
            FROM factory_file_links
            WHERE file_id = ? AND target_type = ? AND target_id = ?
              AND relation_role = ? AND deleted_at IS NOT NULL
            ORDER BY id DESC
            LIMIT 1
        `).get(fileId, targetType, targetId, relationRole) || null
        : null;

    return {
        file: {
            id: Number(file.id),
            originalName: file.original_name,
            parserStatus: file.parser_status,
            fileSha256: file.file_sha256 || '',
            updatedAt: file.updated_at,
        },
        normalizedInput,
        target,
        targetId,
        targetUpdatedAt: archiveTargetVersion(targetType, targetId, accessors),
        knowledgeDocument: knowledgeDocument ? {
            id: Number(knowledgeDocument.id),
            title: knowledgeDocument.title,
            documentType: knowledgeDocument.document_type,
            updatedAt: knowledgeDocument.updated_at,
        } : null,
        link: activeLink ? factoryFileLinkRow(activeLink, accessors) : null,
        deletedLink: deletedLink ? {
            id: Number(deletedLink.id),
            updatedAt: deletedLink.updated_at,
            deletedAt: deletedLink.deleted_at,
        } : null,
        action: activeLink
            ? 'deduplicated'
            : deletedLink
                ? 'restore_link'
                : knowledgeDocument
                    ? 'create_link'
                    : targetType === 'knowledge_document'
                        ? 'create_document_and_link'
                        : 'create_link',
    };
}

function normalizeFactoryFileBusinessAttachmentTarget(input = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const targetType = text(input.targetType, 60);
    if (!TARGET_TYPES.has(targetType) || targetType === 'knowledge_document') {
        const error = new Error('上传即归档只支持已存在的业务对象');
        error.statusCode = 400;
        throw error;
    }
    const targetId = positiveId(input.targetId, '业务对象ID');
    const target = targetSummary(targetType, targetId, accessors);
    if (!target) throw notFound('归档目标不存在或已删除');
    return {
        targetType,
        targetId,
        relationRole: RELATION_ROLES.has(text(input.relationRole, 60))
            ? text(input.relationRole, 60)
            : DEFAULT_ROLES[targetType],
        title: text(input.title, 160),
        note: text(input.note, 1000),
        source: SOURCES.has(text(input.source, 40))
            ? text(input.source, 40)
            : 'business_page',
        target,
        targetUpdatedAt: archiveTargetVersion(targetType, targetId, accessors),
    };
}

function createKnowledgeDocumentForFile(file, input, accessors, auditContext) {
    if (!['parsed', 'metadata_only'].includes(file.parser_status)) {
        const error = new Error('文件尚未解析完成，不能归档到知识库');
        error.statusCode = 409;
        throw error;
    }
    const existing = accessors.db.prepare(`
        SELECT *
        FROM knowledge_documents
        WHERE file_id = ? AND deleted_at IS NULL
        ORDER BY id DESC
        LIMIT 1
    `).get(file.id);
    if (existing) {
        return { document: existing, deduplicated: true };
    }
    const documentType = DOCUMENT_TYPES.has(text(input.documentType, 60))
        ? text(input.documentType, 60)
        : defaultDocumentType(file);
    const title = text(input.title, 160)
        || text(path.basename(file.original_name, file.extension || path.extname(file.original_name)), 160)
        || `工厂资料 ${file.id}`;
    const tags = normalizeTags(input.tags);
    const parsedSummary = parseJson(file.parsed_json, {});
    const now = new Date().toISOString();
    const info = accessors.safeInsert('knowledge_documents', {
        file_id: file.id,
        document_type: documentType,
        title,
        description: text(input.note, 1000),
        content_text: '',
        tags_json: JSON.stringify(tags),
        original_name: file.original_name,
        mime_type: file.mime_type,
        file_size: Number(file.file_size || 0),
        file_sha256: file.file_sha256 || '',
        file_blob: null,
        parser_status: file.parser_status,
        extracted_text: file.parsed_text || '',
        metadata_json: JSON.stringify({
            archivedFrom: 'factory_file',
            parserStatus: file.parser_status,
            parsedSummary,
        }),
        created_at: now,
        updated_at: now,
    }, auditContext);
    return {
        document: accessors.db.prepare('SELECT * FROM knowledge_documents WHERE id = ?')
            .get(Number(info.lastInsertRowid)),
        deduplicated: false,
        auditId: info.auditId || null,
    };
}

function upsertLink(fileId, targetType, targetId, relationRole, input, accessors, auditContext) {
    const existing = accessors.db.prepare(`
        SELECT *
        FROM factory_file_links
        WHERE file_id = ? AND target_type = ? AND target_id = ? AND relation_role = ?
          AND deleted_at IS NULL
        LIMIT 1
    `).get(fileId, targetType, targetId, relationRole);
    if (existing) return {
        row: existing,
        deduplicated: true,
        action: 'deduplicated',
        auditId: null,
    };

    const deleted = accessors.db.prepare(`
        SELECT *
        FROM factory_file_links
        WHERE file_id = ? AND target_type = ? AND target_id = ? AND relation_role = ?
          AND deleted_at IS NOT NULL
        ORDER BY id DESC
        LIMIT 1
    `).get(fileId, targetType, targetId, relationRole);
    const values = {
        title: text(input.title, 160),
        note: text(input.note, 1000),
        source: SOURCES.has(text(input.source, 40)) ? text(input.source, 40) : 'manual',
    };
    if (deleted) {
        const write = accessors.safeUpdate('factory_file_links', deleted.id, {
            ...values,
            deleted_at: null,
        }, auditContext);
        return {
            row: accessors.db.prepare('SELECT * FROM factory_file_links WHERE id = ?').get(deleted.id),
            deduplicated: false,
            action: 'restored',
            auditId: write.auditId || null,
        };
    }
    const now = new Date().toISOString();
    const info = accessors.safeInsert('factory_file_links', {
        file_id: fileId,
        target_type: targetType,
        target_id: targetId,
        relation_role: relationRole,
        ...values,
        created_at: now,
        updated_at: now,
        deleted_at: null,
    }, auditContext);
    return {
        row: accessors.db.prepare('SELECT * FROM factory_file_links WHERE id = ?')
            .get(Number(info.lastInsertRowid)),
        deduplicated: false,
        action: 'created',
        auditId: info.auditId || null,
    };
}

function archiveFactoryFile(fileIdValue, input = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const inspected = inspectFactoryFileArchive(fileIdValue, input, {
        dbAccessors: accessors,
    });
    const fileId = inspected.file.id;
    const { targetType, relationRole } = inspected.normalizedInput;
    const file = accessors.db.prepare(`
        SELECT *
        FROM factory_files
        WHERE id = ? AND deleted_at IS NULL
    `).get(fileId);

    const execute = () => {
        let targetId;
        let knowledgeDocument = null;
        let documentDeduplicated = false;
        let documentAuditId = null;
        if (targetType === 'knowledge_document') {
            const result = createKnowledgeDocumentForFile(
                file,
                inspected.normalizedInput,
                accessors,
                options.auditContext
            );
            knowledgeDocument = result.document;
            documentDeduplicated = result.deduplicated;
            documentAuditId = result.auditId || null;
            targetId = Number(result.document.id);
        } else {
            targetId = inspected.targetId;
            if (!targetSummary(targetType, targetId, accessors)) {
                throw notFound('归档目标不存在或已删除');
            }
        }
        const linked = upsertLink(
            fileId,
            targetType,
            targetId,
            relationRole,
            inspected.normalizedInput,
            accessors,
            options.auditContext
        );
        return {
            link: factoryFileLinkRow(linked.row, accessors),
            knowledgeDocument: knowledgeDocument ? {
                id: Number(knowledgeDocument.id),
                title: knowledgeDocument.title,
                documentType: knowledgeDocument.document_type,
            } : null,
            deduplicated: linked.deduplicated
                && (targetType !== 'knowledge_document' || documentDeduplicated),
            linkAction: linked.action,
            knowledgeDocumentCreated: Boolean(knowledgeDocument && !documentDeduplicated),
            auditIds: [documentAuditId, linked.auditId].filter(Boolean),
        };
    };
    return typeof accessors.db.transaction === 'function' && !accessors.db.inTransaction
        ? accessors.db.transaction(execute).immediate()
        : execute();
}

function deleteFactoryFileLink(fileIdValue, linkIdValue, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const fileId = positiveId(fileIdValue, '文件ID');
    const linkId = positiveId(linkIdValue, '关联ID');
    const link = accessors.db.prepare(`
        SELECT *
        FROM factory_file_links
        WHERE id = ? AND file_id = ? AND deleted_at IS NULL
    `).get(linkId, fileId);
    if (!link) throw notFound('文件关联不存在');
    if (link.target_type === 'order' && link.relation_role === 'customer_requirement') {
        const requirement = accessors.db.prepare(`
            SELECT confirmed_text, confirmed_source_file_ids_json
            FROM order_requirement_summaries
            WHERE order_id = ?
        `).get(link.target_id);
        const confirmedFileIds = parseJson(requirement?.confirmed_source_file_ids_json, []);
        if (requirement?.confirmed_text && Array.isArray(confirmedFileIds) && confirmedFileIds.map(Number).includes(fileId)) {
            const error = new Error('该文件已被确认的客户要求引用，请先撤销确认或重新确认不引用该文件的版本');
            error.statusCode = 409;
            throw error;
        }
    }
    if (link.target_type === 'order' && link.relation_role === 'execution_evidence') {
        let executionRecords = [];
        try {
            executionRecords = accessors.db.prepare(`
                SELECT id, confirmed_source_file_ids_json
                FROM order_execution_records
                WHERE order_id = ?
                  AND deleted_at IS NULL
                  AND confirmed_text <> ''
            `).all(link.target_id);
        } catch {
            executionRecords = [];
        }
        const referencedExecutionRecord = executionRecords.find(row => (
            parseJson(row.confirmed_source_file_ids_json, []).map(Number).includes(fileId)
        ));
        if (referencedExecutionRecord) {
            const error = new Error(`该文件已被确认的执行档案 #${referencedExecutionRecord.id} 引用，请先撤销确认或重新确认不引用该文件的版本`);
            error.statusCode = 409;
            throw error;
        }
    }
    assertExpectedUpdatedAt(
        link,
        options.expectedUpdatedAt || null,
        `文件关联 #${linkId}`
    );
    const deletedAt = new Date().toISOString();
    const write = accessors.safeUpdate(
        'factory_file_links',
        linkId,
        { deleted_at: deletedAt },
        options.auditContext
    );
    return {
        link: factoryFileLinkRow(link, accessors),
        deletedAt,
        auditId: write.auditId || null,
    };
}

module.exports = {
    DOCUMENT_TYPES,
    RELATION_ROLES,
    SEARCHABLE_TARGET_TYPES,
    TARGET_TYPES,
    archiveFactoryFile,
    deleteFactoryFileLink,
    factoryFileLinkRow,
    inspectFactoryFileArchive,
    normalizeFactoryFileBusinessAttachmentTarget,
    listFactoryFileLinks,
    searchFactoryFileArchiveTargets,
};
