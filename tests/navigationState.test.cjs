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
    'navigation-state.ts'
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
    URL,
}, { filename: stateModulePath });
const { buildCurrentHref, navigationHrefMatches } = stateModule.exports;

test('导航当前地址由 pathname 和最新查询参数派生', () => {
    assert.equal(buildCurrentHref('/dashboard', new URLSearchParams()), '/dashboard');
    assert.equal(
        buildCurrentHref('/dashboard', new URLSearchParams('view=knowledge&entry=42')),
        '/dashboard?view=knowledge&entry=42'
    );
});

test('查询型导航按声明参数匹配并允许附加上下文参数', () => {
    const currentHref = '/dashboard?entry=42&view=knowledge';
    assert.equal(navigationHrefMatches(currentHref, '/dashboard?view=knowledge'), true);
    assert.equal(navigationHrefMatches(currentHref, '/dashboard?view=quality'), false);
    assert.equal(navigationHrefMatches(currentHref, '/orders?view=knowledge'), false);
    assert.equal(
        navigationHrefMatches('/dashboard?view=quality&view=knowledge', '/dashboard?view=quality'),
        false
    );
});
