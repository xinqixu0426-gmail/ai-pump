const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../apps/web-next/node_modules/typescript');
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../apps/web-next/lib/recipe-inventory-status.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const loaded = {};
new Function('exports', compiled)(loaded);
const { recipeInventoryPresentation: present } = loaded;

test('库存展示保留角色和原型号，现名用于展示，未核实不能呈现为有货或零库存', () => {
    const view = present({ name: '提手螺丝', model: '旧名称', currentName: '新名称', snapshotName: '旧名称', status: 'needs_review', currentStock: 10 });
    assert.equal(view.name, '提手螺丝');
    assert.equal(view.model, '新名称');
    assert.equal(view.previousName, '旧名称');
    assert.equal(view.stockText, '未核实');
    assert.equal(view.label, '引用待核对');
    assert.equal(view.tone, 'amber');
    assert.equal(present({ model: '旧名称', name: '旧名称', currentName: '新名称' }).name, '新名称');
});

test('库存展示区分已核实零库存、非库存项、缺失与未知数据', () => {
    assert.equal(present({ status: 'out_of_stock', currentStock: 0 }).stockText, '0');
    assert.equal(present({ status: 'in_stock', currentStock: null }).stockText, '未核实');
    assert.equal(present({ status: 'not_tracked', currentStock: null }).stockText, '—');
    assert.equal(present({ status: 'not_tracked' }).tone, 'slate');
    assert.equal(present({ status: 'missing', inventoryType: 'coil', currentStock: 0 }).label, '线圈方案缺失');
    assert.equal(present({ status: 'in_stock', currentStock: 4.5 }).stockText, '4.5');
});
