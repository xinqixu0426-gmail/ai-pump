const { parsePdfBuffer } = require('./factoryPdfParser.cjs');
const { parseSpreadsheetBuffer } = require('./factorySpreadsheetParser.cjs');
const { parseWordBuffer } = require('./factoryWordParser.cjs');
const {
    parseImageBuffer,
    parseScannedPdfBuffer,
} = require('./factoryOcrParser.cjs');

function loadDbAccessors() {
    return require('../db.cjs');
}

function expectedParserVersion(detectedType, extension = '') {
    if (detectedType === 'text' && ['.doc', '.docx'].includes(extension)) return 'word-v1';
    if (detectedType === 'pdf') return 'pdf-ocr-v1';
    if (detectedType === 'spreadsheet') return 'spreadsheet-v1';
    if (detectedType === 'image') return 'image-ocr-v1';
    return '';
}

function needsFactoryFileParsing(file) {
    const expected = expectedParserVersion(file?.detectedType, file?.extension);
    if (!expected) return false;
    return ['pending', 'failed'].includes(file?.parserStatus)
        || file?.parserSummary?.version !== expected;
}

function parseMetadata(row, result) {
    let metadata = {};
    try {
        metadata = JSON.parse(row.metadata_json || '{}');
    } catch {
        metadata = {};
    }
    return JSON.stringify({
        ...metadata,
        parsing: {
            version: result.parsed.version,
            parser: result.parsed.parser,
            pageCount: Number(result.parsed.pageCount || 0),
            parsedPageCount: Number(result.parsed.parsedPageCount || 0),
            sheetCount: Number(result.parsed.sheetCount || 0),
            parsedSheetCount: Number(result.parsed.parsedSheetCount || 0),
            rowCount: Number(result.parsed.rowCount || 0),
            scannedRowCount: Number(result.parsed.scannedRowCount || 0),
            cellCount: Number(result.parsed.cellCount || 0),
            tableCount: result.parsed.tableCount,
            formulaCount: Number(result.parsed.formulaCount || 0),
            truncated: result.parsed.truncated,
            requiresOcr: result.parsed.requiresOcr,
            ocrApplied: Boolean(result.parsed.ocrApplied),
            confidence: Number(result.parsed.confidence || 0),
            needsReview: Boolean(result.parsed.needsReview),
            drawingCandidateCount: Number(result.parsed.drawingCandidateCount || 0),
        },
    });
}

function mergePdfResults(textLayer, ocr) {
    const ocrPages = new Map(
        (ocr?.parsed?.pages || []).map(page => [Number(page.pageNumber), page])
    );
    const pages = (textLayer.parsed.pages || []).map(page => {
        const ocrPage = ocrPages.get(Number(page.pageNumber));
        return page.text || !ocrPage
            ? { ...page, source: 'text_layer' }
            : { ...ocrPage, source: 'ocr' };
    });
    const sections = pages
        .filter(page => page.text)
        .map(page => `【第 ${page.pageNumber} 页${page.source === 'ocr' ? ' OCR' : ''}】\n${page.text}`);
    const unresolvedPages = pages
        .filter(page => !page.text)
        .map(page => page.pageNumber);
    const drawingCandidates = ocr?.parsed?.drawingCandidates || [];
    const ocrApplied = Boolean(ocr);
    return {
        parserStatus: sections.length > 0 ? 'parsed' : 'metadata_only',
        extractedText: sections.join('\n\n'),
        parsed: {
            ...textLayer.parsed,
            version: 'pdf-ocr-v1',
            parser: ocrApplied
                ? `${textLayer.parsed.parser} + ${ocr.parsed.parser}`
                : textLayer.parsed.parser,
            pages,
            parsedPageCount: pages.length,
            truncated: Boolean(textLayer.parsed.truncated || ocr?.parsed?.truncated),
            requiresOcr: false,
            ocrApplied,
            ocrPageNumbers: ocrApplied
                ? ocr.parsed.pages.map(page => page.pageNumber)
                : [],
            unresolvedPages,
            noTextDetected: sections.length === 0,
            confidence: Number(ocr?.parsed?.confidence || 0),
            needsReview: Boolean(ocr?.parsed?.needsReview),
            drawingCandidates,
            drawingCandidateCount: drawingCandidates.length,
            tableCount: pages.reduce(
                (sum, page) => sum + (Array.isArray(page.tables) ? page.tables.length : 0),
                0
            ),
        },
    };
}

async function parsePdfWithOcr(buffer, options = {}) {
    const textLayer = await parsePdfBuffer(buffer, options.pdfOptions);
    if (!textLayer.parsed.requiresOcr) return mergePdfResults(textLayer, null);
    const ocr = await parseScannedPdfBuffer(buffer, {
        ...options.ocrOptions,
        pageNumbers: textLayer.parsed.ocrPageNumbers,
    });
    return mergePdfResults(textLayer, ocr);
}

async function parseFactoryFile(id, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const fileId = Number(id);
    const row = accessors.db.prepare(`
        SELECT *
        FROM factory_files
        WHERE id = ? AND deleted_at IS NULL
    `).get(fileId);
    if (!row) throw new Error('文件不存在');
    const isWord = row.detected_type === 'text'
        && ['.doc', '.docx'].includes(row.extension);
    if (!['pdf', 'spreadsheet', 'image'].includes(row.detected_type) && !isWord) {
        throw new Error('当前只解析 PDF、Word、Excel、CSV 和图片文件');
    }
    const updateState = updates => {
        const execute = () => {
            const write = accessors.safeUpdate(
                'factory_files',
                fileId,
                {
                    ...updates,
                    updated_at: updates.updated_at || new Date().toISOString(),
                },
                options.auditContext
            );
            options.onWrite?.(write);
            return write;
        };
        return options.transactionalWrites
            && typeof accessors.db.transaction === 'function'
            ? accessors.db.transaction(execute).immediate()
            : execute();
    };

    if (!options.skipProcessingWrite) {
        updateState({
            parser_status: 'processing',
            parser_error: '',
        });
    }
    const parsedAt = options.now || new Date().toISOString();
    try {
        let result;
        if (row.detected_type === 'pdf') {
            result = await parsePdfWithOcr(row.file_blob, options);
        } else if (row.detected_type === 'image') {
            result = await parseImageBuffer(row.file_blob, options.ocrOptions);
        } else if (isWord) {
            result = await parseWordBuffer(row.file_blob, options.wordOptions);
        } else {
            result = parseSpreadsheetBuffer(row.file_blob, options.spreadsheetOptions);
        }
        updateState({
            parser_status: result.parserStatus,
            parsed_text: result.extractedText,
            parsed_json: JSON.stringify(result.parsed),
            parser_error: '',
            parsed_at: parsedAt,
            metadata_json: parseMetadata(row, result),
        });
        return result;
    } catch (error) {
        const message = String(error?.message || error).slice(0, 1_000);
        updateState({
            parser_status: 'failed',
            parser_error: message,
            parsed_at: parsedAt,
        });
        throw error;
    }
}

module.exports = {
    mergePdfResults,
    needsFactoryFileParsing,
    parseFactoryFile,
    parsePdfWithOcr,
};
