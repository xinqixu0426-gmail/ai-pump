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
    'lib',
    'part-settings-form-state.ts'
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
    Set,
}, { filename: stateModulePath });
const { mergeUntouchedPartSettings } = stateModule.exports;

function form(overrides = {}) {
    return {
        standardCableAccessoryName: '',
        standardCableAccessoryFee: '',
        xinjieCableAccessoryName: '',
        xinjieCableAccessoryFee: '',
        floatAccessoryDelta: '',
        ...overrides,
    };
}

test('零件设置异步回填只补充未触碰的空字段', () => {
    const current = form({ standardCableAccessoryName: '零件快照名称' });
    const result = mergeUntouchedPartSettings(current, new Set(), {
        standardCableAccessoryName: '全局名称',
        standardCableAccessoryFee: '2.5',
    });

    assert.equal(result.standardCableAccessoryName, '零件快照名称');
    assert.equal(result.standardCableAccessoryFee, '2.5');
});

test('零件设置慢响应不得恢复用户主动清空的字段', () => {
    const current = form();
    const result = mergeUntouchedPartSettings(
        current,
        new Set(['standardCableAccessoryName', 'floatAccessoryDelta']),
        {
            standardCableAccessoryName: '标准插头',
            floatAccessoryDelta: '1.5',
        }
    );

    assert.strictEqual(result, current);
    assert.equal(result.standardCableAccessoryName, '');
    assert.equal(result.floatAccessoryDelta, '');
});
