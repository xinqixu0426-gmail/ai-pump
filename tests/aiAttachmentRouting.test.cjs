const test = require('node:test');
const assert = require('node:assert/strict');
const {
    classifyAttachment,
    requiresExternalPdfUnderstanding,
} = require('../api/services/aiAttachmentRouting.cjs');

function file(detectedType, extension) {
    return { detectedType, extension, parserStatus: 'pending' };
}

test('AI 附件分类：普通文本和本地成功解析文档使用本地内容', () => {
    for (const parserStatus of ['pending', 'processing', 'failed', 'parsed']) {
        assert.equal(
            classifyAttachment({
                ...file('text', '.txt'),
                parserStatus,
            }, { parserStatus, parsedText: '' }).handling,
            'local_text'
        );
    }
    for (const [factoryFile, content] of [
        [file('text', '.docx'), { parserStatus: 'parsed', parsedText: 'Word 正文', parsed: {} }],
        [file('spreadsheet', '.xlsx'), { parserStatus: 'parsed', parsedText: 'A1: 型号', parsed: {} }],
        [file('pdf', '.pdf'), { parserStatus: 'parsed', parsedText: '第 1 页正文', parsed: { requiresOcr: false } }],
    ]) {
        const decision = classifyAttachment(factoryFile, content);
        assert.equal(decision.handling, 'local_parsed');
        assert.equal(decision.requiresKimi, false);
    }
});

test('AI 附件分类：扫描、复杂、截断和不可用文档统一交给外部文件识别', () => {
    const pdf = file('pdf', '.pdf');
    const spreadsheet = file('spreadsheet', '.xlsx');
    const word = file('text', '.docx');
    const cases = [
        [pdf, { parserStatus: 'metadata_only', parsedText: '', parsed: { requiresOcr: true } }],
        [pdf, { parserStatus: 'parsed', parsedText: 'OCR 正文', parsed: { ocrApplied: true } }],
        [pdf, { parserStatus: 'parsed', parsedText: '部分正文', parsed: { unresolvedPages: [2] } }],
        [spreadsheet, { parserStatus: 'parsed', parsedText: '', parsed: {} }],
        [spreadsheet, { parserStatus: 'parsed', parsedText: '部分表格', parsed: { truncated: true } }],
        [word, { parserStatus: 'processing', parsedText: '', parsed: {} }],
        [word, { parserStatus: 'failed', parsedText: '', parsed: {}, parserError: 'failed' }],
    ];
    for (const [factoryFile, content] of cases) {
        const decision = classifyAttachment(factoryFile, content);
        assert.equal(decision.handling, 'external_file');
        assert.equal(decision.requiresKimi, true);
    }
});

test('AI 附件分类：PDF 复杂版式只使用已有解析证据，不按扩展名臆测', () => {
    assert.equal(requiresExternalPdfUnderstanding({
        parsed: { requiresOcr: false, tableCount: 2, unresolvedPages: [] },
    }), false);
    assert.equal(requiresExternalPdfUnderstanding({
        parsed: { pages: [{ pageNumber: 1, source: 'ocr' }] },
    }), true);
});
