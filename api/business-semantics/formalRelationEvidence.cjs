'use strict';

const { classifyQuestion } = require('./questionSemantics.cjs');
const { authoritativeCoilCandidateScope } = require('./authoritativeCandidateScope.cjs');

function verified(item) {
    return item?.result?.success !== false
        && item?.result?.executionEvidence?.verified === true
        && item.result.executionEvidence.kind === 'formal_api_query';
}

function positiveId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function asksForRelation(userText, relationId) {
    const text = String(userText || '');
    if (relationId === 'recipe.uses_coil') return /(?:线圈|绕组)/u.test(text)
        && /(?:用|使用|配)/u.test(text) && !/(?:被哪|用在哪|装在哪)/u.test(text);
    if (relationId === 'coil.used_by_recipe') return /(?:线圈|绕组)/u.test(text)
        && /(?:被哪|给哪|用在哪|装在哪)/u.test(text) && /(?:配方|产品)/u.test(text);
    if (relationId === 'recipe.contains_part') return /(?:零件|配件)/u.test(text)
        && /(?:包含|含有|用了哪|使用哪|需要哪|配了哪|明细)/u.test(text);
    if (relationId === 'part.contained_in_recipe') return /(?:配方|产品)/u.test(text)
        && /(?:被哪|给哪|用在哪|装在哪)/u.test(text);
    return false;
}

function oneConsistent(items, signature) {
    if (!items.length) return null;
    const signatures = new Set(items.map(signature));
    return signatures.size === 1 ? items[0] : null;
}

function explicitlyNamedCoilRows(rows, userText) {
    const text = String(userText || '').replace(/\s+/gu, '');
    const fields = ['material', 'slotType', 'schemeCode', 'schemeName'];
    const narrowed = rows.filter(row => fields.some(field => {
        const value = String(row?.[field] || '').replace(/\s+/gu, '');
        return value.length >= 2 && text.includes(value);
    }));
    return narrowed.length ? narrowed : rows;
}

/**
 * Project already-verified, complete relation reads into the business semantic layer.
 *
 * This is deliberately an adapter over existing ontology/read capabilities, not a second relation
 * engine.  User wording can select which already-declared relation is being asked about, but it can
 * never create a root or target: every canonical id below comes from a verified formal read.
 */
function formalRelationEvidence(userText, toolResults = []) {
    const allows = relationId => asksForRelation(userText, relationId);
    const semantics = classifyQuestion(userText, { admittedCatalogLookup: true });

    if (allows('recipe.uses_coil')) {
        const details = toolResults.filter(item => verified(item) && item.name === 'get_recipe_detail'
            && item.result?.recipe).map(item => item.result.recipe)
            .filter(recipe => positiveId(recipe.id) && positiveId(recipe.coilId));
        const detail = oneConsistent(details, recipe => `${positiveId(recipe.id)}:${positiveId(recipe.coilId)}`);
        if (detail) {
            const coilId = positiveId(detail.coilId);
            const coils = toolResults.filter(item => verified(item) && item.name === 'search_coils'
                && Array.isArray(item.result?.data)).flatMap(item => item.result.data)
                .filter(row => positiveId(row.id ?? row.Id) === coilId);
            const coil = oneConsistent(coils, row => JSON.stringify([positiveId(row.id ?? row.Id),
                String(row.spec || ''), Number(row.sheets), String(row.material || ''), String(row.slotType || '')]));
            if (coil) return {
                relationId: 'recipe.uses_coil', rootType: 'recipe', rootId: positiveId(detail.id),
                rootName: String(detail.name || ''), targetType: 'coil', targetIds: [coilId], items: [coil],
                complete: true, empty: false,
            };
        }
    }

    const definitions = [
        ['recipe.contains_part', 'get_recipe_parts', 'recipe', 'part', item => positiveId(item.partId)],
        ['part.contained_in_recipe', 'get_recipes_by_part', 'part', 'recipe', item => positiveId(item.recipeId)],
    ];
    for (const [relationId, capability, rootType, targetType, targetId] of definitions) {
        if (!allows(relationId)) continue;
        const results = toolResults.filter(item => verified(item) && item.name === capability
            && item.result?.relation === relationId && item.result?.complete === true
            && Array.isArray(item.result?.data)).map(item => item.result);
        const result = oneConsistent(results, value => JSON.stringify(value));
        const rootId = positiveId(result?.root?.canonicalId);
        if (result && rootId) return {
            relationId, rootType, rootId, targetType,
            targetIds: [...new Set(result.data.map(targetId).filter(Boolean))],
            items: result.data, complete: true, empty: result.data.length === 0,
        };
    }

    if (allows('coil.used_by_recipe')) {
        const coilReads = toolResults.filter(item => verified(item) && item.name === 'search_coils'
            && Array.isArray(item.result?.data));
        const scoped = authoritativeCoilCandidateScope(coilReads.flatMap(item => item.result.data), semantics).rows;
        const namedScope = explicitlyNamedCoilRows(scoped, userText);
        const coilScopeComplete = coilReads.length > 0 && coilReads.every(item => {
            const receipt = item.result?.queryReceipt;
            return receipt?.authoritative === true && receipt.truncated !== true
                && receipt.possiblyTruncated !== true
                && Number(receipt.returnedCount) === Number(receipt.totalCount);
        });
        if (coilScopeComplete && scoped.length === 0 && semantics.requestedIdentity.spec
            && semantics.requestedIdentity.sheets) return {
            relationId: 'coil.used_by_recipe', rootType: 'coil', rootId: null, targetType: 'recipe',
            targetIds: [], items: [], complete: true, empty: true, rootNotFound: true,
        };
        const results = toolResults.filter(item => verified(item) && item.name === 'get_recipes_by_coil'
            && item.result?.relation === 'coil.recipes' && item.result?.complete === true
            && item.result?.setCompleteness === 'COMPLETE' && Array.isArray(item.result?.data))
            .map(item => item.result);
        const result = oneConsistent(results, value => JSON.stringify(value));
        const rootId = positiveId(result?.rootCoilId);
        const rootMatches = namedScope.length === 1 && positiveId(namedScope[0]?.id ?? namedScope[0]?.Id) === rootId;
        if (result && rootId && coilScopeComplete && rootMatches) return {
            relationId: 'coil.used_by_recipe', rootType: 'coil', rootId, targetType: 'recipe',
            targetIds: [...new Set(result.data.map(item => positiveId(item.recipeId)).filter(Boolean))],
            items: result.data, complete: true, empty: result.data.length === 0,
        };
    }
    return null;
}

module.exports = { formalRelationEvidence };
