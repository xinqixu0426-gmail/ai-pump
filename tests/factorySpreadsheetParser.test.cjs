const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const XLSX = require('@e965/xlsx');
const {
    parseSpreadsheetBuffer,
} = require('../api/services/factorySpreadsheetParser.cjs');
const {
    needsFactoryFileParsing,
    parseFactoryFile,
} = require('../api/services/factoryFileParser.cjs');
const {
    getFactoryFile,
    getFactoryFileContent,
    storeFactoryFile,
} = require('../api/services/factoryFileStore.cjs');
const {
    buildQuotationFileDraft,
} = require('../api/services/factoryQuotationDraft.cjs');

function buildWorkbookBuffer(rows, options = {}) {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    if (options.formula) {
        sheet.E4 = { t: 'n', v: 8_850, f: 'C4*D4' };
    }
    XLSX.utils.book_append_sheet(workbook, sheet, options.sheetName || '报价单');
    if (options.secondSheet) {
        XLSX.utils.book_append_sheet(
            workbook,
            XLSX.utils.aoa_to_sheet(options.secondSheet),
            '说明'
        );
    }
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

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
        CREATE TABLE customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            default_margin REAL DEFAULT 0,
            deleted_at TEXT
        );
        CREATE TABLE recipes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            spec TEXT,
            saved_total_cost REAL DEFAULT 0,
            deleted_at TEXT
        );
        CREATE TABLE quotations (
            id INTEGER PRIMARY KEY AUTOINCREMENT
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

test('V9.3 表格解析：保留工作表、行列位置、公式和通用表格结构', () => {
    const buffer = buildWorkbookBuffer([
        ['客户名称', '菲律宾客户'],
        [],
        ['产品型号', '规格', '数量', '单价', '金额'],
        ['V750-2寸-菲律宾-60hz', '12-180', 30, 295, 8_850],
    ], {
        formula: true,
        secondSheet: [['备注'], ['FOB Ningbo']],
    });
    const result = parseSpreadsheetBuffer(buffer);

    assert.equal(result.parserStatus, 'parsed');
    assert.equal(result.parsed.version, 'spreadsheet-v1');
    assert.equal(result.parsed.sheetCount, 2);
    assert.equal(result.parsed.parsedSheetCount, 2);
    assert.equal(result.parsed.formulaCount, 1);
    assert.match(result.extractedText, /【工作表：报价单】/);
    assert.match(result.extractedText, /\[第 4 行\]/);
    assert.equal(result.parsed.sheets[0].rows[2].cells[0].cellRef, 'A4');
    assert.equal(result.parsed.sheets[0].rows[2].cells[4].formula, 'C4\*D4');
    assert.equal(result.parsed.sheets[0].tables[0].headers[0], '产品型号');
});

test('V9.3 表格解析：CSV 复用相同结构并保留中文', () => {
    const result = parseSpreadsheetBuffer(Buffer.from(
        '\uFEFF产品型号,数量,单价\nV750,2,100\n',
        'utf8'
    ));

    assert.equal(result.parserStatus, 'parsed');
    assert.equal(result.parsed.sheetCount, 1);
    assert.match(result.extractedText, /产品型号/);
    assert.match(result.extractedText, /V750/);
});

test('V9.3 解析升级：旧 parsed 状态没有 spreadsheet-v1 结构时仍需重解析', () => {
    assert.equal(needsFactoryFileParsing({
        detectedType: 'spreadsheet',
        parserStatus: 'parsed',
        parserSummary: { version: '' },
    }), true);
    assert.equal(needsFactoryFileParsing({
        detectedType: 'spreadsheet',
        parserStatus: 'parsed',
        parserSummary: { version: 'spreadsheet-v1' },
    }), false);
    assert.equal(needsFactoryFileParsing({
        detectedType: 'pdf',
        parserStatus: 'metadata_only',
        parserSummary: { version: 'pdf-v1' },
    }), true);
    assert.equal(needsFactoryFileParsing({
        detectedType: 'pdf',
        parserStatus: 'parsed',
        parserSummary: { version: 'pdf-ocr-v1' },
    }), false);
});

test('V9.3 报价文件草稿：精确映射客户和配方但不写报价', async () => {
    const accessors = createAccessors();
    try {
        accessors.db.prepare(
            'INSERT INTO customers (name, default_margin) VALUES (?, ?)'
        ).run('菲律宾客户', 0.15);
        accessors.db.prepare(
            'INSERT INTO recipes (name, spec, saved_total_cost) VALUES (?, ?, ?)'
        ).run('V750-2寸-菲律宾-60hz', '12-180', 272.85);
        const buffer = buildWorkbookBuffer([
            ['客户名称', '菲律宾客户'],
            ['报价编号', 'Q-2026-001'],
            ['产品型号', '规格', '数量', '单价', '金额', '备注'],
            ['V750-2寸-菲律宾-60hz', '12-180', 30, 295, 8_850, '整机'],
        ]);
        const stored = storeFactoryFile({
            buffer,
            originalName: '菲律宾报价.xlsx',
            now: '2026-07-29T00:00:00.000Z',
        }, { dbAccessors: accessors });

        await parseFactoryFile(stored.file.id, {
            dbAccessors: accessors,
            now: '2026-07-29T00:01:00.000Z',
        });
        const file = getFactoryFile(stored.file.id, { dbAccessors: accessors });
        const content = getFactoryFileContent(stored.file.id, { dbAccessors: accessors });
        const draft = buildQuotationFileDraft(
            stored.file.id,
            {},
            { dbAccessors: accessors }
        );

        assert.equal(file.parserStatus, 'parsed');
        assert.equal(file.parserSummary.sheetCount, 1);
        assert.equal(content.parsed.version, 'spreadsheet-v1');
        assert.equal(draft.customerMatch.status, 'matched');
        assert.equal(draft.items[0].recipeMatch.status, 'matched');
        assert.equal(draft.items[0].source.rowNumber, 4);
        assert.equal(draft.items[0].draftItem.qty, 30);
        assert.equal(draft.items[0].draftItem.unitPrice, 295);
        assert.equal(draft.summary.readyForSaveDraft, true);
        assert.equal(draft.quotationDraftInput.items[0].baseRecipeName, 'V750-2寸-菲律宾-60hz');
        assert.equal(accessors.db.prepare('SELECT COUNT(*) AS count FROM quotations').get().count, 0);
    } finally {
        accessors.db.close();
    }
});

test('V9.3 报价文件草稿：多个配方候选时停止而不猜选', async () => {
    const accessors = createAccessors();
    try {
        accessors.db.prepare('INSERT INTO customers (name) VALUES (?)').run('菲律宾客户');
        accessors.db.prepare(
            'INSERT INTO recipes (name, spec) VALUES (?, ?), (?, ?)'
        ).run('V750-A', '12-180', 'V750-B', '12-180');
        const stored = storeFactoryFile({
            buffer: buildWorkbookBuffer([
                ['客户名称', '菲律宾客户'],
                [],
                ['规格', '数量', '单价'],
                ['12-180', 2, 100],
            ]),
            originalName: '歧义报价.xlsx',
        }, { dbAccessors: accessors });
        await parseFactoryFile(stored.file.id, { dbAccessors: accessors });
        const draft = buildQuotationFileDraft(stored.file.id, {}, { dbAccessors: accessors });

        assert.equal(draft.items[0].recipeMatch.status, 'ambiguous');
        assert.equal(draft.items[0].recipeMatch.candidates.length, 2);
        assert.equal(draft.summary.readyForSaveDraft, false);
        assert.equal(draft.quotationDraftInput, null);
    } finally {
        accessors.db.close();
    }
});

test('V9.3 报价文件草稿：客户位于明细列时读取首行客户而非相邻表头', async () => {
    const accessors = createAccessors();
    try {
        accessors.db.prepare('INSERT INTO customers (name) VALUES (?)').run('菲律宾客户');
        accessors.db.prepare(
            'INSERT INTO recipes (name, spec) VALUES (?, ?)'
        ).run('V750', '12-180');
        const stored = storeFactoryFile({
            buffer: buildWorkbookBuffer([
                ['客户名称', '产品型号', '规格', '数量', '单价'],
                ['菲律宾客户', 'V750', '12-180', 2, 100],
            ]),
            originalName: '明细客户报价.xlsx',
        }, { dbAccessors: accessors });
        await parseFactoryFile(stored.file.id, { dbAccessors: accessors });
        const draft = buildQuotationFileDraft(stored.file.id, {}, { dbAccessors: accessors });

        assert.equal(draft.document.customerName, '菲律宾客户');
        assert.equal(draft.document.customerSource.cellRef, 'A2');
        assert.equal(draft.customerMatch.status, 'matched');
        assert.equal(draft.summary.readyForSaveDraft, true);
    } finally {
        accessors.db.close();
    }
});
