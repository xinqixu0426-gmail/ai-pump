'use strict';
const { randomUUID } = require('node:crypto');
const { ontology } = require('./contract.cjs');
const { validateOntology } = require('./validator.cjs');
const R = require('./resolverContract.cjs');
const C = require('../services/relationReadContract.cjs');
const { createRelationReadService } = require('../services/relationReadService.cjs');
const { createCanonicalRelationQueries } = require('../services/canonicalRelationQueries.cjs');

validateOntology(ontology);
const relations = new Map(ontology.relations.map(r => [r.relationId, r]));
// The existing-reader mapping is read from the ontology, never re-listed here.
const legacyMappings = new Map(ontology.relationReadMapping.filter(m => m.disposition === 'ADAPTER_REQUIRED')
    .map(m => [m.ontologyRelationId, m.existingRelationId]));

function failure(error, q) {
    const statuses = {
        RELATION_REFERENCE_INCOMPLETE: 'REFERENCE_INCOMPLETE',
        RELATION_AMBIGUOUS: 'AMBIGUOUS_LEGACY_REFERENCE',
        RELATION_NOT_FOUND: 'RELATION_UNAVAILABLE',
        RELATION_SOURCE_UNAVAILABLE: 'RELATION_UNAVAILABLE',
        RELATION_SOURCE_INVALID: 'RELATION_UNAVAILABLE',
        RELATION_REFERENCE_CONFLICT: 'REFERENCE_INCOMPLETE',
        RELATION_SCAN_BOUND: 'RELATION_UNAVAILABLE', RELATION_NESTED_BOUND: 'RELATION_UNAVAILABLE',
        RELATION_PAYLOAD_BOUND: 'RELATION_UNAVAILABLE', RELATION_VALUE_INVALID: 'RELATION_UNAVAILABLE',
    };
    const status = error.resolveStatus ?? statuses[error.code] ?? 'TECHNICAL_FAILURE';
    const code = (error.resolveStatus || statuses[error.code]) ? error.code : 'RELATION_TECHNICAL_FAILURE';
    return Object.freeze({ version: 1, ontologyVersion: 1, success: false, status,
        code,
        ...(q ? { relationId: q.relationId, root: q.root } : {}),
        complete: false, items: Object.freeze([]), hasMore: false, warnings: Object.freeze([]) });
}

function createOntologyRelationResolver({ db }) {
    const business = createCanonicalRelationQueries({ db });
    const existing = createRelationReadService({ db, canonicalOnly: true });
    function resolveRelation(input) {
        let q;
        try {
            q = R.validateResolveRequest(input);
            const relation = relations.get(q.relationId);
            return db.transaction(() => {
                const root = business.getEntity(q.root.entityType, Number(q.root.canonicalId));
                if (!root) R.reject('RELATION_ROOT_NOT_FOUND', 'ROOT_NOT_FOUND');
                const mapped = legacyMappings.get(relation.relationId);
                let page, hasMore, total, queryId, asOf, sourceService;
                if (mapped) {
                    const native = existing.read({ version: 1, relation: mapped, rootId: root.id,
                        pageSize: q.pageSize, ...(q.afterId === undefined ? {} : { afterId: Number(q.afterId) }) });
                    page = native.items.map(item => ({ id: Number(item.canonicalId), name: item.display.name }));
                    hasMore = native.hasMore;
                    total = native.totalCount;
                    queryId = native.queryId; asOf = native.asOf;
                    sourceService = 'relationReadService.read:CANONICAL_ONLY';
                } else {
                    const read = business.readSource(relation, root, q);
                    total = read.total;
                    ({ items: page, hasMore } = C.resultPage(read.rows, q.pageSize));
                    queryId = randomUUID(); asOf = new Date().toISOString();
                    sourceService = 'canonicalRelationQueries.readSource';
                }
                const items = page.map(row => ({ entityType: relation.toType, canonicalId: String(row.id), display: { name: C.text(row.name) } }));
                const result = { version: 1, ontologyVersion: 1, success: true,
                    status: total === 0 ? 'VERIFIED_EMPTY' : 'RESOLVED', relationId: relation.relationId,
                    root: q.root, resultEntityType: relation.toType, items, authority: relation.authority,
                    sourceOfTruth: relation.sourceOfTruth, asOf, complete: true, hasMore,
                    pageSize: q.pageSize, returnedCount: items.length, totalCount: total,
                    pageBoundary: { afterId: q.afterId ?? null, nextAfterId: hasMore ? items.at(-1).canonicalId : null },
                    warnings: [], provenance: { relationId: relation.relationId, authority: relation.authority,
                        sourceId: relation.sourceId, physicalSource: relation.physicalSource, sourceService,
                        currentVsSnapshotSemantics: relation.currentVsSnapshotSemantics,
                        canonicalOnly: true, queryId, asOf, root: q.root } };
                return R.validateResolveResult(q, result);
            })();
        } catch (error) { return failure(error, q); }
    }
    return Object.freeze({ resolveRelation });
}

module.exports = { createOntologyRelationResolver };
