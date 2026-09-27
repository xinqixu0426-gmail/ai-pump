'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ontologyV2 } = require('../api/ontology/v2/contract.cjs');
const { validateOntologyV2 } = require('../api/ontology/v2/validator.cjs');
const { ontologyV21 } = require('../api/ontology/v2_1/contract.cjs');
const { validateOntologyV21 } = require('../api/ontology/v2_1/validator.cjs');

function sourceRef(sourceId, path = 'synthetic.path', status = 'RESOLVED') {
    return { sourceId, path, status };
}

function source(sourceId, authority = 'CANONICAL_CURRENT', sourceKind = 'RAW_CURRENT_RESOURCE', provenancePurpose = 'CURRENT_RESOURCE', inputSourceIds = []) {
    return {
        sourceId,
        authority,
        sourceKind,
        provenancePurpose,
        inputSourceIds,
        sourceOfTruth: `Synthetic ${sourceId} declaration`,
        readBoundary: 'TEST_ONLY_NO_RUNTIME',
        storesValueInOntology: false,
    };
}

function fact(entityType, field, options = {}) {
    const sourceId = options.sourceId || `${entityType}.current`;
    const authority = options.authority || 'CANONICAL_CURRENT';
    return {
        factId: `${entityType}.${field}`,
        label: field,
        dataType: options.dataType || 'STRING',
        unit: options.unit === undefined ? null : options.unit,
        sourceRef: options.sourceRef || sourceRef(sourceId),
        authority,
        searchable: false,
        candidateSelectionEvidence: false,
        directIdentityEvidence: false,
        presentationGroup: 'OTHER',
        temporalSemantics: authority === 'DERIVED' ? 'DYNAMIC_DERIVED_CURRENT_VALUE' : 'MUTABLE_CURRENT_VALUE',
        missingSemantics: 'NOT_RECORDED',
        safeForDefaultSummary: false,
        businessRoles: options.businessRoles || ['DESCRIPTIVE'],
        ...options.extra,
    };
}

function profile(entityType, facts) {
    return {
        entityType,
        status: 'SYNTHETIC_TEST_ONLY',
        identity: {
            canonicalId: { sourceRef: sourceRef(`${entityType}.current`, `${entityType}s.id`), kind: 'DB_POSITIVE_INTEGER_PRIMARY_KEY', unique: true },
            canonicalIdentityFactId: null,
            permitsDesignationAsCanonicalId: false,
            permitsNameOnlyCanonicalId: false,
        },
        facts,
        designations: [],
        selectionPolicy: { policyType: 'NONE', runtimeEnabled: false },
        eligibilityPolicy: { policyType: 'NONE', runtimeEnabled: false },
        costingPolicy: null,
        relationBridge: null,
        relationIds: [],
        derivedFactIds: [],
        policyIds: [],
        technicalKnowledge: null,
    };
}

function local(factId) {
    return { scope: 'LOCAL', factId };
}

function related(relationPath, factId) {
    return { scope: 'RELATED', relationPath, factId };
}

function relation(relationId = 'alpha.uses_beta', overrides = {}) {
    return {
        relationId,
        sourceEntityType: 'alpha',
        target: { entityType: 'beta', canonicalEndpointRequired: true },
        direction: 'OUTBOUND',
        cardinality: 'EXACTLY_ONE',
        sourceRef: sourceRef('alpha.current', 'alpha.beta_id'),
        runtimeEnabled: false,
        ...overrides,
    };
}

function extension(extensionId = 'alpha.synthetic_extension', overrides = {}) {
    return {
        extensionId,
        baseEntityType: 'alpha',
        applicability: { kind: 'FACT_EQUALS', factRef: local('alpha.control'), value: true },
        facts: [fact('alpha', 'extensionSignal')],
        designations: [],
        relationIds: [],
        policyIds: [],
        technicalKnowledge: null,
        runtimeEnabled: false,
        ...overrides,
    };
}

function knowledge(collectionId = 'alpha.technical_knowledge', ownerEntityType = 'alpha') {
    return {
        collectionId,
        ownerEntityType,
        entrySchema: {
            requiredFields: ['key', 'label', 'value'],
            optionalFields: ['unit', 'valueType', 'sourceRef', 'updatedAt', 'version', 'evidenceRelationIds'],
        },
        allowsArbitraryKeys: true,
        searchable: true,
        aiReadable: true,
        defaultClassification: 'TECHNICAL_KNOWLEDGE',
        runtimeEnabled: false,
    };
}

