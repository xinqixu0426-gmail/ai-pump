const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../api/database/migrations.cjs');
const {
    archiveFactoryFile,
    deleteFactoryFileLink,
    listFactoryFileLinks,
    searchFactoryFileArchiveTargets,
} = require('../api/services/factoryFileArchive.cjs');
const {
    ARCHIVE_CAPABILITY_ID,
    LINK_DELETE_CAPABILITY_ID,
    buildFactoryFileArchivePreview,
    executeConfirmedFactoryFileArchive,
    executeFactoryFileLinkDelete,
} = require('../api/services/factoryFileCommands.cjs');
const {
    resetBusinessConfirmationsForTests,
} = require('../api/services/businessConfirmation.cjs');
const {
    BUSINESS_ATTACHMENT_UPLOAD_CAPABILITY_ID,
    buildFactoryFileBusinessAttachmentPreview,
    executeConfirmedFactoryFileBusinessAttachmentUpload,
} = require('../api/services/factoryFileLifecycleCommands.cjs');

const NOW = '2026-07-29T08:00:00.000Z';

function createAccessors() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, { now: NOW });
    let nextAuditId = 1;
    const safeInsert = (table, values) => {
        const columns = Object.keys(values).filter(column => values[column] !== undefined);
        const info = db.prepare(`
            INSERT INTO ${table} (${columns.join(', ')})
            VALUES (${columns.map(() => '?').join(', ')})
        `).run(...columns.map(column => values[column]));
        return { ...info, auditId: nextAuditId++ };
    };
    const safeUpdate = (table, id, values) => {
        const normalized = {
            ...values,
            updated_at: new Date().toISOString(),
        };
        const columns = Object.keys(normalized).filter(
            column => normalized[column] !== undefined
        );
        const info = db.prepare(`
            UPDATE ${table}
            SET ${columns.map(column => `${column} = ?`).join(', ')}
            WHERE id = ?
        `).run(...columns.map(column => normalized[column]), id);
        return { ...info, auditId: nextAuditId++ };
    };
    const softDelete = (table, id) => safeUpdate(table, id, {
        deleted_at: NOW,
        updated_at: NOW,
    });
    return { db, safeInsert, safeUpdate, softDelete };
}

function commandContext(capabilityId, key) {
    return {
        actorKey: 'user:file-command-test',
        capabilityId,
        idempotencyKey: key,
        operationId: key,
        requestId: `request:${key}`,
        warnings: [],
    };
}

function insertFactoryFile(accessors, overrides = {}) {
    const values = {
        original_name: 'V1600技术参数.xlsx',
        extension: '.xlsx',
        detected_type: 'spreadsheet',
        mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        file_size: 128,
        file_sha256: `hash-${Math.random()}`,
        file_blob: Buffer.from('file'),
        parser_status: 'parsed',
        source_type: 'direct_upload',
        duplicate_count: 1,
        metadata_json: '{}',
        parsed_text: '扬程 38m，流量 12m3/h',
        parsed_json: '{"sheets":[{"name":"参数"}]}',
        parser_error: '',
        parsed_at: NOW,
        created_at: NOW,
        updated_at: NOW,
        deleted_at: null,
        ...overrides,
    };
    return Number(accessors.safeInsert('factory_files', values).lastInsertRowid);
}

function insertRecipe(accessors, name = 'V1600-12-180') {
    return Number(accessors.safeInsert('recipes', {
        name,
        spec: '60Hz',
        created_at: NOW,
        updated_at: NOW,
        deleted_at: null,
    }).lastInsertRowid);
}

function insertOrder(accessors, overrides = {}) {
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
        ...overrides,
    }).lastInsertRowid);
}

test('V10.1 订单资料：客户要求文件可绑定订单并按合同号检索', () => {
    const accessors = createAccessors();
    try {
        const fileId = insertFactoryFile(accessors, {
            original_name: 'XYX-26013-2生产包装要求.pdf',
            extension: '.pdf',
            detected_type: 'pdf',
            mime_type: 'application/pdf',
        });
        const orderId = insertOrder(accessors);

        const targets = searchFactoryFileArchiveTargets({
            targetType: 'order',
            query: '26013',
        }, { dbAccessors: accessors });
        assert.deepEqual(targets.map(item => item.id), [orderId]);
        assert.match(targets[0].label, /菲律宾客户.*XYX-26013-2/);

        const archived = archiveFactoryFile(fileId, {
            targetType: 'order',
            targetId: orderId,
            source: 'business_page',
        }, { dbAccessors: accessors });

        assert.equal(archived.link.relationRole, 'customer_requirement');
        assert.equal(archived.link.targetId, orderId);
        assert.match(archived.link.target.label, /XYX-26013-2/);
        assert.equal(listFactoryFileLinks({
            targetType: 'order',
            targetId: orderId,
        }, { dbAccessors: accessors }).length, 1);
    } finally {
        accessors.db.close();
    }
});

