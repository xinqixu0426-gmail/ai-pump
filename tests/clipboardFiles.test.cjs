const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../apps/web-next/node_modules/typescript');

const sourcePath = path.join(__dirname, '../apps/web-next/lib/clipboard-files.ts');
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const loaded = { exports: {} };
new Function('exports', 'module', compiled)(loaded.exports, loaded);

const {
    MAX_PASTED_FILE_SIZE,
    selectClipboardFile,
} = loaded.exports;

const spreadsheetPolicy = {
    allowedExtensions: ['.xls', '.xlsx'],
    allowedLabel: ' Excel 文件',
};

function files(...items) {
    return items;
}

function file(name, size = 1) {
    return { name, size };
}

test('剪贴板文件：无文件时保持空结果供文本粘贴放行', () => {
    assert.deepEqual(selectClipboardFile(files(), spreadsheetPolicy), { kind: 'empty' });
});

test('剪贴板文件：扩展名忽略大小写且 10MB 边界可接受', () => {
    const input = file('测试报告.XLSX', MAX_PASTED_FILE_SIZE);
    assert.deepEqual(selectClipboardFile(files(input), spreadsheetPolicy), {
        kind: 'accepted',
        file: input,
        notice: '',
    });
});

test('剪贴板文件：多文件稳定选择第一个并明确提示', () => {
    const first = file('第一份.xlsx');
    const result = selectClipboardFile(
        files(first, file('第二份.xlsx')),
        spreadsheetPolicy,
    );
    assert.equal(result.kind, 'accepted');
    assert.equal(result.file, first);
    assert.match(result.notice, /检测到 2 个文件，本次仅上传第一个/);
});

test('剪贴板文件：无扩展名和不支持扩展名均在上传前拒绝', () => {
    assert.match(
        selectClipboardFile(files(file('无扩展名')), spreadsheetPolicy).message,
        /不支持粘贴/,
    );
    assert.match(
        selectClipboardFile(files(file('报告.pdf')), spreadsheetPolicy).message,
        /不支持粘贴/,
    );
});

test('剪贴板文件：超过 10MB 一个字节时在上传前拒绝', () => {
    const result = selectClipboardFile(
        files(file('超大报告.xlsx', MAX_PASTED_FILE_SIZE + 1)),
        spreadsheetPolicy,
    );
    assert.equal(result.kind, 'rejected');
    assert.match(result.message, /超过 10MB/);
});
