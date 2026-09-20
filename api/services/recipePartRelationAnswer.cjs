'use strict';
const { hasVerifiedExecution } = require('./aiExecutionEvidence.cjs');

function uniqueVerified(toolResults, name, relation) {
    const matches = toolResults.filter(item => item?.name === name && item.result?.success !== false
        && item.result?.relation === relation && item.result?.complete === true
        && hasVerifiedExecution(item.result) && Array.isArray(item.result?.data));
    if (!matches.length) return null;
    const signatures = matches.map(item => JSON.stringify(item.result));
    return new Set(signatures).size === 1 ? matches[0].result : null;
}

function verifiedRecipePartRelationReply(userText, toolResults = [], options = {}) {
    if (options.enabled !== true || !/(?:零件|配件)/u.test(String(userText || ''))) return '';
    const forward = uniqueVerified(toolResults, 'get_recipe_parts', 'recipe.contains_part');
    if (forward) {
        const label = `配方 ID ${forward.root.canonicalId}`;
        if (!forward.data.length) return `${label} 的已保存规范零件关系为空（范围仅为 partsJson，不含线圈、包装、动态配置或模板默认件）。`;
        return `${label} 的已保存规范零件：${forward.data.map(item => item.partName).join('、')}。范围仅为 partsJson。`;
    }
    const reverse = uniqueVerified(toolResults, 'get_recipes_by_part', 'part.contained_in_recipe');
    if (reverse) {
        const label = `零件 ID ${reverse.root.canonicalId}`;
        if (!reverse.data.length) return `${label} 当前没有被任何配方的 partsJson 以正式 partId 引用。`;
        return `${label} 当前被以下配方的 partsJson 正式引用：${reverse.data.map(item => item.recipeName).join('、')}。`;
    }
    return '';
}

module.exports = { verifiedRecipePartRelationReply };
