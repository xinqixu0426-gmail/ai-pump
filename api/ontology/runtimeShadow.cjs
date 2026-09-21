'use strict';
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { performance } = require('node:perf_hooks');
const { compareShadow } = require('./shadowContract.cjs');
const { selectShadowContext, eligible } = require('./shadowEligibility.cjs');
const { withOntologyShadowSpan } = require('../services/observability.cjs');
const MAX_HOP = 1, MAX_SHADOW_RELATIONS_PER_REQUEST = 1, TIMEOUT_MS = 1500;
const recentComparisons = [];
let activeWorkers = 0;
function resolveInWorker(context, databasePath, timeoutMs = TIMEOUT_MS) {
    if (activeWorkers >= 4) return Promise.resolve({ success: false, status: 'TECHNICAL_FAILURE', code: 'SHADOW_WORKER_BUDGET' });
    activeWorkers++;
    return new Promise(resolve => {
        let worker, settled = false;
        const finish = result => {
            if (settled) return;
            settled = true; clearTimeout(timer);
            if (worker) void worker.terminate().catch(() => {}).finally(() => { activeWorkers--; });
            else activeWorkers--;
            resolve(result);
        };
        const timer = setTimeout(() => finish({ success: false, status: 'TECHNICAL_FAILURE', code: 'SHADOW_TIMEOUT' }), timeoutMs);
        try {
            worker = new Worker(path.join(__dirname, 'shadowWorker.cjs'), { workerData: { databasePath,
                request: { ontologyVersion: 1, relationId: context.relationId, root: context.root, pageSize: 50 } } });
            worker.once('message', finish);
            worker.once('error', () => finish({ success: false, status: 'TECHNICAL_FAILURE', code: 'SHADOW_WORKER_FAILURE' }));
            worker.once('exit', () => finish({ success: false, status: 'TECHNICAL_FAILURE', code: 'SHADOW_WORKER_FAILURE' }));
        } catch { finish({ success: false, status: 'TECHNICAL_FAILURE', code: 'SHADOW_WORKER_FAILURE' }); }
    });
}
async function observeShadow({ userText, toolResults, requestId, bindingEnabled = false, traversalEnabled = false, trustedSession, subject, conversationId }, dependencies = {}) {
    let context;
    try { context = selectShadowContext(userText, toolResults); } catch { context = null; }
    if (bindingEnabled) {
        try {
            const binding = require('./relationBinder.cjs').bindRelation({ ontologyVersion: 1, userText,
                verifiedToolResults: toolResults, trustedSession, subject, conversationId });
            try { await require('../services/observability.cjs').withOntologyBindingSpan(binding); } catch { /* Fail open. */ }
            try { dependencies.recordBinding?.(binding); } catch { /* Fail open. */ }
            if (binding.status === 'BOUND') {
                const candidate = require('./bindingCurrentFacts.cjs').currentFactsForBinding(binding, toolResults);
                // A new intent must never replace an existing complete canonical P3 comparison.
                if (!eligible(context) || context.complete !== true || context.canonical !== true) context = candidate;
            }
        } catch { /* Binder failure preserves P3 observation. */ }
    }
    const isEligible = eligible(context);
    const started = performance.now();
    let resolved;
    if (isEligible) {
        try {
            resolved = await (dependencies.resolve || resolveInWorker)(context,
                dependencies.databasePath || path.join(__dirname, '..', '..', 'pump.db'));
        } catch { resolved = { success: false, status: 'TECHNICAL_FAILURE', code: 'SHADOW_RESOLVER_FAILURE' }; }
    }
    const record = compareShadow(context, resolved, { requestId, ontologyMs: isEligible ? performance.now() - started : 0 });
    recentComparisons.push(record);
    if (recentComparisons.length > 100) recentComparisons.shift();
    // Metadata only goes to the existing privacy-filtered instrumentation. IDs remain in local controlled sinks.
    try { await (dependencies.observeSpan || withOntologyShadowSpan)(record, isEligible); } catch { /* Observation must fail open. */ }
    try { dependencies.record?.(record); } catch { /* Sink must fail open. */ }
    // Independent layer: never await or replace the completed P3/P4 observation.
    if (bindingEnabled && traversalEnabled) {
        try { void require('./traversalShadow.cjs').observeTraversalShadow({ userText, toolResults, requestId,
            trustedSession, subject, conversationId }, dependencies.traversal).catch(() => {}); } catch { /* Fail open. */ }
    }
    return record;
}
module.exports = { MAX_HOP, MAX_SHADOW_RELATIONS_PER_REQUEST, TIMEOUT_MS, resolveInWorker, observeShadow,
    recentShadowComparisons: () => recentComparisons.slice() };
