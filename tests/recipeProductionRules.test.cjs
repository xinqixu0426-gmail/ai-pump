const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '../src/utils/recipeProductionRules.ts');
const source = fs.readFileSync(sourcePath, 'utf8')
    .replace(/import[^;]+;\n/g, '');
const helpers = `
function parseRecipePartsJson(partsJson) {
  try {
    const parsed = JSON.parse(partsJson || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
`;
const compiled = ts.transpileModule(`${helpers}\n${source}\nmodule.exports = { buildRecipeStockChecks, stockChecksAllSufficient, stockChecksError, stockDeductionsFromChecks };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleStub = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', compiled)(moduleStub, moduleStub.exports);
const {
    buildRecipeStockChecks,
    stockChecksAllSufficient,
    stockChecksError,
    stockDeductionsFromChecks,
} = moduleStub.exports;

test('配方生产规则按型号和供应商预检库存并生成扣减 payload', () => {
    const recipe = {
        partsJson: JSON.stringify([
            { name: '轴承', model: 'A', supplier: 'S1', qty: 2 },
            { name: '油封', model: 'B', supplier: 'S2', qty: 1 },
        ]),
    };
    const parts = [
        { Id: 10, model: 'A', supplier: 'S1', stock: 5 },
        { Id: 11, model: 'B', supplier: '其它', stock: 3 },
    ];
    const checks = buildRecipeStockChecks(recipe, parts, 2);

    assert.equal(checks[0].qtyNeeded, 4);
    assert.equal(checks[0].partId, 10);
    assert.equal(checks[1].partId, 11);
    assert.equal(stockChecksAllSufficient(checks), true);
    assert.equal(stockChecksError(checks), '');
    assert.deepEqual(stockDeductionsFromChecks(checks), [{ partId: 10, deductQty: 4 }, { partId: 11, deductQty: 2 }]);
});

test('配方生产规则提示库存不足和零件缺失', () => {
    const insufficient = [{ name: '轴承', qtyNeeded: 5, currentStock: 1, sufficient: false, partId: 1 }];
    const missing = [{ name: '油封', qtyNeeded: 1, currentStock: 0, sufficient: true }];

    assert.match(stockChecksError(insufficient), /库存不足/);
    assert.match(stockChecksError(missing), /不存在/);
    assert.equal(stockChecksAllSufficient(insufficient), false);
    assert.deepEqual(buildRecipeStockChecks({ partsJson: '{bad' }, [], 1), []);
});
