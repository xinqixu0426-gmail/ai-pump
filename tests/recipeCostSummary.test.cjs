const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '../src/utils/recipeCostSummary.ts');
const source = fs.readFileSync(sourcePath, 'utf8')
    .replace(/import[^;]+;\n/g, '')
    .replace(/export interface[\s\S]*?\n}\n\nexport interface[\s\S]*?\n}\n\nexport function calculateRecipeCostSummary/, 'function calculateRecipeCostSummary');
const compiled = ts.transpileModule(`${source}\nmodule.exports = { calculateRecipeCostSummary };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleStub = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', compiled)(moduleStub, moduleStub.exports);
const { calculateRecipeCostSummary } = moduleStub.exports;

test('配方浮动成本汇总计算所有分项', () => {
    const summary = calculateRecipeCostSummary({
        allPartsPreview: [
            { model: '泵壳', name: '泵壳', supplier: '', qty: 1, snapshotPrice: 10 },
            { model: '电缆', name: '电缆', supplier: '', qty: 2, snapshotPrice: 1.5 },
        ],
        templateCost: 10,
        selectedTemplate: { Id: 1 },
        coilResult: { totalCost: 20 },
        optionalParts: [{ model: '轴承', supplier: 'A', qty: 2 }],
        capacitorModel: '20μF',
        configParts: [{ model: '浮球', name: '浮球', supplier: '', qty: 1, snapshotPrice: 3 }],
        packingParts: [
            { model: '纸箱', supplier: 'A', qty: 1 },
            { model: '手动木箱', supplier: '', qty: 1, costSource: 'manual', snapshotPrice: 8 },
        ],
        laborCost: 5,
        getPriceByModelAndSupplier: (model) => ({ '轴承': 2, '20μF': 4, '纸箱': 6 }[model] || 0),
    });

    assert.equal(summary.showTemplateCost, true);
    assert.equal(summary.partsCost, 13);
    assert.equal(summary.coilCost, 20);
    assert.equal(summary.optionAndCapacitorCost, 8);
    assert.equal(summary.configCost, 3);
    assert.equal(summary.packingCost, 14);
    assert.equal(summary.totalCost, 18);
});
