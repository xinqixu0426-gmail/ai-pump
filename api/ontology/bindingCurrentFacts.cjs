'use strict';
const { ontology } = require('./contract.cjs');
const { verifiedRows } = require('./relationBinder.cjs');
const { parsedReferences } = require('../services/relationReadContract.cjs');
const { shouldRequireCatalogIdentity } = require('../services/bomPartIdentity.cjs');
const { canonicalId } = require('./resolverContract.cjs');
const { entityMetadata } = require('./bindingMetadata.cjs');
const projections = Object.freeze({
    recipe_template: { from: 'recipe', field: 'templateId' }, recipe_coil: { from: 'recipe', field: 'coilId' },
    order_customer: { from: 'order', field: 'customerId' }, quotation_customer: { from: 'quotation', field: 'customerId' },
    order_recipe: { from: 'order', field: 'itemsJson', decoded: 'items', targetId: 'recipeId' },
    recipe_part: { from: 'recipe', field: 'partsJson', decoded: 'parts', targetId: 'partId', excludeNonPart: true },
});
function targets(row, projection) {
    const value = row[projection.field];
    if (!projection.targetId) return value === null ? [] : [Number.isSafeInteger(value) && value > 0 ? String(value) : null];
    const references = value !== undefined ? parsedReferences(value) : row[projection.decoded];
    if (!Array.isArray(references) || references.length > 50) throw Error('CURRENT_INCOMPLETE');
    return references.filter(p => !projection.excludeNonPart || (p.name !== '线圈转子' && shouldRequireCatalogIdentity(p)))
        .map(p => Number.isSafeInteger(p[projection.targetId]) && p[projection.targetId] > 0 ? String(p[projection.targetId]) : null);
}
function currentFactsForBinding(binding, toolResults = []) {
    const relation = ontology.relations.find(r => r.relationId === binding.relationId);
    const projection = projections[relation.sourceId];
    const rows = verifiedRows(toolResults), capabilities = [...new Set(rows.map(r => r.capability))];
    const context = { relationId: relation.relationId, root: binding.root, sourceCapabilities: capabilities,
        canonicalTargetIds: [], canonical: true, complete: false };
    if (relation.fromType === projection.from) {
        const roots = rows.filter(r => r.entityType === binding.root.entityType && r.canonicalId === binding.root.canonicalId);
        const facts = [];
        for (const root of roots) {
            try { const values = targets(root.row, projection); if (values.some(v => !canonicalId(v))) { context.canonical = false; continue; } facts.push(values); }
            catch { /* Missing fields/invalid snapshots cannot prove empty. */ }
        }
        if (!facts.length) return context;
        const normalized = facts.map(v => [...new Set(v)].sort().join(','));
        if (new Set(normalized).size > 1) return context;
        context.canonicalTargetIds = facts[0]; context.complete = true; context.canonical = true;
        return context;
    }
    // Inverse membership needs a verified unfiltered full source collection, never one detail or a filtered list.
    const list = toolResults.find(t => t?.result?.success !== false && t.result?.count === t.result?.data?.length
        && t.result.filters && Object.values(t.result.filters).every(v => v === '' || v === null)
        && t.result.executionEvidence?.verified && t.result.executionEvidence.kind === 'formal_api_query'
        && entityMetadata[projection.from].resources.some(resource => resource.tool === t.name && resource.field === 'data'
            && t.result.executionEvidence.calls?.some(c => c.method === 'GET' && new RegExp(`^/api/${resource.path}(?:\\?|$)`).test(c.path))));
    if (!list) return context;
    const sourceRows = rows.filter(r => r.entityType === projection.from && r.capability === list.name);
    if (sourceRows.length !== list.result.data.length) return context;
    for (const source of sourceRows) {
        try {
            const references = targets(source.row, projection);
            if (references.some(v => !canonicalId(v))) { context.canonical = false; return context; }
            if (references.includes(binding.root.canonicalId)) context.canonicalTargetIds.push(source.canonicalId);
        } catch { return context; }
    }
    context.complete = true;
    return context;
}
module.exports = { currentFactsForBinding };
