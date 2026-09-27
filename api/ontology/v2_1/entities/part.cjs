'use strict';

const { deepFreeze } = require('../../sources.cjs');
const {
    SourceAuthority,
    SourceKind,
    ProvenancePurpose,
    FactRefScope,
    PredicateKind,
} = require('../catalogs.cjs');

const sourceRef = (sourceId, path) => ({ sourceId, path, status: 'RESOLVED' });

const fact = (factId, label, dataType, sourceId, path, options = {}) => ({
    factId,
    label,
    dataType,
    unit: options.unit ?? null,
    sourceRef: sourceRef(sourceId, path),
    authority: SourceAuthority.CANONICAL_CURRENT,
    searchable: options.searchable === true,
    candidateSelectionEvidence: options.candidateSelectionEvidence === true,
    directIdentityEvidence: false,
    presentationGroup: options.presentationGroup || 'OTHER',
    temporalSemantics: options.temporalSemantics || 'MUTABLE_CURRENT_VALUE',
    missingSemantics: options.missingSemantics || 'UNKNOWN_NOT_FALSE',
    safeForDefaultSummary: options.safeForDefaultSummary === true,
    businessRoles: options.businessRoles || ['DESCRIPTIVE'],
});

const partSources = deepFreeze([
    {
        sourceId: 'part.current_resource',
        authority: SourceAuthority.CANONICAL_CURRENT,
        sourceKind: SourceKind.RAW_CURRENT_RESOURCE,
        provenancePurpose: ProvenancePurpose.CURRENT_RESOURCE,
        inputSourceIds: [],
        sourceOfTruth: 'SQLite:parts formal current resource; parts.deleted_at is authoritative lifecycle storage even though partRow does not currently project deletedAt.',
        readBoundary: 'EXISTING_PART_BUSINESS_API_FOR_PROJECTED_FIELDS; NO_ONTOLOGY_RUNTIME_READER_APPROVED_FOR_RAW_LIFECYCLE',
        storesValueInOntology: false,
    },
    {
        sourceId: 'part.dto_projection',
        authority: SourceAuthority.CANONICAL_CURRENT,
        sourceKind: SourceKind.FORMAL_PROJECTION,
        provenancePurpose: ProvenancePurpose.CURRENT_RESOURCE,
        inputSourceIds: ['part.current_resource'],
        sourceOfTruth: 'Existing partRow projects current model, classification, supplier, price, stock, and timestamps from parts for existing Business API consumers.',
        readBoundary: 'EXISTING_BUSINESS_API_ONLY; NO_ONTOLOGY_RUNTIME_READER_APPROVED',
        storesValueInOntology: false,
    },
    {
        sourceId: 'part.pump_shell_metadata_projection',
        authority: SourceAuthority.CANONICAL_CURRENT,
        sourceKind: SourceKind.FORMAL_PROJECTION,
        provenancePurpose: ProvenancePurpose.CURRENT_RESOURCE,
        inputSourceIds: ['part.current_resource'],
        sourceOfTruth: 'Current PumpShell metadata projection: parts.remark.isStainless is consumed through parsePumpShellMeta; no other remark key is promoted by this source.',
        readBoundary: 'EXISTING_PART_METADATA_PARSER_ONLY; NO_ONTOLOGY_RUNTIME_READER_APPROVED',
        storesValueInOntology: false,
    },
]);

