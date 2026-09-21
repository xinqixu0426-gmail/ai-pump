const { parseFileIds } = require('./orderRequirements.cjs');

const PHASE_LABELS = Object.freeze({
    pre_production: '生产前',
    in_production: '生产中',
    post_production: '生产后',
});

const RECORD_TYPE_LABELS = Object.freeze({
    resource_preparation: '资源准备',
    material_preparation: '物料准备',
    supplier_confirmation: '供应商确认',
    capacity_adjustment: '产能调整',
    supplier_adjustment: '供应商调整',
    process_exception: '过程异常',
    quality_check: '过程质量检查',
    quality_result: '质量结果',
    delivery_result: '交付结果',
    customer_feedback: '客户反馈',
    other: '其他事实',
});

const RECORD_TYPES_BY_PHASE = Object.freeze({
    pre_production: new Set([
        'resource_preparation',
        'material_preparation',
        'supplier_confirmation',
        'other',
    ]),
    in_production: new Set([
        'capacity_adjustment',
        'supplier_adjustment',
        'process_exception',
        'quality_check',
        'other',
    ]),
    post_production: new Set([
        'quality_result',
        'delivery_result',
        'customer_feedback',
        'other',
    ]),
});

function loadDbAccessors() {
    return require('../db.cjs');
}

function badRequest(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
}

function notFound(message) {
    const error = new Error(message);
    error.statusCode = 404;
    return error;
}

function conflict(message) {
    const error = new Error(message);
    error.statusCode = 409;
    return error;
}

function positiveId(value, label = 'ID') {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw badRequest(`${label}无效`);
    return parsed;
}

function sameIds(left, right) {
    return JSON.stringify([...left].sort((a, b) => a - b))
        === JSON.stringify([...right].sort((a, b) => a - b));
}

function normalizePhase(value) {
    const phase = String(value || '').trim();
    if (!Object.prototype.hasOwnProperty.call(PHASE_LABELS, phase)) {
        throw badRequest('执行阶段无效');
    }
    return phase;
}

function normalizeRecordType(value, phase) {
    const recordType = String(value || '').trim();
    if (!RECORD_TYPES_BY_PHASE[phase]?.has(recordType)) {
        throw badRequest(`“${PHASE_LABELS[phase]}”阶段不支持该记录类型`);
    }
    return recordType;
}

function normalizeTitle(value, recordType) {
    const title = String(value || '').trim() || RECORD_TYPE_LABELS[recordType];
    if (title.length > 120) throw badRequest('执行档案标题不能超过 120 字');
    return title;
}

function normalizeSummaryText(value) {
    const result = String(value ?? '').trim();
    if (!result) throw badRequest('执行事实说明不能为空');
    if (result.length > 20000) throw badRequest('执行事实说明不能超过 20000 字');
    return result;
}

function normalizeOccurredAt(value, fallback = null) {
    const source = value || fallback || new Date().toISOString();
    const date = new Date(source);
    if (Number.isNaN(date.getTime())) throw badRequest('发生时间无效');
    return date.toISOString();
}

function requireOrder(orderId, accessors) {
    const order = accessors.db.prepare(`
        SELECT id, customer_name, contract_no, status
        FROM orders
        WHERE id = ? AND deleted_at IS NULL
    `).get(orderId);
    if (!order) throw notFound('订单不存在');
    return order;
}

function requireRecord(orderId, recordId, accessors) {
    const row = accessors.db.prepare(`
        SELECT *
        FROM order_execution_records
        WHERE id = ? AND order_id = ? AND deleted_at IS NULL
    `).get(recordId, orderId);
    if (!row) throw notFound('执行档案不存在');
    return row;
}

function listOrderFiles(orderId, accessors) {
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
          AND l.relation_role = 'execution_evidence'
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
        throw badRequest(`文件未关联当前订单：${invalid.join(', ')}`);
    }
    return requested;
}

