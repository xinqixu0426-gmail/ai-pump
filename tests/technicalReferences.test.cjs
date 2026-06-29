const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '../src/utils/technicalReferences.ts');
const source = fs.readFileSync(sourcePath, 'utf8')
    .replace(/import[^;]+;\n/g, '')
    .replace(/export function buildTechnicalReferenceFields/, 'function buildTechnicalReferenceFields');
const compiled = ts.transpileModule(`${source}\nmodule.exports = { buildTechnicalReferenceFields };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleStub = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', compiled)(moduleStub, moduleStub.exports);
const { buildTechnicalReferenceFields } = moduleStub.exports;

test('技术参考字段工具合并泵壳 notes 和模板转子参数', () => {
    const result = buildTechnicalReferenceFields({
        shellMetaInfo: {
            isStainless: true,
            barrelLength: 170,
            openOffset: 25,
            defaultUpperBearing: '6202',
            barrelLengthPresets: [170, 190],
            customKey: '自定义值',
        },
        selectedTemplate: {
            rotorParamsJson: JSON.stringify({
                rotor_dia: 45,
                upper_bearing: '6202',
            }),
        },
    });

    assert.deepEqual(result.map(item => item.label), [
        '开档偏移量',
        '默认上轴承',
        'customKey',
        '模板转子直径',
        '模板上轴承',
    ]);
    assert.equal(result.find(item => item.id === 'barrelLength'), undefined);
    assert.equal(result.find(item => item.id === 'barrelLengthPresets'), undefined);
    assert.equal(result.find(item => item.id === 'rotor_dia'), undefined);
    assert.equal(result.find(item => item.id === 'rotor_rotor_dia')?.unit, 'mm');
});