const partProfile = deepFreeze({
    entityType: 'part',
    status: 'OWNER_REVIEWED_REFERENCE_PROFILE_CONTRACT_ONLY',
    identity: {
        canonicalId: {
            sourceRef: sourceRef('part.current_resource', 'parts.id -> partRow.id'),
            kind: 'DB_POSITIVE_INTEGER_PRIMARY_KEY',
            unique: true,
        },
        canonicalIdentityFactId: null,
        permitsDesignationAsCanonicalId: false,
        permitsNameOnlyCanonicalId: false,
    },
    facts: [
        fact('part.model', '型号', 'STRING', 'part.dto_projection', 'parts.model -> partRow.model', {
            searchable: true, candidateSelectionEvidence: true, presentationGroup: 'PRIMARY',
            businessRoles: ['DISPLAY', 'DESCRIPTIVE'],
        }),
        fact('part.category', '类别', 'STRING', 'part.dto_projection', 'parts.category -> partRow.category', {
            searchable: true, candidateSelectionEvidence: true, presentationGroup: 'PRIMARY',
            businessRoles: ['DESCRIPTIVE', 'POLICY_INPUT'],
        }),
        fact('part.subcategory', '子类别', 'STRING', 'part.dto_projection', 'parts.subcategory -> partRow.subcategory', {
            searchable: true, candidateSelectionEvidence: true, businessRoles: ['DESCRIPTIVE'],
        }),
        fact('part.supplier', '供应商', 'STRING', 'part.dto_projection', 'parts.supplier -> partRow.supplier', {
            searchable: true, candidateSelectionEvidence: true, businessRoles: ['CURRENT_BUSINESS', 'DESCRIPTIVE'],
        }),
        fact('part.price', '目录单价', 'NUMBER', 'part.dto_projection', 'parts.price -> partRow.price', {
            unit: 'CNY', presentationGroup: 'PRIMARY', businessRoles: ['CURRENT_BUSINESS'],
        }),
        fact('part.stock', '库存', 'INTEGER', 'part.dto_projection', 'parts.stock -> partRow.stock', {
            unit: 'unit', presentationGroup: 'PRIMARY', businessRoles: ['CURRENT_BUSINESS'],
        }),
        fact('part.deletedAt', '删除时间', 'DATETIME', 'part.current_resource', 'parts.deleted_at (not currently projected by partRow)', {
            businessRoles: ['LIFECYCLE'],
        }),
        fact('part.createdAt', '创建时间', 'DATETIME', 'part.dto_projection', 'parts.created_at -> partRow.createdAt', {
            temporalSemantics: 'STABLE_DESIGN_VALUE', businessRoles: ['PROVENANCE'],
        }),
        fact('part.updatedAt', '更新时间', 'DATETIME', 'part.dto_projection', 'parts.updated_at -> partRow.updatedAt', {
            businessRoles: ['PROVENANCE'],
        }),
    ],
    designations: [{
        designationId: 'part.modelDesignation',
        label: '零件型号',
        components: ['part.model'],
        expression: { operation: 'IDENTITY', nullPolicy: 'UNAVAILABLE_IF_ANY_COMPONENT_MISSING' },
        sourceRef: sourceRef('part.dto_projection', 'parts.model -> partRow.model'),
        searchable: true,
        unique: false,
        collisionPolicy: 'REPORT',
        directIdentityEvidence: false,
        canonicalIdentity: false,
    }],
    selectionPolicy: { policyType: 'NONE', runtimeEnabled: false },
    eligibilityPolicy: { policyType: 'NONE', runtimeEnabled: false },
    costingPolicy: null,
    relationBridge: null,
    relationIds: [],
    derivedFactIds: [],
    policyIds: [],
    technicalKnowledge: null,
});

const pumpShellExtensionId = 'part.pump_shell';

const pumpShellExtension = deepFreeze({
    extensionId: pumpShellExtensionId,
    baseEntityType: 'part',
    applicability: {
        kind: PredicateKind.FACT_EQUALS,
        factRef: { scope: FactRefScope.LOCAL, factId: 'part.category' },
        value: '泵壳',
    },
    facts: [
        fact('part.isStainless', '不锈钢筒', 'BOOLEAN', 'part.pump_shell_metadata_projection', 'parts.remark.isStainless -> parsePumpShellMeta(...).isStainless', {
            searchable: true,
            presentationGroup: 'TECHNICAL',
            businessRoles: ['FUNCTIONAL_TECHNICAL', 'POLICY_INPUT'],
        }),
    ],
    designations: [],
    relationIds: [],
    policyIds: [],
    technicalKnowledge: null,
    runtimeEnabled: false,
});

module.exports = { partSources, partProfile, pumpShellExtensionId, pumpShellExtension };
