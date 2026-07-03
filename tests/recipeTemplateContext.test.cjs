const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '../src/utils/recipeTemplateContext.ts');
const source = fs.readFileSync(sourcePath, 'utf8')
    .replace(/import[^;]+;\n/g, '')
    .replace(/export function buildRecipeTemplateContext/, 'function buildRecipeTemplateContext');
const helpers = `
const DEFAULT_LONG_SCREW_EXTRA_LENGTH = 0;
function applyLongScrewRule(part, barrelLength, extraLength = DEFAULT_LONG_SCREW_EXTRA_LENGTH) {
  if (!String(part.name || '').includes('长螺丝')) return part;
  const barrel = Number(barrelLength);
  if (!Number.isFinite(barrel) || barrel <= 0) return part;
  const length = barrel + Number(extraLength || 0);
  return { ...part, model: '6*' + length, barrelLength: barrel, longScrewExtraLength: Number(extraLength || 0), requestedScrewLength: length, screwLength: length };
}
`;
const compiled = ts.transpileModule(`${helpers}\n${source}\nmodule.exports = { buildRecipeTemplateContext };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleStub = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', compiled)(moduleStub, moduleStub.exports);
const { buildRecipeTemplateContext } = moduleStub.exports;

test('配方模板上下文解析模板、泵壳 notes 并应用长螺丝规则', () => {
    const result = buildRecipeTemplateContext({
        selectedTemplate: {
            Id: 1,
            shellModel: '泵壳A',
            costMode: 'components',
            partsJson: JSON.stringify([{ name: '不锈钢长螺丝', model: '6*170', qty: 4 }]),
            shellComponentsJson: JSON.stringify([{ name: '机筒', qty: 1, pricingMode: 'lengthCm' }]),
        },
        selectedModelVariant: { Id: 2, barrelLength: 190, longScrewExtraLength: 10 },
        parts: [{ model: '泵壳A', category: '泵壳', notes: JSON.stringify({ barrelLength: 170 }) }],
        customBarrelLength: '',
    });

    assert.equal(result.effectiveBarrelLength, 190);
    assert.equal(result.effectiveLongScrewExtraLength, 10);
    assert.equal(result.shellMetaInfo.barrelLength, 170);
    assert.equal(result.shellComponents[0].name, '机筒');
    assert.equal(result.adjustedTemplateParts[0].model, '6*200');
});

test('配方模板上下文兼容坏 JSON 和自定义机筒长度优先', () => {
    const result = buildRecipeTemplateContext({
        selectedTemplate: {
            Id: 1,
            shellModel: '泵壳A',
            partsJson: '{bad',
            shellComponentsJson: '{bad',
        },
        selectedModelVariant: { Id: 2, barrelLength: 172 },
        parts: [{ model: '泵壳A', category: '泵壳', notes: '{bad' }],
        customBarrelLength: '190',
    });

    assert.equal(result.effectiveBarrelLength, '190');
    assert.deepEqual(result.adjustedTemplateParts, []);
    assert.deepEqual(result.shellComponents, []);
    assert.equal(result.shellMetaInfo, null);
});

test('配方模板上下文不再使用泵壳 notes 默认机筒长度', () => {
    const result = buildRecipeTemplateContext({
        selectedTemplate: {
            Id: 1,
            shellModel: '泵壳A',
            partsJson: JSON.stringify([{ name: '不锈钢长螺丝', model: '6*170', qty: 4 }]),
            shellComponentsJson: '[]',
        },
        selectedModelVariant: null,
        parts: [{ model: '泵壳A', category: '泵壳', notes: JSON.stringify({ barrelLength: 170 }) }],
        customBarrelLength: '',
    });

    assert.equal(result.effectiveBarrelLength, null);
    assert.equal(result.adjustedTemplateParts[0].model, '6*170');
});
