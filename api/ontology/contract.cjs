'use strict';
const { deepFreeze, RelationAuthority, EntitySources, RelationSources, RelationShapes } = require('./sources.cjs');

const OntologyVersion = 1;
const IdentityContract = deepFreeze({
    canonicalIdKind: 'DB_POSITIVE_INTEGER_PRIMARY_KEY',
    canonicalIdAuthority: 'FORMAL_RESOURCE_RECEIPT',
    createsIdentity: false,
    permitsNameOnlyIdentity: false,
    permitsFuzzyIdentity: false,
    storesBusinessValues: false,
});

const entities = Object.entries(EntitySources).map(([type, source]) => ({
    type, kind: 'BUSINESS_ENTITY', canonicalIdKind: IdentityContract.canonicalIdKind,
    canonicalIdSource: `${source.table}.id`, displaySource: source.display,
    businessKeySource: source.businessKey, sourceOfTruth: `SQLite:${source.table}`,
    resolverSupport: type === 'quotation' ? 'NOT_SUPPORTED' : 'EXISTING_V3_FORMAL_RESULT',
    stableIdentitySupport: type === 'quotation' ? 'FORMAL_DB_ID_ONLY' : 'EXISTING_V4_SPEC',
    authoritative: true,
}));

// Six evidence-backed relationship families, each with two explicit directions.
const relations = Object.entries(RelationSources).flatMap(([sourceId, source]) => {
    const [forward, inverse, forwardCardinality, inverseCardinality] = RelationShapes[sourceId];
    return [false, true].map(reversed => ({
        relationId: reversed ? inverse : forward, sourceId,
        fromType: reversed ? source.toType : source.fromType,
        toType: reversed ? source.fromType : source.toType,
        direction: reversed ? 'INVERSE' : 'FORWARD',
        inverseRelationId: reversed ? forward : inverse,
        cardinality: reversed ? inverseCardinality : forwardCardinality,
        authority: source.authority, sourceOfTruth: source.sourceOfTruth,
        physicalSource: source.physicalSource,
        identityRequirement: 'EXPLICIT_CANONICAL_IDS_BOTH_ENDPOINTS_NO_NAME_FALLBACK',
        currentVsSnapshotSemantics: source.temporal,
        freshnessSemantics: 'FUTURE_READ_MUST_SUPPLY_AS_OF_NO_CACHED_OR_HISTORY_FACTS',
        provenanceRequirement: 'FORMAL_READ_RECEIPT_WITH_SOURCE_AND_UNRESOLVED_REFERENCES',
        completenessSemantics: source.completeness,
        readStrategy: source.readStrategy,
        runtimeEnabled: false,
    }));
});

const transitionalCandidates = [
    { candidateId: 'legacy.model_variant_recipe_name', authority: RelationAuthority.LEGACY_EXACT,
        physicalSource: 'P0 claim: pump_model_variants.model_name / recipes.name',
        evidenceStatus: 'P0_CLAIM_NOT_REPRODUCED', authoritative: false, runtimeEnabled: false },
    { candidateId: 'legacy.bom_part_model', authority: RelationAuthority.LEGACY_EXACT,
        physicalSource: 'recipes.parts_json[].model + supplier / parts.model + supplier',
        evidenceStatus: 'CURRENT_CODE_VERIFIED', authoritative: false, runtimeEnabled: false },
];

// Descriptions only. No service imports, execution, adapters, or traversal here.
const relationReadMapping = [
    { existingRelationId: 'customer.orders', ontologyRelationId: 'customer.has_order', disposition: 'ADAPTER_REQUIRED', reason: 'Reader includes unique legacy customer-name fallback; restrict to explicit customer_id and report unresolved rows.' },
    { existingRelationId: 'order.customer', ontologyRelationId: 'order.belongs_to_customer', disposition: 'ADAPTER_REQUIRED', reason: 'Reader includes unique legacy customer-name fallback; disallow fallback.' },
    { existingRelationId: 'recipe.parts', ontologyRelationId: 'recipe.contains_part', disposition: 'ADAPTER_REQUIRED', reason: 'Reader accepts ID-less model/supplier and requires model equality even with ID; canonical-only adapter must separate stale display text and identity.' },
    { existingRelationId: 'part.recipes', ontologyRelationId: 'part.contained_in_recipe', disposition: 'ADAPTER_REQUIRED', reason: 'Reader includes legacy model references; canonical-only adapter must report unresolved membership and preserve bounds.' },
    { existingRelationId: 'order.lines', ontologyRelationId: null, disposition: 'EXCLUDED', reason: 'Order line ordinal is snapshot-local, not canonical recipe identity; cannot relabel as order.contains_recipe.' },
    { existingRelationId: 'parts.stock', ontologyRelationId: null, disposition: 'EXCLUDED', reason: 'Filtered collection with stock fact, not entity-to-entity relation.' },
    { existingRelationId: 'part.facts', ontologyRelationId: null, disposition: 'EXCLUDED', reason: 'Current stock/price facts, not another entity or a self-edge.' },
];

const ontology = deepFreeze({
    version: OntologyVersion, runtimeEnabled: false, storesBusinessValues: false,
    isBusinessSourceOfTruth: false, access: 'CONTRACT_ONLY_READ_ONLY',
    identityContract: IdentityContract, entities, relations, transitionalCandidates, relationReadMapping,
});

module.exports = { OntologyVersion, IdentityContract, ontology };
