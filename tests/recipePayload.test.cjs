const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '../src/utils/recipePayload.ts');
const source = fs.readFileSync(sourcePath, 'utf8')
    .replace(/import[^;]+;\n/g, '')
    .replace(/export interface[\s\S]*?\n}\n\nfunction numberOrNull/, 'function numberOrNull')
    .replace(/export function serializePackingParts/, 'function serializePackingParts')
    .replace(/export function serializeOptionalParts/, 'function serializeOptionalParts')
    .replace(/export function buildRecipePayload/, 'function buildRecipePayload');
const helpers = `
const DEFAULT_COIL_MATERIAL = '钢带';
function inferPackingMaterial(model, explicit) {
  if (explicit) return explicit;
  return String(model || '').includes('木') ? 'wood' : 'paper';
}
function stringifyTechnicalData(value) {
  const cleaned = {};
  Object.entries(value || {}).forEach(([key, next]) => {
    if (String(next || '').trim()) cleaned[key] = String(next).trim();
  });
  return JSON.stringify(cleaned);
}
`;
const compiled = ts.transpileModule(`${helpers}\n${source}\nmodule.exports = { buildRecipePayload, serializePackingParts, serializeOptionalParts };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleStub = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', compiled)(moduleStub, moduleStub.exports);
const { buildRecipePayload, serializePackingParts, serializeOptionalParts } = moduleStub.exports;

test('配方保存 payload 序列化包装和选配件', () => {
    const packing = serializePackingParts([
        { model: '小纸箱', supplier: 'A', qty: 3 },
        { model: '木箱', supplier: 'B', qty: 1, costSource: 'manual', snapshotPrice: 12 },
        { model: '', supplier: '', qty: 1 },
    ]);
    const optional = serializeOptionalParts([
        { model: '轴承', supplier: 'A', qty: 2 },
        { model: '', supplier: '', qty: 1 },
    ]);

    assert.deepEqual(JSON.parse(packing), [
        { model: '小纸箱', supplier: 'A', qty: 1, packagingMaterial: 'paper' },
        { model: '木箱', supplier: 'B', qty: 1, packagingMaterial: 'wood', snapshotPrice: 12, costSource: 'manual' },
    ]);
    assert.deepEqual(JSON.parse(optional), [
        { model: '轴承', supplier: 'A', qty: 2 },
    ]);
});

test('配方保存 payload 统一表单字段类型', () => {
    const payload = buildRecipePayload({
        recipeName: 'WQ750',
        recipeSpec: '测试规格',
        recipeParts: [{ model: '6*195', name: '不锈钢长螺丝', supplier: '', qty: 4, snapshotPrice: 0.63 }],
        costDraft: { parts: [], partsCost: 2.52, laborCost: 5, savedTotalCost: 7.52, savedCostDetails: 'details' },
        selectedTemplateId: 8,
        coilSpec: '750',
        coilMaterial: '',
        coilSheets: '24',
        hasFloat: true,
        floatWire: '0.55',
        floatAccessoryType: 'xinjie',
        hasCable: false,
        cableLength: '',
        cableWire: '0.55',
        cableAccessoryType: 'standard',
        packingParts: [{ model: '小纸箱', supplier: '', qty: 1 }],
        customBarrelLength: '170',
        selectedModelVariantId: 3,
        impellerModel: '叶轮',
        impellerThickness: '2.5',
        impellerDiameter: '',
        impellerBladeCount: '6',
        technicalData: { power: '750W' },
        optionalParts: [{ model: '轴承', supplier: 'A', qty: 2 }],
        assemblyWage: 1,
        packingWage: 2,
        surfaceTreatmentMode: 'none',
        surfaceTreatmentCost: 99,
        managementFee: 3,
    });

    assert.equal(payload.name, 'WQ750');
    assert.equal(payload.coilMaterial, '钢带');
    assert.equal(payload.coilSheets, 24);
    assert.equal(payload.hasFloat, 1);
    assert.equal(payload.hasCable, 0);
    assert.equal(payload.cableLength, 0);
    assert.equal(payload.customBarrelLength, 170);
    assert.equal(payload.impellerThickness, 2.5);
    assert.equal(payload.impellerDiameter, null);
    assert.equal(payload.impellerBladeCount, 6);
    assert.equal(payload.surfaceTreatmentCost, 0);
    assert.equal(payload.technicalDataJson, '{"power":"750W"}');
});
