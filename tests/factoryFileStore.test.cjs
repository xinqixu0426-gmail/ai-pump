const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const XLSX = require('@e965/xlsx');
const {
    deleteFactoryFile,
    inspectFactoryFile,
    listFactoryFiles,
    storeFactoryFile,
} = require('../api/services/factoryFileStore.cjs');

function createAccessors() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE factory_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            original_name TEXT NOT NULL,
            extension TEXT NOT NULL,
            detected_type TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            file_sha256 TEXT NOT NULL UNIQUE,
            file_blob BLOB NOT NULL,
            parser_status TEXT NOT NULL,
            source_type TEXT NOT NULL,
            duplicate_count INTEGER NOT NULL,
            metadata_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );
        CREATE TABLE knowledge_documents (
            id INTEGER PRIMARY KEY,
            file_id INTEGER,
            deleted_at TEXT
        );
        CREATE TABLE recipe_technical_files (
            id INTEGER PRIMARY KEY,
            file_id INTEGER,
            deleted_at TEXT
        );
    `);
    const safeInsert = (table, values) => {
        const columns = Object.keys(values);
        const info = db.prepare(`
            INSERT INTO ${table} (${columns.join(', ')})
            VALUES (${columns.map(() => '?').join(', ')})
        `).run(...columns.map(column => values[column]));
        return { ...info, auditId: 42 };
    };
    const safeUpdate = (table, id, updates) => {
        const columns = Object.keys(updates);
        db.prepare(`
            UPDATE ${table}
            SET ${columns.map(column => `${column} = ?`).join(', ')}
            WHERE id = ?
        `).run(...columns.map(column => updates[column]), id);
        return { changes: 1, auditId: 43 };
    };
    const softDelete = (table, id) => {
        db.prepare(`UPDATE ${table} SET deleted_at = ? WHERE id = ?`)
            .run('2026-07-29T00:00:00.000Z', id);
    };
    return { db, safeInsert, safeUpdate, softDelete };
}

function workbookBuffer() {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
        ['型号', '价格'],
        ['V750', 95],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, '报价');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

test('V9.1 文件识别：按真实内容识别 UTF-8 文本和 Excel', () => {
    const textFile = inspectFactoryFile({
        buffer: Buffer.from('技术参数：扬程 38m', 'utf8'),
        originalName: '参数.md',
        mimeType: 'application/octet-stream',
    });
    assert.equal(textFile.detectedType, 'text');
    assert.equal(textFile.mimeType, 'text/plain; charset=utf-8');
    assert.equal(textFile.security.extensionVerified, true);

    const spreadsheet = inspectFactoryFile({
        buffer: workbookBuffer(),
        originalName: '客户报价.xlsx',
        mimeType: 'application/zip',
    });
    assert.equal(spreadsheet.detectedType, 'spreadsheet');
    assert.equal(spreadsheet.security.contentSignature, 'office_open_xml');
});

test('V9.1 文件安全：拒绝扩展名伪装、危险文件名和超限文件', () => {
    assert.throws(
        () => inspectFactoryFile({
            buffer: Buffer.from('not a pdf'),
            originalName: '图纸.pdf',
        }),
        /实际 PDF 内容不一致/
    );
    assert.throws(
        () => inspectFactoryFile({
            buffer: Buffer.from('说明'),
            originalName: '报价.exe.txt',
        }),
        /可执行扩展名/
    );
    assert.throws(
        () => inspectFactoryFile({
            buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
            originalName: '过大.txt',
        }),
        /不能超过 10MB/
    );
});

test('V9.1 文件去重：相同 SHA-256 复用文件对象并累计上传次数', () => {
    const accessors = createAccessors();
    const input = {
        buffer: Buffer.from('相同的技术参数', 'utf8'),
        originalName: '参数.txt',
        mimeType: 'text/plain',
        sourceType: 'direct_upload',
        now: '2026-07-29T00:00:00.000Z',
    };
    const first = storeFactoryFile(input, { dbAccessors: accessors });
    const second = storeFactoryFile({
        ...input,
        originalName: '参数副本.txt',
        parserStatus: 'parsed',
        now: '2026-07-29T00:01:00.000Z',
    }, { dbAccessors: accessors });

    assert.equal(first.deduplicated, false);
    assert.equal(second.deduplicated, true);
    assert.equal(second.file.id, first.file.id);
    assert.equal(second.file.duplicateCount, 2);
    assert.equal(second.file.parserStatus, 'parsed');
    assert.deepEqual(first.auditIds, [42]);
    assert.deepEqual(second.auditIds, [43]);
    assert.equal(listFactoryFiles({}, { dbAccessors: accessors }).length, 1);
    accessors.db.close();
});

test('V9.1 文件删除：业务引用中的统一文件禁止直接删除', () => {
    const accessors = createAccessors();
    const stored = storeFactoryFile({
        buffer: Buffer.from('配方报告', 'utf8'),
        originalName: '报告.txt',
    }, { dbAccessors: accessors });
    accessors.db.prepare(
        'INSERT INTO knowledge_documents (id, file_id) VALUES (1, ?)'
    ).run(stored.file.id);

    assert.throws(
        () => deleteFactoryFile(stored.file.id, { dbAccessors: accessors }),
        /仍被业务资料引用/
    );
    accessors.db.prepare('UPDATE knowledge_documents SET deleted_at = ? WHERE id = 1')
        .run('2026-07-29T00:00:00.000Z');
    deleteFactoryFile(stored.file.id, { dbAccessors: accessors });
    assert.equal(listFactoryFiles({}, { dbAccessors: accessors }).length, 0);
    accessors.db.close();
});
