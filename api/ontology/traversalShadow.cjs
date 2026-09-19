'use strict';
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { bindTraversal } = require('./traversalBinder.cjs');
const { currentFactsForBinding } = require('./bindingCurrentFacts.cjs');
const { canonicalId } = require('./resolverContract.cjs');
const { validateTraversalResult } = require('./traversalContract.cjs');
const { ontology } = require('./contract.cjs');
const { deepFreeze } = require('./sources.cjs');
const { safeRequestId } = require('./shadowContract.cjs');
const TIMEOUT_MS = 2500;
let activeWorkers = 0;
function resolveTraversalInWorker(request, databasePath, timeoutMs = TIMEOUT_MS) {
    if (activeWorkers >= 2) return Promise.resolve(null);
    activeWorkers++;
    return new Promise(resolve => {
        let worker, settled = false;
        const finish = result => {
            if (settled) return; settled = true; clearTimeout(timer);
            const release = () => { activeWorkers--; resolve(result); };
            // Completion includes releasing the worker slot, including on timeout.
            if (worker) void worker.terminate().catch(() => {}).finally(release); else release();
        };
        const timer = setTimeout(() => finish(null), timeoutMs);
        try {
            worker = new Worker(path.join(__dirname, 'traversalWorker.cjs'), { workerData: { databasePath, request } });
            worker.once('message', finish); worker.once('error', () => finish(null)); worker.once('exit', () => finish(null));
        } catch { finish(null); }
    });
}
function currentTraversalFacts(binding, toolResults) {
    const empty = { complete: false, canonicalTargetIds: [] };
    if (binding.status !== 'BOUND_2HOP') return empty;
    const first = currentFactsForBinding({ relationId: binding.relationPath[0], root: binding.root }, toolResults);
    if (!first.complete || !first.canonical || first.canonicalTargetIds.some(id => !canonicalId(id)) || first.canonicalTargetIds.length > 20) return empty;
    const relation = ontology.relations.find(r => r.relationId === binding.relationPath[0]), targets = new Set();
    for (const id of new Set(first.canonicalTargetIds)) {
        const second = currentFactsForBinding({ relationId: binding.relationPath[1], root: { entityType: relation.toType, canonicalId: id } }, toolResults);
        if (!second.complete || !second.canonical || second.canonicalTargetIds.some(id => !canonicalId(id))) return empty;
        for (const id of second.canonicalTargetIds) targets.add(id);
        if (targets.size > 50) return empty;
    }
    return { complete: true, canonicalTargetIds: [...targets].sort((a, b) => Number(a) - Number(b)) };
}
function compareTraversal(binding, current, traversal) {
    if (binding.status !== 'BOUND_2HOP') return 'NOT_BOUND';
    if (!current.complete) return 'CURRENT_PATH_NOT_COMPARABLE';
    if (!traversal) return 'TECHNICAL_FAILURE';
    if (!traversal.complete) return 'ONTOLOGY_PATH_NOT_COMPLETE';
    if (traversal.root.entityType !== binding.root.entityType || traversal.root.canonicalId !== binding.root.canonicalId
        || traversal.relationPath.join('|') !== binding.relationPath.join('|')) return 'MISMATCH';
    const expected = [...new Set(current.canonicalTargetIds)].sort((a, b) => Number(a) - Number(b));
    const actual = traversal.targets.map(t => t.canonicalId).sort((a, b) => Number(a) - Number(b));
    return JSON.stringify(expected) === JSON.stringify(actual) ? 'MATCH' : 'MISMATCH';
}
async function observeTraversalShadow(input, dependencies = {}) {
    let binding, current = { complete: false, canonicalTargetIds: [] }, traversal = null;
    try {
        binding = bindTraversal({ ontologyVersion: 1, userText: input.userText, verifiedToolResults: input.toolResults,
            trustedSession: input.trustedSession, subject: input.subject, conversationId: input.conversationId });
        if (binding.status === 'BOUND_2HOP') {
            current = currentTraversalFacts(binding, input.toolResults);
            const result = await (dependencies.resolve || resolveTraversalInWorker)({ ontologyVersion: 1,
                root: binding.root, relationPath: binding.relationPath }, dependencies.databasePath || path.join(__dirname, '..', '..', 'pump.db'));
            traversal = result ? validateTraversalResult(result) : null;
        }
    } catch { /* Observation cannot invalidate authoritative work. */ }
    const record = deepFreeze({ version: 1, ontologyVersion: 1, requestId: safeRequestId(input.requestId), binding: binding || null,
        executed: binding?.status === 'BOUND_2HOP', current, traversal,
        comparison: binding ? compareTraversal(binding, current, traversal) : 'TECHNICAL_FAILURE' });
    try { await (dependencies.observeSpan || require('../services/observability.cjs').withOntologyTraversalSpan)(record); } catch { /* Fail open. */ }
    try { dependencies.record?.(record); } catch { /* Fail open. */ }
    return record;
}
module.exports = { TIMEOUT_MS, resolveTraversalInWorker, currentTraversalFacts, compareTraversal, observeTraversalShadow };
