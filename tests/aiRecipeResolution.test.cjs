const test = require('node:test');
const assert = require('node:assert/strict');
const {
    resolveUniqueRecipe,
} = require('../api/services/aiRecipeResolution.cjs');

const recipes = [
    { id: 1, name: 'v550-tokoy' },
    { id: 2, name: 'v750-tokoy' },
    { id: 3, name: 'V750-出口版' },
];

test('AI 配方解析：名称匹配忽略大小写且唯一简称可定位', () => {
    const result = resolveUniqueRecipe(recipes.slice(0, 2), { recipeName: 'V750' });
    assert.equal(result.recipe.id, 2);
    assert.equal(result.recipe.name, 'v750-tokoy');
});

test('AI 配方解析：简称命中多条时返回候选而不猜选', () => {
    const result = resolveUniqueRecipe(recipes, { recipeName: 'v750' });
    assert.match(result.error, /匹配到 2 个配方/);
    assert.equal(result.code, 'AI_RESOURCE_AMBIGUOUS');
    assert.equal(result.requiresClarification, true);
    assert.deepEqual(result.candidates, [
        { id: 2, name: 'v750-tokoy', spec: '' },
        { id: 3, name: 'V750-出口版', spec: '' },
    ]);
    assert.deepEqual(result.clarification.candidates.map(item => item.label), [
        'v750-tokoy',
        'V750-出口版',
    ]);
});

test('AI 配方解析：显式 ID 优先并保持零匹配语义', () => {
    assert.equal(resolveUniqueRecipe(recipes, { recipeId: 1, recipeName: 'V750' }).recipe.id, 1);
    assert.match(resolveUniqueRecipe(recipes, { recipeId: 99 }).error, /99/);
});