function recordResult(row) {
    const sourceFileIds = parseFileIds(row.source_file_ids_json);
    const confirmedSourceFileIds = parseFileIds(row.confirmed_source_file_ids_json);
    const hasConfirmedVersion = Boolean(row.confirmed_text);
    const hasPendingChanges = hasConfirmedVersion && (
        row.phase !== row.confirmed_phase
        || row.record_type !== row.confirmed_record_type
        || row.title !== row.confirmed_title
        || row.draft_text !== row.confirmed_text
        || row.occurred_at !== row.confirmed_occurred_at
        || !sameIds(sourceFileIds, confirmedSourceFileIds)
    );
    return {
        id: Number(row.id),
        orderId: Number(row.order_id),
        phase: row.phase,
        phaseLabel: PHASE_LABELS[row.phase] || row.phase,
        recordType: row.record_type,
        recordTypeLabel: RECORD_TYPE_LABELS[row.record_type] || row.record_type,
        title: row.title,
        draftText: row.draft_text,
        occurredAt: row.occurred_at,
        sourceFileIds,
        confirmedPhase: row.confirmed_phase || null,
        confirmedPhaseLabel: row.confirmed_phase ? (PHASE_LABELS[row.confirmed_phase] || row.confirmed_phase) : '',
        confirmedRecordType: row.confirmed_record_type || '',
        confirmedRecordTypeLabel: row.confirmed_record_type
            ? (RECORD_TYPE_LABELS[row.confirmed_record_type] || row.confirmed_record_type)
            : '',
        confirmedTitle: row.confirmed_title || '',
        confirmedText: row.confirmed_text || '',
        confirmedOccurredAt: row.confirmed_occurred_at || null,
        confirmedSourceFileIds,
        status: row.status,
        hasConfirmedVersion,
        hasPendingChanges,
        knowledgeStatus: hasConfirmedVersion
            ? (hasPendingChanges ? 'confirmed_with_draft' : 'confirmed')
            : 'not_confirmed',
        confirmedAt: row.confirmed_at || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function getOrderExecutionRecords(orderIdValue, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const orderId = positiveId(orderIdValue, '订单ID');
    const order = requireOrder(orderId, accessors);
    const rows = accessors.db.prepare(`
        SELECT *
        FROM order_execution_records
        WHERE order_id = ? AND deleted_at IS NULL
        ORDER BY occurred_at DESC, id DESC
    `).all(orderId);
    return {
        orderId,
        customerName: order.customer_name || '',
        contractNo: order.contract_no || '',
        orderStatus: order.status || '',
        records: rows.map(recordResult),
        availableFiles: listOrderFiles(orderId, accessors),
    };
}

function normalizeDraftInput(input, existing, availableFiles) {
    const phase = normalizePhase(input.phase ?? existing?.phase);
    const recordType = normalizeRecordType(input.recordType ?? existing?.record_type, phase);
    return {
        phase,
        recordType,
        title: normalizeTitle(input.title ?? existing?.title, recordType),
        summaryText: normalizeSummaryText(input.summaryText ?? existing?.draft_text),
        occurredAt: normalizeOccurredAt(input.occurredAt, existing?.occurred_at),
        sourceFileIds: validateSourceFileIds(
            input.sourceFileIds === undefined
                ? parseFileIds(existing?.source_file_ids_json)
                : input.sourceFileIds,
            availableFiles
        ),
    };
}

function draftMatchesConfirmed(row, draft) {
    return Boolean(row?.confirmed_text)
        && draft.phase === row.confirmed_phase
        && draft.recordType === row.confirmed_record_type
        && draft.title === row.confirmed_title
        && draft.summaryText === row.confirmed_text
        && draft.occurredAt === row.confirmed_occurred_at
        && sameIds(draft.sourceFileIds, parseFileIds(row.confirmed_source_file_ids_json));
}

function createOrderExecutionDraft(orderIdValue, input = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const orderId = positiveId(orderIdValue, '订单ID');
    requireOrder(orderId, accessors);
    const draft = normalizeDraftInput(input, null, listOrderFiles(orderId, accessors));
    const now = new Date().toISOString();
    const inserted = accessors.safeInsert('order_execution_records', {
        order_id: orderId,
        phase: draft.phase,
        record_type: draft.recordType,
        title: draft.title,
        draft_text: draft.summaryText,
        occurred_at: draft.occurredAt,
        source_file_ids_json: JSON.stringify(draft.sourceFileIds),
        confirmed_phase: null,
        confirmed_record_type: '',
        confirmed_title: '',
        confirmed_text: '',
        confirmed_occurred_at: null,
        confirmed_source_file_ids_json: '[]',
        status: 'draft',
        confirmed_at: null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
    }, options.auditContext);
    options.onWrite?.(inserted);
    const recordId = Number(inserted.lastInsertRowid);
    return recordResult(requireRecord(orderId, recordId, accessors));
}

function updateOrderExecutionDraft(orderIdValue, recordIdValue, input = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const orderId = positiveId(orderIdValue, '订单ID');
    const recordId = positiveId(recordIdValue, '执行档案ID');
    requireOrder(orderId, accessors);
    const row = requireRecord(orderId, recordId, accessors);
    const draft = normalizeDraftInput(input, row, listOrderFiles(orderId, accessors));
    const write = accessors.safeUpdate('order_execution_records', recordId, {
        phase: draft.phase,
        record_type: draft.recordType,
        title: draft.title,
        draft_text: draft.summaryText,
        occurred_at: draft.occurredAt,
        source_file_ids_json: JSON.stringify(draft.sourceFileIds),
        status: draftMatchesConfirmed(row, draft) ? 'confirmed' : 'draft',
    }, options.auditContext);
    options.onWrite?.(write);
    return recordResult(requireRecord(orderId, recordId, accessors));
}

function confirmOrderExecutionRecord(orderIdValue, recordIdValue, input = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const orderId = positiveId(orderIdValue, '订单ID');
    const recordId = positiveId(recordIdValue, '执行档案ID');
    const execute = () => {
        if (Object.keys(input || {}).length > 0) {
            updateOrderExecutionDraft(orderId, recordId, input, {
                dbAccessors: accessors,
                auditContext: options.auditContext,
                onWrite: options.onWrite,
            });
        }
        const row = requireRecord(orderId, recordId, accessors);
        const draft = normalizeDraftInput({}, row, listOrderFiles(orderId, accessors));
        const write = accessors.safeUpdate('order_execution_records', recordId, {
            confirmed_phase: draft.phase,
            confirmed_record_type: draft.recordType,
            confirmed_title: draft.title,
            confirmed_text: draft.summaryText,
            confirmed_occurred_at: draft.occurredAt,
            confirmed_source_file_ids_json: JSON.stringify(draft.sourceFileIds),
            status: 'confirmed',
            confirmed_at: new Date().toISOString(),
        }, options.auditContext);
        options.onWrite?.(write);
        return recordResult(requireRecord(orderId, recordId, accessors));
    };
    return options.transaction === false
        ? execute()
        : typeof accessors.db.transaction === 'function'
        ? accessors.db.transaction(execute).immediate()
        : execute();
}

function revokeOrderExecutionConfirmation(orderIdValue, recordIdValue, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const orderId = positiveId(orderIdValue, '订单ID');
    const recordId = positiveId(recordIdValue, '执行档案ID');
    requireOrder(orderId, accessors);
    const row = requireRecord(orderId, recordId, accessors);
    if (!row.confirmed_text) throw conflict('当前执行档案尚未确认进入知识库');
    const write = accessors.safeUpdate('order_execution_records', recordId, {
        confirmed_phase: null,
        confirmed_record_type: '',
        confirmed_title: '',
        confirmed_text: '',
        confirmed_occurred_at: null,
        confirmed_source_file_ids_json: '[]',
        status: 'draft',
        confirmed_at: null,
    }, options.auditContext);
    options.onWrite?.(write);
    return recordResult(requireRecord(orderId, recordId, accessors));
}

function deleteOrderExecutionDraft(orderIdValue, recordIdValue, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const orderId = positiveId(orderIdValue, '订单ID');
    const recordId = positiveId(recordIdValue, '执行档案ID');
    requireOrder(orderId, accessors);
    const row = requireRecord(orderId, recordId, accessors);
    if (row.confirmed_text) {
        throw conflict('已确认的执行事实不能直接删除，请先撤销知识确认');
    }
    const write = accessors.softDelete(
        'order_execution_records',
        recordId,
        options.auditContext
    );
    options.onWrite?.(write);
    return { id: recordId, deleted: true };
}

function listConfirmedOrderExecutionRecordsForKnowledge(options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const tableExists = accessors.db.prepare(`
        SELECT 1
        FROM sqlite_schema
        WHERE type = 'table' AND name = 'order_execution_records'
    `).get();
    if (!tableExists) return [];
    return accessors.db.prepare(`
        SELECT
            id,
            order_id,
            confirmed_phase,
            confirmed_record_type,
            confirmed_title,
            confirmed_text,
            confirmed_occurred_at,
            confirmed_source_file_ids_json,
            confirmed_at
        FROM order_execution_records
        WHERE deleted_at IS NULL AND confirmed_text <> ''
        ORDER BY order_id, confirmed_occurred_at, id
    `).all().map(row => ({
        id: Number(row.id),
        orderId: Number(row.order_id),
        phase: row.confirmed_phase,
        phaseLabel: PHASE_LABELS[row.confirmed_phase] || row.confirmed_phase,
        recordType: row.confirmed_record_type,
        recordTypeLabel: RECORD_TYPE_LABELS[row.confirmed_record_type] || row.confirmed_record_type,
        title: row.confirmed_title,
        confirmedText: row.confirmed_text,
        occurredAt: row.confirmed_occurred_at,
        confirmedSourceFileIds: parseFileIds(row.confirmed_source_file_ids_json),
        confirmedAt: row.confirmed_at,
    }));
}

module.exports = {
    PHASE_LABELS,
    RECORD_TYPE_LABELS,
    RECORD_TYPES_BY_PHASE,
    confirmOrderExecutionRecord,
    createOrderExecutionDraft,
    deleteOrderExecutionDraft,
    getOrderExecutionRecords,
    listConfirmedOrderExecutionRecordsForKnowledge,
    revokeOrderExecutionConfirmation,
    updateOrderExecutionDraft,
};
