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

const NOW = '2026-07-29T08:00:00.000Z';

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
            SET ${columns.map(column => `${column} = ?`).join(', ')}
            WHERE id = ?
        `).run(...columns.map(column => values[column]), id);
    };
    const softDelete = (table, id) => safeUpdate(table, id, {
        deleted_at: NOW,
        updated_at: NOW,
    });
    return { db, safeInsert, safeUpdate, softDelete };
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
            /归档目标不存在/
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
