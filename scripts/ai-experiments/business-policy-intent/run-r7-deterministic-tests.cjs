'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveReferenceFastPath } = require('./referenceFastPath.cjs');
const { alignRoleExpressionToWorkingUtterance } = require('./spanAlignment.cjs');

const root = path.resolve(__dirname, '../../..');
const outputArgument = process.argv.find(value => value.startsWith('--output='));
const outputPath = outputArgument ? path.resolve(root, outputArgument.slice('--output='.length)) : null;

function hint(entries) { return { entries, text: entries.map(item => `${item.expression}：${item.category}`).join('\n') }; }

function fastPathCase(id, input, expectedMode) {
    const actual = resolveReferenceFastPath(input);
    return Object.freeze({ id, expected: expectedMode, actual, status: actual.mode === expectedMode ? 'PASS' : 'FAIL' });
}

function alignmentCase(id, expression, workingUtterance, expectedStatus, expectedAlignedExpression = null) {
    const actual = alignRoleExpressionToWorkingUtterance(expression, workingUtterance);
    const status = actual.status === expectedStatus && (expectedAlignedExpression === null || actual.alignedExpression === expectedAlignedExpression) ? 'PASS' : 'FAIL';
    return Object.freeze({ id, expression, workingUtterance, expected: { status: expectedStatus, alignedExpression: expectedAlignedExpression }, actual, status });
}

const cases = Object.freeze([
    fastPathCase('RF-N01_MULTI_COIL', {
        userInput: '刚才那个线圈多少钱？', recentOwnerWording: '我在看12-120和12-130。', referenceSurface: '刚才那个线圈',
        businessReferenceHint: hint([{ expression: '12-120', category: '线圈/线圈方案相关业务表达' }, { expression: '12-130', category: '线圈/线圈方案相关业务表达' }]),
    }, 'SAFE_UNRESOLVED'),
    fastPathCase('RF-N02_MULTI_RECIPE', {
        userInput: '它多少钱？', recentOwnerWording: '我在看V750和V110。', referenceSurface: '它',
        businessReferenceHint: hint([{ expression: 'V750', category: '配方/产品配置相关业务表达' }, { expression: 'V110', category: '配方/产品配置相关业务表达' }]),
    }, 'SAFE_UNRESOLVED'),
    fastPathCase('RF-N03_TYPE_INCOMPATIBLE', {
        userInput: '刚才那个线圈多少钱？', recentOwnerWording: '我先看看V750。', referenceSurface: '刚才那个线圈',
        businessReferenceHint: hint([{ expression: 'V750', category: '配方/产品配置相关业务表达' }]),
    }, 'SAFE_UNRESOLVED'),
    fastPathCase('RF-N04_NO_RECENT', {
        userInput: '这个多少钱？', recentOwnerWording: '', referenceSurface: '这个', businessReferenceHint: hint([]),
    }, 'SAFE_UNRESOLVED'),
    alignmentCase('SA-01', 'V750-通用款', 'V750通用款现在成本多少？', 'UNIQUE_MATCH', 'V750通用款'),
    alignmentCase('SA-02', 'V750-通用款', 'V750 通用款现在成本多少？', 'UNIQUE_MATCH', 'V750 通用款'),
    alignmentCase('SA-03', 'V750-通用款', 'V750通用款和V750豪贝款分别多少钱？', 'UNIQUE_MATCH', 'V750通用款'),
    alignmentCase('SA-04', 'V750豪贝款', 'V750通用款现在成本多少？', 'NO_MATCH'),
    alignmentCase('SA-05', '12-120', '12-120和12-120分别多少钱？', 'AMBIGUOUS'),
]);

const result = Object.freeze({ phase: 'M4-3A-R7', kind: 'DETERMINISTIC_REFERENCE_SPAN_TESTS', total: cases.length, pass: cases.filter(item => item.status === 'PASS').length, fail: cases.filter(item => item.status === 'FAIL').length, cases });
if (outputPath) fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(result, null, 2));
if (result.fail) process.exitCode = 1;
