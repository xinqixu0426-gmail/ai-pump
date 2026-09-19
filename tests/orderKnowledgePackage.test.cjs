const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../api/database/migrations.cjs');
const {
    confirmOrderExecutionRecord,
    createOrderExecutionDraft,
    updateOrderExecutionDraft,
} = require('../api/services/orderExecutionRecords.cjs');
const { buildOrderKnowledgePackage } = require('../api/services/orderKnowledgePackage.cjs');
const {
    confirmOrderRequirementSummary,
    saveOrderRequirementDraft,
} = require('../api/services/orderRequirements.cjs');

const NOW = '2026-07-30T12:00:00.000Z';

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
        `).run(...columns.map(column => values[column]), NOW, id);
    };
    const softDelete = (table, id) => safeUpdate(table, id, { deleted_at: NOW });
    const orderRow = row => ({
        id: row.id,
        customerName: row.customer_name,
        contractNo: row.contract_no,
        status: row.status,
        remark: row.remark,
        purchaseCompletedAt: row.purchase_completed_at,
        statusChangedAt: row.status_changed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    });
    return { db, safeInsert, safeUpdate, softDelete, orderRow };
}

function insertOrder(accessors) {
    return Number(accessors.safeInsert('orders', {
        customer_name: '菲律宾客户',
        contract_no: 'XYX-26013-2',
        remark: '首批实际订单',
        status: '采购中',
        items_json: JSON.stringify([
            { recipeId: 8, recipeName: 'V1600-12-180', qty: 30, unitCost: 272.85, unitPrice: 310 },
        ]),
        purchase_list_json: JSON.stringify([
            { model: '8米新界式成品电缆', plannedQty: 30, orderedQty: 30, receivedQty: 20, stockedQty: 10 },
        ]),
        todos_json: JSON.stringify([{ id: 'todo-1', text: '确认包装标签', done: false }]),
        created_at: NOW,
        updated_at: NOW,
        deleted_at: null,
    }).lastInsertRowid);
}

function insertAndLinkFile(accessors, orderId, role, name) {
    const fileId = Number(accessors.safeInsert('factory_files', {
        original_name: name,
        extension: '.pdf',
        detected_type: 'pdf',
        mime_type: 'application/pdf',
        file_size: 128,
        file_sha256: `${role}-${name}`,
        file_blob: Buffer.from('file'),
        parser_status: 'parsed',
        source_type: 'direct_upload',
        duplicate_count: 1,
        metadata_json: '{}',
        parsed_text: 'test',
        parsed_json: '{}',
        parser_error: '',
        parsed_at: NOW,
        created_at: NOW,
        updated_at: NOW,
        deleted_at: null,
    }).lastInsertRowid);
    accessors.safeInsert('factory_file_links', {
        file_id: fileId,
        target_type: 'order',
        target_id: orderId,
        relation_role: role,
        title: '',
        note: '',
        source: 'business_page',
        created_at: NOW,
        updated_at: NOW,
        deleted_at: null,
    });
    return fileId;
}

function readinessContext(record) {
    return {
        plan: { purchaseList: JSON.parse(record.purchase_list_json) },
        readiness: {
            order: { id: Number(record.id), status: record.status },
            verdict: 'waiting_materials',
            canProduce: false,
            summary: '仍有物料尚未全部入库。',
            steps: [],
            blockers: [],
            warnings: ['采购到货尚未全部入库'],
            shortages: [{ model: '8米新界式成品电缆', shortageQty: 20 }],
            metrics: { totalUnits: 30 },
        },
    };
}

test('V10.4 订单知识包合并实时业务状态和人工确认事实，并排除待确认草稿', () => {
    const accessors = createAccessors();
    try {
        const orderId = insertOrder(accessors);
        const requirementFileId = insertAndLinkFile(
            accessors,
            orderId,
            'customer_requirement',
            '生产包装要求.pdf'
        );
        const executionFileId = insertAndLinkFile(
            accessors,
            orderId,
            'execution_evidence',
            '供应商调整记录.pdf'
        );

        confirmOrderRequirementSummary(orderId, {
            summaryText: '客户明确要求：30 台使用指定包装标签。',
            sourceFileIds: [requirementFileId],
        }, { dbAccessors: accessors });
        saveOrderRequirementDraft(orderId, {
            summaryText: '未确认草稿：改用另一种标签。',
            sourceFileIds: [requirementFileId],
        }, { dbAccessors: accessors });

        const execution = createOrderExecutionDraft(orderId, {
            phase: 'in_production',
            recordType: 'supplier_adjustment',
            title: '电缆供应商调整',
            summaryText: '人工确认：20 根电缆改由备用供应商交付。',
            occurredAt: NOW,
            sourceFileIds: [executionFileId],
        }, { dbAccessors: accessors });
        confirmOrderExecutionRecord(orderId, execution.id, {}, { dbAccessors: accessors });
        updateOrderExecutionDraft(orderId, execution.id, {
            summaryText: '未确认草稿：改回原供应商。',
        }, { dbAccessors: accessors });

        const result = buildOrderKnowledgePackage(orderId, {
            dbAccessors: accessors,
            buildReadinessContext: readinessContext,
        });

        assert.equal(result.order.status, '采购中');
        assert.equal(result.order.totals.totalUnits, 30);
        assert.equal(result.order.totals.totalCost, 8185.5);
        assert.equal(result.readiness.verdict, 'waiting_materials');
        assert.equal(result.confirmedKnowledge.customerRequirement.text, '客户明确要求：30 台使用指定包装标签。');
        assert.match(result.confirmedKnowledge.executionRecords[0].text, /备用供应商/);
        assert.doesNotMatch(JSON.stringify(result.confirmedKnowledge), /未确认草稿/);
        assert.equal(result.coverage.pendingDraftCount, 2);
        assert.deepEqual(
            result.sourceFiles.map(file => file.relationRole).sort(),
            ['customer_requirement', 'execution_evidence']
        );
        assert.equal(result.provenance.liveBusiness.kind, 'live_business');
        assert.equal(result.provenance.confirmedKnowledge.kind, 'human_confirmed');
        assert.equal(result.provenance.confirmedKnowledge.draftsExcluded, true);
    } finally {
        accessors.db.close();
    }
});

test('V10.4 订单知识包拒绝非法或不存在的订单', () => {
    const accessors = createAccessors();
    try {
        assert.throws(
            () => buildOrderKnowledgePackage(0, {
                dbAccessors: accessors,
                buildReadinessContext: readinessContext,
            }),
            /订单ID无效/
        );
        assert.throws(
            () => buildOrderKnowledgePackage(99, {
                dbAccessors: accessors,
                buildReadinessContext: readinessContext,
            }),
            /订单不存在/
        );
    } finally {
        accessors.db.close();
    }
});
