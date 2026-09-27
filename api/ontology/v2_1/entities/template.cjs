'use strict';

const { deepFreeze } = require('../../sources.cjs');
const {
    SourceAuthority,
    SourceKind,
    ProvenancePurpose,
    RelationDirection,
    RelationCardinality,
} = require('../catalogs.cjs');

const sourceRef = (sourceId, path) => ({ sourceId, path, status: 'RESOLVED' });

const templateSources = deepFreeze([
    {
        sourceId: 'template.current_resource',
        authority: SourceAuthority.CANONICAL_CURRENT,
        sourceKind: SourceKind.RAW_CURRENT_RESOURCE,
        provenancePurpose: ProvenancePurpose.CURRENT_RESOURCE,
        inputSourceIds: [],
        sourceOfTruth: 'SQLite:pump_shell_templates formal current resource, including its canonical template ID and shell_model designation.',
        readBoundary: 'EXISTING_TEMPLATE_BUSINESS_API_ONLY; NO_ONTOLOGY_RUNTIME_READER_APPROVED',
        storesValueInOntology: false,
    },
    {
        sourceId: 'template.shell_part_binding',
        authority: SourceAuthority.CANONICAL_CURRENT,
        sourceKind: SourceKind.FORMAL_PROJECTION,
        provenancePurpose: ProvenancePurpose.RELATION_PROJECTION,
        inputSourceIds: ['template.current_resource', 'part.current_resource'],
        sourceOfTruth: 'SQLite:catalog_template_shell_bindings.template_id -> shell_part_id; template_id is UNIQUE, so a formal binding exists for at most one canonical Part endpoint.',
        readBoundary: 'EXISTING_TEMPLATE_BINDING_QUERY_ONLY; NO_ONTOLOGY_RUNTIME_RELATION_RESOLVER_APPROVED',
        storesValueInOntology: false,
    },
]);

const templateSupportingProfile = deepFreeze({
    entityType: 'template',
    status: 'MINIMAL_SHELL_BINDING_SUPPORT_PROFILE_CONTRACT_ONLY',
    identity: {
        canonicalId: {
            sourceRef: sourceRef('template.current_resource', 'pump_shell_templates.id -> templateRow.id'),
            kind: 'DB_POSITIVE_INTEGER_PRIMARY_KEY',
            unique: true,
        },
        canonicalIdentityFactId: null,
        permitsDesignationAsCanonicalId: false,
        permitsNameOnlyCanonicalId: false,
    },
    facts: [{
        factId: 'template.shellModel',
        label: '壳型',
        dataType: 'STRING',
        unit: null,
        sourceRef: sourceRef('template.current_resource', 'pump_shell_templates.shell_model -> templateRow.shellModel'),
        authority: SourceAuthority.CANONICAL_CURRENT,
        searchable: true,
        candidateSelectionEvidence: true,
        directIdentityEvidence: true,
        presentationGroup: 'PRIMARY',
        temporalSemantics: 'MUTABLE_CURRENT_VALUE',
        missingSemantics: 'UNKNOWN_NOT_FALSE',
        safeForDefaultSummary: false,
        businessRoles: ['DIRECT_LOOKUP', 'DISPLAY'],
    }],
    designations: [{
        designationId: 'template.shellModelDesignation',
        label: '模板壳型',
        components: ['template.shellModel'],
        expression: { operation: 'IDENTITY', nullPolicy: 'UNAVAILABLE_IF_ANY_COMPONENT_MISSING' },
        sourceRef: sourceRef('template.current_resource', 'pump_shell_templates.shell_model -> templateRow.shellModel'),
        searchable: true,
        unique: true,
        collisionPolicy: 'REJECT',
        directIdentityEvidence: true,
        canonicalIdentity: false,
    }],
    selectionPolicy: { policyType: 'NONE', runtimeEnabled: false },
    eligibilityPolicy: { policyType: 'NONE', runtimeEnabled: false },
    costingPolicy: null,
    relationBridge: null,
    relationIds: ['template.uses_shell_part'],
    derivedFactIds: [],
    policyIds: [],
    technicalKnowledge: null,
});

const templateUsesShellPartRelation = deepFreeze({
    relationId: 'template.uses_shell_part',
    sourceEntityType: 'template',
    target: { entityType: 'part', canonicalEndpointRequired: true },
    direction: RelationDirection.OUTBOUND,
    cardinality: RelationCardinality.ZERO_OR_ONE,
    sourceRef: sourceRef('template.shell_part_binding', 'catalog_template_shell_bindings.template_id -> catalog_template_shell_bindings.shell_part_id'),
    runtimeEnabled: false,
});

module.exports = { templateSources, templateSupportingProfile, templateUsesShellPartRelation };
