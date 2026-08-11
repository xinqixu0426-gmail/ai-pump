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

module.exports = {
    normalizeRecipeName,
    resolveUniqueRecipe,
};
