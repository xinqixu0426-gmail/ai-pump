const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '../src/utils/recipeSubmitFlow.ts');
const source = fs.readFileSync(sourcePath, 'utf8')
    .replace(/import[^;]+;\n/g, '')
    .replace(/export interface[\s\S]*?\n}\n\nexport function buildRecipeCostDraftPayload/, 'function buildRecipeCostDraftPayload')
    .replace(/export async function prepareRecipeSubmission/, 'async function prepareRecipeSubmission');
const helpers = `
const DEFAULT_COIL_MATERIAL = '钢带';
let lastCostDraftPayload = null;
async function previewRecipeCostDraft(payload) {
  lastCostDraftPayload = payload;
  return { parts: [{ model: '6*200', name: '长螺丝', supplier: '', qty: 4, snapshotPrice: 0.65 }], savedTotalCost: 2.6, savedCostDetails: 'details' };
}
function buildRecipePayload(input) {
  return { name: input.recipeName, partsJson: JSON.stringify(input.recipeParts), savedTotalCost: input.costDraft.savedTotalCost, surfaceTreatmentCost: input.surfaceTreatmentMode === 'none' ? 0 : input.surfaceTreatmentCost };
}
`;
const compiled = ts.transpileModule(`${helpers}\n${source}\nmodule.exports = { buildRecipeCostDraftPayload, prepareRecipeSubmission, getLastCostDraftPayload: () => lastCostDraftPayload };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleStub = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', compiled)(moduleStub, moduleStub.exports);
const { buildRecipeCostDraftPayload, prepareRecipeSubmission, getLastCostDraftPayload } = moduleStub.exports;

const baseInput = {
    recipeName: '测试配方',
    recipeSpec: '90-100',
    recipeParts: [{ model: '6*195', name: '长螺丝', supplier: '', qty: 4, snapshotPrice: 0.63 }],
    selectedTemplateId: 1,
    coilSpec: '750',
    coilMaterial: '',
    coilSheets: '24',
    hasFloat: false,
    floatWire: '',
    floatAccessoryType: 'standard',
    hasCable: false,
    cableLength: '',
    cableWire: '',
    cableAccessoryType: 'standard',
    packingParts: [],
    customBarrelLength: '170',
    effectiveBarrelLength: 170,
    effectiveLongScrewExtraLength: 25,
    selectedModelVariantId: null,
    impellerModel: '',
    impellerThickness: '',
    impellerDiameter: '',
    impellerBladeCount: '',
    technicalData: {},
    optionalParts: [],
    assemblyWage: 1,
    packingWage: 2,
    surfaceTreatmentMode: 'none',
    surfaceTreatmentCost: 99,
    managementFee: 3,
};

test('配方提交成本草稿 payload 应用默认材质和表面处理 none 归零', () => {
    const payload = buildRecipeCostDraftPayload(baseInput);

    assert.equal(payload.coilMaterial, '钢带');
    assert.equal(payload.surfaceTreatmentCost, 0);
    assert.equal(payload.customBarrelLength, 170);
    assert.equal(payload.longScrewExtraLength, 25);
});

test('配方提交使用成本草稿返回的 parts 生成最终 payload', async () => {
    const result = await prepareRecipeSubmission(baseInput);

    assert.equal(getLastCostDraftPayload().parts[0].model, '6*195');
    assert.equal(result.name, '测试配方');
    assert.equal(result.savedTotalCost, 2.6);
    assert.equal(JSON.parse(result.partsJson)[0].model, '6*200');
    assert.equal(result.surfaceTreatmentCost, 0);
});
