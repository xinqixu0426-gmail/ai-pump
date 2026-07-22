const XLSX = require('@e965/xlsx');

const TEST_POINT_FIELDS = [
    'sequence', 'voltage', 'current', 'powerFactor', 'inputPower', 'speed',
    'measuredFlow', 'inletPressure', 'outletPressure', 'flow', 'head',
    'calculatedInputPower', 'unitEfficiency',
];

const META_LABELS = {
    产品型号: 'model',
    计划编号: 'planNo',
    进口口径: 'inletDiameter',
    水温: 'waterTemperature',
    测试编号: 'testReportNo',
    介质: 'medium',
    出口口径: 'outletDiameter',
    出口表距: 'outletGaugeDistance',
    原厂编号: 'factoryNo',
    额定电压: 'ratedVoltage',
    额定功率: 'ratedPower',
    电机效率: 'motorEfficiency',
    试验人员: 'tester',
    审核: 'reviewer',
    试验日期: 'testDate',
};

function clean(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function numberOrText(value) {
    const text = clean(value);
    if (!text) return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : text;
}

function nextValueBeforeLabel(row, startIndex) {
    for (const raw of row.slice(startIndex)) {
        const value = clean(raw);
        if (!value) continue;
        const possibleLabel = value.replace(/[：:]$/, '');
        if (META_LABELS[possibleLabel]) return '';
        return value;
    }
    return '';
}

function extractMeta(rows) {
    const metadata = {};
    for (const row of rows) {
        for (let index = 0; index < row.length; index += 1) {
            const value = clean(row[index]);
            if (!value) continue;
            const inline = value.match(/^([^：:]+)[：:]\s*(.*)$/);
            if (inline) {
                const key = META_LABELS[clean(inline[1])];
                if (key) {
                    const inlineValue = clean(inline[2]);
                    const next = nextValueBeforeLabel(row, index + 1);
                    if (inlineValue || next) metadata[key] = inlineValue || next;
                }
                continue;
            }
            const key = META_LABELS[value.replace(/[：:]$/, '')];
            if (!key) continue;
            const next = nextValueBeforeLabel(row, index + 1);
            if (next) metadata[key] = next;
        }
    }
    return metadata;
}

function extractTestPoints(rows) {
    const headerIndex = rows.findIndex(row => clean(row[0]) === '序号');
    if (headerIndex < 0) return [];
    const points = [];
    for (const row of rows.slice(headerIndex + 3)) {
        const sequence = Number(clean(row[0]));
        if (!Number.isInteger(sequence) || sequence <= 0) {
            if (points.length > 0) break;
            continue;
        }
        const values = row.slice(0, TEST_POINT_FIELDS.length).map(numberOrText);
        if (values.slice(1).every(value => value === null)) continue;
        points.push(Object.fromEntries(TEST_POINT_FIELDS.map((field, index) => [field, values[index]])));
    }
    return points;
}

function extractPerformanceSummary(rows) {
    const result = {};
    const rowNames = { 规定点: 'specified', 实测点: 'measured', 偏差: 'deviation' };
    for (const row of rows) {
        const key = rowNames[clean(row[0])];
        if (!key) continue;
        const values = row.map(clean);
        const section = {};
        for (let index = 1; index < values.length; index += 1) {
            const label = values[index].replace(/[：:]$/, '');
            if (!['流量', '扬程', '机组效率', '效率'].includes(label)) continue;
            const value = values.slice(index + 1).find(Boolean);
            if (!value) continue;
            const field = label === '流量' ? 'flow' : label === '扬程' ? 'head' : 'efficiency';
            section[field] = value;
        }
        result[key] = section;
    }
    return result;
}

function buildExtractedText(report, originalName) {
    const { metadata, testPoints } = report;
    const lines = [
        `测试报告文件：${originalName}`,
        `报告类型：水泵性能试验报告`,
        ...Object.entries(metadata).map(([key, value]) => `${key}：${value}`),
    ];
    for (const point of testPoints) {
        lines.push(`测试点${point.sequence}：电压 ${point.voltage ?? '-'}V，电流 ${point.current ?? '-'}A，功率因数 ${point.powerFactor ?? '-'}，输入功率 ${point.inputPower ?? '-'}kW，转速 ${point.speed ?? '-'}r/min，流量 ${point.flow ?? '-'}m3/h，扬程 ${point.head ?? '-'}m，机组效率 ${point.unitEfficiency ?? '-'}%`);
    }
    return lines.join('\n');
}

function parsePumpTestReport(buffer, originalName = '测试报告') {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const sheetName = workbook.SheetNames.find(name => workbook.Sheets[name]?.['!ref']);
    if (!sheetName) throw new Error('Excel 中没有可读取的工作表');
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        defval: '',
        raw: false,
        blankrows: false,
    });
    const metadata = extractMeta(rows);
    const testPoints = extractTestPoints(rows);
    const performance = extractPerformanceSummary(rows);
    if (Object.keys(metadata).length === 0 && testPoints.length === 0) {
        throw new Error('未识别到水泵性能试验报告字段，请确认文件格式');
    }
    const report = { sheetName, metadata, performance, testPoints };
    return {
        parsed: report,
        extractedText: buildExtractedText(report, originalName),
        summary: {
            model: metadata.model || '',
            testReportNo: metadata.testReportNo || '',
            testDate: metadata.testDate || '',
            testPointCount: testPoints.length,
        },
    };
}

module.exports = { parsePumpTestReport };
