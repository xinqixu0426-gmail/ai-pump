'use strict';

const { deepFreeze } = require('../../sources.cjs');
const {
    SourceAuthority,
    SourceKind,
    ProvenancePurpose,
    FactValueKind,
    FactRefScope,
    PredicateKind,
    DerivationOperation,
    MaterializationPolicy,
    RelationDirection,
    RelationCardinality,
    technicalKnowledgeEntrySchema,
} = require('../catalogs.cjs');

const sourceRef = (sourceId, path) => ({ sourceId, path, status: 'RESOLVED' });
const stainlessFactRef = deepFreeze({
    scope: FactRefScope.RELATED,
    relationPath: ['recipe.uses_template', 'template.uses_shell_part'],
    factId: 'part.isStainless',
    targetExtensionId: 'part.pump_shell',
});
const stainlessPredicate = value => ({ kind: PredicateKind.FACT_EQUALS, factRef: stainlessFactRef, value });

const directFact = (factId, label, dataType, sourceId, path, options = {}) => ({
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
    ...(options.applicableWhen ? { applicableWhen: options.applicableWhen } : {}),
    ...(options.requiredWhen ? { requiredWhen: options.requiredWhen } : {}),
});

const recipeSources = deepFreeze([
    {
        sourceId: 'recipe.current_resource',
        authority: SourceAuthority.CANONICAL_CURRENT,
        sourceKind: SourceKind.RAW_CURRENT_RESOURCE,
        provenancePurpose: ProvenancePurpose.CURRENT_RESOURCE,
        inputSourceIds: [],
        sourceOfTruth: 'SQLite:recipes formal current resource. recipes.deleted_at is authoritative lifecycle storage even though recipeRow does not currently project deletedAt.',
        readBoundary: 'EXISTING_RECIPE_BUSINESS_API_FOR_PROJECTED_FIELDS; NO_ONTOLOGY_RUNTIME_READER_APPROVED_FOR_RAW_LIFECYCLE',
        storesValueInOntology: false,
    },
    {
        sourceId: 'recipe.dto_projection',
        authority: SourceAuthority.CANONICAL_CURRENT,
        sourceKind: SourceKind.FORMAL_PROJECTION,
        provenancePurpose: ProvenancePurpose.CURRENT_RESOURCE,
        inputSourceIds: ['recipe.current_resource'],
        sourceOfTruth: 'Existing recipeRow projects current Recipe name, spec, configured Coil snapshot, barrel length, dedicated impeller fields, and timestamps for existing Business API consumers.',
        readBoundary: 'EXISTING_BUSINESS_API_ONLY; NO_ONTOLOGY_RUNTIME_READER_APPROVED',
        storesValueInOntology: false,
    },
    {
        sourceId: 'recipe.technical_data_projection',
        authority: SourceAuthority.CANONICAL_CURRENT,
        sourceKind: SourceKind.FORMAL_PROJECTION,
        provenancePurpose: ProvenancePurpose.CURRENT_RESOURCE,
        inputSourceIds: ['recipe.current_resource'],
        sourceOfTruth: 'Explicit saved Recipe technical_data_json values only. This source excludes PumpShell defaults/openOffset, Template rotor_params_json, ModelVariant presets, and name heuristics.',
        readBoundary: 'EXISTING_RECIPE_TECHNICAL_DATA_CONSUMERS_ONLY; NO_ONTOLOGY_RUNTIME_READER_APPROVED',
        storesValueInOntology: false,
    },
    {
        sourceId: 'recipe.template_relation_projection',
        authority: SourceAuthority.CANONICAL_CURRENT,
        sourceKind: SourceKind.FORMAL_PROJECTION,
        provenancePurpose: ProvenancePurpose.RELATION_PROJECTION,
        inputSourceIds: ['recipe.current_resource', 'template.current_resource'],
        sourceOfTruth: 'SQLite:recipes.template_id -> pump_shell_templates.id; nullable FK is the formal Template binding when present.',
        readBoundary: 'EXISTING_RECIPE_QUERY_ONLY; NO_ONTOLOGY_RUNTIME_RELATION_RESOLVER_APPROVED',
        storesValueInOntology: false,
    },
    {
        sourceId: 'recipe.coil_relation_projection',
        authority: SourceAuthority.CANONICAL_CURRENT,
        sourceKind: SourceKind.FORMAL_PROJECTION,
        provenancePurpose: ProvenancePurpose.RELATION_PROJECTION,
        inputSourceIds: ['recipe.current_resource', 'coil.current_resource'],
        sourceOfTruth: 'SQLite:recipes.coil_id -> coils.id; nullable FK is the formal Coil binding when present.',
        readBoundary: 'EXISTING_RECIPE_QUERY_ONLY; NO_ONTOLOGY_RUNTIME_RELATION_RESOLVER_APPROVED',
        storesValueInOntology: false,
    },
    {
        sourceId: 'recipe.piece_count_derivation',
        authority: SourceAuthority.DERIVED,
        sourceKind: SourceKind.DECLARATIVE_DERIVATION,
        provenancePurpose: ProvenancePurpose.CURRENT_RESOURCE,
        inputSourceIds: ['recipe.dto_projection'],
        sourceOfTruth: 'Declarative projection of the persisted Recipe coil_sheets snapshot. technical_data_json.pieceCount is a duplicate materialization, not an input authority.',
        readBoundary: 'NO_ONTOLOGY_RUNTIME_DERIVATION_ENGINE_APPROVED',
        storesValueInOntology: false,
    },
    {
        sourceId: 'recipe.impeller_thickness_current_projection',
        authority: SourceAuthority.CANONICAL_CURRENT,
        sourceKind: SourceKind.FORMAL_PROJECTION,
        provenancePurpose: ProvenancePurpose.CURRENT_RESOURCE,
        inputSourceIds: ['recipe.technical_data_projection', 'recipe.dto_projection'],
        sourceOfTruth: 'Current Rotor draft precedence is explicit technical_data_json.impellerDepth first, then recipes.impeller_thickness only when the JSON patch is empty. The duplicate physical storage remains a migration gap.',
        readBoundary: 'EXISTING_ROTOR_DRAFT_COMPATIBILITY_READER_ONLY; NO_ONTOLOGY_RUNTIME_READER_APPROVED',
        storesValueInOntology: false,
    },
]);

