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
    return [...new Set(source
        .map(Number)
        .filter(item => Number.isInteger(item) && item > 0))]
        .slice(0, 20);
}

function sameIds(left, right) {
    return JSON.stringify([...left].sort((a, b) => a - b))
        === JSON.stringify([...right].sort((a, b) => a - b));
}

function normalizeSummaryText(value) {
    const result = String(value ?? '').trim();
    if (!result) {
        const error = new Error('客户要求摘要不能为空');
        error.statusCode = 400;
        throw error;
    }
    if (result.length > 20000) {
        const error = new Error('客户要求摘要不能超过 20000 字');
        error.statusCode = 400;
        throw error;
    }
    return result;
}

function requireOrder(orderId, accessors) {
    const order = accessors.db.prepare(`
        SELECT id, customer_name, contract_no, status
        FROM orders
        WHERE id = ? AND deleted_at IS NULL
    `).get(orderId);
    if (!order) {
        const error = new Error('订单不存在');
        error.statusCode = 404;
        throw error;
    }
    return order;
}

function listOrderRequirementFiles(orderId, accessors) {
    return accessors.db.prepare(`
        SELECT
            f.id,
            f.original_name,
            f.detected_type,
            f.mime_type,
            f.file_size,
            f.parser_status,
            l.updated_at AS linked_at
        FROM factory_file_links l
        JOIN factory_files f ON f.id = l.file_id
        WHERE l.target_type = 'order'
          AND l.target_id = ?
          AND l.relation_role = 'customer_requirement'
          AND l.deleted_at IS NULL
          AND f.deleted_at IS NULL
        ORDER BY l.updated_at DESC, l.id DESC
    `).all(orderId).map(row => ({
        id: Number(row.id),
        originalName: row.original_name,
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
    const availableIds = new Set(availableFiles.map(file => file.id));
    const invalid = requested.filter(id => !availableIds.has(id));
    if (invalid.length > 0) {
        const error = new Error(`文件未关联当前订单：${invalid.join(', ')}`);
        error.statusCode = 400;
        throw error;
    }
    return requested;
}

function requirementResult(order, row, availableFiles) {
    const sourceFileIds = parseFileIds(row?.source_file_ids_json);
    const confirmedSourceFileIds = parseFileIds(row?.confirmed_source_file_ids_json);
    const draftText = row?.draft_text || '';
    const confirmedText = row?.confirmed_text || '';
    const hasConfirmedVersion = Boolean(confirmedText);
    const hasPendingChanges = Boolean(row) && (
        draftText !== confirmedText
        || !sameIds(sourceFileIds, confirmedSourceFileIds)
    );
    return {
        id: row ? Number(row.id) : null,
        orderId: Number(order.id),
        customerName: order.customer_name || '',
        contractNo: order.contract_no || '',
        orderStatus: order.status || '',
        hasRecord: Boolean(row),
        draftText,
        confirmedText,
        sourceFileIds,
        confirmedSourceFileIds,
        status: row?.status || 'draft',
        hasConfirmedVersion,
        hasPendingChanges,
        knowledgeStatus: hasConfirmedVersion
            ? (hasPendingChanges ? 'confirmed_with_draft' : 'confirmed')
            : 'not_confirmed',
        confirmedAt: row?.confirmed_at || null,
        createdAt: row?.created_at || null,
        updatedAt: row?.updated_at || null,
        availableFiles,
    };
}

function getOrderRequirementSummary(orderIdValue, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const orderId = positiveId(orderIdValue, '订单ID');
    const order = requireOrder(orderId, accessors);
    const row = accessors.db.prepare(`
        SELECT *
        FROM order_requirement_summaries
        WHERE order_id = ?
    `).get(orderId);
    return requirementResult(order, row, listOrderRequirementFiles(orderId, accessors));
}

function saveOrderRequirementDraft(orderIdValue, input = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const orderId = positiveId(orderIdValue, '订单ID');
    requireOrder(orderId, accessors);
    const summaryText = normalizeSummaryText(input.summaryText);
    const availableFiles = listOrderRequirementFiles(orderId, accessors);
    const sourceFileIds = validateSourceFileIds(
        input.sourceFileIds === undefined
            ? availableFiles.map(file => file.id)
            : input.sourceFileIds,
        availableFiles
    );
    const existing = accessors.db.prepare(`
        SELECT * FROM order_requirement_summaries WHERE order_id = ?
    `).get(orderId);
    const confirmedFileIds = parseFileIds(existing?.confirmed_source_file_ids_json);
    const nextStatus = existing?.confirmed_text === summaryText
        && sameIds(sourceFileIds, confirmedFileIds)
        ? 'confirmed'
        : 'draft';
    const now = new Date().toISOString();

    if (existing) {
        const write = accessors.safeUpdate('order_requirement_summaries', existing.id, {
            draft_text: summaryText,
            source_file_ids_json: JSON.stringify(sourceFileIds),
            status: nextStatus,
        }, options.auditContext);
        options.onWrite?.(write);
    } else {
        const write = accessors.safeInsert('order_requirement_summaries', {
            order_id: orderId,
            draft_text: summaryText,
            confirmed_text: '',
            source_file_ids_json: JSON.stringify(sourceFileIds),
            confirmed_source_file_ids_json: '[]',
            status: 'draft',
            confirmed_at: null,
            created_at: now,
            updated_at: now,
        }, options.auditContext);
        options.onWrite?.(write);
    }
    return getOrderRequirementSummary(orderId, { dbAccessors: accessors });
}

function confirmOrderRequirementSummary(orderIdValue, input = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const orderId = positiveId(orderIdValue, '订单ID');
    const execute = () => {
        if (input.summaryText !== undefined || input.sourceFileIds !== undefined) {
            const current = getOrderRequirementSummary(orderId, { dbAccessors: accessors });
            saveOrderRequirementDraft(orderId, {
                summaryText: input.summaryText ?? current.draftText,
                sourceFileIds: input.sourceFileIds ?? current.sourceFileIds,
            }, {
                dbAccessors: accessors,
                auditContext: options.auditContext,
                onWrite: options.onWrite,
            });
        }
        const row = accessors.db.prepare(`
            SELECT * FROM order_requirement_summaries WHERE order_id = ?
        `).get(orderId);
        if (!row) {
            const error = new Error('请先保存客户要求草稿');
            error.statusCode = 409;
            throw error;
        }
        const draftText = normalizeSummaryText(row.draft_text);
        const availableFiles = listOrderRequirementFiles(orderId, accessors);
        const sourceFileIds = validateSourceFileIds(row.source_file_ids_json, availableFiles);
        const write = accessors.safeUpdate('order_requirement_summaries', row.id, {
            confirmed_text: draftText,
            confirmed_source_file_ids_json: JSON.stringify(sourceFileIds),
            status: 'confirmed',
            confirmed_at: new Date().toISOString(),
        }, options.auditContext);
        options.onWrite?.(write);
        return getOrderRequirementSummary(orderId, { dbAccessors: accessors });
    };
    return options.transaction === false
        ? execute()
        : typeof accessors.db.transaction === 'function'
        ? accessors.db.transaction(execute).immediate()
        : execute();
}

function revokeOrderRequirementConfirmation(orderIdValue, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const orderId = positiveId(orderIdValue, '订单ID');
    requireOrder(orderId, accessors);
    const row = accessors.db.prepare(`
        SELECT * FROM order_requirement_summaries WHERE order_id = ?
    `).get(orderId);
    if (!row?.confirmed_text) {
        const error = new Error('当前没有已经确认的客户要求知识');
        error.statusCode = 409;
        throw error;
    }
    const write = accessors.safeUpdate('order_requirement_summaries', row.id, {
        confirmed_text: '',
        confirmed_source_file_ids_json: '[]',
        status: 'draft',
        confirmed_at: null,
    }, options.auditContext);
    options.onWrite?.(write);
    return getOrderRequirementSummary(orderId, { dbAccessors: accessors });
}

function listConfirmedOrderRequirementsForKnowledge(options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const tableExists = accessors.db.prepare(`
        SELECT 1
        FROM sqlite_schema
        WHERE type = 'table' AND name = 'order_requirement_summaries'
    `).get();
    if (!tableExists) return [];
    return accessors.db.prepare(`
        SELECT
            id,
            order_id,
            confirmed_text,
            confirmed_source_file_ids_json,
            confirmed_at
        FROM order_requirement_summaries
        WHERE confirmed_text <> ''
        ORDER BY order_id
    `).all().map(row => ({
        id: Number(row.id),
        orderId: Number(row.order_id),
        confirmedText: row.confirmed_text,
        confirmedSourceFileIds: parseFileIds(row.confirmed_source_file_ids_json),
        confirmedAt: row.confirmed_at,
    }));
}

module.exports = {
    confirmOrderRequirementSummary,
    getOrderRequirementSummary,
    listConfirmedOrderRequirementsForKnowledge,
    parseFileIds,
    revokeOrderRequirementConfirmation,
    saveOrderRequirementDraft,
};
