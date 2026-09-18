const XLSX = require('@e965/xlsx');

const MAX_SPREADSHEET_SHEETS = 20;
const MAX_SPREADSHEET_ROWS = 5_000;
const MAX_SPREADSHEET_COLUMNS = 100;
const MAX_SPREADSHEET_CELLS = 50_000;
const MAX_SPREADSHEET_TEXT_CHARS = 300_000;

function text(value) {
    return String(value ?? '').replace(/\u0000/g, '').trim();
}

function cellText(cell) {
    if (!cell) return '';
    if (cell.w !== undefined && cell.w !== null) return text(cell.w);
    try {
        return text(XLSX.utils.format_cell(cell));
    } catch {
        return text(cell.v);
    }
}

function cellValue(cell) {
    if (!cell) return null;
    if (cell.v instanceof Date) return cell.v.toISOString();
    if (['string', 'number', 'boolean'].includes(typeof cell.v)) return cell.v;
    return cellText(cell);
}

function valueType(cell) {
    if (!cell) return 'empty';
    if (cell.t === 'n') return 'number';
    if (cell.t === 'b') return 'boolean';
    if (cell.t === 'd' || cell.v instanceof Date) return 'date';
    if (cell.t === 'e') return 'error';
    return 'text';
}

function uniqueHeaders(cells) {
    const seen = new Map();
    return cells.map((cell, index) => {
        const base = text(cell.text) || `列${index + 1}`;
        const count = Number(seen.get(base) || 0) + 1;
        seen.set(base, count);
        return count === 1 ? base : `${base}_${count}`;
    });
}

function detectTables(rows) {
    const blocks = [];
    let current = [];
    const flush = () => {
        if (current.length >= 2 && current[0].cells.length >= 2) {
            const headers = uniqueHeaders(current[0].cells);
            const headerColumns = current[0].cells.map(cell => cell.columnIndex);
            blocks.push({
                startRow: current[0].rowNumber,
                endRow: current.at(-1).rowNumber,
                headerRow: current[0].rowNumber,
                headers,
                rowCount: current.length - 1,
                rows: current.slice(1).map(row => ({
                    rowNumber: row.rowNumber,
                    values: headerColumns.map(columnIndex => (
                        row.cells.find(cell => cell.columnIndex === columnIndex)?.text || ''
                    )),
                })),
            });
        }
        current = [];
    };

    for (const row of rows) {
        if (
            current.length > 0
            && row.rowNumber > current.at(-1).rowNumber + 1
        ) {
            flush();
        }
        current.push(row);
    }
    flush();
    return blocks;
}

function workbookMetadata(workbook) {
    const props = workbook?.Props || {};
    return {
        title: text(props.Title).slice(0, 500),
        subject: text(props.Subject).slice(0, 1_000),
        author: text(props.Author).slice(0, 500),
        company: text(props.Company).slice(0, 500),
        createdAt: props.CreatedDate instanceof Date ? props.CreatedDate.toISOString() : null,
        modifiedAt: props.ModifiedDate instanceof Date ? props.ModifiedDate.toISOString() : null,
    };
}

