const {
    normalizeResourceText,
    resolveUniqueResource,
} = require('./aiResourceResolutionV3.cjs');

const normalizeRecipeName = normalizeResourceText;

function recipeCandidate(recipe) {
    return {
        id: recipe.id ?? recipe.Id,
        name: recipe.name,
        spec: recipe.spec || '',
    };
}

function resolveUniqueRecipe(recipes, args = {}) {
    const resolved = resolveUniqueResource(recipes, {
        entityType: 'recipe',
        explicitId: args.recipeId,
        query: args.recipeName,
        nameKeys: ['name'],
        candidateView: recipeCandidate,
    });
    return resolved.resource
        ? { recipe: resolved.resource }
        : resolved;
}

function normalizeRecipeCostContract(costResult, metadata = {}) {
    const source = costResult && typeof costResult === 'object' ? costResult : {};
    const currentTotalCost = Object.prototype.hasOwnProperty.call(source, 'currentTotalCost')
        ? source.currentTotalCost
        : source.unitCost;
    return {
        ...source,
        currentTotalCost,
        unitCost: currentTotalCost,
        ...metadata,
        deprecatedFields: {
            ...(source.deprecatedFields || {}),
            unitCost: '兼容字段；请改用 currentTotalCost',
        },
    };
}

function selectCurrentRecipeCost(currentCosts, recipeId) {
    const item = (Array.isArray(currentCosts?.items) ? currentCosts.items : [])
        .find(candidate => Number(candidate.recipeId) === Number(recipeId));
    if (!item) {
        throw new Error(`配方 ${recipeId} 的当前完整成本结果缺失`);
    }
    return normalizeRecipeCostContract(item, {
        costBasis: 'currentFullCost',
        sourceOfTruth: currentCosts.sourceOfTruth,
        basis: currentCosts.basis,
        asOf: currentCosts.asOf,
    });
}

module.exports = {
    normalizeRecipeCostContract,
    normalizeRecipeName,
    resolveUniqueRecipe,
    selectCurrentRecipeCost,
};
