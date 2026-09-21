'use strict';
const { hasVerifiedExecution } = require('./aiExecutionEvidence.cjs');

/**
 * Present a recipe -> coil fact only when both formal sides agree on one canonical coil id.
 *
 * The recipe detail owns the relationship; the coil catalogue only supplies the target's current
 * canonical display fields. User text, model prose, a specification match, or the first catalogue row
 * can never create this relation. Conflicting/repeated formal reads fail closed instead of choosing one.
 */
function verifiedRecipeCoilRelationReply(userText, toolResults = [], options = {}) {
    if (options.enabled !== true || !/(?:线圈|绕组)/u.test(String(userText || ''))) return '';
    const details = toolResults
        .filter(item => item?.name === 'get_recipe_detail' && item.result?.success !== false
            && hasVerifiedExecution(item.result) && item.result?.recipe)
        .map(item => item.result.recipe);
    const identities = [...new Map(details.map(recipe => {
        const coilId = Number(recipe?.coilId);
        const recipeId = Number(recipe?.id);
        if (!Number.isSafeInteger(recipeId) || recipeId <= 0
            || !Number.isSafeInteger(coilId) || coilId <= 0) return [null, null];
        return [`${recipeId}:${coilId}`, { recipe, recipeId, coilId }];
    }).filter(([key]) => key)).values()];
    if (identities.length !== 1) return '';
    const [{ recipe, coilId }] = identities;
    const coils = toolResults
        .filter(item => item?.name === 'search_coils' && item.result?.success !== false
            && hasVerifiedExecution(item.result) && Array.isArray(item.result?.data))
        .flatMap(item => item.result.data)
        .filter(coil => Number(coil?.id) === coilId);
    const canonical = [...new Map(coils.map(coil => [JSON.stringify([
        Number(coil.id), String(coil.spec || ''), Number(coil.sheets),
        String(coil.material || ''), String(coil.slotType || ''),
    ]), coil])).values()];
    if (canonical.length !== 1) return '';
    const coil = canonical[0];
    const spec = String(coil.spec || recipe.coilSpec || '').trim();
    const sheets = Number(coil.sheets ?? recipe.coilSheets);
    if (!spec || !Number.isSafeInteger(sheets) || sheets <= 0) return '';
    const identity = [coil.material, coil.slotType].map(value => String(value || '').trim()).filter(Boolean);
    return `${String(recipe.name || `配方 ${recipe.id}`).trim()} 使用 ${spec}-${sheets} 线圈${identity.length ? `（${identity.join('/')}）` : ''}。`;
}

function shouldReplaceWithVerifiedRecipeCoilReply(answer, verifiedReply) {
    if (!verifiedReply) return false;
    const shapes = text => [...String(text || '').matchAll(/(?<!\d)(\d{1,3}\s*[-—~]\s*\d{2,3})(?!\d)/gu)]
        .map(match => match[1].replace(/\s+/g, '').replace(/[—~]/g, '-'));
    const expected = new Set(shapes(verifiedReply));
    const actual = new Set(shapes(answer));
    return expected.size > 0 && (actual.size === 0
        || [...expected].some(value => !actual.has(value))
        || [...actual].some(value => !expected.has(value)));
}

module.exports = { shouldReplaceWithVerifiedRecipeCoilReply, verifiedRecipeCoilRelationReply };
