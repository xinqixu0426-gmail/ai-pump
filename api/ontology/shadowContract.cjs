'use strict';
const { ontology } = require('./contract.cjs');
const { canonicalId } = require('./resolverContract.cjs');
const { deepFreeze } = require('./sources.cjs');
const { createHash } = require('node:crypto');

const ShadowContractVersion = 1;
const ShadowFlag = 'AI_ONTOLOGY_RELATION_SHADOW_ENABLED';
const MAX_TARGETS = 512;
const statuses = Object.freeze(['MATCH', 'MISMATCH', 'CURRENT_PATH_INCOMPLETE',
    'CURRENT_PATH_NOT_CANONICAL', 'ONTOLOGY_INCOMPLETE', 'ONTOLOGY_UNAVAILABLE',
    'ROOT_IDENTITY_UNAVAILABLE', 'NOT_ELIGIBLE', 'TECHNICAL_FAILURE']);
const OntologyShadowComparisonV1 = deepFreeze({ version: 1, ontologyVersion: 1,
    fields: ['version', 'ontologyVersion', 'requestId', 'relationId', 'root', 'current', 'ontology', 'comparison', 'timing'],
    statuses, maxCanonicalTargets: MAX_TARGETS, conversationIdRecorded: false });
function ids(values) {
    if (!Array.isArray(values) || values.length > MAX_TARGETS || values.some(v => !canonicalId(v))) return null;
    return [...new Set(values)].sort((a, b) => Number(a) - Number(b));
}
function safeRequestId(value) {
    if (typeof value !== 'string' || !value) return null;
    return /^[a-zA-Z0-9._-]{8,128}$/.test(value) ? value
        : createHash('sha256').update(value).digest('hex').slice(0, 24);
}
function compareShadow(current, resolved, { requestId, ontologyMs = 0 } = {}) {
    const relation = ontology.relations.find(r => r.relationId === current?.relationId);
    const root = current?.root;
    const validRoot = relation && root?.entityType === relation.fromType && canonicalId(root.canonicalId);
    const currentIds = ids(current?.canonicalTargetIds);
    const ontologyIds = ids(Array.isArray(resolved?.items) ? resolved.items.map(item => item?.canonicalId) : null);
    let status, classifications = [], missing = [], extra = [];
    if (!relation) status = 'NOT_ELIGIBLE';
    else if (!validRoot) status = 'ROOT_IDENTITY_UNAVAILABLE';
    else if (currentIds === null || current.canonical !== true) status = 'CURRENT_PATH_NOT_CANONICAL';
    else if (current.complete !== true) status = 'CURRENT_PATH_INCOMPLETE';
    else if (!resolved || resolved.status === 'TECHNICAL_FAILURE') status = 'TECHNICAL_FAILURE';
    else if (!resolved.success) status = ['REFERENCE_INCOMPLETE', 'AMBIGUOUS_LEGACY_REFERENCE'].includes(resolved.status)
        ? 'ONTOLOGY_INCOMPLETE' : 'ONTOLOGY_UNAVAILABLE';
    else if (resolved.root?.entityType !== root.entityType || resolved.root?.canonicalId !== root.canonicalId) {
        status = 'MISMATCH'; classifications = ['ROOT_IDENTITY_MISMATCH'];
    } else if (resolved.relationId !== relation.relationId || resolved.resultEntityType !== relation.toType
        || (Array.isArray(resolved.items) && resolved.items.some(item => item?.entityType !== relation.toType))) {
        status = 'MISMATCH'; classifications = ['RELATION_MAPPING_MISMATCH'];
    } else if (ontologyIds === null) status = 'ONTOLOGY_UNAVAILABLE';
    else if (resolved.hasMore === true) status = 'ONTOLOGY_INCOMPLETE';
    else if (resolved.complete !== true) {
        status = 'MISMATCH'; classifications = ['COMPLETENESS_MISMATCH'];
    } else {
        missing = currentIds.filter(id => !ontologyIds.includes(id));
        extra = ontologyIds.filter(id => !currentIds.includes(id));
        if (missing.length) classifications.push('TARGET_MISSING_IN_ONTOLOGY');
        if (extra.length) classifications.push('TARGET_EXTRA_IN_ONTOLOGY');
        status = classifications.length ? 'MISMATCH' : 'MATCH';
    }
    return deepFreeze({ version: 1, ontologyVersion: 1, requestId: safeRequestId(requestId),
        relationId: relation?.relationId ?? null, root: validRoot ? { entityType: root.entityType, canonicalId: root.canonicalId } : null,
        current: { sourceCapabilities: (Array.isArray(current?.sourceCapabilities) ? current.sourceCapabilities : []).filter(v => typeof v === 'string' && /^[a-z0-9_]{1,64}$/.test(v)).slice(0, 8),
            canonicalTargetIds: currentIds ?? [], completeness: current?.complete === true,
            canonical: current?.canonical === true && currentIds !== null },
        ontology: { canonicalTargetIds: ontologyIds ?? [], completeness: resolved?.success === true && resolved.complete === true && !resolved.hasMore,
            authority: relation?.authority ?? null,
            resolverStatus: ['RESOLVED', 'VERIFIED_EMPTY', 'REFERENCE_INCOMPLETE', 'AMBIGUOUS_LEGACY_REFERENCE',
                'RELATION_UNAVAILABLE', 'ROOT_NOT_FOUND', 'TECHNICAL_FAILURE', 'INVALID_REQUEST'].includes(resolved?.status) ? resolved.status : null,
            failureReason: ['SHADOW_TIMEOUT', 'SHADOW_WORKER_BUDGET', 'SHADOW_WORKER_FAILURE',
                'SHADOW_RESOLVER_FAILURE', 'SHADOW_DATABASE_UNAVAILABLE'].includes(resolved?.code) ? resolved.code : null,
            provenance: resolved?.provenance ? { sourceId: relation?.sourceId,
                sourceService: ['canonicalRelationQueries.readSource', 'relationReadService.read:CANONICAL_ONLY'].includes(resolved.provenance.sourceService)
                    ? resolved.provenance.sourceService : null,
                queryId: /^[a-f0-9-]{36}$/.test(resolved.provenance.queryId) ? resolved.provenance.queryId : null,
                asOf: /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(resolved.provenance.asOf) ? resolved.provenance.asOf : null, canonicalOnly: true } : null },
        comparison: { status, exactCanonicalMatch: status === 'MATCH', missingInOntology: missing,
            extraInOntology: extra, classifications },
        timing: { ontologyMs: Number.isFinite(ontologyMs) ? Math.max(0, ontologyMs) : 0 } });
}
module.exports = { OntologyShadowComparisonV1, ShadowContractVersion, ShadowFlag, MAX_TARGETS, statuses, compareShadow, ids };
