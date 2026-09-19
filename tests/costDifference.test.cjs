const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCostDifference } = require('../api/services/costDifference.cjs');

test('成本差异解释按金额差异排序并给出原因', () => {
    const result = buildCostDifference(
        { leftRecipeName: '12-120', rightRecipeName: '12-140' },
        {
            recipes: [
                { id: 1, name: 'V750 12-120', spec: '12-120' },
                { id: 2, name: 'V750 12-140', spec: '12-140' },
            ],
            leftCost: {
                totalCost: 90,
                details: [
                    { name: '泵壳套件', model: 'V750', supplier: 'A', qty: 1, subtotal: 90 },
                    { name: '长螺丝', model: 'M6x150', supplier: 'B', qty: 4, subtotal: 8 },
                ],
            },
            rightCost: {
                totalCost: 95,
                details: [
                    { name: '泵壳套件', model: 'V750', supplier: 'A', qty: 1, subtotal: 92 },
                    { name: '长螺丝', model: 'M6x170', supplier: 'B', qty: 4, subtotal: 10 },
                    { name: '电容', model: '20uF', supplier: 'C', qty: 1, subtotal: 3 },
                ],
            },
        }
    );

    assert.equal(result.totalDiff, 5);
    assert.equal(result.direction, '增加');
    assert.match(result.summary, /成本增加 5\.00 元/);
    assert.deepEqual(result.drivers.map(driver => driver.name), ['电容', '泵壳套件', '长螺丝']);
    assert.equal(result.drivers[0].reason, '只存在于对比配方');
    assert.equal(result.drivers[2].reason, '型号或供应商不同');
});

test('成本差异解释缺少配方标识时不得误匹配第一条配方', () => {
    assert.throws(
        () => buildCostDifference(
            { rightRecipeName: '12-140' },
            {
                recipes: [
                    { id: 1, name: 'V750 12-120', spec: '12-120' },
                    { id: 2, name: 'V750 12-140', spec: '12-140' },
                ],
                leftCost: { totalCost: 0, details: [] },
                rightCost: { totalCost: 0, details: [] },
            }
        ),
        /未找到基准配方/
    );
});

test('成本差异解释的名称片段匹配多条时返回明确歧义', () => {
    assert.throws(
        () => buildCostDifference(
            { leftRecipeName: 'V750', rightRecipeId: 3 },
            {
                recipes: [
                    { id: 1, name: 'V750 12-120' },
                    { id: 2, name: 'V750 12-140' },
                    { id: 3, name: 'V550 12-120' },
                ],
                leftCost: { totalCost: 0, details: [] },
                rightCost: { totalCost: 0, details: [] },
            }
        ),
        error => error.statusCode === 409
            && error.code === 'RECIPE_SELECTOR_AMBIGUOUS'
            && error.details.candidates.length === 2
    );
});

test('成本差异解释遇到未定价配方时整体失败而不是按零元比较', () => {
    assert.throws(
        () => buildCostDifference(
            { leftRecipeId: 1, rightRecipeId: 2 },
            {
                recipes: [
                    { id: 1, name: '完整配方', partsJson: '[]' },
                    { id: 2, name: '缺价配方', partsJson: '[{"model":"缺价零件"}]' },
                ],
                currentCostDependencies: {
                    partsCache: {},
                    partsByModel: {},
                    coils: [],
                    getSetting: () => 0,
                    buildBomDraft: (_input, recipe) => ({
                        parts: JSON.parse(recipe.partsJson),
                    }),
                    calculateRecipeCost: parts => ({
                        totalCost: '0.00',
                        itemCount: parts.length,
                        details: [],
                        missingParts: parts.map(item => item.model),
                    }),
                },
            }
        ),
        error => error.statusCode === 422
            && error.code === 'RECIPE_COST_INCOMPLETE'
            && error.details.recipeName === '缺价配方'
    );
});