function makeContract() {
    const contract = structuredClone(ontologyV21);
    contract.sources.push(
        source('alpha.current'),
        source('beta.current'),
        source('alpha.derived', 'DERIVED', 'DECLARATIVE_DERIVATION'),
        source('alpha.relation_projection', 'DERIVED', 'FORMAL_PROJECTION', 'RELATION_PROJECTION', ['alpha.current', 'beta.current']),
        source('alpha.compatibility', 'TEMPORARY_NON_AUTHORITATIVE', 'FORMAL_PROJECTION', 'COMPATIBILITY_ADAPTER', ['alpha.current']),
        source('alpha.preset', 'TEMPORARY_NON_AUTHORITATIVE', 'FORMAL_PROJECTION', 'PRESET_INITIALIZATION', ['alpha.current']),
        source('alpha.unresolved', 'UNRESOLVED', 'UNRESOLVED_SEMANTIC_GAP', 'CURRENT_RESOURCE', ['alpha.current'])
    );
    contract.profiles.push(
        profile('alpha', [
            fact('alpha', 'control', { dataType: 'BOOLEAN', businessRoles: ['POLICY_INPUT'] }),
            fact('alpha', 'amount', { dataType: 'NUMBER', unit: 'mm', businessRoles: ['FUNCTIONAL_TECHNICAL', 'POLICY_INPUT'] }),
            fact('alpha', 'offset', { dataType: 'NUMBER', unit: 'mm', businessRoles: ['FUNCTIONAL_TECHNICAL', 'POLICY_INPUT'] }),
            fact('alpha', 'text', { businessRoles: ['DISPLAY'] }),
        ]),
        profile('beta', [
            fact('beta', 'control', { dataType: 'BOOLEAN', businessRoles: ['POLICY_INPUT'] }),
            fact('beta', 'value', { dataType: 'NUMBER', unit: 'mm', businessRoles: ['FUNCTIONAL_TECHNICAL', 'POLICY_INPUT'] }),
            fact('beta', 'label', { businessRoles: ['DISPLAY'] }),
        ])
    );
    return contract;
}

function getProfile(contract, entityType = 'alpha') {
    return contract.profiles.find(item => item.entityType === entityType);
}

function addDerived(contract, field, derivation, options = {}) {
    const item = fact('alpha', field, {
        dataType: options.dataType || 'NUMBER',
        unit: options.unit === undefined ? 'mm' : options.unit,
        sourceId: 'alpha.derived',
        authority: 'DERIVED',
        businessRoles: ['FUNCTIONAL_TECHNICAL'],
        extra: { valueKind: 'DERIVED', derivation },
    });
    getProfile(contract).facts.push(item);
    getProfile(contract).derivedFactIds.push(item.factId);
    return item;
}

function validCacheMetadata(inputs) {
    return {
        inputRefs: inputs,
        sourceRefs: [sourceRef('alpha.current')],
        freshness: 'ON_INPUT_CHANGE',
        contractVersion: '2.1',
        calculationVersion: 'synthetic-v1',
        invalidation: 'INPUT_SOURCE_VERSION_CHANGE',
    };
}

function expectCode(contract, code) {
    assert.throws(() => validateOntologyV21(contract), error => error && error.code === code);
}

test('current V2 and lifted V2.1 Coil contracts remain independently valid', () => {
    assert.equal(validateOntologyV2(ontologyV2).profileCount, 1);
    assert.deepEqual(validateOntologyV21(ontologyV21), {
        version: 2,
        contractRevision: '2.1',
        sourceCount: 19,
        profileCount: 4,
        extensionCount: 1,
        relationCount: 3,
        policyCount: 0,
        technicalKnowledgeTypeCount: 1,
        factCount: 56,
        derivedFactCount: 1,
        relationProjectionFactCount: 0,
        runtimeEnabled: false,
    });
});

