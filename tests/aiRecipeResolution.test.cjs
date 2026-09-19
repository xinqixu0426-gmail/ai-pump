const test = require('node:test');
const assert = require('node:assert/strict');
const {
    resolveUniqueRecipe,
} = require('../api/services/aiRecipeResolution.cjs');
const {
    bindResolutionToolCalls,
    resolveUniqueResource,
} = require('../api/services/aiResourceResolutionV3.cjs');

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
    assert.equal(result.entityType, 'recipe');
    assert.equal(result.query, 'v750');
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
    const missing = resolveUniqueRecipe(recipes, { recipeId: 99 });
    assert.match(missing.error, /99/);
    assert.equal(missing.entityType, 'recipe');
    assert.equal(missing.query, '99');
});

// --- A：口语片段被当成实体名（生产会话 58：「我要找V550的」→「未找到配方：V550的」） ---
const productionLikeRecipes = [
    { id: 12, name: 'V550大脚板-2寸-经典款', spec: '12-120' },
];

test('AI 配方解析：结尾语气助词被剥离后仍能唯一绑定配方', () => {
    for (const spoken of ['V550的', 'V550呢', 'V550吧', 'V550的？', 'V550 的 ', 'v550的', 'V550啊']) {
        const result = resolveUniqueRecipe(productionLikeRecipes, { recipeName: spoken });
        assert.equal(result.recipe?.id, 12, `${spoken} 应绑定配方ID 12`);
        assert.equal(result.error, undefined, `${spoken} 不得报"未找到配方"`);
    }
});

test('AI 配方解析：剥离助词后命中多条必须走候选澄清，而不是"未找到"', () => {
    const result = resolveUniqueRecipe([
        { id: 12, name: 'V550大脚板-2寸-经典款', spec: '' },
        { id: 13, name: '水泵-V550-大脚板-2寸-12-120片-经典款', spec: '' },
    ], { recipeName: 'V550的' });
    assert.equal(result.code, 'AI_RESOURCE_AMBIGUOUS');
    assert.equal(result.requiresClarification, true);
    assert.equal(result.query, 'V550');
    assert.match(result.error, /匹配到 2 个配方/);
    assert.doesNotMatch(result.error, /未找到/);
    assert.deepEqual(result.clarification.candidates.map(item => item.canonicalId), [12, 13]);
    assert.doesNotMatch(JSON.stringify(result), /V550的/u);
});

test('AI 配方解析：确实不存在时明确说不存在，不回显口语片段', () => {
    const missing = resolveUniqueRecipe(productionLikeRecipes, { recipeName: 'V250的' });
    assert.equal(missing.code, 'AI_RESOURCE_NOT_FOUND');
    assert.equal(missing.query, 'V250');
    assert.match(missing.error, /未找到配方：V250$/);
    assert.doesNotMatch(JSON.stringify(missing), /V250的/u);
});

test('AI 资源解析：正式名称本身以助词结尾时，原样精确匹配优先', () => {
    const result = resolveUniqueResource([
        { id: 1, name: '样品的' },
        { id: 2, name: '样品' },
    ], { entityType: 'recipe', nameKeys: ['name'], query: '样品的' });
    assert.equal(result.resource?.id, 1);
    assert.equal(result.code, undefined);
});

test('AI 资源解析：上一轮候选的唯一绑定同样容忍结尾助词', () => {
    const context = {
        version: 3,
        kind: 'resource_selection',
        sourceTool: 'preview_recipe_cost',
        entityType: 'recipe',
        query: 'V750',
        candidates: [
            { index: 1, label: 'V750-出口版', description: '', canonicalId: 3, canonicalName: 'V750-出口版' },
            { index: 2, label: 'V750 菲律宾', description: '', canonicalId: 4, canonicalName: 'V750 菲律宾' },
        ],
    };
    const bound = bindResolutionToolCalls([{
        id: 'call-1',
        function: { name: 'preview_recipe_cost', arguments: JSON.stringify({ recipeName: 'V750-出口版的' }) },
    }], context);
    assert.equal(bound.issue, null);
    assert.deepEqual(JSON.parse(bound.toolCalls[0].function.arguments), { recipeId: 3 });
});

// --- 变更描述被塞进型号字段（生产会话 58 msg 321「12-120换成12-140」、msg 329「550的重新核算」） ---
test('AI 配方解析：变更描述不算"不存在"，给出可执行的下一步', () => {
    for (const spoken of ['12-120换成12-140', '550的重新核算', '把12-120换成12-140成本多少']) {
        const result = resolveUniqueRecipe(productionLikeRecipes, { recipeName: spoken });
        assert.equal(result.code, 'AI_RESOURCE_QUERY_NOT_A_NAME', spoken);
        assert.equal(result.entityType, 'recipe');
        assert.match(result.error, /不是配方名称/);
        assert.doesNotMatch(result.error, /未找到/);
        assert.match(result.hint, /recipeId/);
        assert.match(result.hint, /overrides/);
    }
});

test('AI 配方解析：变更描述判定不影响任何原本能解析的名称', () => {
    // 真正存在、名字里带"替换/加装"等字样时，先按名称解析，不会被当成变更描述。
    const rows = [
        { id: 21, name: '替换件-X-长型号', spec: '' },
        { id: 22, name: '加装支架-2寸-通用', spec: '' },
    ];
    assert.equal(resolveUniqueRecipe(rows, { recipeName: '替换件-X-长型号' }).recipe.id, 21);
    assert.equal(resolveUniqueRecipe(rows, { recipeName: '加装支架-2寸-通用' }).recipe.id, 22);
    // 短型号查不到时仍是"不存在"，不被误判成变更描述。
    const missing = resolveUniqueRecipe(rows, { recipeName: '加装件-Q' });
    assert.equal(missing.code, 'AI_RESOURCE_NOT_FOUND');
    assert.match(missing.error, /未找到配方：加装件-Q$/);
});
