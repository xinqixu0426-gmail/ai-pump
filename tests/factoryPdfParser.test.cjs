const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { parsePdfBuffer } = require('../api/services/factoryPdfParser.cjs');
const { parseFactoryFile } = require('../api/services/factoryFileParser.cjs');
const { classifyAttachment } = require('../api/services/aiAttachmentRouting.cjs');
const {
    getFactoryFile,
    getFactoryFileContent,
    storeFactoryFile,
} = require('../api/services/factoryFileStore.cjs');
const { buildPdfBuffer } = require('./helpers/pdfFixture.cjs');

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
            parsed_text TEXT NOT NULL DEFAULT '',
            parsed_json TEXT NOT NULL DEFAULT '{}',
            parser_error TEXT NOT NULL DEFAULT '',
            parsed_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );
    `);
    const safeInsert = (table, values) => {
        const columns = Object.keys(values);
        return db.prepare(`
            INSERT INTO ${table} (${columns.join(', ')})
            VALUES (${columns.map(() => '?').join(', ')})
        `).run(...columns.map(column => values[column]));
    };
    const safeUpdate = (table, id, updates) => {
        const columns = Object.keys(updates);
        return db.prepare(`
            UPDATE ${table}
            SET ${columns.map(column => `${column} = ?`).join(', ')}
            WHERE id = ?
        `).run(...columns.map(column => updates[column]), id);
    };
    return { db, safeInsert, safeUpdate };
}

test('V9.2 PDF 解析：保留页码、行坐标和表格行', async () => {
    const pdf = buildPdfBuffer([
        [
            { text: 'Pump Test Report', x: 72, y: 740, size: 16 },
            { text: 'Flow', x: 72, y: 700 },
            { text: 'Head', x: 220, y: 700 },
            { text: 'Current', x: 360, y: 700 },
            { text: '10', x: 72, y: 680 },
            { text: '38', x: 220, y: 680 },
            { text: '4.2', x: 360, y: 680 },
        ],
        [
            { text: 'Conclusion', x: 72, y: 740, size: 16 },
            { text: 'Stable operation', x: 72, y: 710 },
        ],
    ]);
    const result = await parsePdfBuffer(pdf);

    assert.equal(result.parserStatus, 'parsed');
    assert.equal(result.parsed.pageCount, 2);
    assert.equal(result.parsed.parsedPageCount, 2);
    assert.equal(result.parsed.requiresOcr, false);
    assert.match(result.extractedText, /【第 1 页】/);
    assert.match(result.extractedText, /Flow \| Head \| Current/);
    assert.match(result.extractedText, /【第 2 页】/);
    assert.ok(result.parsed.pages[0].lines.every(line => Number.isFinite(line.x) && Number.isFinite(line.y)));
    assert.equal(result.parsed.tableCount, 1);
    assert.deepEqual(result.parsed.pages[0].tables[0].rows, [
        ['Flow', 'Head', 'Current'],
        ['10', '38', '4.2'],
    ]);
    assert.equal(classifyAttachment(
        { detectedType: 'pdf', extension: '.pdf' },
        {
            parserStatus: result.parserStatus,
            parsedText: result.extractedText,
            parsed: result.parsed,
        }
    ).handling, 'local_parsed');
});

test('V9.2 PDF 解析：没有文字层时明确要求 OCR', async () => {
    const result = await parsePdfBuffer(buildPdfBuffer([[]]));

    assert.equal(result.parserStatus, 'metadata_only');
    assert.equal(result.extractedText, '');
    assert.equal(result.parsed.requiresOcr, true);
    assert.equal(result.parsed.pageCount, 1);
    assert.equal(classifyAttachment(
        { detectedType: 'pdf', extension: '.pdf' },
        {
            parserStatus: result.parserStatus,
            parsedText: result.extractedText,
            parsed: result.parsed,
        }
    ).handling, 'external_file');
});

test('V9.2 统一文件：解析结果、状态和错误字段写回原文件对象', async () => {
    const accessors = createAccessors();
    try {
        const stored = storeFactoryFile({
            buffer: buildPdfBuffer([[
                { text: 'Page traceable content', x: 72, y: 720 },
            ]]),
            originalName: 'traceable.pdf',
            sourceType: 'direct_upload',
            now: '2026-07-29T00:00:00.000Z',
        }, { dbAccessors: accessors });

        await parseFactoryFile(stored.file.id, {
            dbAccessors: accessors,
            now: '2026-07-29T00:01:00.000Z',
        });
        const file = getFactoryFile(stored.file.id, { dbAccessors: accessors });
        const content = getFactoryFileContent(stored.file.id, { dbAccessors: accessors });

        assert.equal(file.parserStatus, 'parsed');
        assert.equal(file.parserSummary.pageCount, 1);
        assert.equal(file.parsedAt, '2026-07-29T00:01:00.000Z');
        assert.match(file.parsedTextPreview, /Page traceable content/);
        assert.match(content.parsedText, /【第 1 页】/);
        assert.equal(content.parsed.pages[0].pageNumber, 1);
    } finally {
        accessors.db.close();
    }
});
