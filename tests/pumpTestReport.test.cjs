const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('@e965/xlsx');
const { parsePumpTestReport } = require('../api/services/pumpTestReport.cjs');

function testWorkbook() {
    const rows = [
        ['水泵性能试验报告'],
        ['产品型号：QDX1.5-38-12-180片-1"', '', '', '', '计划编号：16'],
        ['测试编号：1259', '', '', '', '介质：清水'],
        ['原厂编号：test-1', '', '', '', '额定电压：220V', '', '', '', '额定功率：750W'],
        [],
        ['序号', '测定数值'],
        ['', '电压', '电流', '功率因数', '输入功率', '转速', '流量', '进口压', '出口压', '流量', '扬程', '输入功率', '机组效率'],
        ['', 'V', 'A', '', 'kW', 'r/min', 'm3/h', 'kPa', 'kPa', 'm3/h', 'm', 'kW', '%'],
        [1, 220.1, 5.14, 0.97, 1.098, 2865, 0, 0, 320, 0, 36.04, 1.098, 0],
        [2, 220, 5.51, 0.98, 1.188, 2845, 1.07, 0, 313, 1.07, 34.33, 1.188, 8.42],
        [],
        ['规定点', '', '流量：', '', '15m3/h', '', '扬程：', '', '10m', '', '机组效率：', '', '15%'],
        ['实测点', '', '流量：', '', '11.6m3/h', '', '扬程：', '', '7.8m', '', '机组效率：', '', '14.6%'],
        ['偏差', '', '流量：', '', '-22.4%', '', '扬程：', '', '-22.4%', '', '效率：', '', '-2.4%'],
        ['', '试验人员：', '', 'Dan', '', '审核：', '', '153', '', '试验日期：', '', '2026/5/13'],
    ];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
    return XLSX.write(book, { type: 'buffer', bookType: 'xls' });
}

test('测试报告解析：保留原始模板字段但公开文本只使用逐点测试数据', () => {
    const result = parsePumpTestReport(testWorkbook(), 'QDX.xls');
    assert.equal(result.parsed.metadata.model, 'QDX1.5-38-12-180片-1"');
    assert.equal(result.parsed.metadata.testReportNo, '1259');
    assert.equal(result.parsed.metadata.tester, 'Dan');
    assert.equal(result.parsed.performance.measured.head, '7.8m');
    assert.equal(result.parsed.performance.deviation.efficiency, '-2.4%');
    assert.equal(result.parsed.testPoints.length, 2);
    assert.equal(result.parsed.testPoints[1].flow, 1.07);
    assert.match(result.extractedText, /测试点2：电压 220V/);
    assert.doesNotMatch(result.extractedText, /规定点：|实测点：|偏差：/);
    assert.equal('specified' in result.summary, false);
    assert.equal('measured' in result.summary, false);
    assert.equal('deviation' in result.summary, false);
    assert.equal(result.summary.testPointCount, 2);
});

test('测试报告解析：拒绝没有报告字段的工作簿', () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['普通表格']]), 'Sheet1');
    const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
    assert.throws(() => parsePumpTestReport(buffer, 'bad.xlsx'), /未识别到水泵性能试验报告字段/);
});
