const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MAX_PDF_PAGES = 100;
const MAX_PDF_TEXT_CHARS = 300_000;
const MAX_PAGE_LINES = 5_000;

let pdfJsPromise = null;

function text(value) {
    return String(value ?? '').replace(/\u0000/g, '').trim();
}

function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 2) {
    const factor = 10 ** digits;
    return Math.round(number(value) * factor) / factor;
}

function packageAssetUrl(folder) {
    const packageRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
    return pathToFileURL(`${path.join(packageRoot, folder)}${path.sep}`).href;
}

function loadPdfJs() {
    if (!pdfJsPromise) {
        const moduleUrl = pathToFileURL(
            require.resolve('pdfjs-dist/legacy/build/pdf.mjs')
        ).href;
        pdfJsPromise = import(moduleUrl);
    }
    return pdfJsPromise;
}

function itemFontSize(item) {
    const transform = Array.isArray(item.transform) ? item.transform : [];
    return Math.max(
        Math.hypot(number(transform[2]), number(transform[3])),
        number(item.height),
        1
    );
}

function normalizeTextItems(items) {
    return (Array.isArray(items) ? items : [])
        .filter(item => item && typeof item.str === 'string' && text(item.str))
        .map(item => {
            const transform = Array.isArray(item.transform) ? item.transform : [];
            return {
                text: text(item.str).replace(/\s+/g, ' '),
                x: number(transform[4]),
                y: number(transform[5]),
                width: Math.max(0, number(item.width)),
                height: Math.max(1, number(item.height, itemFontSize(item))),
                fontSize: itemFontSize(item),
                hasEol: Boolean(item.hasEOL),
            };
        })
        .sort((left, right) => (
            right.y - left.y
            || left.x - right.x
        ));
}

function groupItemsIntoLines(items) {
    const lines = [];
    for (const item of normalizeTextItems(items)) {
        const line = lines.find(candidate => (
            Math.abs(candidate.y - item.y)
            <= Math.max(2.5, Math.min(candidate.fontSize, item.fontSize) * 0.35)
        ));
        if (line) {
            line.items.push(item);
            line.y = Math.max(line.y, item.y);
            line.fontSize = Math.max(line.fontSize, item.fontSize);
        } else if (lines.length < MAX_PAGE_LINES) {
            lines.push({
                y: item.y,
                fontSize: item.fontSize,
                items: [item],
            });
        }
    }

    return lines
        .sort((left, right) => right.y - left.y)
        .map((line, index) => {
            const sorted = line.items.sort((left, right) => left.x - right.x);
            const cells = [];
            for (const item of sorted) {
                const previousCell = cells.at(-1);
                const previousItem = previousCell?.items.at(-1);
                const gap = previousItem
                    ? item.x - (previousItem.x + previousItem.width)
                    : 0;
                const splitThreshold = previousItem
                    ? Math.max(12, Math.min(previousItem.fontSize, item.fontSize) * 1.25)
                    : Number.POSITIVE_INFINITY;
                if (!previousCell || gap > splitThreshold || previousItem.hasEol) {
                    cells.push({ items: [item] });
                } else {
                    previousCell.items.push(item);
                }
            }

            const normalizedCells = cells.map(cell => {
                const first = cell.items[0];
                let value = '';
                let previous = null;
                for (const item of cell.items) {
                    if (previous) {
                        const gap = item.x - (previous.x + previous.width);
                        if (gap > Math.max(1.5, Math.min(previous.fontSize, item.fontSize) * 0.15)) {
                            value += ' ';
                        }
                    }
                    value += item.text;
                    previous = item;
                }
                const right = Math.max(...cell.items.map(item => item.x + item.width));
                return {
                    text: value.trim(),
                    x: round(first.x),
                    width: round(Math.max(0, right - first.x)),
                };
            }).filter(cell => cell.text);
            const left = Math.min(...sorted.map(item => item.x));
            const right = Math.max(...sorted.map(item => item.x + item.width));
            const top = Math.max(...sorted.map(item => item.y + item.height));
            const bottom = Math.min(...sorted.map(item => item.y));
            return {
                lineNumber: index + 1,
                text: normalizedCells.map(cell => cell.text).join(
                    normalizedCells.length > 1 ? ' | ' : ''
                ),
                x: round(left),
                y: round(bottom),
                width: round(Math.max(0, right - left)),
                height: round(Math.max(1, top - bottom)),
                cells: normalizedCells,
            };
        })
        .filter(line => line.text);
}

function alignedRows(left, right) {
    if (left.cells.length !== right.cells.length || left.cells.length < 2) return false;
    return left.cells.every((cell, index) => (
        Math.abs(cell.x - right.cells[index].x) <= 18
    ));
}

