'use strict';
const { performance } = require('node:perf_hooks');
const { LIMITS, validateTraversalRequest, validateTraversalResult } = require('./traversalContract.cjs');
const { validateResolveResult } = require('./resolverContract.cjs');
function finish(result, started) {
    result.targetCount = result.targets.length;
    Object.assign(result.budget, { firstHopEntities: result.intermediateCount, finalTargets: result.targetCount });
    result.complete = result.status === 'COMPLETE'; result.timing.durationMs = Math.max(0, performance.now() - started);
    for (let i = 0; i < 4; i++) result.budget.resultBytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
    return validateTraversalResult(result);
}
function base(q) { return { version: 1, ontologyVersion: 1, status: 'PATH_INVALID', root: q?.root ?? null,
    relationPath: q?.relationPath ?? [], pathId: q?.pathId ?? null, intermediateEntityType: q?.intermediateEntityType ?? null,
    targetEntityType: q?.targetEntityType ?? null, intermediateCount: 0, targetCount: 0, targets: [], complete: false,
    warnings: [], failedIntermediateIds: [], provenance: [], budget: { limits: LIMITS, firstHopEntities: 0,
        secondHopCalls: 0, finalTargets: 0, resultBytes: 0 }, timing: { durationMs: 0 } }; }
function createOntologyTraversal({ resolver }) {
    function traverse(input) {
        const started = performance.now(); let q;
        try { q = validateTraversalRequest(input); }
        catch { const r = base(); r.warnings.push('PATH_INVALID'); return finish(r, started); }
        const r = base(q), warn = code => { if (!r.warnings.includes(code)) r.warnings.push(code); };
        function read(relationId, root, pageSize) {
            const request = { ontologyVersion: 1, relationId, root, pageSize };
            try {
                const result = resolver.resolveRelation(request);
                return result?.success === true ? validateResolveResult(request, result) : result;
            } catch { return { success: false, status: 'TECHNICAL_FAILURE' }; }
        }
        const first = read(q.relationPath[0], q.root, LIMITS.maxFirstHopEntities);
        if (first?.success !== true) {
            r.status = first?.status === 'ROOT_NOT_FOUND' ? 'ROOT_NOT_FOUND' : 'UNAVAILABLE';
            warn(r.status === 'ROOT_NOT_FOUND' ? 'ROOT_NOT_FOUND' : 'FIRST_HOP_UNAVAILABLE'); return finish(r, started);
        }
        r.intermediateCount = first.items.length;
        let exhausted = first.hasMore, successful = 0;
        if (first.hasMore) warn('FIRST_HOP_TRUNCATED');
        const receipt = result => ({ relationId: result.relationId, sourceId: result.provenance.sourceId,
            queryId: result.provenance.queryId, asOf: result.provenance.asOf });
        let stop = false;
        for (const intermediateItem of first.items) {
            const intermediate = { entityType: intermediateItem.entityType, canonicalId: intermediateItem.canonicalId };
            if (stop || r.budget.secondHopCalls >= LIMITS.maxSecondHopCalls) {
                exhausted = true; warn('SECOND_HOP_BUDGET'); r.failedIntermediateIds.push(intermediate.canonicalId); continue;
            }
            r.budget.secondHopCalls++;
            const second = read(q.relationPath[1], intermediate, LIMITS.maxFinalTargets);
            if (second?.success !== true) {
                r.failedIntermediateIds.push(intermediate.canonicalId);
                const reason = ['REFERENCE_INCOMPLETE', 'AMBIGUOUS_LEGACY_REFERENCE', 'ROOT_NOT_FOUND', 'RELATION_UNAVAILABLE', 'TECHNICAL_FAILURE'].includes(second?.status) ? second.status : 'TECHNICAL_FAILURE';
                warn(`SECOND_HOP_${reason}`); continue;
            }
            successful++;
            if (second.hasMore) { exhausted = true; warn('SECOND_HOP_TRUNCATED'); r.failedIntermediateIds.push(intermediate.canonicalId); }
            for (const item of second.items) {
                const target = { entityType: item.entityType, canonicalId: item.canonicalId };
                let provenance = r.provenance.find(p => p.target.entityType === target.entityType && p.target.canonicalId === target.canonicalId);
                if (!provenance && r.targets.length >= LIMITS.maxFinalTargets) {
                    exhausted = true; stop = true; warn('FINAL_TARGET_BUDGET');
                    if (!r.failedIntermediateIds.includes(intermediate.canonicalId)) r.failedIntermediateIds.push(intermediate.canonicalId); break;
                }
                const edge = { root: q.root, relationPath: q.relationPath, intermediate, reads: [receipt(first), receipt(second)] };
                const created = !provenance;
                if (created) { provenance = { target, paths: [] }; r.targets.push(target); r.provenance.push(provenance); }
                provenance.paths.push(edge);
                // Reserve enough space for remaining bounded warning/failed-ID/budget metadata.
                if (Buffer.byteLength(JSON.stringify(r), 'utf8') >= LIMITS.maxResultBytes - 4096) {
                    provenance.paths.pop(); if (created) { r.targets.pop(); r.provenance.pop(); }
                    exhausted = true; stop = true; warn('RESULT_BYTE_BUDGET');
                    if (!r.failedIntermediateIds.includes(intermediate.canonicalId)) r.failedIntermediateIds.push(intermediate.canonicalId); break;
                }
            }
        }
        r.status = exhausted ? 'BUDGET_EXHAUSTED' : r.failedIntermediateIds.length ? (successful ? 'PARTIAL' : 'UNAVAILABLE') : 'COMPLETE';
        return finish(r, started);
    }
    return Object.freeze({ traverse });
}
module.exports = { createOntologyTraversal };
