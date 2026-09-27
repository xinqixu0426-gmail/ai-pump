'use strict';

const { SourceAuthority } = require('./sources.cjs');

const SOURCE_AUTHORITIES = new Set(Object.values(SourceAuthority));
const DATA_TYPES = new Set(['STRING', 'INTEGER', 'NUMBER', 'BOOLEAN', 'DATETIME']);
const PRESENTATION_GROUPS = new Set(['PRIMARY', 'TECHNICAL', 'OTHER']);
const TEMPORAL_SEMANTICS = new Set([
    'STABLE_DESIGN_VALUE',
    'MUTABLE_CURRENT_VALUE',
    'DYNAMIC_DERIVED_CURRENT_VALUE',
    'SAVED_SNAPSHOT_VALUE',
    'TEMPORARY_VALUE',
]);

function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
}

function check(condition, code) {
    if (!condition) fail(code);
}

function plainObject(value) {
    return Boolean(value)
        && typeof value === 'object'
        && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, expected, code = 'ONTOLOGY_V2_FIELDS_INVALID') {
    check(plainObject(value), code);
    check(
        Object.keys(value).sort().join(',') === [...expected].sort().join(','),
        code
    );
}

function nonEmptyString(value, code = 'ONTOLOGY_V2_METADATA_INVALID') {
    check(typeof value === 'string' && value.trim().length > 0, code);
}

function boolean(value, code = 'ONTOLOGY_V2_METADATA_INVALID') {
    check(typeof value === 'boolean', code);
}

function validateSourceRef(sourceRef, sourceMap) {
    exactKeys(sourceRef, ['sourceId', 'path', 'status'], 'ONTOLOGY_V2_SOURCE_REF_INVALID');
    nonEmptyString(sourceRef.sourceId, 'ONTOLOGY_V2_SOURCE_REF_INVALID');
    nonEmptyString(sourceRef.path, 'ONTOLOGY_V2_SOURCE_REF_INVALID');
    check(['RESOLVED', 'UNRESOLVED'].includes(sourceRef.status), 'ONTOLOGY_V2_SOURCE_REF_INVALID');
    const source = sourceMap.get(sourceRef.sourceId);
    check(source, 'ONTOLOGY_V2_SOURCE_UNKNOWN');
    check(
        (sourceRef.status === 'UNRESOLVED') === (source.authority === SourceAuthority.UNRESOLVED),
        'ONTOLOGY_V2_SOURCE_STATUS_INVALID'
    );
    return source;
}

function validateFact(item, entityType, factIds, sourceMap) {
    exactKeys(item, [
        'factId', 'label', 'dataType', 'unit', 'sourceRef', 'authority',
        'searchable', 'candidateSelectionEvidence', 'directIdentityEvidence',
        'presentationGroup', 'temporalSemantics', 'missingSemantics',
        'safeForDefaultSummary', 'businessRoles',
    ], 'ONTOLOGY_V2_FACT_FIELDS_INVALID');
    nonEmptyString(item.factId, 'ONTOLOGY_V2_FACT_ID_INVALID');
    check(
        new RegExp(`^${entityType}\\.[a-z][A-Za-z0-9]*$`).test(item.factId),
        'ONTOLOGY_V2_FACT_ID_INVALID'
    );
    check(!factIds.has(item.factId), 'ONTOLOGY_V2_FACT_DUPLICATE');
    nonEmptyString(item.label, 'ONTOLOGY_V2_FACT_METADATA_INVALID');
    check(DATA_TYPES.has(item.dataType), 'ONTOLOGY_V2_FACT_METADATA_INVALID');
    check(item.unit === null || (typeof item.unit === 'string' && item.unit.length > 0), 'ONTOLOGY_V2_FACT_METADATA_INVALID');
    const source = validateSourceRef(item.sourceRef, sourceMap);
    check(SOURCE_AUTHORITIES.has(item.authority) && item.authority === source.authority, 'ONTOLOGY_V2_FACT_AUTHORITY_INVALID');
    ['searchable', 'candidateSelectionEvidence', 'directIdentityEvidence', 'safeForDefaultSummary']
        .forEach(field => boolean(item[field], 'ONTOLOGY_V2_FACT_METADATA_INVALID'));
    check(PRESENTATION_GROUPS.has(item.presentationGroup), 'ONTOLOGY_V2_FACT_METADATA_INVALID');
    check(TEMPORAL_SEMANTICS.has(item.temporalSemantics), 'ONTOLOGY_V2_FACT_METADATA_INVALID');
    nonEmptyString(item.missingSemantics, 'ONTOLOGY_V2_FACT_METADATA_INVALID');
    check(Array.isArray(item.businessRoles) && item.businessRoles.length > 0, 'ONTOLOGY_V2_FACT_ROLE_INVALID');
    check(new Set(item.businessRoles).size === item.businessRoles.length, 'ONTOLOGY_V2_FACT_ROLE_INVALID');
    item.businessRoles.forEach(role => {
        nonEmptyString(role, 'ONTOLOGY_V2_FACT_ROLE_INVALID');
        check(/^[A-Z][A-Z0-9_]*$/.test(role), 'ONTOLOGY_V2_FACT_ROLE_INVALID');
    });
    check(
        item.sourceRef.status !== 'UNRESOLVED' || item.safeForDefaultSummary === false,
        'ONTOLOGY_V2_UNRESOLVED_FACT_UNSAFE'
    );
    factIds.add(item.factId);
}