const recipeProfile = deepFreeze({
    entityType: 'recipe',
    status: 'CURRENT_SAFE_FUNCTIONAL_PROFILE_CONTRACT_ONLY',
    identity: {
        canonicalId: {
            sourceRef: sourceRef('recipe.current_resource', 'recipes.id -> recipeRow.id'),
            kind: 'DB_POSITIVE_INTEGER_PRIMARY_KEY',
            unique: true,
        },
        canonicalIdentityFactId: null,
        permitsDesignationAsCanonicalId: false,
        permitsNameOnlyCanonicalId: false,
    },
    facts: [
        directFact('recipe.name', '配方名称', 'STRING', 'recipe.dto_projection', 'recipes.name -> recipeRow.name', {
            searchable: true, candidateSelectionEvidence: true, presentationGroup: 'PRIMARY', businessRoles: ['DISPLAY', 'DESCRIPTIVE'],
        }),
        directFact('recipe.spec', '规格', 'STRING', 'recipe.dto_projection', 'recipes.spec -> recipeRow.spec', {
            searchable: true, candidateSelectionEvidence: true, businessRoles: ['DESCRIPTIVE'],
        }),
        directFact('recipe.createdAt', '创建时间', 'DATETIME', 'recipe.dto_projection', 'recipes.created_at -> recipeRow.createdAt', {
            temporalSemantics: 'STABLE_DESIGN_VALUE', businessRoles: ['PROVENANCE'],
        }),
        directFact('recipe.updatedAt', '更新时间', 'DATETIME', 'recipe.dto_projection', 'recipes.updated_at -> recipeRow.updatedAt', {
            businessRoles: ['PROVENANCE'],
        }),
        directFact('recipe.deletedAt', '删除时间', 'DATETIME', 'recipe.current_resource', 'recipes.deleted_at (not currently projected by recipeRow)', {
            businessRoles: ['LIFECYCLE'],
        }),
        directFact('recipe.coilSheets', '配置线圈片数', 'INTEGER', 'recipe.dto_projection', 'recipes.coil_sheets -> recipeRow.coilSheets', {
            unit: 'sheet', presentationGroup: 'PRIMARY', businessRoles: ['BOM_INPUT', 'INTERNAL_CALCULATION'],
        }),
        directFact('recipe.barrelLength', '机筒长度', 'NUMBER', 'recipe.dto_projection', 'recipes.custom_barrel_length -> recipeRow.customBarrelLength', {
            unit: 'mm', presentationGroup: 'TECHNICAL', businessRoles: ['FUNCTIONAL_TECHNICAL', 'BOM_INPUT'],
            applicableWhen: stainlessPredicate(true), requiredWhen: stainlessPredicate(true),
        }),
        directFact('recipe.rotorDiameter', '转子直径', 'NUMBER', 'recipe.technical_data_projection', 'recipes.technical_data_json.rotorDiameter', {
            unit: 'mm', presentationGroup: 'TECHNICAL', businessRoles: ['FUNCTIONAL_TECHNICAL'],
        }),
        directFact('recipe.bearingSpan', '开档', 'NUMBER', 'recipe.technical_data_projection', 'recipes.technical_data_json.bearingSpan', {
            unit: 'mm', presentationGroup: 'TECHNICAL', businessRoles: ['FUNCTIONAL_TECHNICAL'],
            applicableWhen: stainlessPredicate(false), requiredWhen: stainlessPredicate(false),
        }),
        directFact('recipe.stackOffset', '定位', 'NUMBER', 'recipe.technical_data_projection', 'recipes.technical_data_json.stackOffset', {
            unit: 'mm', presentationGroup: 'TECHNICAL', businessRoles: ['FUNCTIONAL_TECHNICAL'],
        }),
        directFact('recipe.oilSealDiameter', '油封孔径', 'NUMBER', 'recipe.technical_data_projection', 'recipes.technical_data_json.oilSealDiameter', {
            unit: 'mm', presentationGroup: 'TECHNICAL', businessRoles: ['FUNCTIONAL_TECHNICAL'],
        }),
        directFact('recipe.impellerBoreDiameter', '叶轮孔径', 'NUMBER', 'recipe.technical_data_projection', 'recipes.technical_data_json.impellerBoreDiameter', {
            unit: 'mm', presentationGroup: 'TECHNICAL', businessRoles: ['FUNCTIONAL_TECHNICAL'],
        }),
        directFact('recipe.impellerSpan', '叶轮开档', 'NUMBER', 'recipe.technical_data_projection', 'recipes.technical_data_json.impellerSpan', {
            unit: 'mm', presentationGroup: 'TECHNICAL', businessRoles: ['FUNCTIONAL_TECHNICAL'],
        }),
        directFact('recipe.impellerThickness', '叶轮厚度', 'NUMBER', 'recipe.impeller_thickness_current_projection', 'technical_data_json.impellerDepth -> recipes.impeller_thickness fallback', {
            unit: 'mm', presentationGroup: 'TECHNICAL', businessRoles: ['FUNCTIONAL_TECHNICAL'],
        }),
        directFact('recipe.threadLength', '螺纹长度', 'NUMBER', 'recipe.technical_data_projection', 'recipes.technical_data_json.threadLength', {
            unit: 'mm', presentationGroup: 'TECHNICAL', businessRoles: ['FUNCTIONAL_TECHNICAL'],
        }),
        directFact('recipe.threadDiameter', '螺纹直径', 'NUMBER', 'recipe.technical_data_projection', 'recipes.technical_data_json.threadDiameter', {
            unit: 'mm', presentationGroup: 'TECHNICAL', businessRoles: ['FUNCTIONAL_TECHNICAL'],
        }),
        {
            factId: 'recipe.pieceCount',
            label: '转子片数',
            dataType: 'INTEGER',
            unit: 'sheet',
            sourceRef: sourceRef('recipe.piece_count_derivation', 'COPY(recipe.coilSheets)'),
            authority: SourceAuthority.DERIVED,
            searchable: false,
            candidateSelectionEvidence: false,
            directIdentityEvidence: false,
            presentationGroup: 'TECHNICAL',
            temporalSemantics: 'DYNAMIC_DERIVED_CURRENT_VALUE',
            missingSemantics: 'UNKNOWN_NOT_FALSE',
            safeForDefaultSummary: false,
            businessRoles: ['FUNCTIONAL_TECHNICAL', 'DERIVED_TECHNICAL'],
            valueKind: FactValueKind.DERIVED,
            derivation: {
                operation: DerivationOperation.COPY,
                inputs: [{ scope: FactRefScope.LOCAL, factId: 'recipe.coilSheets' }],
                sourceRef: sourceRef('recipe.piece_count_derivation', 'COPY(recipe.coilSheets)'),
                missingInputPolicy: 'UNRESOLVED',
                materialization: MaterializationPolicy.COMPUTE_ON_READ,
            },
        },
    ],
    designations: [{
        designationId: 'recipe.nameDesignation',
        label: '配方名称',
        components: ['recipe.name'],
        expression: { operation: 'IDENTITY', nullPolicy: 'UNAVAILABLE_IF_ANY_COMPONENT_MISSING' },
        sourceRef: sourceRef('recipe.dto_projection', 'recipes.name -> recipeRow.name'),
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
    relationIds: ['recipe.uses_template', 'recipe.uses_coil'],
    derivedFactIds: ['recipe.pieceCount'],
    policyIds: [],
    technicalKnowledge: { collectionId: 'recipe.technical_knowledge' },
});

const recipeRelations = deepFreeze([
    {
        relationId: 'recipe.uses_template',
        sourceEntityType: 'recipe',
        target: { entityType: 'template', canonicalEndpointRequired: true },
        direction: RelationDirection.OUTBOUND,
        cardinality: RelationCardinality.ZERO_OR_ONE,
        sourceRef: sourceRef('recipe.template_relation_projection', 'recipes.template_id -> pump_shell_templates.id'),
        runtimeEnabled: false,
    },
    {
        relationId: 'recipe.uses_coil',
        sourceEntityType: 'recipe',
        target: { entityType: 'coil', canonicalEndpointRequired: true },
        direction: RelationDirection.OUTBOUND,
        cardinality: RelationCardinality.ZERO_OR_ONE,
        sourceRef: sourceRef('recipe.coil_relation_projection', 'recipes.coil_id -> coils.id'),
        runtimeEnabled: false,
    },
]);

const recipeTechnicalKnowledgeType = deepFreeze({
    collectionId: 'recipe.technical_knowledge',
    ownerEntityType: 'recipe',
    entrySchema: technicalKnowledgeEntrySchema,
    allowsArbitraryKeys: true,
    searchable: true,
    aiReadable: true,
    defaultClassification: 'TECHNICAL_KNOWLEDGE',
    runtimeEnabled: false,
});

const recipeTargetSemanticGaps = deepFreeze([
    'RECIPE_OPEN_OFFSET_STORAGE_MISSING',
    'STAINLESS_BEARING_SPAN_DERIVATION_BLOCKED_BY_OPEN_OFFSET_STORAGE',
    'RECIPE_UPPER_BEARING_PART_ID_STORAGE_MISSING',
    'RECIPE_LOWER_BEARING_PART_ID_STORAGE_MISSING',
    'IMPELLER_THICKNESS_DUPLICATE_STORAGE',
]);

module.exports = {
    recipeSources,
    recipeProfile,
    recipeRelations,
    recipeTechnicalKnowledgeType,
    recipeTargetSemanticGaps,
    stainlessFactRef,
};