test('synthetic Base, extension, relation, projections, predicates, derivations, policy and knowledge validate together', () => {
    const contract = makeContract();
    const alpha = getProfile(contract);
    contract.relations.push(relation());
    alpha.relationIds.push('alpha.uses_beta');
    contract.extensions.push(extension());
    contract.technicalKnowledgeTypes.push(knowledge());
    alpha.technicalKnowledge = { collectionId: 'alpha.technical_knowledge' };
    alpha.facts.push(fact('alpha', 'relatedValue', {
        dataType: 'NUMBER', unit: 'mm', sourceId: 'alpha.relation_projection', authority: 'DERIVED',
        businessRoles: ['FUNCTIONAL_TECHNICAL'],
        extra: {
            valueKind: 'RELATION_PROJECTION',
            relationProjection: { relationId: 'alpha.uses_beta', targetFactRef: related(['alpha.uses_beta'], 'beta.value') },
        },
    }));
    alpha.facts.push(fact('alpha', 'conditionalText', {
        businessRoles: ['DISPLAY'],
        extra: { requiredWhen: { kind: 'FACT_EQUALS', factRef: local('alpha.control'), value: true } },
    }));
    addDerived(contract, 'copiedAmount', {
        operation: 'COPY', inputs: [local('alpha.amount')], sourceRef: sourceRef('alpha.derived'),
        missingInputPolicy: 'UNRESOLVED', materialization: 'COMPUTE_ON_READ',
    });
    addDerived(contract, 'span', {
        operation: 'SUBTRACT', inputs: [local('alpha.amount'), local('alpha.offset')], sourceRef: sourceRef('alpha.derived'),
        missingInputPolicy: 'UNRESOLVED', materialization: 'NEVER_MATERIALIZE',
    });
    addDerived(contract, 'relatedCopy', {
        operation: 'PROJECT_RELATED_FACT', inputs: [related(['alpha.uses_beta'], 'beta.value')], sourceRef: sourceRef('alpha.derived'),
        missingInputPolicy: 'UNRESOLVED', materialization: 'MATERIALIZED_CACHE',
        cacheMetadata: validCacheMetadata([related(['alpha.uses_beta'], 'beta.value')]),
    });
    contract.policies.push({
        policyId: 'alpha.synthetic_policy', ownerEntityType: 'alpha',
        applicableWhen: { kind: 'RELATION_EXISTS', relationId: 'alpha.uses_beta' },
        factRefs: [local('alpha.control')], relationIds: ['alpha.uses_beta'], rules: [], runtimeEnabled: false,
    });
    alpha.policyIds.push('alpha.synthetic_policy');
    const result = validateOntologyV21(contract);
    assert.equal(result.profileCount, 6);
    assert.equal(result.extensionCount, 2);
    assert.equal(result.relationCount, 4);
    assert.equal(result.policyCount, 1);
    assert.equal(result.technicalKnowledgeTypeCount, 2);
    assert.equal(result.derivedFactCount, 4);
    assert.equal(result.relationProjectionFactCount, 1);
});

test('contract revision and runtime isolation fail closed', () => {
    const revision = makeContract();
    revision.contractRevision = '2.0';
    expectCode(revision, 'ONTOLOGY_V21_VERSION_UNSUPPORTED');
    const rootRuntime = makeContract();
    rootRuntime.runtimeEnabled = true;
    expectCode(rootRuntime, 'ONTOLOGY_V21_RUNTIME_ISOLATION_REQUIRED');
    const nestedRuntime = makeContract();
    nestedRuntime.extensions.push(extension(undefined, { runtimeEnabled: true }));
    expectCode(nestedRuntime, 'ONTOLOGY_V21_RUNTIME_ISOLATION_REQUIRED');
});

test('source DAG and provenance-purpose boundaries fail closed', () => {
    const purpose = makeContract();
    purpose.sources.find(item => item.sourceId === 'alpha.current').provenancePurpose = 'UNKNOWN';
    expectCode(purpose, 'ONTOLOGY_V21_PROVENANCE_PURPOSE_INVALID');
    const selfCycle = makeContract();
    selfCycle.sources.find(item => item.sourceId === 'alpha.current').inputSourceIds = ['alpha.current'];
    expectCode(selfCycle, 'ONTOLOGY_V2_SOURCE_CYCLE');
    const indirectCycle = makeContract();
    indirectCycle.sources.push(source('graph.a', 'DERIVED', 'FORMAL_PROJECTION', 'CURRENT_RESOURCE', ['graph.b']), source('graph.b', 'DERIVED', 'FORMAL_PROJECTION', 'CURRENT_RESOURCE', ['graph.a']));
    expectCode(indirectCycle, 'ONTOLOGY_V2_SOURCE_CYCLE');
    const compatibility = makeContract();
    compatibility.sources.find(item => item.sourceId === 'alpha.compatibility').authority = 'CANONICAL_CURRENT';
    expectCode(compatibility, 'ONTOLOGY_V21_COMPATIBILITY_PRECEDENCE_INVALID');
    const preset = makeContract();
    preset.sources.find(item => item.sourceId === 'alpha.preset').authority = 'CANONICAL_CURRENT';
    expectCode(preset, 'ONTOLOGY_V21_PRESET_AUTHORITY_INVALID');
});