test('V9.5 文件归档：搜索真实配方并建立可去重业务关联', () => {
    const accessors = createAccessors();
    try {
        const fileId = insertFactoryFile(accessors);
        const recipeId = insertRecipe(accessors);
        insertRecipe(accessors, 'V750-2寸');

        const targets = searchFactoryFileArchiveTargets({
            targetType: 'recipe',
            query: 'V1600',
        }, { dbAccessors: accessors });
        assert.deepEqual(targets.map(item => item.id), [recipeId]);
        assert.equal(targets[0].label, 'V1600-12-180');

        const first = archiveFactoryFile(fileId, {
            targetType: 'recipe',
            targetId: recipeId,
            note: '客户确认后的技术参数',
        }, { dbAccessors: accessors });
        const second = archiveFactoryFile(fileId, {
            targetType: 'recipe',
            targetId: recipeId,
        }, { dbAccessors: accessors });

        assert.equal(first.deduplicated, false);
        assert.equal(first.link.relationRole, 'technical_reference');
        assert.equal(first.link.target.label, 'V1600-12-180');
        assert.equal(second.deduplicated, true);
        assert.equal(listFactoryFileLinks({ fileId }, { dbAccessors: accessors }).length, 1);
    } finally {
        accessors.db.close();
    }
});

test('V9.5 文件归档：同一解析文件只创建一份知识资料并保留解析正文', () => {
    const accessors = createAccessors();
    try {
        const fileId = insertFactoryFile(accessors);
        const first = archiveFactoryFile(fileId, {
            targetType: 'knowledge_document',
            title: 'V1600 技术参数',
            documentType: 'spreadsheet',
            tags: ['V1600', '技术参数'],
            note: '现场确认资料',
        }, { dbAccessors: accessors });
        const second = archiveFactoryFile(fileId, {
            targetType: 'knowledge_document',
            title: '重复标题不会复制资料',
        }, { dbAccessors: accessors });

        assert.equal(first.deduplicated, false);
        assert.equal(first.knowledgeDocument.title, 'V1600 技术参数');
        assert.equal(second.deduplicated, true);
        assert.equal(second.knowledgeDocument.id, first.knowledgeDocument.id);
        assert.equal(
            accessors.db.prepare('SELECT COUNT(*) AS count FROM knowledge_documents WHERE file_id = ?').get(fileId).count,
            1
        );
        const document = accessors.db.prepare('SELECT * FROM knowledge_documents WHERE file_id = ?').get(fileId);
        assert.equal(document.extracted_text, '扬程 38m，流量 12m3/h');
        assert.deepEqual(JSON.parse(document.tags_json), ['V1600', '技术参数']);
        assert.equal(listFactoryFileLinks({ fileId }, { dbAccessors: accessors })[0].targetType, 'knowledge_document');
    } finally {
        accessors.db.close();
    }
});

test('V9.5 文件归档：拒绝不存在的业务对象和未完成解析的知识资料', () => {
    const accessors = createAccessors();
    try {
        const parsedFileId = insertFactoryFile(accessors);
        const pendingFileId = insertFactoryFile(accessors, {
            original_name: '等待解析.pdf',
            extension: '.pdf',
            detected_type: 'pdf',
            mime_type: 'application/pdf',
            file_sha256: 'pending-file',
            parser_status: 'pending',
            parsed_at: null,
        });
        assert.throws(
            () => archiveFactoryFile(parsedFileId, {
                targetType: 'recipe',
                targetId: 999,
            }, { dbAccessors: accessors }),
            /业务资料关联目标不存在/
        );
        assert.throws(
            () => archiveFactoryFile(pendingFileId, {
                targetType: 'knowledge_document',
            }, { dbAccessors: accessors }),
            /尚未解析完成/
        );
    } finally {
        accessors.db.close();
    }
});

