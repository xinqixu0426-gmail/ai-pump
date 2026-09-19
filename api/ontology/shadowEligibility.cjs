'use strict';
const { hasVerifiedExecution } = require('../services/aiExecutionEvidence.cjs');
const { isCoilRecipeRelationQuery } = require('../services/aiToolShortlist.cjs');
const { shouldRequireCatalogIdentity } = require('../services/bomPartIdentity.cjs');
const { canonicalId } = require('./resolverContract.cjs');
const { ids, MAX_TARGETS } = require('./shadowContract.cjs');
const { ontology } = require('./contract.cjs');
const { parsedReferences } = require('../services/relationReadContract.cjs');
function id(value) { return Number.isSafeInteger(value) && value > 0 ? String(value) : null; }
function formal(item, path) {
    return hasVerifiedExecution(item?.result) && item.result.success !== false
        && item.result.executionEvidence.kind === 'formal_api_query'
        && item.result.executionEvidence.calls?.some(call => call.method === 'GET' && call.path === path);
}
function context(relationId, entityType, rootId, targets, capabilities, complete = true) {
    const canonicalTargetIds = ids(targets);
    return { relationId, root: { entityType, canonicalId: id(rootId) },
        canonicalTargetIds: canonicalTargetIds ?? [], canonical: canonicalTargetIds !== null,
        sourceCapabilities: capabilities, complete };
}
// Observe only executed formal result shapes. No new language planner, no name binding.
function* shadowContexts(userText, toolResults = []) {
    for (const item of toolResults) {
        const result = item?.result;
        if (item.name === 'get_recipe_detail' && result?.recipe) {
            const r = result.recipe;
            if (!formal(item, `/api/recipes/${r.id}`)) continue;
            let parts = r.parts;
            if (Object.hasOwn(r, 'partsJson')) {
                try { parts = parsedReferences(r.partsJson); }
                catch {
                    yield context('recipe.contains_part', 'recipe', r.id, [], [item.name], false);
                    continue;
                }
            }
            if (!Array.isArray(parts) || parts.length > MAX_TARGETS) {
                yield context('recipe.contains_part', 'recipe', r.id, [], [item.name], false);
                continue;
            }
            const references = parts.filter(p => p && p.name !== '线圈转子' && shouldRequireCatalogIdentity(p));
            yield context('recipe.contains_part', 'recipe', r.id, references.map(p => id(p.partId)), [item.name],
                parts.every(p => p && typeof p === 'object' && !Array.isArray(p)));
        }
        if (item.name === 'get_order_detail' && result?.order) {
            const o = result.order;
            if (formal(item, `/api/orders/${o.id}`)) yield context('order.belongs_to_customer', 'order', o.id,
                [id(o.customerId)], [item.name]);
        }
        if (item.name === 'get_quotation_detail' && result?.quotation) {
            const q = result.quotation;
            if (formal(item, `/api/quotations/${q.id}`)) yield context('quotation.belongs_to_customer', 'quotation', q.id,
                [id(q.customerId)], [item.name]);
        }
        if (item.name === 'search_coils' && isCoilRecipeRelationQuery(userText)
            && Array.isArray(result?.data) && result.data.length === 1) {
            const coil = result.data[0];
            const list = toolResults.find(t => t.name === 'get_all_recipes' && formal(t, '/api/recipes')
                && t.result.filters?.keyword === '' && t.result.filters.hasTechnicalFiles === null
                && Array.isArray(t.result.data) && t.result.count === t.result.data.length);
            if (!list || !result.executionEvidence?.calls?.some(c => c.method === 'GET' && /^\/api\/coils(?:\?|$)/.test(c.path))
                || !hasVerifiedExecution(result) || result.success === false) continue;
            const recipes = list.result.data;
            if (recipes.length > MAX_TARGETS) {
                yield context('coil.used_by_recipe', 'coil', coil.id, [], [item.name, list.name], false);
                continue;
            }
            const valid = recipes.every(r => id(r.id)
                && (r.coilId === null || id(r.coilId)));
            yield context('coil.used_by_recipe', 'coil', coil.id,
                recipes.filter(r => r.coilId === coil.id).map(r => id(r.id)), [item.name, list.name], valid);
        }
    }
}
function selectShadowContext(userText, toolResults = []) {
    let firstUnavailable = null;
    for (const c of shadowContexts(userText, toolResults)) {
        if (eligible(c)) return c;
        firstUnavailable ??= c;
    }
    return firstUnavailable;
}
function eligible(context) {
    const relation = ontology.relations.find(r => r.relationId === context?.relationId);
    return Boolean(relation && context?.root && canonicalId(context.root.canonicalId)
        && context.root.entityType === relation.fromType);
}
module.exports = { selectShadowContext, eligible };