test('extensions reject unknown bases, identity and composition collisions', () => {
    const unknownBase = makeContract();
    unknownBase.extensions.push(extension(undefined, { baseEntityType: 'missing' }));
    expectCode(unknownBase, 'ONTOLOGY_V21_EXTENSION_BASE_INVALID');
    const identity = makeContract();
    identity.extensions.push({ ...extension(), identity: { canonicalId: 'forbidden' } });
    expectCode(identity, 'ONTOLOGY_V21_EXTENSION_IDENTITY_FORBIDDEN');
    const baseCollision = makeContract();
    baseCollision.extensions.push(extension(undefined, { facts: [fact('alpha', 'control', { dataType: 'BOOLEAN', businessRoles: ['POLICY_INPUT'] })] }));
    expectCode(baseCollision, 'ONTOLOGY_V21_COMPOSITION_COLLISION');
    const extensionCollision = makeContract();
    extensionCollision.extensions.push(extension('alpha.one'));
    extensionCollision.extensions.push(extension('alpha.two'));
    expectCode(extensionCollision, 'ONTOLOGY_V21_COMPOSITION_COLLISION');
    const ownershipCollision = makeContract();
    ownershipCollision.extensions.push(extension('alpha.one', { relationIds: ['alpha.uses_beta'] }));
    ownershipCollision.extensions.push(extension('alpha.two', { relationIds: ['alpha.uses_beta'] }));
    expectCode(ownershipCollision, 'ONTOLOGY_V21_COMPOSITION_COLLISION');
});

test('predicates reject unknown/type-mismatched facts and unsupported expressions', () => {
    const unknown = makeContract();
    unknown.extensions.push(extension(undefined, { applicability: { kind: 'FACT_EXISTS', factRef: local('alpha.unknown') } }));
    expectCode(unknown, 'ONTOLOGY_V21_FACT_REF_INVALID');
    const typeMismatch = makeContract();
    typeMismatch.extensions.push(extension(undefined, { applicability: { kind: 'FACT_EQUALS', factRef: local('alpha.control'), value: 'true' } }));
    expectCode(typeMismatch, 'ONTOLOGY_V21_PREDICATE_TYPE_INVALID');
    const unsupported = makeContract();
    unsupported.extensions.push(extension(undefined, { applicability: { kind: 'ANY_OF', predicates: [] } }));
    expectCode(unsupported, 'ONTOLOGY_V21_PREDICATE_INVALID');
});

test('formal relations and their ownership reject non-canonical or unrelated declarations', () => {
    const sourceEntity = makeContract();
    sourceEntity.relations.push(relation(undefined, { sourceEntityType: 'missing' }));
    expectCode(sourceEntity, 'ONTOLOGY_V21_RELATION_SOURCE_INVALID');
    const targetEntity = makeContract();
    targetEntity.relations.push(relation(undefined, { target: { entityType: 'missing', canonicalEndpointRequired: true } }));
    expectCode(targetEntity, 'ONTOLOGY_V21_RELATION_ENDPOINT_INVALID');
    const endpoint = makeContract();
    endpoint.relations.push(relation(undefined, { target: { entityType: 'beta', canonicalEndpointRequired: false } }));
    expectCode(endpoint, 'ONTOLOGY_V21_RELATION_ENDPOINT_INVALID');
    const cardinality = makeContract();
    cardinality.relations.push(relation(undefined, { cardinality: 'FIRST_MATCH' }));
    expectCode(cardinality, 'ONTOLOGY_V21_RELATION_CARDINALITY_INVALID');
    const ownership = makeContract();
    ownership.relations.push(relation());
    getProfile(ownership, 'beta').relationIds.push('alpha.uses_beta');
    expectCode(ownership, 'ONTOLOGY_V21_RELATION_OWNERSHIP_INVALID');
});