test('V9.5 文件归档：解除关联采用软删除且可重新归档', () => {
    const accessors = createAccessors();
    try {
        const fileId = insertFactoryFile(accessors);
        const recipeId = insertRecipe(accessors);
        const archived = archiveFactoryFile(fileId, {
            targetType: 'recipe',
            targetId: recipeId,
        }, { dbAccessors: accessors });

        deleteFactoryFileLink(fileId, archived.link.id, { dbAccessors: accessors });
        assert.equal(listFactoryFileLinks({ fileId }, { dbAccessors: accessors }).length, 0);

        const restored = archiveFactoryFile(fileId, {
            targetType: 'recipe',
            targetId: recipeId,
        }, { dbAccessors: accessors });
        assert.equal(restored.link.id, archived.link.id);
        assert.equal(listFactoryFileLinks({ fileId }, { dbAccessors: accessors }).length, 1);
    } finally {
        accessors.db.close();
    }
});

test('文件归档正式命令：预览绑定快照、强审计并支持持久化幂等重放', () => {
    resetBusinessConfirmationsForTests();
    const accessors = createAccessors();
    try {
        const fileId = insertFactoryFile(accessors);
        const recipeId = insertRecipe(accessors);
        const preview = buildFactoryFileArchivePreview(
            accessors,
            fileId,
            {
                targetType: 'recipe',
                targetId: recipeId,
                note: '正式命令归档',
            },
            'user:file-command-test'
        );
        assert.equal(preview.capabilityId, ARCHIVE_CAPABILITY_ID);
        assert.equal(preview.action, 'create_link');
        assert.equal(preview.changes.length, 1);

        const input = { confirmationToken: preview.confirmationToken };
        const context = commandContext(
            ARCHIVE_CAPABILITY_ID,
            'file-archive:test-1'
        );
        const first = executeConfirmedFactoryFileArchive(
            accessors,
            fileId,
            input,
            context,
            'user:file-command-test'
        );
        const replay = executeConfirmedFactoryFileArchive(
            accessors,
            fileId,
            input,
            context,
            'user:file-command-test'
        );

        assert.equal(first.deduplicated, false);
        assert.equal(first.auditIds.length, 1);
        assert.equal(first.changes.length, 1);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(replay.operationId, first.operationId);
        assert.equal(
            accessors.db.prepare(`
                SELECT COUNT(*) AS count
                FROM factory_file_links
                WHERE file_id = ? AND deleted_at IS NULL
            `).get(fileId).count,
            1
        );
    } finally {
        resetBusinessConfirmationsForTests();
        accessors.db.close();
    }
});

test('文件归档正式命令：预览后目标版本变化时拒绝写入', () => {
    resetBusinessConfirmationsForTests();
    const accessors = createAccessors();
    try {
        const fileId = insertFactoryFile(accessors);
        const recipeId = insertRecipe(accessors);
        const preview = buildFactoryFileArchivePreview(
            accessors,
            fileId,
            { targetType: 'recipe', targetId: recipeId },
            'user:file-command-test'
        );
        accessors.db.prepare(
            'UPDATE recipes SET updated_at = ? WHERE id = ?'
        ).run('2026-07-30T08:00:00.000Z', recipeId);

        assert.throws(
            () => executeConfirmedFactoryFileArchive(
                accessors,
                fileId,
                { confirmationToken: preview.confirmationToken },
                commandContext(
                    ARCHIVE_CAPABILITY_ID,
                    'file-archive:test-stale'
                ),
                'user:file-command-test'
            ),
            error => error?.code === 'factory_file_archive_preview_stale'
        );
        assert.equal(
            accessors.db.prepare(
                'SELECT COUNT(*) AS count FROM factory_file_links'
            ).get().count,
            0
        );
    } finally {
        resetBusinessConfirmationsForTests();
        accessors.db.close();
    }
});

