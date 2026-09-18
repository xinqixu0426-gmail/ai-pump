'use strict';
const { EntitySources, RelationSources, RelationAuthority, RelationShapes } = require('./sources.cjs');

function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
}
function check(condition, code) { if (!condition) fail(code); }
function keys(value, expected) {
    check(value && typeof value === 'object' && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype
        && Object.keys(value).sort().join(',') === [...expected].sort().join(','), 'ONTOLOGY_FIELDS_INVALID');
}
function strings(value, fields) {
    fields.forEach(field => check(typeof value[field] === 'string' && value[field].trim().length > 0, 'ONTOLOGY_METADATA_INVALID'));
}

function validateOntology(contract) {
    keys(contract, ['version', 'runtimeEnabled', 'storesBusinessValues', 'isBusinessSourceOfTruth', 'access', 'identityContract', 'entities', 'relations', 'transitionalCandidates', 'relationReadMapping']);
    check(contract.version === 1, 'ONTOLOGY_VERSION_UNSUPPORTED');
    check(contract.runtimeEnabled === false && contract.storesBusinessValues === false
        && contract.isBusinessSourceOfTruth === false && contract.access === 'CONTRACT_ONLY_READ_ONLY', 'ONTOLOGY_READ_ONLY_REQUIRED');
    const identity = contract.identityContract;
    keys(identity, ['canonicalIdKind', 'canonicalIdAuthority', 'createsIdentity', 'permitsNameOnlyIdentity', 'permitsFuzzyIdentity', 'storesBusinessValues']);
    check(identity.canonicalIdKind === 'DB_POSITIVE_INTEGER_PRIMARY_KEY' && identity.canonicalIdAuthority === 'FORMAL_RESOURCE_RECEIPT'
        && ['createsIdentity', 'permitsNameOnlyIdentity', 'permitsFuzzyIdentity', 'storesBusinessValues'].every(k => identity[k] === false), 'ONTOLOGY_IDENTITY_INVALID');
    ['entities', 'relations', 'transitionalCandidates', 'relationReadMapping'].forEach(k => check(Array.isArray(contract[k]), 'ONTOLOGY_COLLECTION_INVALID'));
    const entities = new Map();
    for (const entity of contract.entities) {
        keys(entity, ['type', 'kind', 'canonicalIdKind', 'canonicalIdSource', 'displaySource', 'businessKeySource', 'sourceOfTruth', 'resolverSupport', 'stableIdentitySupport', 'authoritative']);
        check(!entities.has(entity.type), 'ONTOLOGY_ENTITY_DUPLICATE');
        check(Object.hasOwn(EntitySources, entity.type), 'ONTOLOGY_ENTITY_UNSUPPORTED');
        const source = EntitySources[entity.type];
        check(entity.kind === 'BUSINESS_ENTITY' && entity.authoritative === true
            && entity.canonicalIdKind === identity.canonicalIdKind && entity.canonicalIdSource === `${source.table}.id`
            && entity.sourceOfTruth === `SQLite:${source.table}` && entity.displaySource === source.display
            && entity.businessKeySource === source.businessKey, 'ONTOLOGY_ENTITY_SOURCE_INVALID');
        check(entity.resolverSupport === (entity.type === 'quotation' ? 'NOT_SUPPORTED' : 'EXISTING_V3_FORMAL_RESULT')
            && entity.stableIdentitySupport === (entity.type === 'quotation' ? 'FORMAL_DB_ID_ONLY' : 'EXISTING_V4_SPEC'), 'ONTOLOGY_ENTITY_SUPPORT_INVALID');
        entities.set(entity.type, entity);
    }
    check(entities.size === 7, 'ONTOLOGY_ENTITY_COUNT_INVALID');
    const relations = new Map();
    const relationFields = ['relationId', 'sourceId', 'fromType', 'toType', 'direction', 'inverseRelationId', 'cardinality', 'authority', 'sourceOfTruth', 'physicalSource', 'identityRequirement', 'currentVsSnapshotSemantics', 'freshnessSemantics', 'provenanceRequirement', 'completenessSemantics', 'readStrategy', 'runtimeEnabled'];
    for (const relation of contract.relations) {
        keys(relation, relationFields);
        strings(relation, relationFields.filter(k => k !== 'runtimeEnabled'));
        check(!relations.has(relation.relationId), 'ONTOLOGY_RELATION_DUPLICATE');
        check(entities.has(relation.fromType) && entities.has(relation.toType), 'ONTOLOGY_ENDPOINT_INVALID');
        check(relation.fromType !== relation.toType, 'ONTOLOGY_SELF_REFERENCE_INVALID');
        check([RelationAuthority.CANONICAL_DIRECT, RelationAuthority.DETERMINISTIC_DERIVED].includes(relation.authority), 'ONTOLOGY_AUTHORITY_INVALID');
        check(relation.runtimeEnabled === false, 'ONTOLOGY_READ_ONLY_REQUIRED');
        check(Object.hasOwn(RelationSources, relation.sourceId), 'ONTOLOGY_SOURCE_INVALID');
        const source = RelationSources[relation.sourceId], reverse = relation.direction === 'INVERSE';
        check(['FORWARD', 'INVERSE'].includes(relation.direction)
            && relation.fromType === (reverse ? source.toType : source.fromType)
            && relation.toType === (reverse ? source.fromType : source.toType)
            && relation.sourceOfTruth === source.sourceOfTruth && relation.physicalSource === source.physicalSource
            && relation.authority === source.authority && relation.readStrategy === source.readStrategy
            && relation.currentVsSnapshotSemantics === source.temporal
            && relation.completenessSemantics === source.completeness, 'ONTOLOGY_SOURCE_INVALID');
        check(new RegExp(`^${relation.fromType}\\.[a-z]+(?:_[a-z]+)+$`).test(relation.relationId)
            && relation.relationId.endsWith(`_${relation.toType}`), 'ONTOLOGY_RELATION_NAME_INVALID');
        check(['ONE', 'ZERO_OR_ONE', 'MANY'].includes(relation.cardinality), 'ONTOLOGY_CARDINALITY_INVALID');
        const shape = RelationShapes[relation.sourceId];
        check(relation.relationId === shape[reverse ? 1 : 0]
            && relation.cardinality === shape[reverse ? 3 : 2], 'ONTOLOGY_RELATION_SHAPE_INVALID');
        check(relation.identityRequirement === 'EXPLICIT_CANONICAL_IDS_BOTH_ENDPOINTS_NO_NAME_FALLBACK'
            && relation.freshnessSemantics === 'FUTURE_READ_MUST_SUPPLY_AS_OF_NO_CACHED_OR_HISTORY_FACTS'
            && relation.provenanceRequirement === 'FORMAL_READ_RECEIPT_WITH_SOURCE_AND_UNRESOLVED_REFERENCES', 'ONTOLOGY_IDENTITY_INVALID');
        relations.set(relation.relationId, relation);
    }
    check(relations.size === 12, 'ONTOLOGY_RELATION_COUNT_INVALID');
    for (const relation of relations.values()) {
        const inverse = relations.get(relation.inverseRelationId);
        check(inverse && inverse.inverseRelationId === relation.relationId && inverse.fromType === relation.toType
            && inverse.toType === relation.fromType && inverse.sourceId === relation.sourceId
            && inverse.direction !== relation.direction, 'ONTOLOGY_INVERSE_INVALID');
    }
    for (const sourceId of Object.keys(RelationSources)) {
        check([...relations.values()].filter(r => r.sourceId === sourceId).length === 2, 'ONTOLOGY_SOURCE_COVERAGE_INVALID');
    }
    for (const type of entities.keys()) {
        check([...relations.values()].some(r => r.fromType === type || r.toType === type), 'ONTOLOGY_ENTITY_UNUSED');
    }
    check(contract.transitionalCandidates.length === 2, 'ONTOLOGY_CANDIDATE_COUNT_INVALID');
    const candidateIds = new Set();
    for (const candidate of contract.transitionalCandidates) {
        keys(candidate, ['candidateId', 'authority', 'physicalSource', 'evidenceStatus', 'authoritative', 'runtimeEnabled']);
        strings(candidate, ['candidateId', 'physicalSource']);
        check(!candidateIds.has(candidate.candidateId) && !relations.has(candidate.candidateId), 'ONTOLOGY_CANDIDATE_DUPLICATE');
        check(candidate.authority === RelationAuthority.LEGACY_EXACT && candidate.authoritative === false
            && candidate.runtimeEnabled === false, 'ONTOLOGY_CANDIDATE_ISOLATION_INVALID');
        check(candidate.evidenceStatus === ({
            'legacy.model_variant_recipe_name': 'P0_CLAIM_NOT_REPRODUCED',
            'legacy.bom_part_model': 'CURRENT_CODE_VERIFIED',
        })[candidate.candidateId], 'ONTOLOGY_CANDIDATE_EVIDENCE_INVALID');
        candidateIds.add(candidate.candidateId);
    }
    const mapped = new Set();
    for (const mapping of contract.relationReadMapping) {
        keys(mapping, ['existingRelationId', 'ontologyRelationId', 'disposition', 'reason']);
        strings(mapping, ['existingRelationId', 'reason']);
        check(!mapped.has(mapping.existingRelationId), 'ONTOLOGY_MAPPING_DUPLICATE');
        check(mapping.disposition === 'EXCLUDED' ? mapping.ontologyRelationId === null
            : mapping.disposition === 'ADAPTER_REQUIRED' && relations.has(mapping.ontologyRelationId), 'ONTOLOGY_MAPPING_INVALID');
        mapped.add(mapping.existingRelationId);
    }
    check(mapped.size === 7, 'ONTOLOGY_MAPPING_COUNT_INVALID');
    return Object.freeze({ version: 1, entityCount: 7, relationFamilyCount: 6, directedRelationCount: 12, authorityAFamilies: 4, authorityBFamilies: 2, inversePairs: 6, runtimeEnabled: false });
}

module.exports = { validateOntology };