test('relation projections and RELATED FactRef paths reject invalid traversal', () => {
    const unknownRelation = makeContract();
    getProfile(unknownRelation).facts.push(fact('alpha', 'projection', {
        dataType: 'NUMBER', unit: 'mm', sourceId: 'alpha.relation_projection', authority: 'DERIVED',
        extra: { valueKind: 'RELATION_PROJECTION', relationProjection: { relationId: 'alpha.unknown', targetFactRef: related(['alpha.unknown'], 'beta.value') } },
    }));
    expectCode(unknownRelation, 'ONTOLOGY_V21_RELATION_PROJECTION_INVALID');
    const unknownTarget = makeContract();
    unknownTarget.relations.push(relation());
    getProfile(unknownTarget).relationIds.push('alpha.uses_beta');
    getProfile(unknownTarget).facts.push(fact('alpha', 'projection', {
        dataType: 'NUMBER', unit: 'mm', sourceId: 'alpha.relation_projection', authority: 'DERIVED',
        extra: { valueKind: 'RELATION_PROJECTION', relationProjection: { relationId: 'alpha.uses_beta', targetFactRef: related(['alpha.uses_beta'], 'beta.unknown') } },
    }));
    expectCode(unknownTarget, 'ONTOLOGY_V21_FACT_REF_INVALID');
    const mismatch = makeContract();
    mismatch.relations.push(relation());
    getProfile(mismatch).relationIds.push('alpha.uses_beta');
    getProfile(mismatch).facts.push(fact('alpha', 'projection', {
        dataType: 'STRING', sourceId: 'alpha.relation_projection', authority: 'DERIVED',
        extra: { valueKind: 'RELATION_PROJECTION', relationProjection: { relationId: 'alpha.uses_beta', targetFactRef: related(['alpha.uses_beta'], 'beta.value') } },
    }));
    expectCode(mismatch, 'ONTOLOGY_V21_RELATION_PROJECTION_INVALID');
    const pathMismatch = makeContract();
    pathMismatch.relations.push(relation());
    getProfile(pathMismatch).relationIds.push('alpha.uses_beta');
    getProfile(pathMismatch).facts[0].applicableWhen = { kind: 'FACT_EXISTS', factRef: related(['alpha.uses_beta', 'alpha.uses_beta'], 'beta.value') };
    expectCode(pathMismatch, 'ONTOLOGY_V21_CROSS_ENTITY_PATH_INVALID');
    const pathCycle = makeContract();
    pathCycle.relations.push(relation(), relation('beta.uses_alpha', {
        sourceEntityType: 'beta', target: { entityType: 'alpha', canonicalEndpointRequired: true }, sourceRef: sourceRef('beta.current', 'beta.alpha_id'),
    }));
    getProfile(pathCycle).relationIds.push('alpha.uses_beta');
    getProfile(pathCycle, 'beta').relationIds.push('beta.uses_alpha');
    getProfile(pathCycle).facts[0].applicableWhen = { kind: 'FACT_EXISTS', factRef: related(['alpha.uses_beta', 'beta.uses_alpha'], 'alpha.control') };
    expectCode(pathCycle, 'ONTOLOGY_V21_CROSS_ENTITY_PATH_INVALID');
});

