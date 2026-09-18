const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { installBusinessChangeSchema } = require('./helpers/businessChangeSchema.cjs');
const {
    DELETE_CAPABILITY_ID,
    UPLOAD_CAPABILITY_ID,
    executeKnowledgeDocumentDelete,
    executeKnowledgeDocumentUpload,
    listKnowledgeDocuments,
} = require('../api/services/knowledgeDocuments.cjs');

function createDependencies() {
    const db = new Database(':memory:');
    installBusinessChangeSchema(db);
    db.exec(`
        CREATE TABLE api_operations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operation_id TEXT NOT NULL,
            capability_id TEXT NOT NULL,
            actor_key TEXT NOT NULL,
            idempotency_key TEXT NOT NULL,
            request_hash TEXT NOT NULL,
            request_id TEXT,
            status TEXT NOT NULL,
            response_json TEXT,
            created_at TEXT NOT NULL,
            completed_at TEXT,
            expires_at TEXT NOT NULL,
            UNIQUE(actor_key, capability_id, idempotency_key)
        );
        CREATE TABLE factory_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            original_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            file_sha256 TEXT NOT NULL,
            file_blob BLOB,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );
        CREATE TABLE knowledge_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER,
            document_type TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            content_text TEXT,
            tags_json TEXT,
            original_name TEXT,
            mime_type TEXT,
            file_size INTEGER NOT NULL,
            file_sha256 TEXT,
            file_blob BLOB,
            parser_status TEXT NOT NULL,
            extracted_text TEXT,
            metadata_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );
    `);
    let nextAuditId = 1;
    function safeInsert(table, values) {
        const columns = Object.keys(values);
        const info = db.prepare(`
            INSERT INTO ${table} (${columns.join(', ')})
            VALUES (${columns.map(() => '?').join(', ')})
        `).run(...columns.map(column => values[column]));
        return { ...info, auditId: nextAuditId++ };
    }
    function safeUpdate(table, id, values) {
        const updates = {
            ...values,
            updated_at: new Date().toISOString(),
        };
        const columns = Object.keys(updates);
        const info = db.prepare(`
            UPDATE ${table}
            SET ${columns.map(column => `${column} = ?`).join(', ')}
            WHERE id = ?
        `).run(...columns.map(column => updates[column]), id);
        return { ...info, auditId: nextAuditId++ };
    }
    function rowAdapter(row) {
        if (!row) return null;
        return {
            id: Number(row.id),
            fileId: row.file_id == null ? null : Number(row.file_id),
            documentType: row.document_type,
            title: row.title,
            description: row.description || '',
            contentText: row.content_text || '',
            tagsJson: row.tags_json || '[]',
            originalName: row.original_name || '',
            mimeType: row.mime_type,
            fileSize: Number(row.file_size || 0),
            fileSha256: row.file_sha256 || '',
            parserStatus: row.parser_status,
            metadataJson: row.metadata_json || '{}',
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
    return {
        allowedDocumentExtensions: new Set(['.md', '.txt']),
        db,
        inspectFactoryFile(input) {
            return {
                ...input,
                fileSize: input.buffer.length,
                fileSha256: crypto.createHash('sha256').update(input.buffer).digest('hex'),
                originalName: input.originalName,
                mimeType: input.mimeType || 'application/octet-stream',
            };
        },
        knowledgeDocumentRow: rowAdapter,
        parseKnowledgeDocumentFile(input) {
            return {
                parserStatus: input.originalName ? 'parsed' : 'not_applicable',
                extractedText: input.buffer?.toString('utf8') || '',
                metadata: { tested: true },
            };
        },
        safeInsert,
        safeUpdate,
        storeFactoryFile(input) {
            const now = input.now;
            const inspected = this.inspectFactoryFile(input);
            const write = safeInsert('factory_files', {
                original_name: inspected.originalName,
                mime_type: inspected.mimeType,
                file_size: inspected.fileSize,
                file_sha256: inspected.fileSha256,
                file_blob: input.buffer,
                created_at: now,
                updated_at: now,
                deleted_at: null,
            });
            return {
                file: {
                    id: Number(write.lastInsertRowid),
                    mimeType: inspected.mimeType,
                    fileSize: inspected.fileSize,
                    fileSha256: inspected.fileSha256,
                },
                deduplicated: false,
                auditIds: [write.auditId],
            };
        },
    };
}

function context(capabilityId, key) {
    return {
        actorKey: 'user:test',
        capabilityId,
        idempotencyKey: key,
        operationId: key,
        requestId: `request:${key}`,
    };
}

test('知识资料命令：上传原子写入文件、资料、强审计回执并安全重放', () => {
    const dependencies = createDependencies();
    const input = {
        documentType: 'technical_note',
        title: '装配经验',
        contentText: '轴承装配前需要清洁。',
        tags: ['装配'],
        buffer: Buffer.from('# 装配经验'),
        originalName: 'assembly.md',
        mimeType: 'text/markdown',
    };
    const first = executeKnowledgeDocumentUpload(
        dependencies,
        input,
        context(UPLOAD_CAPABILITY_ID, 'knowledge-upload:test-1')
    );
    const replay = executeKnowledgeDocumentUpload(
        dependencies,
        input,
        context(UPLOAD_CAPABILITY_ID, 'knowledge-upload:test-1')
    );
    assert.equal(first.status, 'completed');
    assert.equal(first.auditIds.length, 2);
    assert.equal(first.document.title, '装配经验');
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.document.id, first.document.id);
    assert.equal(
        dependencies.db.prepare('SELECT COUNT(*) AS count FROM knowledge_documents').get().count,
        1
    );
    assert.equal(listKnowledgeDocuments(dependencies).length, 1);
    dependencies.db.close();
});

test('知识资料命令：同键异参拒绝，删除校验 expectedUpdatedAt 且可重放', () => {
    const dependencies = createDependencies();
    const uploaded = executeKnowledgeDocumentUpload(
        dependencies,
        {
            documentType: 'technical_note',
            title: '删除测试',
            contentText: '测试内容',
        },
        context(UPLOAD_CAPABILITY_ID, 'knowledge-upload:test-2')
    );
    assert.throws(
        () => executeKnowledgeDocumentUpload(
            dependencies,
            {
                documentType: 'technical_note',
                title: '异参',
                contentText: '测试内容',
            },
            context(UPLOAD_CAPABILITY_ID, 'knowledge-upload:test-2')
        ),
        error => error.code === 'idempotency_key_conflict'
    );
    assert.throws(
        () => executeKnowledgeDocumentDelete(
            dependencies,
            uploaded.document.id,
            { expectedUpdatedAt: '2020-01-01T00:00:00.000Z' },
            context(DELETE_CAPABILITY_ID, 'knowledge-delete:test-2-stale')
        ),
        error => error.code === 'resource_version_conflict'
    );
    const deleted = executeKnowledgeDocumentDelete(
        dependencies,
        uploaded.document.id,
        { expectedUpdatedAt: uploaded.document.updatedAt },
        context(DELETE_CAPABILITY_ID, 'knowledge-delete:test-2')
    );
    const replay = executeKnowledgeDocumentDelete(
        dependencies,
        uploaded.document.id,
        { expectedUpdatedAt: uploaded.document.updatedAt },
        context(DELETE_CAPABILITY_ID, 'knowledge-delete:test-2')
    );
    assert.equal(deleted.deleted, 1);
    assert.equal(deleted.auditIds.length, 1);
    assert.equal(replay.idempotentReplay, true);
    assert.equal(listKnowledgeDocuments(dependencies).length, 0);
    dependencies.db.close();
});
