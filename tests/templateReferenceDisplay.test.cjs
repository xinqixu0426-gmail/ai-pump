const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('../apps/web-next/node_modules/typescript');
const result = {};
new Function('exports', ts.transpileModule(fs.readFileSync('apps/web-next/lib/template-reference-display.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(result);
const { templateReferenceDisplay: display } = result;
const parts = [{ id: 1, model: '新名称', supplier: '甲', category: '泵壳搭配', catalogUnitCost: 3 }, { id: 2, model: '旧名称', supplier: '甲', category: '泵壳搭配', catalogUnitCost: 99 }];

test('模板现名按固定 ID 读取，旧名被占用不选错物料或价格', () => {
    const reference = { partId: 1, model: '旧名称', supplier: '甲' };
    const read = display(reference, parts, '泵壳搭配');
    assert.equal(read.name, '新名称');
    assert.equal(read.part.catalogUnitCost, 3);
    assert.equal(reference.model, '旧名称');
    assert.equal(display(reference, [{ ...parts[0], model: '再次改名' }]).name, '再次改名');
});

test('模板失效、非法 ID 与供应商/分类冲突标记待核对，不回退同名', () => {
    for (const reference of [{ partId: 999 }, { partId: 0 }, { partId: 1.5 }, { partId: 1, supplier: '乙' }]) {
        const read = display({ model: '旧名称', ...reference }, parts);
        assert.ok(read.issue);
        assert.equal(read.part, undefined);
    }
    assert.ok(display({ partId: 1 }, parts, '配件').issue);
});

test('无 ID 的历史模板仍显示保存名，不猜补引用', () => {
    const read = display({ model: '旧名称' }, parts);
    assert.equal(read.name, '旧名称');
    assert.equal(read.part, undefined);
    assert.equal(read.issue, null);
});
