'use strict';
const { ontology } = require('./contract.cjs');
const { canonicalId, MAX_RESULT_BYTES: RESOLVER_BYTES } = require('./resolverContract.cjs');
const { deepFreeze } = require('./sources.cjs');
const { TraversalPolicyV1 } = require('./traversalPolicy.cjs');
const LIMITS = deepFreeze({ maxHop: 2, maxPaths: 1, maxFirstHopEntities: 20, maxSecondHopCalls: 20,
    maxFinalTargets: 50, maxResultBytes: Math.min(262143, RESOLVER_BYTES - 1) });
const statuses = ['COMPLETE', 'PARTIAL', 'UNAVAILABLE', 'ROOT_NOT_FOUND', 'PATH_INVALID', 'BUDGET_EXHAUSTED'];
const OntologyTraversalRequestV1 = deepFreeze({ version: 1, ontologyVersion: 1, relationPathLength: 2, limits: LIMITS, shadowOnly: true });
const OntologyTraversalResultV1 = deepFreeze({ version: 1, ontologyVersion: 1, statuses, limits: LIMITS, shadowOnly: true });
const relations = new Map(ontology.relations.map(r => [r.relationId, r]));
function reject(code) { throw Object.assign(new Error(code), { code }); }
function fields(value, allowed) {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(k => !allowed.includes(k))
        || allowed.some(k => !Object.hasOwn(value, k))) reject('TRAVERSAL_FIELDS_INVALID');
}
function validateTraversalRequest(input) {
    fields(input, ['ontologyVersion', 'root', 'relationPath']); fields(input.root, ['entityType', 'canonicalId']);
    if (input.ontologyVersion !== 1) reject('TRAVERSAL_VERSION_INVALID');
    if (!canonicalId(input.root.canonicalId)) reject('TRAVERSAL_ROOT_NOT_CANONICAL');
    if (!Array.isArray(input.relationPath) || input.relationPath.length !== 2) reject('TRAVERSAL_HOP_INVALID');
    const [r1, r2] = input.relationPath.map(id => relations.get(id));
    if (!r1 || !r2) reject('TRAVERSAL_RELATION_UNKNOWN');
    if ([r1, r2].some(r => !['CANONICAL_DIRECT', 'DETERMINISTIC_DERIVED'].includes(r.authority))) reject('TRAVERSAL_NOT_AUTHORITATIVE');
    if (r1.fromType !== input.root.entityType) reject('TRAVERSAL_ROOT_TYPE_INVALID');
    if (r1.toType !== r2.fromType) reject('TRAVERSAL_ADJACENCY_INVALID');
    if (r2.relationId === r1.inverseRelationId || r2.toType === r1.fromType) reject('TRAVERSAL_LOOP_FORBIDDEN');
    const policy = TraversalPolicyV1.paths.find(p => p.relationPath.join('|') === input.relationPath.join('|'));
    if (!policy) reject('TRAVERSAL_PATH_NOT_ALLOWED');
    return deepFreeze({ ontologyVersion: 1, root: { ...input.root }, relationPath: [...input.relationPath], pathId: policy.pathId,
        intermediateEntityType: r1.toType, targetEntityType: r2.toType });
}
// Policy entries themselves must obey structural V1 rules; no registry expansion.
for (const p of TraversalPolicyV1.paths) validateTraversalRequest({ ontologyVersion: 1,
    root: { entityType: relations.get(p.relationPath[0])?.fromType, canonicalId: '1' }, relationPath: p.relationPath });
