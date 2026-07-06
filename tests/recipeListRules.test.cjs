const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '../src/utils/recipeListRules.ts');
const source = fs.readFileSync(sourcePath, 'utf8')
    .replace(/import[^;]+;\n/g, '');
const compiled = ts.transpileModule(`${source}\nmodule.exports = { parseRecipePartsJson, validRecipeParts, recipePartsOverview, buildRecipeCopperRisk, getRecipeLaborTotal, getRecipeSavedTotal, buildRecipeListFallbackData, buildRecipeListData };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleStub = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', compiled)(moduleStub, moduleStub.exports);
const {
    parseRecipePartsJson,
    validRecipeParts,
    recipePartsOverview,
    buildRecipeCopperRisk,
    getRecipeLaborTotal,
    getRecipeSavedTotal,
    buildRecipeListFallbackData,
    buildRecipeListData,
} = moduleStub.exports;

test('配方列表规则解析 parts、生成概览并读取人工成本', () => {
    const parts = parseRecipePartsJson('[{"model":"A","qty":2},{"model":"","qty":1}]');
    const valid = validRecipeParts(parts);

    assert.deepEqual(parseRecipePartsJson('{bad'), []);
    assert.equal(valid.length, 1);
    assert.equal(recipePartsOverview(valid), 'A×2');
    assert.equal(getRecipeLaborTotal({ assemblyWage: 1, packingWage: 2, surfaceTreatmentCost: 3, managementFee: 4 }), 10);
    assert.equal(getRecipeLaborTotal({ savedCostDetails: '安装工资: ¥1.50\n管理费用: ¥2.50' }), 4);
    assert.equal(getRecipeSavedTotal({ savedTotalCost: 88 }), 88);
});

test('配方列表规则优先保存总成本，计算失败时生成兜底数据', async () => {
    const recipe = {
        Id: 7,
        partsJson: JSON.stringify([{ model: 'A', qty: 2 }]),
        savedTotalCost: 99,
    };
    const data = await buildRecipeListData(recipe, async () => ({ totalCost: '10', itemCount: 1, details: [], missingParts: [] }));
    const fallback = buildRecipeListFallbackData(recipe, [{ model: 'A', qty: 2 }]);
    const failed = await buildRecipeListData(recipe, async () => { throw new Error('bad'); });

    assert.equal(data.cost, '¥99.00');
    assert.equal(data.costResult.snapshotTotalCost, '99.00');
    assert.equal(fallback.costResult.itemCount, 1);
    assert.equal(failed.cost, '¥99.00');
});

test('配方列表铜价预警按保存公式和当前铜价分级', () => {
    const parts = [{
        model: '12-120',
        name: '线圈转子',
        qty: 1,
        formula: '0.21×120 + 0.533×78 + 8.00 + 5.00',
    }];

    assert.equal(buildRecipeCopperRisk(parts, 81).level, 'watch');
    assert.equal(buildRecipeCopperRisk(parts, 83).level, 'review');
    const critical = buildRecipeCopperRisk(parts, 88);
    assert.equal(critical.level, 'critical');
    assert.equal(critical.diffPerTon, 10000);
    assert.match(critical.label, /上涨 ¥10,000\/吨/);
    assert.equal(buildRecipeCopperRisk(parts, 76).level, 'none');
});