test('relation projections bind the declared direct relation while generic RELATED derivations retain multi-hop paths', () => {
    const sameTargetMismatch = makeContract();
    sameTargetMismatch.relations.push(
        relation('alpha.uses_beta_primary'),
        relation('alpha.uses_beta_secondary')
    );
    getProfile(sameTargetMismatch).relationIds.push('alpha.uses_beta_primary', 'alpha.uses_beta_secondary');
    getProfile(sameTargetMismatch).facts.push(fact('alpha', 'projection', {
        dataType: 'NUMBER', unit: 'mm', sourceId: 'alpha.relation_projection', authority: 'DERIVED',
        extra: {
            valueKind: 'RELATION_PROJECTION',
            relationProjection: {
                relationId: 'alpha.uses_beta_primary',
                targetFactRef: related(['alpha.uses_beta_secondary'], 'beta.value'),
            },
        },
    }));
    expectCode(sameTargetMismatch, 'ONTOLOGY_V21_RELATION_PROJECTION_INVALID');

    const multiHopProjection = makeContract();
    multiHopProjection.sources.push(source('gamma.current'));
    multiHopProjection.profiles.push(profile('gamma', [fact('gamma', 'value', { dataType: 'NUMBER', unit: 'mm', businessRoles: ['FUNCTIONAL_TECHNICAL'] })]));
    multiHopProjection.relations.push(
        relation(),
        relation('beta.uses_gamma', {
            sourceEntityType: 'beta', target: { entityType: 'gamma', canonicalEndpointRequired: true }, sourceRef: sourceRef('beta.current', 'beta.gamma_id'),
        })
    );
    getProfile(multiHopProjection).relationIds.push('alpha.uses_beta');
    getProfile(multiHopProjection, 'beta').relationIds.push('beta.uses_gamma');
    getProfile(multiHopProjection).facts.push(fact('alpha', 'projection', {
        dataType: 'NUMBER', unit: 'mm', sourceId: 'alpha.relation_projection', authority: 'DERIVED',
        extra: {
            valueKind: 'RELATION_PROJECTION',
            relationProjection: { relationId: 'alpha.uses_beta', targetFactRef: related(['alpha.uses_beta', 'beta.uses_gamma'], 'gamma.value') },
        },
    }));
    expectCode(multiHopProjection, 'ONTOLOGY_V21_RELATION_PROJECTION_INVALID');

    const displayMismatch = makeContract();
    displayMismatch.relations.push(relation('alpha.uses_beta_primary'), relation('alpha.uses_beta_secondary'));
    getProfile(displayMismatch).relationIds.push('alpha.uses_beta_primary', 'alpha.uses_beta_secondary');
    getProfile(displayMismatch).facts.push(fact('alpha', 'projection', {
        dataType: 'NUMBER', unit: 'mm', sourceId: 'alpha.relation_projection', authority: 'DERIVED',
        extra: {
            valueKind: 'RELATION_PROJECTION',
            relationProjection: {
                relationId: 'alpha.uses_beta_primary',
                targetFactRef: related(['alpha.uses_beta_primary'], 'beta.value'),
                displayProjection: related(['alpha.uses_beta_secondary'], 'beta.label'),
            },
        },
    }));
    expectCode(displayMismatch, 'ONTOLOGY_V21_RELATION_PROJECTION_INVALID');

    const displayPositive = makeContract();
    displayPositive.relations.push(relation());
    getProfile(displayPositive).relationIds.push('alpha.uses_beta');
    getProfile(displayPositive).facts.push(fact('alpha', 'projection', {
        dataType: 'NUMBER', unit: 'mm', sourceId: 'alpha.relation_projection', authority: 'DERIVED',
        extra: {
            valueKind: 'RELATION_PROJECTION',
            relationProjection: {
                relationId: 'alpha.uses_beta',
                targetFactRef: related(['alpha.uses_beta'], 'beta.value'),
                displayProjection: related(['alpha.uses_beta'], 'beta.label'),
            },
        },
    }));
    assert.doesNotThrow(() => validateOntologyV21(displayPositive));

    const multiHopDerived = makeContract();
    multiHopDerived.sources.push(source('gamma.current'));
    multiHopDerived.profiles.push(profile('gamma', [fact('gamma', 'value', { dataType: 'NUMBER', unit: 'mm', businessRoles: ['FUNCTIONAL_TECHNICAL'] })]));
    multiHopDerived.relations.push(
        relation(),
        relation('beta.uses_gamma', {
            sourceEntityType: 'beta', target: { entityType: 'gamma', canonicalEndpointRequired: true }, sourceRef: sourceRef('beta.current', 'beta.gamma_id'),
        })
    );
    getProfile(multiHopDerived).relationIds.push('alpha.uses_beta');
    getProfile(multiHopDerived, 'beta').relationIds.push('beta.uses_gamma');
    addDerived(multiHopDerived, 'multiHopCopy', {
        operation: 'PROJECT_RELATED_FACT', inputs: [related(['alpha.uses_beta', 'beta.uses_gamma'], 'gamma.value')], sourceRef: sourceRef('alpha.derived'),
        missingInputPolicy: 'UNRESOLVED', materialization: 'COMPUTE_ON_READ',
    });
    assert.doesNotThrow(() => validateOntologyV21(multiHopDerived));
});

test('value kinds and derivation operations reject malformed or unsafe definitions', () => {
    const direct = makeContract();
    getProfile(direct).facts[0].derivation = {};
    expectCode(direct, 'ONTOLOGY_V21_FACT_VALUE_KIND_INVALID');
    const missing = makeContract();
    getProfile(missing).facts[0].valueKind = 'DERIVED';
    expectCode(missing, 'ONTOLOGY_V21_FACT_VALUE_KIND_INVALID');
    const authority = makeContract();
    getProfile(authority).facts[0].valueKind = 'DERIVED';
    getProfile(authority).facts[0].derivation = {};
    expectCode(authority, 'ONTOLOGY_V21_DERIVED_AUTHORITY_INVALID');
    const count = makeContract();
    addDerived(count, 'badCount', { operation: 'SUBTRACT', inputs: [local('alpha.amount')], sourceRef: sourceRef('alpha.derived'), missingInputPolicy: 'UNRESOLVED', materialization: 'COMPUTE_ON_READ' });
    expectCode(count, 'ONTOLOGY_V21_DERIVATION_INPUT_INVALID');
    const nonNumeric = makeContract();
    addDerived(nonNumeric, 'badType', { operation: 'SUBTRACT', inputs: [local('alpha.text'), local('alpha.offset')], sourceRef: sourceRef('alpha.derived'), missingInputPolicy: 'UNRESOLVED', materialization: 'COMPUTE_ON_READ' });
    expectCode(nonNumeric, 'ONTOLOGY_V21_DERIVATION_INPUT_INVALID');
    const units = makeContract();
    getProfile(units).facts.find(item => item.factId === 'alpha.offset').unit = 'cm';
    addDerived(units, 'badUnit', { operation: 'SUBTRACT', inputs: [local('alpha.amount'), local('alpha.offset')], sourceRef: sourceRef('alpha.derived'), missingInputPolicy: 'UNRESOLVED', materialization: 'COMPUTE_ON_READ' });
    expectCode(units, 'ONTOLOGY_V21_DERIVATION_INPUT_INVALID');
    const operation = makeContract();
    addDerived(operation, 'badOperation', { operation: 'ADD', inputs: [local('alpha.amount'), local('alpha.offset')], sourceRef: sourceRef('alpha.derived'), missingInputPolicy: 'UNRESOLVED', materialization: 'COMPUTE_ON_READ' });
    expectCode(operation, 'ONTOLOGY_V21_DERIVATION_OPERATION_FORBIDDEN');
});