function validateProfile(profile, sourceMap, entityTypes) {
    exactKeys(profile, [
        'entityType', 'status', 'identity', 'facts', 'designations',
        'selectionPolicy', 'eligibilityPolicy', 'costingPolicy', 'relationBridge',
    ], 'ONTOLOGY_V2_PROFILE_FIELDS_INVALID');
    nonEmptyString(profile.entityType, 'ONTOLOGY_V2_ENTITY_TYPE_INVALID');
    check(/^[a-z][a-z0-9_]*$/.test(profile.entityType), 'ONTOLOGY_V2_ENTITY_TYPE_INVALID');
    check(!entityTypes.has(profile.entityType), 'ONTOLOGY_V2_PROFILE_DUPLICATE');
    nonEmptyString(profile.status);

    exactKeys(profile.identity, [
        'canonicalId', 'canonicalIdentityFactId', 'permitsDesignationAsCanonicalId',
        'permitsNameOnlyCanonicalId',
    ], 'ONTOLOGY_V2_IDENTITY_INVALID');
    exactKeys(profile.identity.canonicalId, ['sourceRef', 'kind', 'unique'], 'ONTOLOGY_V2_IDENTITY_INVALID');
    validateSourceRef(profile.identity.canonicalId.sourceRef, sourceMap);
    nonEmptyString(profile.identity.canonicalId.kind, 'ONTOLOGY_V2_IDENTITY_INVALID');
    check(profile.identity.canonicalId.unique === true, 'ONTOLOGY_V2_IDENTITY_INVALID');
    check(profile.identity.canonicalIdentityFactId === null, 'ONTOLOGY_V2_IDENTITY_INVALID');
    check(
        profile.identity.permitsDesignationAsCanonicalId === false
        && profile.identity.permitsNameOnlyCanonicalId === false,
        'ONTOLOGY_V2_IDENTITY_INVALID'
    );

    check(Array.isArray(profile.facts), 'ONTOLOGY_V2_FACT_COLLECTION_INVALID');
    const factIds = new Set();
    profile.facts.forEach(item => validateFact(item, profile.entityType, factIds, sourceMap));

    check(Array.isArray(profile.designations), 'ONTOLOGY_V2_DESIGNATION_INVALID');
    const designationIds = new Set();
    for (const designation of profile.designations) {
        exactKeys(designation, [
            'designationId', 'label', 'components', 'expression', 'sourceRef',
            'searchable', 'unique', 'collisionPolicy', 'directIdentityEvidence',
            'canonicalIdentity',
        ], 'ONTOLOGY_V2_DESIGNATION_INVALID');
        nonEmptyString(designation.designationId, 'ONTOLOGY_V2_DESIGNATION_INVALID');
        check(!designationIds.has(designation.designationId), 'ONTOLOGY_V2_DESIGNATION_DUPLICATE');
        nonEmptyString(designation.label, 'ONTOLOGY_V2_DESIGNATION_INVALID');
        check(Array.isArray(designation.components) && designation.components.length > 0, 'ONTOLOGY_V2_DESIGNATION_INVALID');
        check(designation.components.every(component => factIds.has(component)), 'ONTOLOGY_V2_DESIGNATION_COMPONENT_INVALID');
        check(plainObject(designation.expression), 'ONTOLOGY_V2_DESIGNATION_INVALID');
        if (designation.expression.operation === 'JOIN') {
            exactKeys(designation.expression, ['operation', 'separator', 'nullPolicy'], 'ONTOLOGY_V2_DESIGNATION_INVALID');
            nonEmptyString(designation.expression.separator, 'ONTOLOGY_V2_DESIGNATION_INVALID');
        } else if (designation.expression.operation === 'IDENTITY') {
            exactKeys(designation.expression, ['operation', 'nullPolicy'], 'ONTOLOGY_V2_DESIGNATION_INVALID');
            check(designation.components.length === 1, 'ONTOLOGY_V2_DESIGNATION_INVALID');
        } else {
            fail('ONTOLOGY_V2_DESIGNATION_INVALID');
        }
        nonEmptyString(designation.expression.nullPolicy, 'ONTOLOGY_V2_DESIGNATION_INVALID');
        validateSourceRef(designation.sourceRef, sourceMap);
        ['searchable', 'unique', 'directIdentityEvidence', 'canonicalIdentity']
            .forEach(field => boolean(designation[field], 'ONTOLOGY_V2_DESIGNATION_INVALID'));
        check(['ALLOWED', 'REJECT', 'REPORT'].includes(designation.collisionPolicy), 'ONTOLOGY_V2_DESIGNATION_IDENTITY_INVALID');
        check(!(designation.unique && designation.collisionPolicy === 'ALLOWED'), 'ONTOLOGY_V2_DESIGNATION_IDENTITY_INVALID');
        check(!(designation.canonicalIdentity && (!designation.unique || !designation.directIdentityEvidence)), 'ONTOLOGY_V2_DESIGNATION_IDENTITY_INVALID');
        designationIds.add(designation.designationId);
    }

    const policy = profile.selectionPolicy;
    check(plainObject(policy), 'ONTOLOGY_V2_SELECTION_POLICY_INVALID');
    if (policy.policyType === 'NONE') {
        exactKeys(policy, ['policyType', 'runtimeEnabled'], 'ONTOLOGY_V2_SELECTION_POLICY_INVALID');
    } else if (policy.policyType === 'EXPLICIT_ONLY') {
        exactKeys(policy, ['policyType', 'explicitConditionFactIds', 'runtimeEnabled'], 'ONTOLOGY_V2_SELECTION_POLICY_INVALID');
        check(Array.isArray(policy.explicitConditionFactIds) && policy.explicitConditionFactIds.every(id => factIds.has(id)), 'ONTOLOGY_V2_SELECTION_FACT_INVALID');
        check(new Set(policy.explicitConditionFactIds).size === policy.explicitConditionFactIds.length, 'ONTOLOGY_V2_SELECTION_FACT_INVALID');
    } else if (policy.policyType === 'EXPLICIT_THEN_DEFAULT') {
        exactKeys(policy, ['policyType', 'explicitConditionFactIds', 'defaultMetadata', 'orderedStages', 'outcomes', 'defaultMayOverrideExplicitConditions', 'runtimeEnabled'], 'ONTOLOGY_V2_SELECTION_POLICY_INVALID');
        check(Array.isArray(policy.explicitConditionFactIds) && policy.explicitConditionFactIds.every(id => factIds.has(id)), 'ONTOLOGY_V2_SELECTION_FACT_INVALID');
        check(new Set(policy.explicitConditionFactIds).size === policy.explicitConditionFactIds.length, 'ONTOLOGY_V2_SELECTION_FACT_INVALID');
        exactKeys(policy.defaultMetadata, ['sourceRef', 'classification', 'identityEvidence'], 'ONTOLOGY_V2_SELECTION_POLICY_INVALID');
        validateSourceRef(policy.defaultMetadata.sourceRef, sourceMap);
        nonEmptyString(policy.defaultMetadata.classification, 'ONTOLOGY_V2_SELECTION_POLICY_INVALID');
        boolean(policy.defaultMetadata.identityEvidence, 'ONTOLOGY_V2_SELECTION_POLICY_INVALID');
        check(Array.isArray(policy.orderedStages) && policy.orderedStages.length > 0 && new Set(policy.orderedStages).size === policy.orderedStages.length, 'ONTOLOGY_V2_SELECTION_POLICY_INVALID');
        policy.orderedStages.forEach(stage => nonEmptyString(stage, 'ONTOLOGY_V2_SELECTION_POLICY_INVALID'));
        check(plainObject(policy.outcomes) && Object.keys(policy.outcomes).length > 0, 'ONTOLOGY_V2_SELECTION_POLICY_INVALID');
        Object.entries(policy.outcomes).forEach(([key, value]) => { nonEmptyString(key, 'ONTOLOGY_V2_SELECTION_POLICY_INVALID'); nonEmptyString(value, 'ONTOLOGY_V2_SELECTION_POLICY_INVALID'); });
        boolean(policy.defaultMayOverrideExplicitConditions, 'ONTOLOGY_V2_SELECTION_POLICY_INVALID');
    } else {
        fail('ONTOLOGY_V2_SELECTION_POLICY_TYPE_INVALID');
    }
    check(policy.runtimeEnabled === false, 'ONTOLOGY_V2_SELECTION_RUNTIME_INVALID');

    const eligibility = profile.eligibilityPolicy;
    check(plainObject(eligibility), 'ONTOLOGY_V2_ELIGIBILITY_POLICY_INVALID');
    if (eligibility.policyType === 'NONE') {
        exactKeys(eligibility, ['policyType', 'runtimeEnabled'], 'ONTOLOGY_V2_ELIGIBILITY_POLICY_INVALID');
    } else if (eligibility.policyType === 'LIFECYCLE_STATUS') {
        exactKeys(eligibility, ['policyType', 'factId', 'ordinaryEligibleValues', 'explicitOptInValues', 'historicalOnlyValues', 'runtimeEnabled'], 'ONTOLOGY_V2_ELIGIBILITY_POLICY_INVALID');
        check(factIds.has(eligibility.factId), 'ONTOLOGY_V2_ELIGIBILITY_POLICY_INVALID');
        ['ordinaryEligibleValues', 'explicitOptInValues', 'historicalOnlyValues'].forEach(field => {
            check(Array.isArray(eligibility[field]), 'ONTOLOGY_V2_ELIGIBILITY_POLICY_INVALID');
            eligibility[field].forEach(value => nonEmptyString(value, 'ONTOLOGY_V2_ELIGIBILITY_POLICY_INVALID'));
        });
    } else {
        fail('ONTOLOGY_V2_ELIGIBILITY_POLICY_TYPE_INVALID');
    }
    check(eligibility.runtimeEnabled === false, 'ONTOLOGY_V2_ELIGIBILITY_POLICY_INVALID');

    const costing = profile.costingPolicy;
    if (costing !== null) {
        exactKeys(costing, ['policyType', 'sourceRef', 'values', 'runtimeEnabled'], 'ONTOLOGY_V2_COSTING_POLICY_INVALID');
        nonEmptyString(costing.policyType, 'ONTOLOGY_V2_COSTING_POLICY_INVALID');
        validateSourceRef(costing.sourceRef, sourceMap);
        check(Array.isArray(costing.values) && costing.values.length > 0, 'ONTOLOGY_V2_COSTING_POLICY_INVALID');
        costing.values.forEach(value => { exactKeys(value, ['value', 'semantics'], 'ONTOLOGY_V2_COSTING_POLICY_INVALID'); nonEmptyString(value.value, 'ONTOLOGY_V2_COSTING_POLICY_INVALID'); nonEmptyString(value.semantics, 'ONTOLOGY_V2_COSTING_POLICY_INVALID'); });
        check(costing.runtimeEnabled === false, 'ONTOLOGY_V2_COSTING_POLICY_INVALID');
    }

    if (profile.relationBridge !== null) {
    exactKeys(profile.relationBridge, [
        'ontologyVersion', 'relationIds', 'implementation', 'promotesRelationToIdentityEvidence',
    ], 'ONTOLOGY_V2_RELATION_BRIDGE_INVALID');
    check(
        profile.relationBridge.ontologyVersion === 1
        && Array.isArray(profile.relationBridge.relationIds)
        && profile.relationBridge.relationIds.length > 0
        && profile.relationBridge.relationIds.every(id => typeof id === 'string' && id.length > 0)
        && profile.relationBridge.implementation === 'REFERENCE_EXISTING_V1_ONLY'
        && profile.relationBridge.promotesRelationToIdentityEvidence === false,
        'ONTOLOGY_V2_RELATION_BRIDGE_INVALID'
    );
    }
    entityTypes.add(profile.entityType);
    return { factCount: factIds.size, designationCount: designationIds.size };
}

