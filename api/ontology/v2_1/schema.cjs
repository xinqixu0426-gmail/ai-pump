'use strict';

const { deepFreeze } = require('../sources.cjs');
const { FactRefScope, FactValueKind } = require('./catalogs.cjs');

// O4-A deliberately only freezes declarative structures. O4-B owns semantic validation.
function defineV21Source(definition) {
    return deepFreeze({ storesValueInOntology: false, ...definition, storesValueInOntology: false });
}

function defineV21Fact(definition) {
    return deepFreeze({ valueKind: FactValueKind.DIRECT, ...definition });
}

function defineV21Relation(definition) {
    return deepFreeze({ runtimeEnabled: false, ...definition, runtimeEnabled: false });
}

function defineV21Predicate(definition) {
    return deepFreeze({ ...definition });
}

function defineV21Derivation(definition) {
    return deepFreeze({ ...definition });
}

function defineV21Policy(definition) {
    return deepFreeze({ runtimeEnabled: false, ...definition, runtimeEnabled: false });
}

function defineV21TechnicalKnowledgeCollection(definition) {
    return deepFreeze({
        runtimeEnabled: false,
        defaultClassification: 'TECHNICAL_KNOWLEDGE',
        ...definition,
        runtimeEnabled: false,
    });
}

// Extensions intentionally have no identity field. Canonical identity remains with the base profile.
function defineV21ExtensionProfile(definition) {
    const { identity: _identity, ...extension } = definition;
    return deepFreeze({ runtimeEnabled: false, ...extension, runtimeEnabled: false });
}

function defineV21BaseProfile(definition) {
    return deepFreeze({
        relationIds: [],
        derivedFactIds: [],
        policyIds: [],
        technicalKnowledge: null,
        ...definition,
    });
}

const emptyV21Capabilities = deepFreeze({
    relationIds: [],
    derivedFactIds: [],
    policyIds: [],
    technicalKnowledge: null,
});

const FactRefExamples = deepFreeze({
    LOCAL: { scope: FactRefScope.LOCAL, factId: 'entity.exampleFact' },
    RELATED: { scope: FactRefScope.RELATED, relationPath: ['entity.uses_related'], factId: 'related.exampleFact' },
});

// Field inventories are contract documentation for later generic validation, not validators.
const V21Schema = deepFreeze({
    contract: ['version', 'contractRevision', 'sources', 'roleCatalog', 'profiles', 'extensions', 'relations', 'policies', 'technicalKnowledgeTypes'],
    source: ['sourceId', 'authority', 'sourceKind', 'provenancePurpose', 'inputSourceIds', 'sourceOfTruth', 'readBoundary', 'storesValueInOntology'],
    baseProfileOptional: ['relationIds', 'derivedFactIds', 'policyIds', 'technicalKnowledge'],
    extensionProfile: ['extensionId', 'baseEntityType', 'applicability', 'facts', 'designations', 'relationIds', 'policyIds', 'technicalKnowledge', 'sourceRefs', 'runtimeEnabled'],
    relation: ['relationId', 'sourceEntityType', 'target', 'direction', 'cardinality', 'sourceRef', 'applicableWhen', 'semanticRoles', 'runtimeEnabled'],
    factOptional: ['valueKind', 'relationProjection', 'derivation', 'applicableWhen', 'requiredWhen', 'prohibitedWhen'],
    relationProjection: ['relationId', 'targetFactRef', 'displayProjection'],
    factRef: ['scope', 'factId', 'relationPath'],
    derivation: ['operation', 'inputs', 'sourceRef', 'missingInputPolicy', 'materialization', 'cacheMetadata'],
    materializedCacheMetadata: ['inputRefs', 'sourceRefs', 'freshness', 'contractVersion', 'calculationVersion', 'invalidation'],
    policy: ['policyId', 'ownerEntityType', 'applicableWhen', 'factRefs', 'relationIds', 'rules', 'runtimeEnabled'],
    technicalKnowledgeCollection: ['collectionId', 'ownerEntityType', 'entrySchema', 'allowsArbitraryKeys', 'searchable', 'aiReadable', 'defaultClassification', 'runtimeEnabled'],
});

module.exports = {
    defineV21Source,
    defineV21Fact,
    defineV21Relation,
    defineV21Predicate,
    defineV21Derivation,
    defineV21Policy,
    defineV21TechnicalKnowledgeCollection,
    defineV21ExtensionProfile,
    defineV21BaseProfile,
    emptyV21Capabilities,
    FactRefExamples,
    V21Schema,
};
