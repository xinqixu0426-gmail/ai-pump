const path = require('node:path');
const XLSX = require('@e965/xlsx');
const { parsePumpTestReport } = require('./pumpTestReport.cjs');

const MAX_EXTRACTED_TEXT_LENGTH = 200_000;
const ALLOWED_DOCUMENT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.xls', '.xlsx', '.pdf']);

function limitText(value) {
    const text = String(value || '').replace(/\u0000/g, '').trim();
    return text.length > MAX_EXTRACTED_TEXT_LENGTH
        ? `${text.slice(0, MAX_EXTRACTED_TEXT_LENGTH)}\n[内容已截断]`
        : text;
}

function extractSpreadsheetText(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const sections = [];
    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet?.['!ref']) continue;
        const csv = XLSX.utils.sheet_to_csv(sheet, {
            blankrows: false,
            FS: '\t',
            RS: '\n',
        }).trim();
        if (csv) sections.push(`工作表：${sheetName}\n${csv}`);
    }
    if (sections.length === 0) throw new Error('Excel 中没有可读取的工作表');
    return limitText(sections.join('\n\n'));
}

function parseKnowledgeDocumentFile({ buffer, originalName, documentType }) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        return {
            parserStatus: 'not_applicable',
            extractedText: '',
            metadata: {},
        };
    }

    const extension = path.extname(String(originalName || '')).toLowerCase();
    if (!ALLOWED_DOCUMENT_EXTENSIONS.has(extension)) {
        throw new Error('只支持 .txt、.md、.csv、.xls、.xlsx 和 .pdf 文件');
    }

    if (extension === '.pdf') {
        return {
            parserStatus: 'metadata_only',
            extractedText: '',
            metadata: {
                extension,
                extractionNote: 'V5.1 尚未解析 PDF 图纸正文，仅检索标题、说明和标签。',
            },
        };
    }

    if (['.txt', '.md', '.csv'].includes(extension)) {
        const extractedText = limitText(buffer.toString('utf8'));
        if (!extractedText) throw new Error('文本文件没有可读取内容');
        return {
            parserStatus: 'parsed',
            extractedText,
            metadata: { extension },
        };
    }

    if (documentType === 'pump_performance_test') {
        const report = parsePumpTestReport(buffer, originalName);
        return {
            parserStatus: 'parsed',
            extractedText: limitText(report.extractedText),
            metadata: {
                extension,
                reportSummary: report.summary,
                reportParsed: report.parsed,
            },
        };
    }

    return {
        parserStatus: 'parsed',
        extractedText: extractSpreadsheetText(buffer),
        metadata: { extension },
    };
}

module.exports = {
    ALLOWED_DOCUMENT_EXTENSIONS,
    MAX_EXTRACTED_TEXT_LENGTH,
    extractSpreadsheetText,
    parseKnowledgeDocumentFile,
};