function validateOntologyV2(contract) {
    exactKeys(contract, [
        'version', 'status', 'runtimeEnabled', 'storesBusinessValues',
        'isBusinessSourceOfTruth', 'access', 'sources', 'profiles',
    ]);
    check(contract.version === 2, 'ONTOLOGY_V2_VERSION_UNSUPPORTED');
    nonEmptyString(contract.status);
    check(
        contract.runtimeEnabled === false
        && contract.storesBusinessValues === false
        && contract.isBusinessSourceOfTruth === false
        && contract.access === 'CONTRACT_ONLY_NO_RUNTIME',
        'ONTOLOGY_V2_RUNTIME_ISOLATION_REQUIRED'
    );
    check(Array.isArray(contract.sources), 'ONTOLOGY_V2_SOURCE_COLLECTION_INVALID');
    const sourceMap = new Map();
    for (const source of contract.sources) {
        exactKeys(source, [
            'sourceId', 'authority', 'sourceOfTruth', 'readBoundary', 'storesValueInOntology',
        ], 'ONTOLOGY_V2_SOURCE_INVALID');
        nonEmptyString(source.sourceId, 'ONTOLOGY_V2_SOURCE_INVALID');
        check(!sourceMap.has(source.sourceId), 'ONTOLOGY_V2_SOURCE_DUPLICATE');
        check(SOURCE_AUTHORITIES.has(source.authority), 'ONTOLOGY_V2_SOURCE_INVALID');
        nonEmptyString(source.sourceOfTruth, 'ONTOLOGY_V2_SOURCE_INVALID');
        nonEmptyString(source.readBoundary, 'ONTOLOGY_V2_SOURCE_INVALID');
        check(source.storesValueInOntology === false, 'ONTOLOGY_V2_SOURCE_STORES_VALUE');
        sourceMap.set(source.sourceId, source);
    }
    check(Array.isArray(contract.profiles), 'ONTOLOGY_V2_PROFILE_COLLECTION_INVALID');
    const entityTypes = new Set();
    let factCount = 0;
    let designationCount = 0;
    for (const profile of contract.profiles) {
        const result = validateProfile(profile, sourceMap, entityTypes);
        factCount += result.factCount;
        designationCount += result.designationCount;
    }
    return Object.freeze({
        version: 2,
        sourceCount: sourceMap.size,
        profileCount: entityTypes.size,
        factCount,
        designationCount,
        runtimeEnabled: false,
    });
}

module.exports = { validateOntologyV2 };
