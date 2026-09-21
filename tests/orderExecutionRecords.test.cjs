const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../api/database/migrations.cjs');
const {
    confirmOrderExecutionRecord,
    createOrderExecutionDraft,
    deleteOrderExecutionDraft,
    getOrderExecutionRecords,
    listConfirmedOrderExecutionRecordsForKnowledge,
    revokeOrderExecutionConfirmation,
    updateOrderExecutionDraft,
} = require('../api/services/orderExecutionRecords.cjs');
const { buildKnowledgeEntries } = require('../api/services/knowledge.cjs');
const { deleteFactoryFileLink } = require('../api/services/factoryFileArchive.cjs');

const NOW = '2026-07-30T09:00:00.000Z';

function createAccessors() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, { now: NOW });
    const safeInsert = (table, values) => {
        const columns = Object.keys(values).filter(column => values[column] !== undefined);
        return db.prepare(`
            INSERT INTO ${table} (${columns.join(', ')})
            VALUES (${columns.map(() => '?').join(', ')})
        `).run(...columns.map(column => values[column]));
    };
    const safeUpdate = (table, id, values) => {
        const columns = Object.keys(values).filter(column => values[column] !== undefined);
        return db.prepare(`
            UPDATE ${table}
            SET ${columns.map(column => `${column} = ?`).join(', ')}, updated_at = ?
            WHERE id = ?
        `).run(...columns.map(column => values[column]), new Date().toISOString(), id);
    };
    const softDelete = (table, id) => safeUpdate(table, id, { deleted_at: NOW });
    return { db, safeInsert, safeUpdate, softDelete };
}

function insertOrder(accessors) {
    return Number(accessors.safeInsert('orders', {
        customer_name: '菲律宾客户',
        contract_no: 'XYX-26013-2',
        status: '待采购',
        items_json: '[]',
        purchase_list_json: '[]',
        todos_json: '[]',
        created_at: NOW,
        updated_at: NOW,
        deleted_at: null,
    }).lastInsertRowid);
}

function insertFile(accessors, name = '首批泵壳检查.jpg') {
    return Number(accessors.safeInsert('factory_files', {
        original_name: name,
        extension: '.jpg',
        detected_type: 'image',
        mime_type: 'image/jpeg',
        file_size: 128,
        file_sha256: `hash-${name}`,
        file_blob: Buffer.from('file'),
        parser_status: 'metadata_only',
        source_type: 'direct_upload',
        duplicate_count: 1,
        metadata_json: '{}',
        parsed_text: '',
        parsed_json: '{}',
        parser_error: '',
        parsed_at: NOW,
        created_at: NOW,
        updated_at: NOW,
        deleted_at: null,
    }).lastInsertRowid);
}

function linkFileToOrder(accessors, fileId, orderId) {
    return Number(accessors.safeInsert('factory_file_links', {
        file_id: fileId,
        target_type: 'order',
        target_id: orderId,
        relation_role: 'execution_evidence',
        title: '',
        note: '',
        source: 'business_page',
        created_at: NOW,
        updated_at: NOW,
        deleted_at: null,
    }).lastInsertRowid);
}

function buildOrderKnowledge(accessors, orderId) {
    const row = accessors.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    const entries = buildKnowledgeEntries({
        dbAccessors: accessors,
        parts: [],
        templates: [],
        recipes: [],
        technicalFiles: [],
        coils: [],
        documents: [],
        customers: [],
        quotations: [],
        orders: [{
            id: row.id,
            customerName: row.customer_name,
            contractNo: row.contract_no,
            status: row.status,
            itemsJson: row.items_json,
            purchaseListJson: row.purchase_list_json,
            todosJson: row.todos_json,
            remark: row.remark,
            updatedAt: row.updated_at,
        }],
        settings: [],
        ruleCandidates: [],
        qualitySummary: { issues: [] },
    });
    return entries.find(entry => entry.entryType === 'order');
}

function executionInput(fileId, overrides = {}) {
    return {
        phase: 'pre_production',
        recordType: 'material_preparation',
        title: '首批泵壳检查完成',
        summaryText: '首批 30 套泵壳已到厂并完成人工外观检查。',
        occurredAt: NOW,
        sourceFileIds: fileId ? [fileId] : [],
        ...overrides,
    };
}