function detectTables(lines) {
    const tables = [];
    let current = [];
    const flush = () => {
        if (current.length >= 2) {
            tables.push({
                rowCount: current.length,
                columnCount: Math.max(...current.map(line => line.cells.length)),
                startLine: current[0].lineNumber,
                endLine: current.at(-1).lineNumber,
                rows: current.map(line => line.cells.map(cell => cell.text)),
            });
        }
        current = [];
    };

    for (const line of lines) {
        if (line.cells.length < 2) {
            flush();
            continue;
        }
        if (current.length === 0 || alignedRows(current.at(-1), line)) {
            current.push(line);
        } else {
            flush();
            current.push(line);
        }
    }
    flush();
    return tables;
}

function safeMetadata(metadata) {
    const info = metadata?.info || {};
    return {
        title: text(info.Title).slice(0, 500),
        author: text(info.Author).slice(0, 500),
        subject: text(info.Subject).slice(0, 1_000),
        creator: text(info.Creator).slice(0, 500),
        producer: text(info.Producer).slice(0, 500),
    };
}

async function parsePdfBuffer(buffer, options = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error('PDF 内容为空');
    }
    const pdfjs = options.pdfjs || await loadPdfJs();
    const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(buffer),
        disableWorker: true,
        isEvalSupported: false,
        useSystemFonts: true,
        cMapUrl: packageAssetUrl('cmaps'),
        cMapPacked: true,
        standardFontDataUrl: packageAssetUrl('standard_fonts'),
        wasmUrl: packageAssetUrl('wasm'),
    });
    let document = null;
    try {
        document = await loadingTask.promise;
        const totalPages = Number(document.numPages || 0);
        const pageLimit = Math.min(
            totalPages,
            Math.max(1, Number(options.maxPages) || MAX_PDF_PAGES)
        );
        const maxChars = Math.max(1, Number(options.maxChars) || MAX_PDF_TEXT_CHARS);
        const pages = [];
        const textSections = [];
        let extractedChars = 0;
        let truncated = totalPages > pageLimit;

        for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
            const page = await document.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1 });
            const content = await page.getTextContent({
                disableNormalization: false,
                includeMarkedContent: false,
            });
            const lines = groupItemsIntoLines(content.items);
            const remainingChars = Math.max(0, maxChars - extractedChars);
            const pageLines = [];
            for (const line of lines) {
                if (remainingChars <= 0) {
                    truncated = true;
                    break;
                }
                const consumed = pageLines.reduce((sum, item) => sum + item.text.length + 1, 0);
                if (consumed + line.text.length > remainingChars) {
                    truncated = true;
                    break;
                }
                pageLines.push(line);
            }
            const pageText = pageLines.map(line => line.text).join('\n');
            extractedChars += pageText.length;
            pages.push({
                pageNumber,
                width: round(viewport.width),
                height: round(viewport.height),
                text: pageText,
                lines: pageLines,
                tables: detectTables(pageLines),
            });
            if (pageText) {
                textSections.push(`【第 ${pageNumber} 页】\n${pageText}`);
            }
            page.cleanup();
            if (extractedChars >= maxChars) {
                truncated = pageNumber < totalPages || truncated;
                break;
            }
        }

        let metadata = {};
        try {
            metadata = safeMetadata(await document.getMetadata());
        } catch {
            metadata = {};
        }
        const extractedText = textSections.join('\n\n').trim();
        const ocrPageNumbers = pages
            .filter(page => !page.text)
            .map(page => page.pageNumber);
        const requiresOcr = ocrPageNumbers.length > 0;
        return {
            parserStatus: extractedText ? 'parsed' : 'metadata_only',
            extractedText,
            parsed: {
                version: 'pdf-v1',
                parser: `pdfjs-dist@${pdfjs.version || 'unknown'}`,
                pageCount: totalPages,
                parsedPageCount: pages.length,
                truncated,
                requiresOcr,
                ocrPageNumbers,
                metadata,
                pages,
                tableCount: pages.reduce((sum, page) => sum + page.tables.length, 0),
            },
        };
    } catch (error) {
        if (error?.name === 'PasswordException') {
            throw new Error('PDF 已加密，需要先解除密码保护后再上传');
        }
        throw new Error(`PDF 解析失败：${error?.message || error}`);
    } finally {
        if (document) await document.destroy();
        else if (loadingTask?.destroy) await loadingTask.destroy();
    }
}

module.exports = {
    MAX_PDF_PAGES,
    MAX_PDF_TEXT_CHARS,
    detectTables,
    groupItemsIntoLines,
    parsePdfBuffer,
};