function parseSpreadsheetBuffer(buffer, options = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error('表格内容为空');
    }
    let workbook;
    try {
        workbook = XLSX.read(buffer, {
            type: 'buffer',
            cellDates: true,
            cellFormula: true,
            cellNF: false,
            cellStyles: false,
        });
    } catch (error) {
        throw new Error(`Excel 解析失败：${error?.message || error}`);
    }

    const maxSheets = Math.max(
        1,
        Math.min(Number(options.maxSheets) || MAX_SPREADSHEET_SHEETS, MAX_SPREADSHEET_SHEETS)
    );
    const maxRows = Math.max(1, Number(options.maxRows) || MAX_SPREADSHEET_ROWS);
    const maxColumns = Math.max(
        1,
        Math.min(Number(options.maxColumns) || MAX_SPREADSHEET_COLUMNS, MAX_SPREADSHEET_COLUMNS)
    );
    const maxCells = Math.max(1, Number(options.maxCells) || MAX_SPREADSHEET_CELLS);
    const maxChars = Math.max(1, Number(options.maxChars) || MAX_SPREADSHEET_TEXT_CHARS);
    const sheetNames = (workbook.SheetNames || []).slice(0, maxSheets);
    const sheets = [];
    const textSections = [];
    let totalRows = 0;
    let scannedRows = 0;
    let totalCells = 0;
    let formulaCount = 0;
    let textChars = 0;
    let truncated = (workbook.SheetNames || []).length > sheetNames.length;

    for (const sheetName of sheetNames) {
        if (scannedRows >= maxRows || totalCells >= maxCells || textChars >= maxChars) {
            truncated = true;
            break;
        }
        const sheet = workbook.Sheets[sheetName];
        const rows = [];
        let sourceRange = null;
        try {
            sourceRange = sheet?.['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
        } catch {
            sourceRange = null;
        }
        if (sourceRange) {
            const startRow = Math.max(0, sourceRange.s.r);
            const endRow = Math.min(
                sourceRange.e.r,
                startRow + Math.max(0, maxRows - scannedRows) - 1
            );
            const startColumn = Math.max(0, sourceRange.s.c);
            const endColumn = Math.min(sourceRange.e.c, startColumn + maxColumns - 1);
            if (endRow < sourceRange.e.r || endColumn < sourceRange.e.c) truncated = true;

            for (let rowIndex = startRow; rowIndex <= endRow; rowIndex += 1) {
                scannedRows += 1;
                if (totalCells >= maxCells || textChars >= maxChars) {
                    truncated = true;
                    break;
                }
                const cells = [];
                for (let columnIndex = startColumn; columnIndex <= endColumn; columnIndex += 1) {
                    const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
                    const cell = sheet[cellRef];
                    const formatted = cellText(cell);
                    if (!formatted) continue;
                    if (totalCells >= maxCells || textChars + formatted.length > maxChars) {
                        truncated = true;
                        break;
                    }
                    const columnLetter = XLSX.utils.encode_col(columnIndex);
                    cells.push({
                        columnIndex: columnIndex + 1,
                        columnLetter,
                        cellRef,
                        text: formatted,
                        value: cellValue(cell),
                        valueType: valueType(cell),
                        formula: text(cell?.f),
                    });
                    totalCells += 1;
                    textChars += formatted.length;
                    if (cell?.f) formulaCount += 1;
                }
                if (cells.length > 0) {
                    rows.push({
                        rowNumber: rowIndex + 1,
                        cells,
                        text: cells.map(cell => `${cell.columnLetter}: ${cell.text}`).join(' | '),
                    });
                    totalRows += 1;
                }
            }
        }

        const tables = detectTables(rows);
        const merges = (sheet?.['!merges'] || []).slice(0, 1_000).map(range => (
            XLSX.utils.encode_range(range)
        ));
        sheets.push({
            name: sheetName,
            sourceRange: sheet?.['!ref'] || '',
            rowCount: rows.length,
            columnCount: rows.reduce(
                (max, row) => Math.max(max, ...row.cells.map(cell => cell.columnIndex)),
                0
            ),
            rows,
            tables,
            merges,
        });
        if (rows.length > 0) {
            textSections.push([
                `【工作表：${sheetName}】`,
                ...rows.map(row => `[第 ${row.rowNumber} 行] ${row.text}`),
            ].join('\n'));
        }
    }

    const extractedText = textSections.join('\n\n').trim();
    return {
        parserStatus: 'parsed',
        extractedText,
        parsed: {
            version: 'spreadsheet-v1',
            parser: `@e965/xlsx@${XLSX.version || 'unknown'}`,
            sheetCount: (workbook.SheetNames || []).length,
            parsedSheetCount: sheets.length,
            rowCount: totalRows,
            scannedRowCount: scannedRows,
            cellCount: totalCells,
            tableCount: sheets.reduce((sum, sheet) => sum + sheet.tables.length, 0),
            formulaCount,
            truncated,
            requiresOcr: false,
            metadata: workbookMetadata(workbook),
            sheets,
        },
    };
}

module.exports = {
    MAX_SPREADSHEET_CELLS,
    MAX_SPREADSHEET_COLUMNS,
    MAX_SPREADSHEET_ROWS,
    MAX_SPREADSHEET_SHEETS,
    MAX_SPREADSHEET_TEXT_CHARS,
    detectTables,
    parseSpreadsheetBuffer,
};
