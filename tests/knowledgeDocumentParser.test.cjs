const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('@e965/xlsx');
const {
    extractSpreadsheetText,
    parseKnowledgeDocumentFile,
} = require('../api/services/knowledgeDocumentParser.cjs');

function workbookBuffer(rows) {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '参数');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

test('Knowledge V5：普通 Excel 技术资料提取工作表文本', () => {
    const buffer = workbookBuffer([
        ['型号', '叶轮直径', '材料'],
        ['QDX1.5-38', 120, '不锈钢'],
    ]);

    const parsed = parseKnowledgeDocumentFile({
        buffer,
        originalName: '技术参数.xlsx',
        documentType: 'spreadsheet',
    });

    assert.equal(parsed.parserStatus, 'parsed');
    assert.match(parsed.extractedText, /工作表：参数/);
    assert.match(parsed.extractedText, /QDX1\.5-38/);
    assert.match(parsed.extractedText, /不锈钢/);
});

test('Knowledge V5：文本资料按 UTF-8 提取并移除空字符', () => {
    const parsed = parseKnowledgeDocumentFile({
        buffer: Buffer.from('泵壳厚度：2mm\u0000\n材质：304', 'utf8'),
        originalName: '技术说明.md',
        documentType: 'technical_note',
    });

    assert.equal(parsed.parserStatus, 'parsed');
    assert.equal(parsed.extractedText.includes('\u0000'), false);
    assert.match(parsed.extractedText, /材质：304/);
});

test('Knowledge V5：PDF 图纸只标记元数据检索，不伪造正文', () => {
    const parsed = parseKnowledgeDocumentFile({
        buffer: Buffer.from('%PDF-1.4'),
        originalName: '泵壳图纸.pdf',
        documentType: 'drawing',
    });

    assert.equal(parsed.parserStatus, 'metadata_only');
    assert.equal(parsed.extractedText, '');
    assert.match(parsed.metadata.extractionNote, /尚未解析 PDF 图纸正文/);
});

test('Knowledge V5：空表格和不支持的文件被拒绝', () => {
    assert.throws(
        () => extractSpreadsheetText(workbookBuffer([])),
        /没有可读取的工作表/
    );
    assert.throws(
        () => parseKnowledgeDocumentFile({
            buffer: Buffer.from('x'),
            originalName: '参数.docx',
            documentType: 'other',
        }),
        /只支持/
    );
});