test('derivation DAG catches self, two-node and three-node cycles', () => {
    const self = makeContract();
    addDerived(self, 'self', { operation: 'COPY', inputs: [local('alpha.self')], sourceRef: sourceRef('alpha.derived'), missingInputPolicy: 'UNRESOLVED', materialization: 'COMPUTE_ON_READ' });
    expectCode(self, 'ONTOLOGY_V21_DERIVATION_CYCLE');
    const two = makeContract();
    addDerived(two, 'one', { operation: 'COPY', inputs: [local('alpha.two')], sourceRef: sourceRef('alpha.derived'), missingInputPolicy: 'UNRESOLVED', materialization: 'COMPUTE_ON_READ' });
    addDerived(two, 'two', { operation: 'COPY', inputs: [local('alpha.one')], sourceRef: sourceRef('alpha.derived'), missingInputPolicy: 'UNRESOLVED', materialization: 'COMPUTE_ON_READ' });
    expectCode(two, 'ONTOLOGY_V21_DERIVATION_CYCLE');
    const three = makeContract();
    addDerived(three, 'one', { operation: 'COPY', inputs: [local('alpha.two')], sourceRef: sourceRef('alpha.derived'), missingInputPolicy: 'UNRESOLVED', materialization: 'COMPUTE_ON_READ' });
    addDerived(three, 'two', { operation: 'COPY', inputs: [local('alpha.three')], sourceRef: sourceRef('alpha.derived'), missingInputPolicy: 'UNRESOLVED', materialization: 'COMPUTE_ON_READ' });
    addDerived(three, 'three', { operation: 'COPY', inputs: [local('alpha.one')], sourceRef: sourceRef('alpha.derived'), missingInputPolicy: 'UNRESOLVED', materialization: 'COMPUTE_ON_READ' });
    expectCode(three, 'ONTOLOGY_V21_DERIVATION_CYCLE');
});

test('materialization and authority-source safety reject independent truth claims', () => {
    const missingCache = makeContract();
    addDerived(missingCache, 'cache', { operation: 'COPY', inputs: [local('alpha.amount')], sourceRef: sourceRef('alpha.derived'), missingInputPolicy: 'UNRESOLVED', materialization: 'MATERIALIZED_CACHE' });
    expectCode(missingCache, 'ONTOLOGY_V21_DERIVED_CACHE_INVALID');
    const neverCache = makeContract();
    addDerived(neverCache, 'cache', { operation: 'COPY', inputs: [local('alpha.amount')], sourceRef: sourceRef('alpha.derived'), missingInputPolicy: 'UNRESOLVED', materialization: 'NEVER_MATERIALIZE', cacheMetadata: validCacheMetadata([local('alpha.amount')]) });
    expectCode(neverCache, 'ONTOLOGY_V21_DERIVED_CACHE_INVALID');
    const compatibilityIdentity = makeContract();
    getProfile(compatibilityIdentity).facts.push(fact('alpha', 'legacyCode', { sourceId: 'alpha.compatibility', authority: 'TEMPORARY_NON_AUTHORITATIVE', extra: { directIdentityEvidence: true } }));
    expectCode(compatibilityIdentity, 'ONTOLOGY_V21_COMPATIBILITY_PRECEDENCE_INVALID');
    const compatibilitySelection = makeContract();
    getProfile(compatibilitySelection).facts.push(fact('alpha', 'legacySelection', { sourceId: 'alpha.compatibility', authority: 'TEMPORARY_NON_AUTHORITATIVE', extra: { candidateSelectionEvidence: true } }));
    expectCode(compatibilitySelection, 'ONTOLOGY_V21_COMPATIBILITY_PRECEDENCE_INVALID');
    const unresolved = makeContract();
    getProfile(unresolved).facts.push(fact('alpha', 'unknown', { sourceId: 'alpha.unresolved', authority: 'UNRESOLVED', sourceRef: sourceRef('alpha.unresolved', 'unknown', 'UNRESOLVED'), extra: { safeForDefaultSummary: true } }));
    expectCode(unresolved, 'ONTOLOGY_V2_UNRESOLVED_FACT_UNSAFE');
    const unresolvedAsResolved = makeContract();
    getProfile(unresolvedAsResolved).facts[0].sourceRef = sourceRef('alpha.unresolved', 'unknown', 'RESOLVED');
    getProfile(unresolvedAsResolved).facts[0].authority = 'UNRESOLVED';
    expectCode(unresolvedAsResolved, 'ONTOLOGY_V2_SOURCE_STATUS_INVALID');
    const knowledgeSource = makeContract();
    knowledgeSource.sources.push(source('alpha.knowledge_source', 'TEMPORARY_NON_AUTHORITATIVE', 'FORMAL_PROJECTION', 'KNOWLEDGE_METADATA', ['alpha.current']));
    getProfile(knowledgeSource).facts.push(fact('alpha', 'knowledgeAsPolicy', { sourceId: 'alpha.knowledge_source', authority: 'TEMPORARY_NON_AUTHORITATIVE', businessRoles: ['POLICY_INPUT'] }));
    expectCode(knowledgeSource, 'ONTOLOGY_V21_KNOWLEDGE_FUNCTIONAL_AUTHORITY_FORBIDDEN');
});

