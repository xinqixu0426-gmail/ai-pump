'use strict';

const { validateOntologyV2 } = require('../v2/validator.cjs');
const {
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
} = require('./catalogs.cjs');

const V2_FACT_KEYS = [
    'factId', 'label', 'dataType', 'unit', 'sourceRef', 'authority',
    'searchable', 'candidateSelectionEvidence', 'directIdentityEvidence',
    'presentationGroup', 'temporalSemantics', 'missingSemantics',
    'safeForDefaultSummary', 'businessRoles',
];
const FACT_OPTIONAL_KEYS = ['valueKind', 'relationProjection', 'derivation', 'applicableWhen', 'requiredWhen', 'prohibitedWhen'];
const SOURCE_AUTHORITIES = new Set(Object.values(SourceAuthority));
const SOURCE_KINDS = new Set(Object.values(SourceKind));
const ROLE_ID_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const ENTITY_TYPE_PATTERN = /^[a-z][a-z0-9_]*$/;
const FUNCTIONAL_KNOWLEDGE_FIELDS = new Set([
    'canonicalIdentity', 'directIdentityEvidence', 'candidateSelectionEvidence', 'businessRoles',
    'policyInput', 'requiredWhen', 'relationId', 'relationBinding', 'costInput', 'bomInput',
    'writeCapability', 'derivation',
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

function nonEmptyString(value, code) {
    check(typeof value === 'string' && value.trim().length > 0, code);
}

function exactKeys(value, expected, code) {
    check(plainObject(value), code);
    check(Object.keys(value).sort().join(',') === [...expected].sort().join(','), code);
}

function exactKeysWithOptional(value, required, optional, code) {
    check(plainObject(value), code);
    const keys = Object.keys(value);
    required.forEach(key => check(keys.includes(key), code));
    check(keys.every(key => required.includes(key) || optional.includes(key)), code);
}

function checkJsonData(value, seen = new Set()) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
    if (typeof value === 'function' || typeof value === 'undefined' || typeof value === 'symbol' || typeof value === 'bigint') {
        fail('ONTOLOGY_V21_EXECUTABLE_DECLARATION_FORBIDDEN');
    }
    if (value instanceof RegExp || !(Array.isArray(value) || plainObject(value))) {
        fail('ONTOLOGY_V21_EXECUTABLE_DECLARATION_FORBIDDEN');
    }
    if (seen.has(value)) fail('ONTOLOGY_V21_EXECUTABLE_DECLARATION_FORBIDDEN');
    seen.add(value);
    Object.values(value).forEach(item => checkJsonData(item, seen));
    seen.delete(value);
}

function stripFactV21(fact) {
    return Object.fromEntries(V2_FACT_KEYS.map(key => [key, fact[key]]));
}

function projectToV2(contract) {
    return {
        version: contract.version,
        status: contract.status,
        runtimeEnabled: contract.runtimeEnabled,
        storesBusinessValues: contract.storesBusinessValues,
        isBusinessSourceOfTruth: contract.isBusinessSourceOfTruth,
        access: contract.access,
        sources: contract.sources.map(({ provenancePurpose: _purpose, ...source }) => source),
        roleCatalog: contract.roleCatalog,
        profiles: contract.profiles.map(profile => {
            const {
                relationIds: _relationIds,
                derivedFactIds: _derivedFactIds,
                policyIds: _policyIds,
                technicalKnowledge: _technicalKnowledge,
                ...v2Profile
            } = profile;
            return { ...v2Profile, facts: profile.facts.map(stripFactV21) };
        }),
    };
}

function validateSourceRef(sourceRef, sourceMap, code = 'ONTOLOGY_V21_SOURCE_REF_INVALID') {
    exactKeys(sourceRef, ['sourceId', 'path', 'status'], code);
    nonEmptyString(sourceRef.sourceId, code);
    nonEmptyString(sourceRef.path, code);
    check(['RESOLVED', 'UNRESOLVED'].includes(sourceRef.status), code);
    const source = sourceMap.get(sourceRef.sourceId);
    check(source, 'ONTOLOGY_V21_SOURCE_UNKNOWN');
    check((sourceRef.status === 'UNRESOLVED') === (source.authority === SourceAuthority.UNRESOLVED), 'ONTOLOGY_V21_SOURCE_STATUS_INVALID');
    return source;
}

function validateRoleIds(roles, roleIds, code) {
    check(Array.isArray(roles), code);
    check(new Set(roles).size === roles.length, code);
    roles.forEach(role => {
        nonEmptyString(role, code);
        check(roleIds.has(role), 'ONTOLOGY_V21_ROLE_UNKNOWN');
    });
}

function unitsCompatible(left, right) {
    return left === right;
}

function numericDataType(dataType) {
    return dataType === 'INTEGER' || dataType === 'NUMBER';
}

function literalMatchesFact(value, fact) {
    if (fact.dataType === 'STRING' || fact.dataType === 'DATETIME') return typeof value === 'string';
    if (fact.dataType === 'BOOLEAN') return typeof value === 'boolean';
    if (fact.dataType === 'INTEGER') return Number.isInteger(value);
    if (fact.dataType === 'NUMBER') return typeof value === 'number' && Number.isFinite(value);
    return false;
}

function validateSourcePurpose(source) {
    check(Object.values(ProvenancePurpose).includes(source.provenancePurpose), 'ONTOLOGY_V21_PROVENANCE_PURPOSE_INVALID');
    if (source.provenancePurpose === ProvenancePurpose.COMPATIBILITY_ADAPTER) {
        check(source.authority !== SourceAuthority.CANONICAL_CURRENT, 'ONTOLOGY_V21_COMPATIBILITY_PRECEDENCE_INVALID');
    }
    if (source.provenancePurpose === ProvenancePurpose.PRESET_INITIALIZATION) {
        check(source.authority !== SourceAuthority.CANONICAL_CURRENT, 'ONTOLOGY_V21_PRESET_AUTHORITY_INVALID');
    }
    if (source.provenancePurpose === ProvenancePurpose.RELATION_PROJECTION) {
        check(source.sourceKind === SourceKind.FORMAL_PROJECTION, 'ONTOLOGY_V21_PROVENANCE_PURPOSE_INVALID');
    }
}

function validateContractRoot(contract) {
    exactKeys(contract, [
        'version', 'contractRevision', 'status', 'runtimeEnabled', 'storesBusinessValues',
        'isBusinessSourceOfTruth', 'access', 'sources', 'roleCatalog', 'profiles', 'extensions',
        'relations', 'policies', 'technicalKnowledgeTypes',
    ], 'ONTOLOGY_V21_CONTRACT_FIELDS_INVALID');
    check(contract.version === 2 && contract.contractRevision === OntologyV21ContractRevision, 'ONTOLOGY_V21_VERSION_UNSUPPORTED');
    check(
        contract.runtimeEnabled === false
        && contract.storesBusinessValues === false
        && contract.isBusinessSourceOfTruth === false
        && contract.access === 'CONTRACT_ONLY_NO_RUNTIME',
        'ONTOLOGY_V21_RUNTIME_ISOLATION_REQUIRED'
    );
    ['sources', 'roleCatalog', 'profiles', 'extensions', 'relations', 'policies', 'technicalKnowledgeTypes']
        .forEach(field => check(Array.isArray(contract[field]), 'ONTOLOGY_V21_CONTRACT_FIELDS_INVALID'));
}

function validateRoleCatalog(roleCatalog) {
    const roleIds = new Set();
    roleCatalog.forEach(role => {
        exactKeys(role, ['roleId', 'label', 'description'], 'ONTOLOGY_V21_ROLE_CATALOG_INVALID');
        nonEmptyString(role.roleId, 'ONTOLOGY_V21_ROLE_CATALOG_INVALID');
        check(ROLE_ID_PATTERN.test(role.roleId) && !roleIds.has(role.roleId), 'ONTOLOGY_V21_ROLE_CATALOG_INVALID');
        nonEmptyString(role.label, 'ONTOLOGY_V21_ROLE_CATALOG_INVALID');
        nonEmptyString(role.description, 'ONTOLOGY_V21_ROLE_CATALOG_INVALID');
        roleIds.add(role.roleId);
    });
    ['FUNCTIONAL_TECHNICAL', 'TECHNICAL_KNOWLEDGE', 'POLICY_INPUT'].forEach(role => {
        check(roleIds.has(role), 'ONTOLOGY_V21_ROLE_CATALOG_INVALID');
    });
    return roleIds;
}

function validateSources(sources) {
    const sourceMap = new Map();
    sources.forEach(source => {
        exactKeys(source, [
            'sourceId', 'authority', 'sourceKind', 'provenancePurpose', 'inputSourceIds',
            'sourceOfTruth', 'readBoundary', 'storesValueInOntology',
        ], 'ONTOLOGY_V21_SOURCE_INVALID');
        nonEmptyString(source.sourceId, 'ONTOLOGY_V21_SOURCE_INVALID');
        check(!sourceMap.has(source.sourceId), 'ONTOLOGY_V21_SOURCE_DUPLICATE');
        check(SOURCE_AUTHORITIES.has(source.authority) && SOURCE_KINDS.has(source.sourceKind), 'ONTOLOGY_V21_SOURCE_INVALID');
        check(Array.isArray(source.inputSourceIds) && new Set(source.inputSourceIds).size === source.inputSourceIds.length, 'ONTOLOGY_V21_SOURCE_INVALID');
        source.inputSourceIds.forEach(id => nonEmptyString(id, 'ONTOLOGY_V21_SOURCE_INVALID'));
        nonEmptyString(source.sourceOfTruth, 'ONTOLOGY_V21_SOURCE_INVALID');
        nonEmptyString(source.readBoundary, 'ONTOLOGY_V21_SOURCE_INVALID');
        check(source.storesValueInOntology === false, 'ONTOLOGY_V21_SOURCE_STORES_VALUE');
        validateSourcePurpose(source);
        sourceMap.set(source.sourceId, source);
    });
    sources.forEach(source => source.inputSourceIds.forEach(id => check(sourceMap.has(id), 'ONTOLOGY_V21_SOURCE_INPUT_INVALID')));
    const states = new Map();
    const visit = sourceId => {
        if (states.get(sourceId) === 'VISITING') fail('ONTOLOGY_V2_SOURCE_CYCLE');
        if (states.get(sourceId) === 'VISITED') return;
        states.set(sourceId, 'VISITING');
        sourceMap.get(sourceId).inputSourceIds.forEach(visit);
        states.set(sourceId, 'VISITED');
    };
    sourceMap.forEach((_, sourceId) => visit(sourceId));
    return sourceMap;
}

function validateProfileShape(profile) {
    exactKeys(profile, [
        'entityType', 'status', 'identity', 'facts', 'designations', 'selectionPolicy',
        'eligibilityPolicy', 'costingPolicy', 'relationBridge', 'relationIds', 'derivedFactIds',
        'policyIds', 'technicalKnowledge',
    ], 'ONTOLOGY_V21_PROFILE_FIELDS_INVALID');
    nonEmptyString(profile.entityType, 'ONTOLOGY_V21_PROFILE_FIELDS_INVALID');
    check(ENTITY_TYPE_PATTERN.test(profile.entityType), 'ONTOLOGY_V21_PROFILE_FIELDS_INVALID');
    ['relationIds', 'derivedFactIds', 'policyIds'].forEach(field => {
        check(Array.isArray(profile[field]) && new Set(profile[field]).size === profile[field].length, 'ONTOLOGY_V21_PROFILE_FIELDS_INVALID');
        profile[field].forEach(id => nonEmptyString(id, 'ONTOLOGY_V21_PROFILE_FIELDS_INVALID'));
    });
}

function validateFactShape(fact) {
    exactKeysWithOptional(fact, V2_FACT_KEYS, FACT_OPTIONAL_KEYS, 'ONTOLOGY_V21_FACT_FIELDS_INVALID');
    const valueKind = fact.valueKind || FactValueKind.DIRECT;
    check(Object.values(FactValueKind).includes(valueKind), 'ONTOLOGY_V21_FACT_VALUE_KIND_INVALID');
    if (valueKind === FactValueKind.DIRECT) {
        check(!('relationProjection' in fact) && !('derivation' in fact), 'ONTOLOGY_V21_FACT_VALUE_KIND_INVALID');
    } else if (valueKind === FactValueKind.RELATION_PROJECTION) {
        check('relationProjection' in fact && !('derivation' in fact), 'ONTOLOGY_V21_FACT_VALUE_KIND_INVALID');
    } else {
        check('derivation' in fact && !('relationProjection' in fact), 'ONTOLOGY_V21_FACT_VALUE_KIND_INVALID');
        check(fact.authority === SourceAuthority.DERIVED, 'ONTOLOGY_V21_DERIVED_AUTHORITY_INVALID');
        check(fact.directIdentityEvidence === false && fact.candidateSelectionEvidence === false, 'ONTOLOGY_V21_DERIVED_AUTHORITY_INVALID');
    }
}

function validateFactSourceSafety(fact, sourceMap) {
    const source = validateSourceRef(fact.sourceRef, sourceMap);
    const unsafeCompatibilityUse = fact.directIdentityEvidence
        || fact.candidateSelectionEvidence
        || fact.safeForDefaultSummary
        || fact.businessRoles.includes('POLICY_INPUT');
    if (source.provenancePurpose === ProvenancePurpose.COMPATIBILITY_ADAPTER) {
        check(!unsafeCompatibilityUse, 'ONTOLOGY_V21_COMPATIBILITY_PRECEDENCE_INVALID');
    }
    if (source.provenancePurpose === ProvenancePurpose.PRESET_INITIALIZATION) {
        check(
            !fact.directIdentityEvidence
            && !fact.candidateSelectionEvidence
            && !fact.businessRoles.includes('POLICY_INPUT'),
            'ONTOLOGY_V21_PRESET_AUTHORITY_INVALID'
        );
    }
    if (source.provenancePurpose === ProvenancePurpose.KNOWLEDGE_METADATA) {
        check(
            !unsafeCompatibilityUse
            && !fact.businessRoles.some(role => ['FUNCTIONAL_TECHNICAL', 'POLICY_INPUT', 'COST_INPUT', 'BOM_INPUT', 'CURRENT_BUSINESS'].includes(role)),
            'ONTOLOGY_V21_KNOWLEDGE_FUNCTIONAL_AUTHORITY_FORBIDDEN'
        );
    }
    if (source.authority === SourceAuthority.UNRESOLVED) {
        check(!unsafeCompatibilityUse && !('requiredWhen' in fact), 'ONTOLOGY_V21_UNRESOLVED_UNSAFE');
    }
    return source;
}

function assertCanonicalIdentitySource(profile, sourceMap) {
    const source = validateSourceRef(profile.identity.canonicalId.sourceRef, sourceMap);
    check(
        source.authority === SourceAuthority.CANONICAL_CURRENT
        && source.provenancePurpose === ProvenancePurpose.CURRENT_RESOURCE,
        'ONTOLOGY_V21_CANONICAL_IDENTITY_SOURCE_INVALID'
    );
}

function createSemanticModel(profiles, extensions) {
    const entities = new Map();
    profiles.forEach(profile => {
        check(!entities.has(profile.entityType), 'ONTOLOGY_V21_PROFILE_DUPLICATE');
        const baseFacts = new Map();
        profile.facts.forEach(fact => {
            check(!baseFacts.has(fact.factId), 'ONTOLOGY_V21_FACT_DUPLICATE');
            baseFacts.set(fact.factId, fact);
        });
        entities.set(profile.entityType, {
            profile,
            baseFacts,
            factOwners: new Map([...baseFacts.keys()].map(factId => [factId, null])),
            designationIds: new Set(profile.designations.map(item => item.designationId)),
            relationOwners: new Map(profile.relationIds.map(relationId => [relationId, null])),
            policyOwners: new Map(profile.policyIds.map(policyId => [policyId, null])),
            extensions: new Map(),
        });
    });
    const extensionIds = new Set();
    const declarations = new Map();
    extensions.forEach(extension => {
        check(!Object.prototype.hasOwnProperty.call(extension, 'identity'), 'ONTOLOGY_V21_EXTENSION_IDENTITY_FORBIDDEN');
        exactKeysWithOptional(extension, [
            'extensionId', 'baseEntityType', 'applicability', 'facts', 'designations',
            'relationIds', 'policyIds', 'technicalKnowledge', 'runtimeEnabled',
        ], ['sourceRefs'], 'ONTOLOGY_V21_EXTENSION_FIELDS_INVALID');
        nonEmptyString(extension.extensionId, 'ONTOLOGY_V21_EXTENSION_FIELDS_INVALID');
        check(!extensionIds.has(extension.extensionId), 'ONTOLOGY_V21_EXTENSION_DUPLICATE');
        extensionIds.add(extension.extensionId);
        nonEmptyString(extension.baseEntityType, 'ONTOLOGY_V21_EXTENSION_BASE_INVALID');
        const entity = entities.get(extension.baseEntityType);
        check(entity, 'ONTOLOGY_V21_EXTENSION_BASE_INVALID');
        check(extension.runtimeEnabled === false, 'ONTOLOGY_V21_RUNTIME_ISOLATION_REQUIRED');
        check(Array.isArray(extension.facts) && Array.isArray(extension.designations), 'ONTOLOGY_V21_EXTENSION_FIELDS_INVALID');
        ['relationIds', 'policyIds'].forEach(field => {
            check(Array.isArray(extension[field]) && new Set(extension[field]).size === extension[field].length, 'ONTOLOGY_V21_EXTENSION_FIELDS_INVALID');
        });
        check(new Set(extension.facts.map(fact => fact.factId)).size === extension.facts.length, 'ONTOLOGY_V21_FACT_DUPLICATE');
        extension.relationIds.forEach(relationId => {
            check(!entity.relationOwners.has(relationId), 'ONTOLOGY_V21_COMPOSITION_COLLISION');
            entity.relationOwners.set(relationId, extension.extensionId);
        });
        extension.policyIds.forEach(policyId => {
            check(!entity.policyOwners.has(policyId), 'ONTOLOGY_V21_COMPOSITION_COLLISION');
            entity.policyOwners.set(policyId, extension.extensionId);
        });
        extension.designations.forEach(designation => {
            check(!entity.designationIds.has(designation.designationId), 'ONTOLOGY_V21_COMPOSITION_COLLISION');
            entity.designationIds.add(designation.designationId);
        });
        extension.facts.forEach(fact => {
            validateFactShape(fact);
            check(!entity.factOwners.has(fact.factId), 'ONTOLOGY_V21_COMPOSITION_COLLISION');
            entity.factOwners.set(fact.factId, extension.extensionId);
        });
        entity.extensions.set(extension.extensionId, extension);
        declarations.set(extension.extensionId, extension);
    });
    return { entities, extensionDeclarations: declarations };
}

function baseSurface(entityType) {
    return { entityType, extensionId: null };
}

function extensionSurface(entityType, extensionId) {
    return { entityType, extensionId };
}

function getVisibleFact(model, surface, factId) {
    const entity = model.entities.get(surface.entityType);
    if (!entity) return null;
    if (entity.baseFacts.has(factId)) return { fact: entity.baseFacts.get(factId), extensionId: null };
    if (surface.extensionId) {
        const extension = entity.extensions.get(surface.extensionId);
        const fact = extension && extension.facts.find(item => item.factId === factId);
        if (fact) return { fact, extensionId: surface.extensionId };
    }
    return null;
}

function getRelatedTerminalFact(model, entityType, targetExtensionId, factId) {
    const entity = model.entities.get(entityType);
    if (!entity) return null;
    if (targetExtensionId === undefined) {
        return entity.baseFacts.has(factId) ? { fact: entity.baseFacts.get(factId), extensionId: null } : null;
    }
    const extension = entity.extensions.get(targetExtensionId);
    const fact = extension && extension.facts.find(item => item.factId === factId);
    return fact ? { fact, extensionId: targetExtensionId } : null;
}

function assertRelationVisible(model, surface, relationMap, relationId, entityType) {
    const relation = relationMap.get(relationId);
    check(relation && relation.sourceEntityType === entityType, 'ONTOLOGY_V21_CROSS_ENTITY_PATH_INVALID');
    const entity = model.entities.get(entityType);
    const ownerExtensionId = entity && entity.relationOwners.get(relationId);
    check(ownerExtensionId !== undefined, 'ONTOLOGY_V21_RELATION_OWNERSHIP_INVALID');
    check(
        ownerExtensionId === null
        || (surface.extensionId === ownerExtensionId && surface.entityType === entityType),
        'ONTOLOGY_V21_EXTENSION_SCOPE_INVALID'
    );
    return relation;
}

function validateExtensionsWithV2Projection(contract, extensionDeclarations) {
    const projected = projectToV2(contract);
    extensionDeclarations.forEach(extension => {
        const baseIndex = projected.profiles.findIndex(profile => profile.entityType === extension.baseEntityType);
        const base = projected.profiles[baseIndex];
        projected.profiles[baseIndex] = {
            ...base,
            facts: [...base.facts, ...extension.facts.map(stripFactV21)],
            designations: [...base.designations, ...extension.designations],
        };
        try {
            validateOntologyV2(projected);
        } catch (error) {
            fail(error.code || 'ONTOLOGY_V21_EXTENSION_INVALID');
        }
        projected.profiles[baseIndex] = base;
    });
}

function validateTechnicalKnowledgeCollection(collection, entities) {
    exactKeys(collection, [
        'collectionId', 'ownerEntityType', 'entrySchema', 'allowsArbitraryKeys', 'searchable',
        'aiReadable', 'defaultClassification', 'runtimeEnabled',
    ], 'ONTOLOGY_V21_KNOWLEDGE_INVALID');
    nonEmptyString(collection.collectionId, 'ONTOLOGY_V21_KNOWLEDGE_INVALID');
    check(entities.has(collection.ownerEntityType), 'ONTOLOGY_V21_KNOWLEDGE_OWNER_INVALID');
    exactKeys(collection.entrySchema, ['requiredFields', 'optionalFields'], 'ONTOLOGY_V21_KNOWLEDGE_INVALID');
    Object.values(collection.entrySchema).flat().forEach(field => {
        check(!FUNCTIONAL_KNOWLEDGE_FIELDS.has(field), 'ONTOLOGY_V21_KNOWLEDGE_FUNCTIONAL_AUTHORITY_FORBIDDEN');
    });
    check(
        Array.isArray(collection.entrySchema.requiredFields)
        && Array.isArray(collection.entrySchema.optionalFields)
        && collection.entrySchema.requiredFields.join(',') === 'key,label,value'
        && collection.entrySchema.optionalFields.join(',') === 'unit,valueType,sourceRef,updatedAt,version,evidenceRelationIds',
        'ONTOLOGY_V21_KNOWLEDGE_INVALID'
    );
    check(collection.allowsArbitraryKeys === true && typeof collection.searchable === 'boolean' && typeof collection.aiReadable === 'boolean', 'ONTOLOGY_V21_KNOWLEDGE_INVALID');
    check(collection.defaultClassification === 'TECHNICAL_KNOWLEDGE', 'ONTOLOGY_V21_KNOWLEDGE_INVALID');
    check(collection.runtimeEnabled === false, 'ONTOLOGY_V21_RUNTIME_ISOLATION_REQUIRED');
}

function knowledgeRef(value, collections, ownerEntityType) {
    if (value === null) return;
    exactKeys(value, ['collectionId'], 'ONTOLOGY_V21_KNOWLEDGE_REF_INVALID');
    const collection = collections.get(value.collectionId);
    check(collection && collection.ownerEntityType === ownerEntityType, 'ONTOLOGY_V21_KNOWLEDGE_OWNER_INVALID');
}

function getFactRefTerminal(ref, surface, model, relationMap, sourceMap, roleIds, requirePolicyInput = false) {
    exactKeysWithOptional(ref, ['scope', 'factId'], ['relationPath', 'targetExtensionId'], 'ONTOLOGY_V21_FACT_REF_INVALID');
    check(Object.values(FactRefScope).includes(ref.scope), 'ONTOLOGY_V21_FACT_REF_INVALID');
    nonEmptyString(ref.factId, 'ONTOLOGY_V21_FACT_REF_INVALID');
    let entityType = surface.entityType;
    let traversalSurface = surface;
    let terminal;
    if (ref.scope === FactRefScope.LOCAL) {
        check(!('relationPath' in ref) && !('targetExtensionId' in ref), 'ONTOLOGY_V21_FACT_REF_INVALID');
        terminal = getVisibleFact(model, surface, ref.factId);
    } else {
        check(Array.isArray(ref.relationPath) && ref.relationPath.length > 0, 'ONTOLOGY_V21_CROSS_ENTITY_PATH_INVALID');
        const seenTypes = new Set([entityType]);
        ref.relationPath.forEach(relationId => {
            nonEmptyString(relationId, 'ONTOLOGY_V21_CROSS_ENTITY_PATH_INVALID');
            const relation = assertRelationVisible(model, traversalSurface, relationMap, relationId, entityType);
            entityType = relation.target.entityType;
            check(!seenTypes.has(entityType), 'ONTOLOGY_V21_CROSS_ENTITY_PATH_INVALID');
            seenTypes.add(entityType);
            // An extension-owned relation is only visible on its declaring extension surface.
            // After crossing a relation, no target extension is implicitly active.
            traversalSurface = baseSurface(entityType);
        });
        if ('targetExtensionId' in ref) nonEmptyString(ref.targetExtensionId, 'ONTOLOGY_V21_FACT_REF_INVALID');
        terminal = getRelatedTerminalFact(model, entityType, ref.targetExtensionId, ref.factId);
    }
    check(terminal, 'ONTOLOGY_V21_FACT_REF_INVALID');
    const source = validateFactSourceSafety(terminal.fact, sourceMap);
    check(source.authority !== SourceAuthority.UNRESOLVED, 'ONTOLOGY_V21_UNRESOLVED_UNSAFE');
    if (requirePolicyInput) check(terminal.fact.businessRoles.includes('POLICY_INPUT'), 'ONTOLOGY_V21_POLICY_INPUT_REQUIRED');
    return { fact: terminal.fact, entityType, extensionId: terminal.extensionId };
}

function validatePredicate(predicate, surface, model, relationMap, sourceMap, roleIds) {
    check(plainObject(predicate), 'ONTOLOGY_V21_PREDICATE_INVALID');
    if (predicate.kind === PredicateKind.FACT_EQUALS) {
        exactKeys(predicate, ['kind', 'factRef', 'value'], 'ONTOLOGY_V21_PREDICATE_INVALID');
        const { fact } = getFactRefTerminal(predicate.factRef, surface, model, relationMap, sourceMap, roleIds, true);
        check(literalMatchesFact(predicate.value, fact), 'ONTOLOGY_V21_PREDICATE_TYPE_INVALID');
    } else if (predicate.kind === PredicateKind.FACT_EXISTS) {
        exactKeys(predicate, ['kind', 'factRef'], 'ONTOLOGY_V21_PREDICATE_INVALID');
        getFactRefTerminal(predicate.factRef, surface, model, relationMap, sourceMap, roleIds, true);
    } else if (predicate.kind === PredicateKind.RELATION_EXISTS) {
        exactKeys(predicate, ['kind', 'relationId'], 'ONTOLOGY_V21_PREDICATE_INVALID');
        assertRelationVisible(model, surface, relationMap, predicate.relationId, surface.entityType);
    } else if (predicate.kind === PredicateKind.ALL_OF) {
        exactKeys(predicate, ['kind', 'predicates'], 'ONTOLOGY_V21_PREDICATE_INVALID');
        check(Array.isArray(predicate.predicates) && predicate.predicates.length > 0, 'ONTOLOGY_V21_PREDICATE_INVALID');
        predicate.predicates.forEach(item => validatePredicate(item, surface, model, relationMap, sourceMap, roleIds));
    } else {
        fail('ONTOLOGY_V21_PREDICATE_INVALID');
    }
}

function validateRelation(relation, entities, sourceMap, roleIds) {
    exactKeysWithOptional(relation, [
        'relationId', 'sourceEntityType', 'target', 'direction', 'cardinality', 'sourceRef', 'runtimeEnabled',
    ], ['applicableWhen', 'semanticRoles'], 'ONTOLOGY_V21_RELATION_INVALID');
    nonEmptyString(relation.relationId, 'ONTOLOGY_V21_RELATION_INVALID');
    check(entities.has(relation.sourceEntityType), 'ONTOLOGY_V21_RELATION_SOURCE_INVALID');
    exactKeys(relation.target, ['entityType', 'canonicalEndpointRequired'], 'ONTOLOGY_V21_RELATION_ENDPOINT_INVALID');
    check(entities.has(relation.target.entityType) && relation.target.canonicalEndpointRequired === true, 'ONTOLOGY_V21_RELATION_ENDPOINT_INVALID');
    check(Object.values(RelationDirection).includes(relation.direction), 'ONTOLOGY_V21_RELATION_INVALID');
    check(Object.values(RelationCardinality).includes(relation.cardinality), 'ONTOLOGY_V21_RELATION_CARDINALITY_INVALID');
    const source = validateSourceRef(relation.sourceRef, sourceMap);
    check(source.authority !== SourceAuthority.UNRESOLVED && ![ProvenancePurpose.COMPATIBILITY_ADAPTER, ProvenancePurpose.PRESET_INITIALIZATION, ProvenancePurpose.KNOWLEDGE_METADATA].includes(source.provenancePurpose), 'ONTOLOGY_V21_RELATION_ENDPOINT_INVALID');
    check(relation.runtimeEnabled === false, 'ONTOLOGY_V21_RUNTIME_ISOLATION_REQUIRED');
    if ('semanticRoles' in relation) validateRoleIds(relation.semanticRoles, roleIds, 'ONTOLOGY_V21_RELATION_INVALID');
}

function validateOwnerRelations(owner, surface, model, relationMap) {
    owner.relationIds.forEach(relationId => {
        const relation = relationMap.get(relationId);
        const entity = model.entities.get(surface.entityType);
        check(
            relation
            && relation.sourceEntityType === surface.entityType
            && entity.relationOwners.get(relationId) === surface.extensionId,
            'ONTOLOGY_V21_RELATION_OWNERSHIP_INVALID'
        );
    });
}

function validateRelationProjection(fact, surface, model, relationMap, sourceMap) {
    exactKeysWithOptional(fact.relationProjection, ['relationId', 'targetFactRef'], ['displayProjection'], 'ONTOLOGY_V21_RELATION_PROJECTION_INVALID');
    const relation = relationMap.get(fact.relationProjection.relationId);
    check(relation && relation.sourceEntityType === surface.entityType, 'ONTOLOGY_V21_RELATION_PROJECTION_INVALID');
    const validateDirectTargetRef = factRef => {
        check(
            plainObject(factRef)
            && factRef.scope === FactRefScope.RELATED
            && Array.isArray(factRef.relationPath)
            && factRef.relationPath.length === 1
            && factRef.relationPath[0] === relation.relationId,
            'ONTOLOGY_V21_RELATION_PROJECTION_INVALID'
        );
        const terminal = getFactRefTerminal(factRef, surface, model, relationMap, sourceMap, new Set());
        check(terminal.entityType === relation.target.entityType, 'ONTOLOGY_V21_RELATION_PROJECTION_INVALID');
        return terminal;
    };
    const terminal = validateDirectTargetRef(fact.relationProjection.targetFactRef);
    check(terminal.entityType === relation.target.entityType, 'ONTOLOGY_V21_RELATION_PROJECTION_INVALID');
    check(terminal.fact.dataType === fact.dataType && unitsCompatible(terminal.fact.unit, fact.unit), 'ONTOLOGY_V21_RELATION_PROJECTION_INVALID');
    const source = validateFactSourceSafety(fact, sourceMap);
    check(source.provenancePurpose === ProvenancePurpose.RELATION_PROJECTION, 'ONTOLOGY_V21_RELATION_PROJECTION_INVALID');
    if ('displayProjection' in fact.relationProjection) {
        validateDirectTargetRef(fact.relationProjection.displayProjection);
        check(fact.directIdentityEvidence === false, 'ONTOLOGY_V21_RELATION_PROJECTION_INVALID');
    }
}

function validateDerivation(fact, surface, model, relationMap, sourceMap) {
    const derivation = fact.derivation;
    exactKeysWithOptional(derivation, ['operation', 'inputs', 'sourceRef', 'missingInputPolicy', 'materialization'], ['cacheMetadata'], 'ONTOLOGY_V21_DERIVATION_INVALID');
    check(Object.values(DerivationOperation).includes(derivation.operation), 'ONTOLOGY_V21_DERIVATION_OPERATION_FORBIDDEN');
    check(Array.isArray(derivation.inputs), 'ONTOLOGY_V21_DERIVATION_INPUT_INVALID');
    check(derivation.missingInputPolicy === 'UNRESOLVED', 'ONTOLOGY_V21_DERIVATION_INPUT_INVALID');
    const source = validateSourceRef(derivation.sourceRef, sourceMap);
    check(source.authority === SourceAuthority.DERIVED, 'ONTOLOGY_V21_DERIVED_AUTHORITY_INVALID');
    check(Object.values(MaterializationPolicy).includes(derivation.materialization), 'ONTOLOGY_V21_DERIVATION_INVALID');
    const inputs = derivation.inputs.map(input => getFactRefTerminal(input, surface, model, relationMap, sourceMap, new Set()));
    if (derivation.operation === DerivationOperation.COPY) {
        check(inputs.length === 1 && inputs[0].fact.dataType === fact.dataType && unitsCompatible(inputs[0].fact.unit, fact.unit), 'ONTOLOGY_V21_DERIVATION_INPUT_INVALID');
    } else if (derivation.operation === DerivationOperation.SUBTRACT) {
        check(inputs.length === 2 && numericDataType(fact.dataType) && inputs.every(input => numericDataType(input.fact.dataType)) && unitsCompatible(inputs[0].fact.unit, inputs[1].fact.unit) && unitsCompatible(inputs[0].fact.unit, fact.unit), 'ONTOLOGY_V21_DERIVATION_INPUT_INVALID');
    } else {
        check(inputs.length === 1 && derivation.inputs[0].scope === FactRefScope.RELATED && inputs[0].fact.dataType === fact.dataType && unitsCompatible(inputs[0].fact.unit, fact.unit), 'ONTOLOGY_V21_DERIVATION_INPUT_INVALID');
    }
    if (derivation.materialization === MaterializationPolicy.MATERIALIZED_CACHE) {
        exactKeys(derivation.cacheMetadata, ['inputRefs', 'sourceRefs', 'freshness', 'contractVersion', 'calculationVersion', 'invalidation'], 'ONTOLOGY_V21_DERIVED_CACHE_INVALID');
        check(Array.isArray(derivation.cacheMetadata.inputRefs) && derivation.cacheMetadata.inputRefs.length > 0, 'ONTOLOGY_V21_DERIVED_CACHE_INVALID');
        derivation.cacheMetadata.inputRefs.forEach(input => getFactRefTerminal(input, surface, model, relationMap, sourceMap, new Set()));
        check(Array.isArray(derivation.cacheMetadata.sourceRefs) && derivation.cacheMetadata.sourceRefs.length > 0, 'ONTOLOGY_V21_DERIVED_CACHE_INVALID');
        derivation.cacheMetadata.sourceRefs.forEach(sourceRef => validateSourceRef(sourceRef, sourceMap));
        ['freshness', 'contractVersion', 'calculationVersion', 'invalidation'].forEach(field => nonEmptyString(derivation.cacheMetadata[field], 'ONTOLOGY_V21_DERIVED_CACHE_INVALID'));
    } else {
        check(!('cacheMetadata' in derivation), 'ONTOLOGY_V21_DERIVED_CACHE_INVALID');
    }
}

function validateDerivationGraph(model, relationMap, sourceMap) {
    const derivedFacts = new Map();
    const keyFor = (entityType, factId) => `${entityType}\u0000${factId}`;
    model.entities.forEach((entity, entityType) => {
        entity.baseFacts.forEach(fact => {
            if ((fact.valueKind || FactValueKind.DIRECT) === FactValueKind.DERIVED) {
                derivedFacts.set(keyFor(entityType, fact.factId), { fact, surface: baseSurface(entityType) });
            }
        });
        entity.extensions.forEach((extension, extensionId) => extension.facts.forEach(fact => {
            if ((fact.valueKind || FactValueKind.DIRECT) === FactValueKind.DERIVED) {
                derivedFacts.set(keyFor(entityType, fact.factId), { fact, surface: extensionSurface(entityType, extensionId) });
            }
        }));
    });
    const states = new Map();
    const visit = key => {
        if (states.get(key) === 'VISITING') fail('ONTOLOGY_V21_DERIVATION_CYCLE');
        if (states.get(key) === 'VISITED') return;
        states.set(key, 'VISITING');
        const item = derivedFacts.get(key);
        item.fact.derivation.inputs.forEach(ref => {
            const terminal = getFactRefTerminal(ref, item.surface, model, relationMap, sourceMap, new Set());
            const terminalKey = keyFor(terminal.entityType, terminal.fact.factId);
            if (derivedFacts.has(terminalKey)) visit(terminalKey);
        });
        states.set(key, 'VISITED');
    };
    derivedFacts.forEach((_, key) => visit(key));
    return derivedFacts.size;
}

function validatePolicy(policy, surface, model, relationMap, sourceMap, roleIds) {
    exactKeysWithOptional(policy, ['policyId', 'ownerEntityType', 'factRefs', 'relationIds', 'rules', 'runtimeEnabled'], ['applicableWhen'], 'ONTOLOGY_V21_POLICY_INVALID');
    nonEmptyString(policy.policyId, 'ONTOLOGY_V21_POLICY_INVALID');
    check(model.entities.has(policy.ownerEntityType) && policy.ownerEntityType === surface.entityType, 'ONTOLOGY_V21_POLICY_INVALID');
    check(Array.isArray(policy.factRefs) && Array.isArray(policy.relationIds) && Array.isArray(policy.rules), 'ONTOLOGY_V21_POLICY_INVALID');
    check(new Set(policy.relationIds).size === policy.relationIds.length, 'ONTOLOGY_V21_POLICY_INVALID');
    policy.factRefs.forEach(ref => getFactRefTerminal(ref, surface, model, relationMap, sourceMap, roleIds, true));
    policy.relationIds.forEach(id => {
        try {
            assertRelationVisible(model, surface, relationMap, id, policy.ownerEntityType);
        } catch (error) {
            fail('ONTOLOGY_V21_POLICY_INVALID');
        }
    });
    check(policy.rules.length === 0, 'ONTOLOGY_V21_POLICY_RULES_UNSUPPORTED');
    check(policy.runtimeEnabled === false, 'ONTOLOGY_V21_RUNTIME_ISOLATION_REQUIRED');
    if ('applicableWhen' in policy) validatePredicate(policy.applicableWhen, surface, model, relationMap, sourceMap, roleIds);
}

function validateOntologyV21(contract) {
    checkJsonData(contract);
    validateContractRoot(contract);
    const roleIds = validateRoleCatalog(contract.roleCatalog);
    const sourceMap = validateSources(contract.sources);

    // Preserves all frozen V2 profile/source/designation/policy semantics without touching V2 code.
    validateOntologyV2(projectToV2(contract));

    const profileIds = new Set();
    contract.profiles.forEach(profile => {
        validateProfileShape(profile);
        check(!profileIds.has(profile.entityType), 'ONTOLOGY_V21_PROFILE_DUPLICATE');
        profileIds.add(profile.entityType);
        assertCanonicalIdentitySource(profile, sourceMap);
        profile.facts.forEach(fact => {
            validateFactShape(fact);
            validateFactSourceSafety(fact, sourceMap);
        });
    });

    const { entities, extensionDeclarations } = createSemanticModel(contract.profiles, contract.extensions);
    const model = { entities, extensionDeclarations };
    validateExtensionsWithV2Projection(contract, extensionDeclarations);

    const relationMap = new Map();
    contract.relations.forEach(relation => {
        check(!relationMap.has(relation.relationId), 'ONTOLOGY_V21_RELATION_DUPLICATE');
        validateRelation(relation, entities, sourceMap, roleIds);
        relationMap.set(relation.relationId, relation);
    });

    const collectionMap = new Map();
    contract.technicalKnowledgeTypes.forEach(collection => {
        check(!collectionMap.has(collection.collectionId), 'ONTOLOGY_V21_KNOWLEDGE_DUPLICATE');
        validateTechnicalKnowledgeCollection(collection, entities);
        collectionMap.set(collection.collectionId, collection);
    });

    contract.profiles.forEach(profile => {
        const surface = baseSurface(profile.entityType);
        validateOwnerRelations(profile, surface, model, relationMap);
        knowledgeRef(profile.technicalKnowledge, collectionMap, profile.entityType);
        const factIds = new Set(profile.facts.map(fact => fact.factId));
        profile.derivedFactIds.forEach(id => {
            const fact = profile.facts.find(item => item.factId === id);
            check(fact && (fact.valueKind || FactValueKind.DIRECT) === FactValueKind.DERIVED, 'ONTOLOGY_V21_DERIVED_FACT_IDS_INVALID');
        });
        profile.facts.filter(fact => (fact.valueKind || FactValueKind.DIRECT) === FactValueKind.DERIVED)
            .forEach(fact => check(profile.derivedFactIds.includes(fact.factId), 'ONTOLOGY_V21_DERIVED_FACT_IDS_INVALID'));
        check(factIds.size === profile.facts.length, 'ONTOLOGY_V21_FACT_DUPLICATE');
    });
    extensionDeclarations.forEach(extension => {
        const surface = extensionSurface(extension.baseEntityType, extension.extensionId);
        validateOwnerRelations(extension, surface, model, relationMap);
        knowledgeRef(extension.technicalKnowledge, collectionMap, extension.baseEntityType);
        if ('sourceRefs' in extension) {
            check(Array.isArray(extension.sourceRefs), 'ONTOLOGY_V21_EXTENSION_FIELDS_INVALID');
            extension.sourceRefs.forEach(ref => validateSourceRef(ref, sourceMap));
        }
        // Applicability bootstraps the extension: only the base semantic surface exists here.
        validatePredicate(extension.applicability, baseSurface(extension.baseEntityType), model, relationMap, sourceMap, roleIds);
    });

    contract.relations.forEach(relation => {
        if ('applicableWhen' in relation) {
            const entity = entities.get(relation.sourceEntityType);
            const ownerExtensionId = entity.relationOwners.get(relation.relationId);
            validatePredicate(
                relation.applicableWhen,
                ownerExtensionId === undefined ? baseSurface(relation.sourceEntityType) : extensionSurface(relation.sourceEntityType, ownerExtensionId),
                model,
                relationMap,
                sourceMap,
                roleIds
            );
        }
    });

    const validateFactsOnSurface = (facts, surface) => facts.forEach(fact => {
        const valueKind = fact.valueKind || FactValueKind.DIRECT;
        if (valueKind === FactValueKind.RELATION_PROJECTION) validateRelationProjection(fact, surface, model, relationMap, sourceMap);
        if (valueKind === FactValueKind.DERIVED) validateDerivation(fact, surface, model, relationMap, sourceMap);
        ['applicableWhen', 'requiredWhen', 'prohibitedWhen'].forEach(field => {
            if (field in fact) validatePredicate(fact[field], surface, model, relationMap, sourceMap, roleIds);
        });
    });
    entities.forEach((entity, entityType) => {
        validateFactsOnSurface([...entity.baseFacts.values()], baseSurface(entityType));
        entity.extensions.forEach((extension, extensionId) => validateFactsOnSurface(extension.facts, extensionSurface(entityType, extensionId)));
    });

    const policyIds = new Set();
    contract.policies.forEach(policy => {
        check(!policyIds.has(policy.policyId), 'ONTOLOGY_V21_POLICY_DUPLICATE');
        policyIds.add(policy.policyId);
    });
    contract.profiles.forEach(profile => profile.policyIds.forEach(id => check(policyIds.has(id), 'ONTOLOGY_V21_POLICY_REFERENCE_INVALID')));
    extensionDeclarations.forEach(extension => extension.policyIds.forEach(id => check(policyIds.has(id), 'ONTOLOGY_V21_POLICY_REFERENCE_INVALID')));

    contract.policies.forEach(policy => {
        const entity = entities.get(policy.ownerEntityType);
        const ownerExtensionId = entity && entity.policyOwners.get(policy.policyId);
        check(ownerExtensionId !== undefined, 'ONTOLOGY_V21_POLICY_REFERENCE_INVALID');
        validatePolicy(
            policy,
            extensionSurface(policy.ownerEntityType, ownerExtensionId),
            model,
            relationMap,
            sourceMap,
            roleIds
        );
    });

    const derivedFactCount = validateDerivationGraph(model, relationMap, sourceMap);
    const allFacts = [...entities.values()].flatMap(entity => [
        ...entity.baseFacts.values(),
        ...[...entity.extensions.values()].flatMap(extension => extension.facts),
    ]);
    const relationProjectionFactCount = allFacts.filter(fact => fact.valueKind === FactValueKind.RELATION_PROJECTION).length;
    const factCount = allFacts.length;
    return Object.freeze({
        version: 2,
        contractRevision: OntologyV21ContractRevision,
        sourceCount: sourceMap.size,
        profileCount: contract.profiles.length,
        extensionCount: contract.extensions.length,
        relationCount: relationMap.size,
        policyCount: policyIds.size,
        technicalKnowledgeTypeCount: collectionMap.size,
        factCount,
        derivedFactCount,
        relationProjectionFactCount,
        runtimeEnabled: false,
    });
}

module.exports = { validateOntologyV21 };
