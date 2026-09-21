'use strict';
const { ontology } = require('./contract.cjs');
const { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_RESULT_BYTES, SCAN_LIMIT, NESTED_LIMIT } = require('../services/relationReadContract.cjs');
const { deepFreeze } = require('./sources.cjs');

const ResolverContractVersion = 1;
const relations = new Map(ontology.relations.map(r => [r.relationId, r]));
const existingReaders = new Set(ontology.relationReadMapping.filter(m => m.disposition === 'ADAPTER_REQUIRED').map(m => m.ontologyRelationId));
function reject(code, status = 'INVALID_REQUEST') {
    const error = new Error(code);
    error.code = code;
    error.resolveStatus = status;
    throw error;
}
function canonicalId(value) {
    return typeof value === 'string' && /^[1-9][0-9]*$/.test(value)
        && Number.isSafeInteger(Number(value));
}
function object(value, allowed, required = allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype
        || Object.keys(value).some(k => !allowed.includes(k))
        || required.some(k => !Object.hasOwn(value, k))) reject('RELATION_RESOLVE_FIELDS_INVALID');
}
function validateResolveRequest(input) {
    object(input, ['ontologyVersion', 'relationId', 'root', 'pageSize', 'afterId'], ['ontologyVersion', 'relationId', 'root']);
    if (input.ontologyVersion !== ontology.version) reject('RELATION_ONTOLOGY_VERSION_UNSUPPORTED');
    if (typeof input.relationId !== 'string') reject('RELATION_ID_INVALID');
    if (ontology.transitionalCandidates.some(c => c.candidateId === input.relationId)) reject('RELATION_NOT_AUTHORITATIVE');
    const relation = relations.get(input.relationId);
    if (!relation) reject('RELATION_ID_UNKNOWN');
    if (!['CANONICAL_DIRECT', 'DETERMINISTIC_DERIVED'].includes(relation.authority)) reject('RELATION_NOT_AUTHORITATIVE');
    object(input.root, ['entityType', 'canonicalId']);
    if (input.root.entityType !== relation.fromType) reject('RELATION_ROOT_TYPE_INVALID');
    if (!canonicalId(input.root.canonicalId)) reject('RELATION_CANONICAL_ID_INVALID');
    if (input.pageSize !== undefined && (!Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > MAX_PAGE_SIZE)) reject('RELATION_PAGE_SIZE_INVALID');
    if (input.afterId !== undefined && !canonicalId(input.afterId)) reject('RELATION_CURSOR_INVALID');
    if (input.afterId !== undefined && relation.cardinality !== 'MANY') reject('RELATION_CURSOR_UNSUPPORTED');
    return deepFreeze({ ontologyVersion: 1, relationId: relation.relationId,
        root: { ...input.root }, pageSize: input.pageSize ?? DEFAULT_PAGE_SIZE,
        ...(input.afterId !== undefined ? { afterId: input.afterId } : {}) });
}

function validateResolveResult(request, result) {
    const q = validateResolveRequest(request), relation = relations.get(q.relationId);
    const invalid = () => reject('RELATION_RESULT_INVALID', 'TECHNICAL_FAILURE');
    const expected = ['version', 'ontologyVersion', 'success', 'status', 'relationId', 'root', 'resultEntityType', 'items', 'authority', 'sourceOfTruth', 'provenance', 'asOf', 'complete', 'hasMore', 'pageSize', 'returnedCount', 'totalCount', 'pageBoundary', 'warnings'];
    if (!result || Object.keys(result).sort().join(',') !== expected.sort().join(',')
        || result.version !== 1 || result.ontologyVersion !== 1 || result.success !== true
        || result.relationId !== relation.relationId || result.resultEntityType !== relation.toType
        || result.root?.entityType !== q.root.entityType || result.root?.canonicalId !== q.root.canonicalId
        || Object.keys(result.root).sort().join(',') !== 'canonicalId,entityType'
        || result.authority !== relation.authority || result.sourceOfTruth !== relation.sourceOfTruth
        || result.complete !== true || !Array.isArray(result.items) || result.items.length > q.pageSize
        || result.pageSize !== q.pageSize || result.returnedCount !== result.items.length
        || !Number.isSafeInteger(result.totalCount) || result.totalCount < result.items.length
        || typeof result.hasMore !== 'boolean' || !Array.isArray(result.warnings) || result.warnings.length !== 0
        || result.status !== (result.totalCount === 0 ? 'VERIFIED_EMPTY' : 'RESOLVED')
        || !Number.isFinite(Date.parse(result.asOf))) invalid();
    const p = result.provenance;
    if (!p || Object.keys(p).sort().join(',') !== 'asOf,authority,canonicalOnly,currentVsSnapshotSemantics,physicalSource,queryId,relationId,root,sourceId,sourceService'
        || p.relationId !== relation.relationId || p.authority !== relation.authority
        || p.sourceId !== relation.sourceId || p.physicalSource !== relation.physicalSource
        || p.currentVsSnapshotSemantics !== relation.currentVsSnapshotSemantics
        || p.canonicalOnly !== true || p.asOf !== result.asOf
        || p.root?.entityType !== q.root.entityType || p.root?.canonicalId !== q.root.canonicalId
        || Object.keys(p.root).sort().join(',') !== 'canonicalId,entityType'
        || p.sourceService !== (existingReaders.has(relation.relationId) ? 'relationReadService.read:CANONICAL_ONLY' : 'canonicalRelationQueries.readSource')
        || typeof p.queryId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.queryId)) invalid();
    let prior = q.afterId === undefined ? Infinity : Number(q.afterId);
    for (const item of result.items) {
        if (!item || Object.keys(item).sort().join(',') !== 'canonicalId,display,entityType'
            || item.entityType !== relation.toType || !canonicalId(item.canonicalId)
            || Number(item.canonicalId) >= prior || !item.display
            || Object.keys(item.display).join(',') !== 'name' || typeof item.display.name !== 'string'
            || !item.display.name.length || item.display.name.length > 160) invalid();
        prior = Number(item.canonicalId);
    }
    if (!result.pageBoundary || Object.keys(result.pageBoundary).sort().join(',') !== 'afterId,nextAfterId'
        || result.pageBoundary.afterId !== (q.afterId ?? null)
        || result.pageBoundary.nextAfterId !== (result.hasMore ? result.items.at(-1)?.canonicalId : null)
        || (result.hasMore && (result.items.length !== q.pageSize || result.totalCount <= result.items.length))
        || (q.afterId === undefined && !result.hasMore && result.totalCount !== result.items.length)
        || (relation.cardinality !== 'MANY' && (result.items.length > 1 || result.hasMore))
        || (relation.cardinality === 'ONE' && result.items.length !== 1)
        || Buffer.byteLength(JSON.stringify(result), 'utf8') >= MAX_RESULT_BYTES) invalid();
    return deepFreeze(result);
}

module.exports = { ResolverContractVersion, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_RESULT_BYTES,
    SCAN_LIMIT, NESTED_LIMIT, canonicalId, reject, validateResolveRequest, validateResolveResult };
