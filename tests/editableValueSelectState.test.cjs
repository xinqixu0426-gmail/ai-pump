const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const typescript = require('../apps/web-next/node_modules/typescript');

const stateModulePath = path.join(
    __dirname,
    '..',
    'apps',
    'web-next',
    'components',
    'recipe',
    'editable-value-select-state.ts'
);
const transpiledState = typescript.transpileModule(fs.readFileSync(stateModulePath, 'utf8'), {
    compilerOptions: {
        module: typescript.ModuleKind.CommonJS,
        target: typescript.ScriptTarget.ES2020,
    },
});
const stateModule = { exports: {} };
vm.runInNewContext(transpiledState.outputText, {
    module: stateModule,
    exports: stateModule.exports,
}, { filename: stateModulePath });
const { moveActiveOptionIndex, filterEditableOptions } = stateModule.exports;

test('候选搜索支持型号、标签、大小写和多关键词，不修改源列表', () => {
    const options = [{ value: 'V550木箱', label: 'V550木箱 · 外包装 · 木箱' }, { value: '珍珠棉', label: '珍珠棉 · 内衬' }];
    assert.equal(filterEditableOptions(options, '').length, 2);
    assert.equal(filterEditableOptions(options, '  ').length, 2);
    assert.equal(filterEditableOptions(options, 'v550 木箱')[0].value, 'V550木箱');
    assert.equal(filterEditableOptions(options, '内衬')[0].value, '珍珠棉');
    assert.equal(filterEditableOptions(options, '不存在').length, 0);
    assert.equal(filterEditableOptions(options, '木').length, 1);
    assert.equal(options.length, 2);
    assert.equal(moveActiveOptionIndex({ currentIndex: 0, optionCount: 0, selectedIndex: -1, direction: 'next' }), -1);
});

test('可编辑候选框键盘导航从选中项或首尾候选开始', () => {
    assert.equal(moveActiveOptionIndex({
        currentIndex: -1,
        optionCount: 3,
        selectedIndex: -1,
        direction: 'next',
    }), 0);
    assert.equal(moveActiveOptionIndex({
        currentIndex: -1,
        optionCount: 3,
        selectedIndex: -1,
        direction: 'previous',
    }), 2);
    assert.equal(moveActiveOptionIndex({
        currentIndex: -1,
        optionCount: 3,
        selectedIndex: 1,
        direction: 'next',
    }), 1);
});

test('可编辑候选框键盘导航在候选首尾循环并安全处理空列表', () => {
    assert.equal(moveActiveOptionIndex({
        currentIndex: 2,
        optionCount: 3,
        selectedIndex: -1,
        direction: 'next',
    }), 0);
    assert.equal(moveActiveOptionIndex({
        currentIndex: 0,
        optionCount: 3,
        selectedIndex: -1,
        direction: 'previous',
    }), 2);
    assert.equal(moveActiveOptionIndex({
        currentIndex: 0,
        optionCount: 0,
        selectedIndex: -1,
        direction: 'next',
    }), -1);
});
