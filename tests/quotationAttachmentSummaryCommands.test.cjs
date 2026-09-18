const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../api/database/migrations.cjs');
const {
    attachQuotationInquiry,
    getQuotationAttachmentSummary,
} = require('../api/services/quotationAttachmentSummaries.cjs');
const {
    quotationSavePreviewHash,
} = require('../api/services/quotationDraft.cjs');

function createFixture() {
    const db = new Database(':memory:');
    runMigrations(db, { now: '2026-08-11T08:00:00.000Z' });
    let tick = 0;
    const nextTime = () => `2026-08-11T08:00:${String(++tick).padStart(2, '0')}.000Z`;
    const audit = (action, table, id, context) => Number(db.prepare(`
        INSERT INTO audit_log (
            action, table_name, record_id, user, request_id,
            operation_id, capability_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        action,
        table,
        id,
        context?.user || 'test',
        context?.requestId || null,
        context?.operationId || null,
        context?.capabilityId || null,
        nextTime()
    ).lastInsertRowid);
    const dependencies = {
        db,
        safeInsert(table, values, context) {
            const columns = Object.keys(values).filter(key => values[key] !== undefined);
            const info = db.prepare(`
                INSERT INTO ${table} (${columns.join(', ')})
                VALUES (${columns.map(() => '?').join(', ')})
            `).run(...columns.map(key => values[key]));
            return {
                ...info,
                auditId: audit('INSERT', table, Number(info.lastInsertRowid), context),
            };
        },
    };
    const customerId = Number(db.prepare(`
        INSERT INTO customers (name, created_at, updated_at) VALUES ('客户A', ?, ?)
    `).run(nextTime(), nextTime()).lastInsertRowid);
    const quotationId = Number(db.prepare(`
        INSERT INTO quotations (
            customer_id, status, items_json, created_at, updated_at
        ) VALUES (?, '报价中', '[]', ?, ?)
    `).run(customerId, nextTime(), nextTime()).lastInsertRowid);
    const fileIds = Array.from({ length: 21 }, (_, index) => Number(db.prepare(`
        INSERT INTO factory_files (
            original_name, extension, detected_type, mime_type, file_size,
            file_sha256, file_blob, parser_status, source_type, duplicate_count,
            metadata_json, parsed_text, parsed_json, parser_error,
            created_at, updated_at
        ) VALUES (?, '.docx', 'text',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            100, ?, X'01', 'parsed', 'direct_upload', 1,
            '{}', '木箱包装', '{}', '', ?, ?)
    `).run(`客户要求${index + 1}.docx`, `quotation-word-hash-${index + 1}`, nextTime(), nextTime()).lastInsertRowid));
    return { db, dependencies, quotationId, fileIds };
}

test('新建报价询价资料：创建报价时关联原始附件并保存 AI 摘要', () => {
    const fixture = createFixture();
    try {
        const before = fixture.db.prepare('SELECT * FROM quotations WHERE id = ?')
            .get(fixture.quotationId);
        const result = attachQuotationInquiry(fixture.quotationId, {
            attachmentFileIds: fixture.fileIds.slice(0, 2),
            attachmentSummary: '客户要求木箱包装；价格和交期未提供。',
            attachmentSourceFileIds: fixture.fileIds.slice(0, 2),
        }, {
            dbAccessors: fixture.dependencies,
            auditContext: { capabilityId: 'quotations.create' },
        });
        const after = fixture.db.prepare('SELECT * FROM quotations WHERE id = ?')
            .get(fixture.quotationId);
        const loaded = getQuotationAttachmentSummary(fixture.quotationId, {
            dbAccessors: fixture.dependencies,
        });

        assert.equal(result.linkIds.length, 2);
        assert.equal(result.auditIds.length, 3);
        assert.equal(result.expectedAuditCount, 3);
        assert.equal(loaded.availableFiles.length, 2);
        assert.equal(loaded.draftText, '客户要求木箱包装；价格和交期未提供。');
        assert.deepEqual(loaded.sourceFileIds, fixture.fileIds.slice(0, 2));
        assert.deepEqual(after, before, '询价摘要不得修改正式报价金额、明细或状态');
    } finally {
        fixture.db.close();
    }
});

test('新建报价询价资料：没有附件和摘要时不创建附属记录', () => {
    const fixture = createFixture();
    try {
        const result = attachQuotationInquiry(fixture.quotationId, {}, {
            dbAccessors: fixture.dependencies,
        });
        assert.deepEqual(result.linkIds, []);
        assert.equal(result.summaryId, null);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM factory_file_links').get().count, 0);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM quotation_attachment_summaries').get().count, 0);
    } finally {
        fixture.db.close();
    }
});

test('新建报价询价资料：拒绝不存在文件、报价外摘要来源、来源无摘要和数量超限', () => {
    const fixture = createFixture();
    try {
        assert.throws(() => attachQuotationInquiry(fixture.quotationId, {
            attachmentFileIds: [999],
        }, { dbAccessors: fixture.dependencies }), /不存在或已删除/);

        assert.throws(() => attachQuotationInquiry(fixture.quotationId, {
            attachmentFileIds: [fixture.fileIds[0]],
            attachmentSummary: '非法来源',
            attachmentSourceFileIds: [fixture.fileIds[1]],
        }, { dbAccessors: fixture.dependencies }), /未关联当前报价/);

        assert.throws(() => attachQuotationInquiry(fixture.quotationId, {
            attachmentFileIds: fixture.fileIds.slice(0, 5),
            attachmentSummary: '过多来源',
            attachmentSourceFileIds: fixture.fileIds.slice(0, 5),
        }, { dbAccessors: fixture.dependencies }), /最多选择 4 个/);

        assert.throws(() => attachQuotationInquiry(fixture.quotationId, {
            attachmentFileIds: fixture.fileIds.slice(0, 1),
            attachmentSourceFileIds: fixture.fileIds.slice(0, 1),
        }, { dbAccessors: fixture.dependencies }), /必须保存附件摘要/);

        assert.throws(() => attachQuotationInquiry(fixture.quotationId, {
            attachmentFileIds: fixture.fileIds,
        }, { dbAccessors: fixture.dependencies }), /最多关联 20 个/);
    } finally {
        fixture.db.close();
    }
});

test('报价保存预览哈希绑定询价附件、摘要和摘要来源', () => {
    const base = {
        customerId: 1,
        status: '报价中',
        itemsJson: '[]',
        totalCost: 100,
        totalPrice: 120,
        remark: '',
        attachmentFileIds: [1, 2],
        attachmentSummary: '客户要求木箱包装',
        attachmentSourceFileIds: [1],
    };
    const original = quotationSavePreviewHash(base);
    assert.notEqual(quotationSavePreviewHash({
        ...base,
        attachmentFileIds: [1, 3],
    }), original);
    assert.notEqual(quotationSavePreviewHash({
        ...base,
        attachmentSummary: '客户要求纸箱包装',
    }), original);
    assert.notEqual(quotationSavePreviewHash({
        ...base,
        attachmentSourceFileIds: [2],
    }), original);
});

test('读取报价询价资料严格只读', () => {
    const fixture = createFixture();
    try {
        attachQuotationInquiry(fixture.quotationId, {
            attachmentFileIds: fixture.fileIds.slice(0, 2),
            attachmentSummary: '只读摘要',
            attachmentSourceFileIds: fixture.fileIds.slice(0, 1),
        }, { dbAccessors: fixture.dependencies });
        const auditBefore = fixture.db.prepare('SELECT COUNT(*) count FROM audit_log').get().count;
        const linksBefore = fixture.db.prepare('SELECT COUNT(*) count FROM factory_file_links').get().count;
        const result = getQuotationAttachmentSummary(fixture.quotationId, {
            dbAccessors: fixture.dependencies,
        });
        assert.equal(result.draftText, '只读摘要');
        assert.equal(result.availableFiles.length, 2);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM audit_log').get().count, auditBefore);
        assert.equal(fixture.db.prepare('SELECT COUNT(*) count FROM factory_file_links').get().count, linksBefore);
    } finally {
        fixture.db.close();
    }
});
