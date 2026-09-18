const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../apps/web-next/node_modules/typescript');
const source = fs.readFileSync('apps/web-next/lib/technical-references.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const loaded = { exports: {} };
vm.runInNewContext(compiled.outputText, { module: loaded, exports: loaded.exports });
const { findShellMetaForTemplate } = loaded.exports;
const parts = [
  { id: 176, category: '泵壳', model: '泵壳-V750-2寸大脚板', remark: '{"isStainless":true,"openOffset":15}' },
  { id: 236, category: '泵壳', model: '模板-V750大脚板-2寸-经典款', remark: '{"isStainless":false}' },
];
test('模板和泵壳名称不同时读取绑定身份，不被同名零件覆盖', () => {
  assert.equal(findShellMetaForTemplate({ shellPartId: 176, shellModel: parts[1].model }, parts).isStainless, true);
});
test('已有绑定失效时不猜测其他同名泵壳', () => {
  assert.equal(findShellMetaForTemplate({ shellPartId: 999, shellModel: parts[1].model }, parts), null);
});
test('未绑定的旧模板仍支持原有型号匹配，损坏备注安全返回空', () => {
  assert.equal(findShellMetaForTemplate({ shellModel: parts[0].model }, parts).openOffset, 15);
  assert.equal(findShellMetaForTemplate({ shellPartId: 176 }, [{ ...parts[0], remark: '{bad' }]), null);
});
