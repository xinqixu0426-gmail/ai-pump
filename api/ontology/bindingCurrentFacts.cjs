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
    // Inverse membership needs a verified unfiltered full source collection, never one detail or a
    // filtered list. Certification is keyed on the semantic source snapshot, not on raw invocation
    // count: repeated reads of the same authoritative collection are complete + complete = complete,
    // while materially different collections must not be resolved by silently taking the last one.
    const isCompleteRead = t => t?.result?.success !== false && Array.isArray(t.result?.data)
        && t.result.count === t.result.data.length
        && t.result.filters && Object.values(t.result.filters).every(v => v === '' || v === null)
        && t.result.executionEvidence?.verified && t.result.executionEvidence.kind === 'formal_api_query'
        && entityMetadata[projection.from].resources.some(resource => resource.tool === t.name && resource.field === 'data'
            && t.result.executionEvidence.calls?.some(c => c.method === 'GET' && new RegExp(`^/api/${resource.path}(?:\\?|$)`).test(c.path)));
    const reads = toolResults.filter(isCompleteRead);
    if (!reads.length) return context;
    // One snapshot identity per distinct source collection, independent of read order.
    const signature = read => read.result.data.map(record => record?.id).filter(id => id !== undefined)
        .map(String).sort((a, b) => Number(a) - Number(b)).join(',');
    if (new Set(reads.map(signature)).size > 1) return context;
    const capability = reads[0].name, pageSize = reads[0].result.data.length;
    const sourceRows = rows.filter(r => r.entityType === projection.from && r.capability === capability);
    // Each complete read contributes exactly one full row block. Any surplus or shortfall means some
    // other read of this capability was filtered, truncated or partial, so membership cannot be proven.
    if (pageSize * reads.length !== sourceRows.length) return context;
    for (const source of sourceRows.slice(0, pageSize)) {
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
