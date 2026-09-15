const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('../apps/web-next/node_modules/typescript');
const loaded = { exports: {} };
new Function('exports', ts.transpileModule(fs.readFileSync('apps/web-next/components/recipe/missing-part-naming.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(loaded.exports);
const { nameMissingPartCandidates, uniqueBatchInputs } = loaded.exports;
const { getNamingRules, previewCatalogName } = require('../api/services/catalogNaming.cjs');
const row = (key, overrides = {}) => ({ key, rowId: key, targetKind: 'recipe-optional', contextLabel: '选配件', model: '原候选', supplier: '供应商', category: '配件', subcategory: '', catalogUnitCost: 3, stock: 0, matchScope: 'non-packaging', ...overrides });
const rules = () => getNamingRules().rules;
const generate = async input => previewCatalogName(input).name;

test('批量规格命名采用服务端名称且保留每个原草稿行标识', async () => {
    const input = [row('a'), row('b', { category: '包装', subcategory: '外包装' }), row('c', { category: '轴承', model: '6204' })];
    const specs = { a: { kind: '接头', specification: 'G1' }, b: { kind: '纸箱', specification: '20×30' } };
    const named = await nameMissingPartCandidates(input, rules(), specs, generate);
    assert.deepEqual(named.map(x => x.model), ['接头-G1', '纸箱-20×30', '6204']);
    assert.deepEqual(named.map(x => x.rowId), ['a', 'b', 'c']);
    assert.equal(named[0].matchScope, 'exact-category');
    assert.equal(input[0].model, '原候选');
    assert.equal(named[2].naming, undefined);
    assert.equal(uniqueBatchInputs(named)[0].naming.ruleId, 'accessory');
});

test('缺规格和预览失败不降级使用原候选', async () => {
    await assert.rejects(nameMissingPartCandidates([row('a')], rules(), {}, generate), /补齐/);
    await assert.rejects(nameMissingPartCandidates([row('a')], rules(), { a: { kind: '接头', specification: 'G1' } }, async () => { throw new Error('网络失败'); }), /网络失败/);
});

test('生成同名合并只创建一件但保留回填行；分类、价格或规格不同不得静默合并', async () => {
    const specs = { a: { kind: '接头', specification: 'G1' }, b: { specification: 'G1', kind: '接头' } };
    const named = await nameMissingPartCandidates([row('a'), row('b')], rules(), specs, generate);
    assert.equal(uniqueBatchInputs(named).length, 1);
    assert.equal(named.length, 2);
    for (const patch of [{ category: '皮垫' }, { catalogUnitCost: 4 }, { stock: 1 }, { naming: { ruleId: 'accessory', spec: { kind: '其他' } } }]) {
        assert.throws(() => uniqueBatchInputs([named[0], { ...named[1], ...patch }]), /多个分类|不同价格|规格不一致/);
    }
});
