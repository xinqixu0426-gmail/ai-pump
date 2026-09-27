'use strict';

const { deepFreeze } = require('../sources.cjs');
const { roleCatalog: roleCatalogV2 } = require('../v2/roles.cjs');
const { SourceAuthority, SourceKind } = require('../v2/sources.cjs');

const OntologyV21ContractRevision = '2.1';

// These catalogs describe V2.1 declaration vocabulary only. They are not runtime evaluators.
const ProvenancePurpose = deepFreeze({
    CURRENT_RESOURCE: 'CURRENT_RESOURCE',
    RELATION_PROJECTION: 'RELATION_PROJECTION',
    PRESET_INITIALIZATION: 'PRESET_INITIALIZATION',
    COMPATIBILITY_ADAPTER: 'COMPATIBILITY_ADAPTER',
    KNOWLEDGE_METADATA: 'KNOWLEDGE_METADATA',
});

const FactValueKind = deepFreeze({
    DIRECT: 'DIRECT',
    RELATION_PROJECTION: 'RELATION_PROJECTION',
    DERIVED: 'DERIVED',
});

const RelationDirection = deepFreeze({
    OUTBOUND: 'OUTBOUND',
    INBOUND: 'INBOUND',
});

const RelationCardinality = deepFreeze({
    ZERO_OR_ONE: 'ZERO_OR_ONE',
    EXACTLY_ONE: 'EXACTLY_ONE',
    ZERO_OR_MANY: 'ZERO_OR_MANY',
    ONE_OR_MANY: 'ONE_OR_MANY',
});

const FactRefScope = deepFreeze({
    LOCAL: 'LOCAL',
    RELATED: 'RELATED',
});

const PredicateKind = deepFreeze({
    FACT_EQUALS: 'FACT_EQUALS',
    FACT_EXISTS: 'FACT_EXISTS',
    RELATION_EXISTS: 'RELATION_EXISTS',
    ALL_OF: 'ALL_OF',
});

const DerivationOperation = deepFreeze({
    COPY: 'COPY',
    SUBTRACT: 'SUBTRACT',
    PROJECT_RELATED_FACT: 'PROJECT_RELATED_FACT',
});

const MaterializationPolicy = deepFreeze({
    COMPUTE_ON_READ: 'COMPUTE_ON_READ',
    MATERIALIZED_CACHE: 'MATERIALIZED_CACHE',
    NEVER_MATERIALIZE: 'NEVER_MATERIALIZE',
});

// V2 role objects are preserved verbatim; V2.1 only appends the approved generic roles.
const roleCatalogV21 = deepFreeze([
    ...roleCatalogV2,
    {
        roleId: 'FUNCTIONAL_TECHNICAL',
        label: '功能技术',
        description: '参与明确技术功能或正式技术配置的事实。',
    },
    {
        roleId: 'TECHNICAL_KNOWLEDGE',
        label: '技术资料',
        description: '可读、可检索但默认不具备业务功能权威的技术资料。',
    },
    {
        roleId: 'POLICY_INPUT',
        label: '策略输入',
        description: '经显式合同声明后可作为通用策略条件输入的事实。',
    },
]);

// This describes every generic entry, not a fixed inventory of business knowledge keys.
const technicalKnowledgeEntrySchema = deepFreeze({
    requiredFields: ['key', 'label', 'value'],
    optionalFields: ['unit', 'valueType', 'sourceRef', 'updatedAt', 'version', 'evidenceRelationIds'],
});

module.exports = {
    OntologyV21ContractRevision,
    SourceAuthority,
    SourceKind,
    ProvenancePurpose,
    FactValueKind,
    RelationDirection,
    RelationCardinality,
    FactRefScope,
    PredicateKind,
    DerivationOperation,
    MaterializationPolicy,
    roleCatalogV21,
    technicalKnowledgeEntrySchema,
};
