const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../apps/web-next/node_modules/typescript');
const source = fs.readFileSync('apps/web-next/components/recipe/recipe-detail-presentation.ts', 'utf8');
const state = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { module: state, exports: state.exports });
const { bomCategory, groupBomRows, recipeFeeRows, recipePartModel } = state.exports;

test('线圈型号展示保存的规格片数材质槽眼线重，不使用方案名冒充型号', () => {
    const recipe = { coilSpec: '12', coilSheets: 140, coilMaterial: '钢带', coilSlotType: '小眼', coilWireWeight: 0.677 };
    assert.equal(recipePartModel({ name: '线圈转子', model: '正式方案' }, recipe), '12 / 140片 / 钢带 / 小眼 / 线重 0.677kg');
    assert.equal(recipePartModel({ name: '线圈转子', model: '13.5-200', material: '冷轧', slotType: '国标眼', wireWeight: 0.8 }, recipe), '13.5 / 200片 / 冷轧 / 国标眼 / 线重 0.8kg');
    assert.match(recipePartModel({ costRole: 'coil', model: '正式方案' }, {}), /线重未记录/);
    assert.equal(recipePartModel({ model: '25μF' }, recipe), '25μF');
});

test('BOM 分类按正式角色，组内按小计而非单价降序且不改源数组', () => {
    assert.equal(bomCategory({ costRole: 'coil' }), '');
    assert.equal(bomCategory({ name: '螺丝', snapshotPrice: 0.5 }), '螺丝');
    assert.equal(bomCategory({ name: '螺丝', snapshotPrice: 2 }), '');
    assert.equal(bomCategory({ name: 'O型圈', snapshotPrice: 0.2 }), '皮垫与垫圈');
    const rows = [{ part: { model: 'a' }, savedSubtotal: 2 }, { part: { model: 'b' }, savedSubtotal: null }, { part: { model: 'c' }, savedSubtotal: 6 }];
    assert.equal(groupBomRows(rows).map(group => group.rows[0].part.model).join(','), 'c,a,b');
    assert.equal(rows[0].part.model, 'a');
    assert.equal(groupBomRows([]).length, 0);
});

test('费用优先显示正式保存回执，支持旧喷漆记录、零金额和缺失', () => {
    const fees = recipeFeeRows({ assemblyWage: 20, savedCostDetails: '安装工资: ¥10.00\n打包工资: ¥0.00\n表面处理(喷漆): ¥3.00\n管理费用: ¥4.00' });
    assert.equal(fees.find(row => row.name === '安装工资').amount, 10);
    assert.equal(fees.find(row => row.name === '打包工资').amount, 0);
    assert.equal(fees.find(row => row.name === '表面处理').amount, 3);
    assert.equal(fees.find(row => row.name === '表面处理').process, '喷漆');
    assert.equal(recipeFeeRows({ surfaceTreatmentMode: 'electrophoresis' }).find(row => row.name === '表面处理').process, '电泳');
    assert.equal(recipeFeeRows({ savedCostDetails: '喷漆工资: ¥2.00' }).find(row => row.name === '表面处理').amount, 2);
    assert.equal(recipeFeeRows({}).every(row => row.amount === null), true);
});

test('低价螺丝小分组与单项统一排序，保留全部明细和单价', () => {
    const row = (name, price, qty) => ({ part: { name, model: name, snapshotPrice: price }, qty, snapshotPrice: price, currentPrice: price, savedSubtotal: price * qty, currentSubtotal: price * qty, diff: 0 });
    const result = groupBomRows([row('线圈', 100, 1), row('螺丝a', 0.5, 4), row('螺丝b', 0.8, 4), row('电容', 4, 1)]);
    assert.equal(result[1].category, '螺丝');
    assert.equal(result[1].amount, 5.2);
    assert.equal(result[1].rows.length, 2);
    assert.equal(result[1].rows[0].part.name, '螺丝b');
    assert.equal(result[1].rows[0].snapshotPrice, 0.8);
    assert.equal(result[2].rows[0].part.name, '电容');
});
