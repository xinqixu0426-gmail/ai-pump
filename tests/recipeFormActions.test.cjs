const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '../src/utils/recipeFormActions.ts');
const source = fs.readFileSync(sourcePath, 'utf8')
    .replace(/import[^;]+;\n/g, '')
    .replace(/export interface[\s\S]*?\n}\n\nexport function emptyImpellerFields/, 'function emptyImpellerFields')
    .replace(/export function impellerFieldsFromVariant/, 'function impellerFieldsFromVariant')
    .replace(/export function recipeFieldsFromVariant/, 'function recipeFieldsFromVariant')
    .replace(/export function addOptionalPart/, 'function addOptionalPart')
    .replace(/export function updateOptionalPart/, 'function updateOptionalPart')
    .replace(/export function removeOptionalPart/, 'function removeOptionalPart');
const helpers = `const DEFAULT_COIL_MATERIAL = '钢带';`;
const compiled = ts.transpileModule(`${helpers}\n${source}\nmodule.exports = { emptyImpellerFields, impellerFieldsFromVariant, recipeFieldsFromVariant, addOptionalPart, updateOptionalPart, removeOptionalPart };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleStub = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', compiled)(moduleStub, moduleStub.exports);
const {
    emptyImpellerFields,
    recipeFieldsFromVariant,
    addOptionalPart,
    updateOptionalPart,
    removeOptionalPart,
} = moduleStub.exports;

test('型号变体应用生成配方和叶轮信息字段', () => {
    const fields = recipeFieldsFromVariant({
        modelName: '人民款370w',
        note: '90-100',
        templateId: 8,
        coilSpec: '750',
        coilSheets: 24,
        barrelLength: 172,
        impellerModel: '叶轮A',
        impellerThickness: 2.5,
        impellerDiameter: 95,
        impellerBladeCount: 6,
    });

    assert.equal(fields.recipeName, '人民款370w');
    assert.equal(fields.recipeSpec, '90-100');
    assert.equal(fields.selectedTemplateId, 8);
    assert.equal(fields.coilMaterial, '钢带');
    assert.equal(fields.coilSheets, '24');
    assert.equal(fields.customBarrelLength, '172');
    assert.equal(fields.impellerThickness, '2.5');
    assert.equal(fields.impellerBladeCount, '6');
});

test('叶轮字段重置为空', () => {
    assert.deepEqual(emptyImpellerFields(), {
        impellerModel: '',
        impellerThickness: '',
        impellerDiameter: '',
        impellerBladeCount: '',
    });
});

test('选配件增删改会在型号变化时自动匹配供应商', () => {
    const added = addOptionalPart([{ id: 1, model: '轴承', supplier: 'A', qty: 2 }], 2);
    assert.deepEqual(added[1], { id: 2, model: '', supplier: '', qty: 1 });

    const changedModel = updateOptionalPart(added, 1, 'model', '油封', model => model === '油封' ? '油封供应商' : '');
    assert.equal(changedModel[0].model, '油封');
    assert.equal(changedModel[0].supplier, '油封供应商');

    const changedQty = updateOptionalPart(changedModel, 1, 'qty', 3);
    assert.equal(changedQty[0].qty, 3);

    assert.deepEqual(removeOptionalPart(changedQty, 2).map(part => part.id), [1]);
});
