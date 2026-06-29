const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '../src/utils/recipeCoilForm.ts');
const source = fs.readFileSync(sourcePath, 'utf8')
    .replace(/import[^;]+;\n/g, '')
    .replace(/export function buildCoilCalculateBody/, 'function buildCoilCalculateBody')
    .replace(/export function resolveCoilLinkedSelections/, 'function resolveCoilLinkedSelections');
const helpers = `
const DEFAULT_COIL_MATERIAL = '钢带';
function capacitorValueFromModel(model) {
  const normalized = String(model || '').replace(/[uUμfFvV\\s]/g, '').trim();
  const value = parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}
`;
const compiled = ts.transpileModule(`${helpers}\n${source}\nmodule.exports = { buildCoilCalculateBody, resolveCoilLinkedSelections };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleStub = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', compiled)(moduleStub, moduleStub.exports);
const { buildCoilCalculateBody, resolveCoilLinkedSelections } = moduleStub.exports;

test('线圈计算请求体使用默认材质并支持自定义线重', () => {
    assert.deepEqual(buildCoilCalculateBody({
        spec: '750',
        material: '',
        sheets: '24',
        customWeight: '0.35',
    }), {
        spec: '750',
        material: '钢带',
        sheets: 24,
        wireWeight: 0.35,
    });
});

test('线圈结果联动线径和电容型号', () => {
    const result = resolveCoilLinkedSelections({
        coilResult: { wireGauge: '0.75', capacitor: '20uF' },
        floatWireOptions: ['0.55', '0.75'],
        cableWireOptions: ['0.75'],
        parts: [
            { model: '18μF', category: '电容' },
            { model: '20μF', category: '电容' },
        ],
    });

    assert.equal(result.nextFloatWire, '0.75');
    assert.equal(result.nextCableWire, '0.75');
    assert.equal(result.capacitorModel, '20μF');
});

test('线圈结果无法匹配电容时返回空型号', () => {
    const result = resolveCoilLinkedSelections({
        coilResult: { wireGauge: '0.6', capacitor: '25uF' },
        floatWireOptions: ['0.55'],
        cableWireOptions: ['0.75'],
        parts: [{ model: '20μF', category: '电容' }],
    });

    assert.equal(result.nextFloatWire, undefined);
    assert.equal(result.nextCableWire, undefined);
    assert.equal(result.capacitorModel, '');
});