test('V10.3 执行档案：草稿不入知识，确认后进入，修改时保留上一次确认事实', () => {
    const accessors = createAccessors();
    try {
        const orderId = insertOrder(accessors);
        const fileId = insertFile(accessors);
        linkFileToOrder(accessors, fileId, orderId);

        const draft = createOrderExecutionDraft(
            orderId,
            executionInput(fileId),
            { dbAccessors: accessors }
        );
        assert.equal(draft.knowledgeStatus, 'not_confirmed');
        assert.deepEqual(listConfirmedOrderExecutionRecordsForKnowledge({ dbAccessors: accessors }), []);
        assert.doesNotMatch(buildOrderKnowledge(accessors, orderId).content, /首批 30 套/);

        const confirmed = confirmOrderExecutionRecord(
            orderId,
            draft.id,
            {},
            { dbAccessors: accessors }
        );
        assert.equal(confirmed.knowledgeStatus, 'confirmed');
        const firstKnowledge = buildOrderKnowledge(accessors, orderId);
        assert.match(firstKnowledge.content, /执行档案（人工确认事实）/);
        assert.match(firstKnowledge.content, /首批 30 套/);
        assert.equal(firstKnowledge.metadata.executionRecordCount, 1);

        const changed = updateOrderExecutionDraft(
            orderId,
            draft.id,
            executionInput(fileId, {
                phase: 'in_production',
                recordType: 'supplier_adjustment',
                title: '泵壳供应商临时调整',
                summaryText: '因原供应商延期，人工决定将后续 20 套改由备用供应商交付。',
                occurredAt: '2026-07-30T10:00:00.000Z',
            }),
            { dbAccessors: accessors }
        );
        assert.equal(changed.knowledgeStatus, 'confirmed_with_draft');
        const beforeReconfirm = buildOrderKnowledge(accessors, orderId);
        assert.match(beforeReconfirm.content, /首批 30 套/);
        assert.doesNotMatch(beforeReconfirm.content, /备用供应商/);

        confirmOrderExecutionRecord(orderId, draft.id, {}, { dbAccessors: accessors });
        const afterReconfirm = buildOrderKnowledge(accessors, orderId);
        assert.match(afterReconfirm.content, /生产中\/供应商调整/);
        assert.match(afterReconfirm.content, /备用供应商/);
        assert.doesNotMatch(afterReconfirm.content, /首批 30 套/);

        const revoked = revokeOrderExecutionConfirmation(
            orderId,
            draft.id,
            { dbAccessors: accessors }
        );
        assert.equal(revoked.knowledgeStatus, 'not_confirmed');
        assert.match(revoked.draftText, /备用供应商/);
        assert.doesNotMatch(buildOrderKnowledge(accessors, orderId).content, /备用供应商/);
    } finally {
        accessors.db.close();
    }
});

test('V10.3 执行档案：阶段类型和来源附件必须匹配真实订单', () => {
    const accessors = createAccessors();
    try {
        const orderId = insertOrder(accessors);
        const unrelatedFileId = insertFile(accessors, '其他订单质量报告.jpg');

        assert.throws(
            () => createOrderExecutionDraft(orderId, executionInput(null, {
                phase: 'pre_production',
                recordType: 'quality_result',
            }), { dbAccessors: accessors }),
            /不支持该记录类型/
        );
        assert.throws(
            () => createOrderExecutionDraft(orderId, executionInput(unrelatedFileId), {
                dbAccessors: accessors,
            }),
            /文件未关联当前订单/
        );
        assert.equal(getOrderExecutionRecords(orderId, { dbAccessors: accessors }).records.length, 0);
    } finally {
        accessors.db.close();
    }
});

test('V10.3 执行档案：确认事实保护来源文件，未确认草稿可以删除', () => {
    const accessors = createAccessors();
    try {
        const orderId = insertOrder(accessors);
        const fileId = insertFile(accessors);
        const linkId = linkFileToOrder(accessors, fileId, orderId);
        const draft = createOrderExecutionDraft(
            orderId,
            executionInput(fileId),
            { dbAccessors: accessors }
        );

        const deleted = deleteOrderExecutionDraft(
            orderId,
            draft.id,
            { dbAccessors: accessors }
        );
        assert.equal(deleted.deleted, true);

        const confirmedDraft = createOrderExecutionDraft(
            orderId,
            executionInput(fileId),
            { dbAccessors: accessors }
        );
        confirmOrderExecutionRecord(orderId, confirmedDraft.id, {}, { dbAccessors: accessors });
        assert.throws(
            () => deleteOrderExecutionDraft(orderId, confirmedDraft.id, { dbAccessors: accessors }),
            /不能直接删除/
        );
        assert.throws(
            () => deleteFactoryFileLink(fileId, linkId, { dbAccessors: accessors }),
            /已被确认的执行档案/
        );
        assert.equal(
            accessors.db.prepare('SELECT deleted_at FROM factory_file_links WHERE id = ?').get(linkId).deleted_at,
            null
        );
    } finally {
        accessors.db.close();
    }
});