test('业务附件 Service 在同一事务创建文件与关联并支持幂等重放', () => {
    resetBusinessConfirmationsForTests();
    const accessors = createAccessors();
    try {
        const recipeId = insertRecipe(accessors, 'ATTACHMENT-ATOMIC');
        const input = {
            buffer: Buffer.from('atomic attachment', 'utf8'),
            originalName: 'atomic.txt',
            mimeType: 'text/plain',
            targetType: 'recipe',
            targetId: recipeId,
            relationRole: 'technical_reference',
            title: '原子附件',
            source: 'business_page',
        };
        const preview = buildFactoryFileBusinessAttachmentPreview(
            accessors,
            input,
            'user:file-command-test'
        );
        const context = {
            ...commandContext(
                BUSINESS_ATTACHMENT_UPLOAD_CAPABILITY_ID,
                'file-business-attachment:test-1'
            ),
            idempotencyKey: preview.suggestedIdempotencyKey,
        };
        const commandInput = {
            buffer: input.buffer,
            originalName: input.originalName,
            mimeType: input.mimeType,
            confirmationToken: preview.confirmationToken,
        };
        const first = executeConfirmedFactoryFileBusinessAttachmentUpload(
            accessors,
            commandInput,
            context,
            'user:file-command-test'
        );
        const replay = executeConfirmedFactoryFileBusinessAttachmentUpload(
            accessors,
            commandInput,
            context,
            'user:file-command-test'
        );
        assert.equal(first.file.originalName, 'atomic.txt');
        assert.equal(first.link.targetId, recipeId);
        assert.equal(first.auditIds.length, 2);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(
            accessors.db.prepare('SELECT COUNT(*) AS count FROM factory_files WHERE deleted_at IS NULL').get().count,
            1
        );
        assert.equal(
            accessors.db.prepare('SELECT COUNT(*) AS count FROM factory_file_links WHERE deleted_at IS NULL').get().count,
            1
        );
    } finally {
        resetBusinessConfirmationsForTests();
        accessors.db.close();
    }
});

test('业务附件关联写失败会回滚刚存储的文件和上传审计', () => {
    resetBusinessConfirmationsForTests();
    const accessors = createAccessors();
    try {
        const recipeId = insertRecipe(accessors, 'ATTACHMENT-ROLLBACK');
        const input = {
            buffer: Buffer.from('rollback attachment', 'utf8'),
            originalName: 'rollback.txt',
            mimeType: 'text/plain',
            targetType: 'recipe',
            targetId: recipeId,
            relationRole: 'technical_reference',
            source: 'business_page',
        };
        const preview = buildFactoryFileBusinessAttachmentPreview(
            accessors,
            input,
            'user:file-command-test'
        );
        const failingAccessors = {
            ...accessors,
            safeInsert(table, values, context) {
                if (table === 'factory_file_links') {
                    throw new Error('injected archive link failure');
                }
                return accessors.safeInsert(table, values, context);
            },
        };
        assert.throws(
            () => executeConfirmedFactoryFileBusinessAttachmentUpload(
                failingAccessors,
                {
                    buffer: input.buffer,
                    originalName: input.originalName,
                    mimeType: input.mimeType,
                    confirmationToken: preview.confirmationToken,
                },
                {
                    ...commandContext(
                        BUSINESS_ATTACHMENT_UPLOAD_CAPABILITY_ID,
                        'file-business-attachment:rollback'
                    ),
                    idempotencyKey: preview.suggestedIdempotencyKey,
                },
                'user:file-command-test'
            ),
            /injected archive link failure/
        );
        assert.equal(
            accessors.db.prepare("SELECT COUNT(*) AS count FROM factory_files WHERE original_name = 'rollback.txt'").get().count,
            0
        );
        assert.equal(
            accessors.db.prepare('SELECT COUNT(*) AS count FROM factory_file_links').get().count,
            0
        );
    } finally {
        resetBusinessConfirmationsForTests();
        accessors.db.close();
    }
});

test('文件关联删除正式命令：校验版本、强审计并安全重放', () => {
    const accessors = createAccessors();
    try {
        const fileId = insertFactoryFile(accessors);
        const recipeId = insertRecipe(accessors);
        const archived = archiveFactoryFile(fileId, {
            targetType: 'recipe',
            targetId: recipeId,
        }, { dbAccessors: accessors });
        const context = commandContext(
            LINK_DELETE_CAPABILITY_ID,
            'file-link-delete:test-1'
        );
        const input = { expectedUpdatedAt: archived.link.updatedAt };
        const first = executeFactoryFileLinkDelete(
            accessors,
            fileId,
            archived.link.id,
            input,
            context
        );
        const replay = executeFactoryFileLinkDelete(
            accessors,
            fileId,
            archived.link.id,
            input,
            context
        );

        assert.equal(first.deleted, 1);
        assert.equal(first.auditIds.length, 1);
        assert.equal(first.changes.length, 1);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(listFactoryFileLinks(
            { fileId },
            { dbAccessors: accessors }
        ).length, 0);
    } finally {
        accessors.db.close();
    }
});
