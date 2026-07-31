const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../api/database/migrations.cjs');
const {
    confirmOrderRequirementSummary,
    getOrderRequirementSummary,
    listConfirmedOrderRequirementsForKnowledge,
    revokeOrderRequirementConfirmation,
    saveOrderRequirementDraft,
} = require('../api/services/orderRequirements.cjs');
const { buildKnowledgeEntries } = require('../api/services/knowledge.cjs');
const { deleteFactoryFileLink } = require('../api/services/factoryFileArchive.cjs');

const NOW = '2026-07-30T08:00:00.000Z';

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
    return { db, safeInsert, safeUpdate };
}

function insertOrder(accessors) {
    return Number(accessors.safeInsert('orders', {
        customer_name: '菲律宾客户',
        contract_no: 'XYX-26013-2',
        status: '待确认',
        items_json: '[]',
        purchase_list_json: '[]',
        todos_json: '[]',
        created_at: NOW,
        updated_at: NOW,
        deleted_at: null,
    }).lastInsertRowid);
}

function insertFile(accessors, name = 'XYX-26013-2生产包装要求.pdf') {
    return Number(accessors.safeInsert('factory_files', {
        original_name: name,
        extension: '.pdf',
        detected_type: 'pdf',
        mime_type: 'application/pdf',
        file_size: 128,
        file_sha256: `hash-${name}`,
        file_blob: Buffer.from('file'),
        parser_status: 'parsed',
        source_type: 'direct_upload',
        duplicate_count: 1,
        metadata_json: '{}',
        parsed_text: '客户要求线圈规格 12x180mm',
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
        relation_role: 'customer_requirement',
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

test('V10.2 客户要求：只有人工确认版本进入订单知识，草稿修改保留旧确认版', () => {
    const accessors = createAccessors();
    try {
        const orderId = insertOrder(accessors);
        const fileId = insertFile(accessors);
        linkFileToOrder(accessors, fileId, orderId);

        const draft = saveOrderRequirementDraft(orderId, {
            summaryText: '客户明确要求：线圈规格 12x180mm。',
            sourceFileIds: [fileId],
        }, { dbAccessors: accessors });
        assert.equal(draft.knowledgeStatus, 'not_confirmed');
        assert.deepEqual(listConfirmedOrderRequirementsForKnowledge({ dbAccessors: accessors }), []);
        assert.doesNotMatch(buildOrderKnowledge(accessors, orderId).content, /12x180mm/);

        const confirmed = confirmOrderRequirementSummary(orderId, {}, { dbAccessors: accessors });
        assert.equal(confirmed.knowledgeStatus, 'confirmed');
        assert.match(buildOrderKnowledge(accessors, orderId).content, /客户要求（人工确认）[\s\S]*12x180mm/);

        const changed = saveOrderRequirementDraft(orderId, {
            summaryText: '客户明确要求：线圈规格 12x200mm。',
            sourceFileIds: [fileId],
        }, { dbAccessors: accessors });
        assert.equal(changed.knowledgeStatus, 'confirmed_with_draft');
        const beforeReconfirm = buildOrderKnowledge(accessors, orderId);
        assert.match(beforeReconfirm.content, /12x180mm/);
        assert.doesNotMatch(beforeReconfirm.content, /12x200mm/);

        confirmOrderRequirementSummary(orderId, {}, { dbAccessors: accessors });
        const afterReconfirm = buildOrderKnowledge(accessors, orderId);
        assert.match(afterReconfirm.content, /12x200mm/);
        assert.doesNotMatch(afterReconfirm.content, /12x180mm/);

        const revoked = revokeOrderRequirementConfirmation(orderId, { dbAccessors: accessors });
        assert.equal(revoked.knowledgeStatus, 'not_confirmed');
        assert.equal(revoked.draftText, '客户明确要求：线圈规格 12x200mm。');
        assert.deepEqual(listConfirmedOrderRequirementsForKnowledge({ dbAccessors: accessors }), []);
        assert.doesNotMatch(buildOrderKnowledge(accessors, orderId).content, /12x200mm/);
    } finally {
        accessors.db.close();
    }
});

test('V10.2 客户要求：拒绝引用未关联当前订单的文件', () => {
    const accessors = createAccessors();
    try {
        const orderId = insertOrder(accessors);
        const unrelatedFileId = insertFile(accessors, '其他订单.pdf');
        assert.throws(
            () => saveOrderRequirementDraft(orderId, {
                summaryText: '客户明确要求：使用其他订单文件。',
                sourceFileIds: [unrelatedFileId],
            }, { dbAccessors: accessors }),
            /文件未关联当前订单/
        );
        assert.equal(getOrderRequirementSummary(orderId, { dbAccessors: accessors }).hasRecord, false);
    } finally {
        accessors.db.close();
    }
});

test('V10.2 客户要求：已确认来源文件不能直接解除订单关联', () => {
    const accessors = createAccessors();
    try {
        const orderId = insertOrder(accessors);
        const fileId = insertFile(accessors);
        const linkId = linkFileToOrder(accessors, fileId, orderId);
        confirmOrderRequirementSummary(orderId, {
            summaryText: '客户明确要求：线圈规格 12x180mm。',
            sourceFileIds: [fileId],
        }, { dbAccessors: accessors });

        assert.throws(
            () => deleteFactoryFileLink(fileId, linkId, { dbAccessors: {
                ...accessors,
                softDelete(table, id) {
                    accessors.safeUpdate(table, id, { deleted_at: NOW });
                },
            } }),
            /已被确认的客户要求引用/
        );
        assert.equal(
            accessors.db.prepare('SELECT deleted_at FROM factory_file_links WHERE id = ?').get(linkId).deleted_at,
            null
        );
    } finally {
        accessors.db.close();
    }
});
