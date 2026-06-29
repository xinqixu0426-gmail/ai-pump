const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '../src/utils/recipePrefill.ts');
const source = fs.readFileSync(sourcePath, 'utf8')
    .replace(/import[^;]+;\n/g, '')
    .replace(/export interface[\s\S]*?\n}\n\nexport function buildPackingSelectionsFromRecipe/, 'function buildPackingSelectionsFromRecipe')
    .replace(/export function buildOptionalSelectionsFromRecipe/, 'function buildOptionalSelectionsFromRecipe')
    .replace(/export function parseLegacyRecipeParts/, 'function parseLegacyRecipeParts');
const helpers = `
function inferPackingMaterial(model, explicit) {
  if (explicit) return explicit;
  return String(model || '').includes('木') ? 'wood' : 'paper';
}
`;
const compiled = ts.transpileModule(`${helpers}\n${source}\nmodule.exports = { buildPackingSelectionsFromRecipe, buildOptionalSelectionsFromRecipe, parseLegacyRecipeParts };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleStub = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', compiled)(moduleStub, moduleStub.exports);
const { buildPackingSelectionsFromRecipe, buildOptionalSelectionsFromRecipe, parseLegacyRecipeParts } = moduleStub.exports;

test('配方预填解析 packingPartsJson 并兼容旧 boxType', () => {
    assert.deepEqual(buildPackingSelectionsFromRecipe({
        packingPartsJson: JSON.stringify([{ model: '小纸箱', supplier: 'A', qty: 5 }]),
        boxType: '木箱',
    }), [
        { model: '小纸箱', supplier: 'A', qty: 1, packagingMaterial: 'paper' },
    ]);

    assert.deepEqual(buildPackingSelectionsFromRecipe({ packingPartsJson: 'bad', boxType: '木箱' }), [
        { model: '木箱', supplier: '', qty: 1, packagingMaterial: 'wood' },
    ]);
});

test('配方预填解析 extraPartsJson', () => {
    const result = buildOptionalSelectionsFromRecipe({
        extraPartsJson: JSON.stringify([{ model: '轴承', supplier: 'A', qty: 2 }, { model: '', supplier: '', qty: 1 }]),
    });

    assert.deepEqual(result, [{ model: '轴承', supplier: 'A', qty: 2 }]);
});

test('配方预填解析旧 partsJson', () => {
    const result = parseLegacyRecipeParts(JSON.stringify([
        { name: '线圈转子', model: '750-24', supplier: '', qty: 1, material: '钢带' },
        { name: '浮球-新界式', model: '浮球-线径0.55', supplier: '', qty: 1, floatAccessoryType: 'xinjie' },
        { name: '电缆线', model: '电缆-线径0.55', supplier: '', qty: 3 },
        { name: '纸箱', model: '小纸箱', supplier: '', qty: 1 },
        { name: '轴承', model: '6202', supplier: 'A', qty: 2 },
    ]), ['0.55'], ['0.55']);

    assert.equal(result.coilMaterial, '钢带');
    assert.equal(result.coilSpec, '750');
    assert.equal(result.coilSheets, '24');
    assert.equal(result.hasFloat, true);
    assert.equal(result.floatWire, '0.55');
    assert.equal(result.floatAccessoryType, 'xinjie');
    assert.equal(result.hasCable, true);
    assert.equal(result.cableWire, '0.55');
    assert.equal(result.cableLength, '3');
    assert.deepEqual(result.packingParts, [{ model: '小纸箱', supplier: '', qty: 1, packagingMaterial: 'paper' }]);
    assert.deepEqual(result.optionalParts, [{ model: '6202', supplier: 'A', qty: 2 }]);
});
