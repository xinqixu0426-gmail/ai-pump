const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '../src/utils/recipeBomDraftPayload.ts');
const source = fs.readFileSync(sourcePath, 'utf8')
    .replace(/import[^;]+;\n/g, '')
    .replace(/export interface[\s\S]*?\n}\n\nexport function shouldRequestRecipeBomDraft/, 'function shouldRequestRecipeBomDraft')
    .replace(/export function buildRecipeBomDraftPayload/, 'function buildRecipeBomDraftPayload');
const helpers = `
const DEFAULT_COIL_MATERIAL = '钢带';
function inferPackingMaterial(model, explicit) {
  if (explicit) return explicit;
  if (String(model || '').includes('木箱')) return '木箱';
  if (String(model || '').includes('彩')) return '彩印纸箱';
  if (String(model || '').includes('泡沫')) return '泡沫';
  if (String(model || '').includes('商标')) return '商标';
  if (String(model || '').includes('说明书')) return '说明书';
  if (String(model || '').includes('珍珠棉')) return '珍珠棉';
  return '牛皮纸箱';
}
`;
const compiled = ts.transpileModule(`${helpers}\n${source}\nmodule.exports = { shouldRequestRecipeBomDraft, buildRecipeBomDraftPayload };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleStub = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', compiled)(moduleStub, moduleStub.exports);
const { shouldRequestRecipeBomDraft, buildRecipeBomDraftPayload } = moduleStub.exports;

test('BOM draft 请求判断覆盖模板、选配和动态配置', () => {
    assert.equal(shouldRequestRecipeBomDraft({
        selectedTemplateId: null,
        optionalParts: [],
        hasFloat: false,
        hasCable: false,
        packingParts: [],
    }), false);
    assert.equal(shouldRequestRecipeBomDraft({
        selectedTemplateId: 1,
        optionalParts: [],
        hasFloat: false,
        hasCable: false,
        packingParts: [],
    }), true);
    assert.equal(shouldRequestRecipeBomDraft({
        selectedTemplateId: null,
        optionalParts: [{ model: '轴承' }],
        hasFloat: false,
        hasCable: false,
        packingParts: [],
    }), true);
});

test('BOM draft payload 标准化选配、包装和线圈默认材质', () => {
    const payload = buildRecipeBomDraftPayload({
        selectedTemplateId: 1,
        selectedModelVariantId: 2,
        effectiveBarrelLength: 170,
        effectiveLongScrewExtraLength: 25,
        coilSpec: '750',
        coilSheets: '24',
        coilMaterial: '',
        coilResult: null,
        capacitorModel: '20μF',
        optionalParts: [
            { model: '轴承', supplier: 'A', qty: 2 },
            { model: '', supplier: '', qty: 1 },
        ],
        hasFloat: true,
        floatWire: '0.55',
        floatAccessoryType: 'standard',
        floatAccessoryDelta: 1,
        hasCable: true,
        cableLength: '3',
        cableWire: '0.55',
        cableAccessoryType: 'xinjie',
        packingParts: [
            { model: '彩印纸箱A', supplier: 'P', qty: 1 },
            { model: '木箱B', supplier: 'P', qty: 1, snapshotPrice: 12, costSource: 'manual' },
            { model: '说明书', supplier: 'P', qty: 1 },
        ],
    });

    assert.equal(payload.coilMaterial, '钢带');
    assert.deepEqual(payload.optionalParts, [{ model: '轴承', supplier: 'A', qty: 2 }]);
    assert.deepEqual(payload.packingParts, [
        { model: '彩印纸箱A', supplier: 'P', qty: 1, snapshotPrice: undefined, costSource: undefined, packagingMaterial: '彩印纸箱' },
        { model: '木箱B', supplier: 'P', qty: 1, snapshotPrice: 12, costSource: 'manual', packagingMaterial: '木箱' },
        { model: '说明书', supplier: 'P', qty: 1, snapshotPrice: undefined, costSource: undefined, packagingMaterial: '说明书' },
    ]);
});