function validateTraversalResult(result) {
    fields(result, ['version', 'ontologyVersion', 'status', 'root', 'relationPath', 'pathId', 'intermediateEntityType', 'targetEntityType',
        'intermediateCount', 'targetCount', 'targets', 'complete', 'warnings', 'failedIntermediateIds', 'provenance', 'budget', 'timing']);
    const invalid = () => reject('TRAVERSAL_RESULT_INVALID');
    if (result.version !== 1 || result.ontologyVersion !== 1 || !statuses.includes(result.status)
        || result.complete !== (result.status === 'COMPLETE') || !Array.isArray(result.targets)
        || result.targetCount !== result.targets.length || result.targetCount > LIMITS.maxFinalTargets
        || !Number.isSafeInteger(result.intermediateCount) || result.intermediateCount < 0 || result.intermediateCount > 20
        || !Array.isArray(result.warnings) || !Array.isArray(result.failedIntermediateIds) || !Array.isArray(result.provenance)) invalid();
    if (result.status === 'PATH_INVALID') {
        if (result.root !== null || result.relationPath.length || result.targets.length || result.provenance.length
            || result.intermediateCount || result.pathId !== null || result.intermediateEntityType !== null || result.targetEntityType !== null) invalid();
    } else {
        const q = validateTraversalRequest({ ontologyVersion: 1, root: result.root, relationPath: result.relationPath });
        if (q.pathId !== result.pathId || q.intermediateEntityType !== result.intermediateEntityType || q.targetEntityType !== result.targetEntityType) invalid();
    }
    const keys = new Set();
    for (const t of result.targets) {
        fields(t, ['entityType', 'canonicalId']);
        if (t.entityType !== result.targetEntityType || !canonicalId(t.canonicalId) || keys.has(`${t.entityType}:${t.canonicalId}`)) invalid();
        keys.add(`${t.entityType}:${t.canonicalId}`);
        const p = result.provenance.find(p => p.target.entityType === t.entityType && p.target.canonicalId === t.canonicalId);
        if (!p || !p.paths?.length) invalid();
    }
    if (result.provenance.length !== result.targets.length) invalid();
    for (const p of result.provenance) {
        fields(p, ['target', 'paths']); fields(p.target, ['entityType', 'canonicalId']);
        if (!keys.has(`${p.target.entityType}:${p.target.canonicalId}`) || p.paths.length > 20) invalid();
        const seen = new Set();
        for (const edge of p.paths) {
            fields(edge, ['root', 'relationPath', 'intermediate', 'reads']); fields(edge.root, ['entityType', 'canonicalId']); fields(edge.intermediate, ['entityType', 'canonicalId']);
            if (edge.root.entityType !== result.root.entityType || edge.root.canonicalId !== result.root.canonicalId
                || edge.relationPath.join('|') !== result.relationPath.join('|') || edge.intermediate.entityType !== result.intermediateEntityType
                || !canonicalId(edge.intermediate.canonicalId) || seen.has(edge.intermediate.canonicalId) || edge.reads.length !== 2) invalid();
            seen.add(edge.intermediate.canonicalId);
            for (let i = 0; i < 2; i++) {
                fields(edge.reads[i], ['relationId', 'sourceId', 'queryId', 'asOf']);
                if (edge.reads[i].relationId !== result.relationPath[i] || edge.reads[i].sourceId !== relations.get(result.relationPath[i]).sourceId
                    || !/^[a-f0-9-]{36}$/i.test(edge.reads[i].queryId) || !Number.isFinite(Date.parse(edge.reads[i].asOf))) invalid();
            }
        }
    }
    if (result.failedIntermediateIds.some(id => !canonicalId(id)) || new Set(result.failedIntermediateIds).size !== result.failedIntermediateIds.length
        || result.failedIntermediateIds.length > result.intermediateCount
        || result.warnings.length > 24 || result.warnings.some(w => !/^[A-Z0-9_]{1,64}$/.test(w))
        || result.complete && (result.warnings.length || result.failedIntermediateIds.length)) invalid();
    fields(result.budget, ['limits', 'firstHopEntities', 'secondHopCalls', 'finalTargets', 'resultBytes']);
    if (JSON.stringify(result.budget.limits) !== JSON.stringify(LIMITS) || result.budget.firstHopEntities !== result.intermediateCount
        || result.budget.finalTargets !== result.targetCount || !Number.isSafeInteger(result.budget.secondHopCalls)
        || result.budget.secondHopCalls < 0 || result.budget.secondHopCalls > 20
        || result.budget.resultBytes !== Buffer.byteLength(JSON.stringify(result), 'utf8') || result.budget.resultBytes > LIMITS.maxResultBytes) invalid();
    fields(result.timing, ['durationMs']); if (!Number.isFinite(result.timing.durationMs) || result.timing.durationMs < 0) invalid();
    return deepFreeze(result);
}
module.exports = { LIMITS, OntologyTraversalRequestV1, OntologyTraversalResultV1, validateTraversalRequest, validateTraversalResult };