test('Technical Knowledge stays generic, owned and non-functional', () => {
    const functionalField = makeContract();
    functionalField.technicalKnowledgeTypes.push(knowledge());
    functionalField.technicalKnowledgeTypes[0].entrySchema.optionalFields.push('policyInput');
    expectCode(functionalField, 'ONTOLOGY_V21_KNOWLEDGE_FUNCTIONAL_AUTHORITY_FORBIDDEN');
    const ownerMismatch = makeContract();
    ownerMismatch.technicalKnowledgeTypes.push(knowledge('beta.technical_knowledge', 'beta'));
    getProfile(ownerMismatch).technicalKnowledge = { collectionId: 'beta.technical_knowledge' };
    expectCode(ownerMismatch, 'ONTOLOGY_V21_KNOWLEDGE_OWNER_INVALID');
    const fakePromotion = makeContract();
    getProfile(fakePromotion).facts[0].applicableWhen = { kind: 'FACT_EXISTS', factRef: local('knowledge.insulationClass') };
    expectCode(fakePromotion, 'ONTOLOGY_V21_FACT_REF_INVALID');
});

test('policies and executable declarations fail closed', () => {
    const duplicateRelation = makeContract();
    duplicateRelation.relations.push(relation());
    getProfile(duplicateRelation).relationIds.push('alpha.uses_beta', 'alpha.uses_beta');
    expectCode(duplicateRelation, 'ONTOLOGY_V21_PROFILE_FIELDS_INVALID');
    const unknownPolicy = makeContract();
    getProfile(unknownPolicy).policyIds.push('alpha.missing_policy');
    expectCode(unknownPolicy, 'ONTOLOGY_V21_POLICY_REFERENCE_INVALID');
    const nonDerivedId = makeContract();
    getProfile(nonDerivedId).derivedFactIds.push('alpha.amount');
    expectCode(nonDerivedId, 'ONTOLOGY_V21_DERIVED_FACT_IDS_INVALID');
    const functionPredicate = makeContract();
    getProfile(functionPredicate).facts[0].applicableWhen = () => true;
    expectCode(functionPredicate, 'ONTOLOGY_V21_EXECUTABLE_DECLARATION_FORBIDDEN');
});

test('validator remains generic and imports no business/runtime modules', () => {
    const validatorPath = path.join(__dirname, '..', 'api', 'ontology', 'v2_1', 'validator.cjs');
    const sourceText = fs.readFileSync(validatorPath, 'utf8');
    const forbiddenBranchPatterns = [
        /entityType\s*===\s*['"](?:recipe|part|coil)['"]/,
        /factId\s*===\s*['"][^'"]*(?:openOffset|isStainless|bearing)['"]/,
        /category\s*===\s*['"](?:泵壳|pump)/,
        /if\s*\([^)]*(?:recipes|parts|coils|bearing)/,
    ];
    forbiddenBranchPatterns.forEach(pattern => assert.doesNotMatch(sourceText, pattern));
    [
        /require\(['"][^'"]*\/db(?:\.cjs)?['"]\)/,
        /require\(['"][^'"]*services\//,
        /require\(['"][^'"]*costEngine/,
        /require\(['"][^'"]*recipeBomEngine/,
        /require\(['"][^'"]*routes\//,
        /require\(['"][^'"]*tools\.cjs['"]\)/,
    ].forEach(pattern => assert.doesNotMatch(sourceText, pattern));
});
