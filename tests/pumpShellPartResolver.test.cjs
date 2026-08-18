const test = require('node:test');
const assert = require('node:assert/strict');
const { findPumpShellPart } = require('../api/services/pumpShellPartResolver.cjs');

const parts = [
    { id: 1, model: 'V750-DY款-圆底脚-12', category: '泵壳' },
    { id: 2, model: 'V750-DY款-圆底脚-13.5', category: '泵壳搭配' },
    { id: 3, model: 'V1500-DY款-圆底脚', category: '泵壳' },
];

test('泵壳型号优先精确匹配，并兼容唯一的尺寸后缀改名', () => {
    assert.equal(findPumpShellPart(parts, 'V750-DY款-圆底脚-12')?.id, 1);
    assert.equal(findPumpShellPart(parts, 'V750-DY款-圆底脚')?.id, 1);
    assert.equal(findPumpShellPart(parts, 'V1500-DY款-圆底脚-12')?.id, 3);
});

test('泵壳型号兼容匹配遇到多个尺寸或两个不同显式尺寸时拒绝猜选', () => {
    const ambiguous = [
        { id: 1, model: 'V750-DY款-圆底脚-12', category: '泵壳' },
        { id: 2, model: 'V750-DY款-圆底脚-13.5', category: '泵壳' },
    ];
    assert.equal(findPumpShellPart(ambiguous, 'V750-DY款-圆底脚'), null);
    assert.equal(findPumpShellPart(ambiguous, 'V750-DY款-圆底脚-14'), null);
});

test('普通业务型号后缀不作为尺寸兼容匹配', () => {
    const namedVariants = [
        { id: 1, model: 'V750-DY款-圆底脚-A', category: '泵壳' },
    ];
    assert.equal(findPumpShellPart(namedVariants, 'V750-DY款-圆底脚'), null);
});
