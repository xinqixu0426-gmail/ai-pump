'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ontologyV21 } = require('../api/ontology/v2_1/contract.cjs');
const { validateOntologyV21 } = require('../api/ontology/v2_1/validator.cjs');

function sourceRef(sourceId, path = 'synthetic.value', status = 'RESOLVED') {
    return { sourceId, path, status };
}

function source(sourceId, authority = 'CANONICAL_CURRENT', sourceKind = 'RAW_CURRENT_RESOURCE', provenancePurpose = 'CURRENT_RESOURCE', inputSourceIds = []) {
    return {
        sourceId,
        authority,
        sourceKind,
        provenancePurpose,
        inputSourceIds,
        sourceOfTruth: `Synthetic ${sourceId}`,
        readBoundary: 'TEST_ONLY_NO_RUNTIME',
        storesValueInOntology: false,
    };
}

function fact(entityType, name, options = {}) {
    const authority = options.authority || 'CANONICAL_CURRENT';
    return {
        factId: `${entityType}.${name}`,
        label: name,
        dataType: options.dataType || 'STRING',
        unit: options.unit === undefined ? null : options.unit,
        sourceRef: options.sourceRef || sourceRef(options.sourceId || `${entityType}.current`),
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

function related(relationPath, factId, targetExtensionId) {
    return targetExtensionId === undefined
        ? { scope: 'RELATED', relationPath, factId }
        : { scope: 'RELATED', relationPath, factId, targetExtensionId };
}

function relation(relationId, sourceEntityType, targetEntityType, sourceId) {
    return {
        relationId,
        sourceEntityType,
        target: { entityType: targetEntityType, canonicalEndpointRequired: true },
        direction: 'OUTBOUND',
        cardinality: 'EXACTLY_ONE',
        sourceRef: sourceRef(sourceId, `${sourceEntityType}.${relationId}`),
        runtimeEnabled: false,
    };
}

function designation(designationId, components) {
    return {
        designationId,
        label: designationId,
        components,
        expression: { operation: 'JOIN', separator: '-', nullPolicy: 'UNAVAILABLE_IF_ANY_COMPONENT_MISSING' },
        sourceRef: sourceRef('component.current', designationId),
        searchable: true,
        unique: false,
        collisionPolicy: 'ALLOWED',
        directIdentityEvidence: false,
        canonicalIdentity: false,
    };
}

function derivedFact(entityType, name, inputs, operation = 'SUBTRACT') {
    return fact(entityType, name, {
        dataType: 'NUMBER',
        unit: 'mm',
        sourceId: `${entityType}.derived`,
        authority: 'DERIVED',
        businessRoles: ['FUNCTIONAL_TECHNICAL'],
        extra: {
            valueKind: 'DERIVED',
            derivation: {
                operation,
                inputs,
                sourceRef: sourceRef(`${entityType}.derived`),
                missingInputPolicy: 'UNRESOLVED',
                materialization: 'COMPUTE_ON_READ',
            },
        },
    });
}

function getProfile(contract, entityType) {
    return contract.profiles.find(item => item.entityType === entityType);
}

function getExtension(contract, extensionId) {
    return contract.extensions.find(item => item.extensionId === extensionId);
}

function expectCode(contract, code) {
    assert.throws(() => validateOntologyV21(contract), error => error && error.code === code);
}

function makeSyntheticWorld({ includeExtensions = true } = {}) {
    const contract = structuredClone(ontologyV21);
    contract.sources.push(
        source('component.current'),
        source('assembly.current'),
        source('module.current'),
        source('reference_item.current'),
        source('component.derived', 'DERIVED', 'DECLARATIVE_DERIVATION'),
        source('assembly.derived', 'DERIVED', 'DECLARATIVE_DERIVATION'),
        source('component.relation_projection', 'DERIVED', 'FORMAL_PROJECTION', 'RELATION_PROJECTION', ['component.current', 'module.current']),
        source('component.compatibility', 'TEMPORARY_NON_AUTHORITATIVE', 'FORMAL_PROJECTION', 'COMPATIBILITY_ADAPTER', ['component.current']),
        source('component.preset', 'TEMPORARY_NON_AUTHORITATIVE', 'FORMAL_PROJECTION', 'PRESET_INITIALIZATION', ['component.current'])
    );

    const component = profile('component', [
        fact('component', 'category', { businessRoles: ['POLICY_INPUT'] }),
        fact('component', 'baseAmount', { dataType: 'NUMBER', unit: 'mm', businessRoles: ['FUNCTIONAL_TECHNICAL', 'POLICY_INPUT'] }),
    ]);
    component.designations.push(designation('component.baseDesignation', ['component.category']));
    const assembly = profile('assembly', [
        fact('assembly', 'enabled', { dataType: 'BOOLEAN', businessRoles: ['POLICY_INPUT'] }),
    ]);
    const module = profile('module', [
        fact('module', 'value', { dataType: 'NUMBER', unit: 'mm', businessRoles: ['FUNCTIONAL_TECHNICAL', 'POLICY_INPUT'] }),
        fact('module', 'label', { businessRoles: ['DISPLAY'] }),
    ]);
    const referenceItem = profile('reference_item', [
        fact('reference_item', 'value', { dataType: 'NUMBER', unit: 'mm', businessRoles: ['FUNCTIONAL_TECHNICAL', 'POLICY_INPUT'] }),
    ]);
    contract.profiles.push(component, assembly, module, referenceItem);

    contract.relations.push(
        relation('assembly.uses_component', 'assembly', 'component', 'assembly.current'),
        relation('component.uses_module', 'component', 'module', 'component.current'),
        relation('module.uses_reference_item', 'module', 'reference_item', 'module.current')
    );
    assembly.relationIds.push('assembly.uses_component');
    component.relationIds.push('component.uses_module');
    module.relationIds.push('module.uses_reference_item');

    assembly.facts.push(fact('assembly', 'componentPresent', {
        dataType: 'BOOLEAN',
        businessRoles: ['DESCRIPTIVE'],
        extra: {
            requiredWhen: { kind: 'FACT_EXISTS', factRef: related(['assembly.uses_component'], 'component.category') },
        },
    }));
    assembly.facts.push(derivedFact('assembly', 'moduleValue', [related(['assembly.uses_component', 'component.uses_module'], 'module.value')], 'PROJECT_RELATED_FACT'));
    assembly.derivedFactIds.push('assembly.moduleValue');
    const cachedModuleValue = derivedFact('assembly', 'cachedModuleValue', [related(['assembly.uses_component', 'component.uses_module'], 'module.value')], 'PROJECT_RELATED_FACT');
    cachedModuleValue.derivation.materialization = 'MATERIALIZED_CACHE';
    cachedModuleValue.derivation.cacheMetadata = {
        inputRefs: [related(['assembly.uses_component', 'component.uses_module'], 'module.value')],
        sourceRefs: [sourceRef('assembly.current')],
        freshness: 'ON_INPUT_CHANGE',
        contractVersion: '2.1',
        calculationVersion: 'synthetic-v1',
        invalidation: 'INPUT_SOURCE_VERSION_CHANGE',
    };
    assembly.facts.push(cachedModuleValue);
    assembly.derivedFactIds.push('assembly.cachedModuleValue');

    if (!includeExtensions) return contract;

    contract.relations.push(
        relation('component.extension_uses_module_a', 'component', 'module', 'component.current'),
        relation('component.extension_uses_module_b', 'component', 'module', 'component.current')
    );

    const extensionA = {
        extensionId: 'component.feature_a',
        baseEntityType: 'component',
        applicability: { kind: 'FACT_EQUALS', factRef: local('component.category'), value: 'A' },
        facts: [
            fact('component', 'aGate', { dataType: 'BOOLEAN', businessRoles: ['POLICY_INPUT'] }),
            fact('component', 'aDelta', { dataType: 'NUMBER', unit: 'mm', businessRoles: ['FUNCTIONAL_TECHNICAL', 'POLICY_INPUT'] }),
            derivedFact('component', 'aDerived', [local('component.baseAmount'), local('component.aDelta')]),
            fact('component', 'aProjectedValue', {
                dataType: 'NUMBER',
                unit: 'mm',
                sourceId: 'component.relation_projection',
                authority: 'DERIVED',
                businessRoles: ['FUNCTIONAL_TECHNICAL'],
                extra: {
                    valueKind: 'RELATION_PROJECTION',
                    relationProjection: {
                        relationId: 'component.extension_uses_module_a',
                        targetFactRef: related(['component.extension_uses_module_a'], 'module.value'),
                    },
                },
            }),
            fact('component', 'aConditional', {
                businessRoles: ['DESCRIPTIVE'],
                extra: { requiredWhen: { kind: 'FACT_EXISTS', factRef: local('component.aGate') } },
            }),
        ],
        designations: [designation('component.aDesignation', ['component.category', 'component.aGate'])],
        relationIds: ['component.extension_uses_module_a'],
        policyIds: ['component.a_policy'],
        technicalKnowledge: { collectionId: 'component.technical_knowledge' },
        runtimeEnabled: false,
    };
    const extensionB = {
        extensionId: 'component.feature_b',
        baseEntityType: 'component',
        applicability: { kind: 'FACT_EQUALS', factRef: local('component.category'), value: 'B' },
        facts: [fact('component', 'bGate', { dataType: 'BOOLEAN', businessRoles: ['POLICY_INPUT'] })],
        designations: [designation('component.bDesignation', ['component.category', 'component.bGate'])],
        relationIds: ['component.extension_uses_module_b'],
        policyIds: [],
        technicalKnowledge: null,
        runtimeEnabled: false,
    };
    contract.extensions.push(extensionA, extensionB);
    contract.policies.push({
        policyId: 'component.a_policy',
        ownerEntityType: 'component',
        applicableWhen: { kind: 'FACT_EXISTS', factRef: local('component.aGate') },
        factRefs: [local('component.aGate')],
        relationIds: ['component.extension_uses_module_a'],
        rules: [],
        runtimeEnabled: false,
    });
    contract.technicalKnowledgeTypes.push({
        collectionId: 'component.technical_knowledge',
        ownerEntityType: 'component',
        entrySchema: {
            requiredFields: ['key', 'label', 'value'],
            optionalFields: ['unit', 'valueType', 'sourceRef', 'updatedAt', 'version', 'evidenceRelationIds'],
        },
        allowsArbitraryKeys: true,
        searchable: true,
        aiReadable: true,
        defaultClassification: 'TECHNICAL_KNOWLEDGE',
        runtimeEnabled: false,
    });
    component.technicalKnowledge = { collectionId: 'component.technical_knowledge' };

    const qualifiedAGate = derivedFact(
        'assembly',
        'qualifiedAGate',
        [related(['assembly.uses_component'], 'component.aGate', 'component.feature_a')],
        'PROJECT_RELATED_FACT'
    );
    qualifiedAGate.dataType = 'BOOLEAN';
    qualifiedAGate.unit = null;
    assembly.facts.push(qualifiedAGate);
    assembly.derivedFactIds.push('assembly.qualifiedAGate');
    assembly.facts.push(fact('assembly', 'qualifiedACondition', {
        dataType: 'BOOLEAN',
        businessRoles: ['DESCRIPTIVE'],
        extra: {
            requiredWhen: {
                kind: 'FACT_EXISTS',
                factRef: related(['assembly.uses_component'], 'component.aGate', 'component.feature_a'),
            },
        },
    }));
    return contract;
}

test('baseline Coil lift, synthetic Base-only world, independent extensions and full composition validate', () => {
    assert.doesNotThrow(() => validateOntologyV21(ontologyV21));
    assert.doesNotThrow(() => validateOntologyV21(makeSyntheticWorld({ includeExtensions: false })));
    const result = validateOntologyV21(makeSyntheticWorld());
    assert.equal(result.extensionCount, 3);
    assert.equal(result.relationCount, 6);
    assert.equal(result.policyCount, 1);
    assert.equal(result.technicalKnowledgeTypeCount, 1);
});

test('Base and one Extension see Base facts, while an Extension sees only its own added facts', () => {
    const oneExtension = makeSyntheticWorld();
    oneExtension.extensions = [getExtension(oneExtension, 'component.feature_a')];
    oneExtension.relations = oneExtension.relations.filter(item => item.relationId !== 'component.extension_uses_module_b');
    assert.doesNotThrow(() => validateOntologyV21(oneExtension));
    assert.doesNotThrow(() => validateOntologyV21(makeSyntheticWorld()));
});

test('extension applicability bootstraps from the Base surface only', () => {
    const self = makeSyntheticWorld();
    getExtension(self, 'component.feature_a').applicability = { kind: 'FACT_EXISTS', factRef: local('component.aGate') };
    expectCode(self, 'ONTOLOGY_V21_FACT_REF_INVALID');

    const sibling = makeSyntheticWorld();
    getExtension(sibling, 'component.feature_b').applicability = { kind: 'FACT_EXISTS', factRef: local('component.aGate') };
    expectCode(sibling, 'ONTOLOGY_V21_FACT_REF_INVALID');
});

test('Base declarations cannot leak into extension-only facts, relations or policies', () => {
    const condition = makeSyntheticWorld();
    getProfile(condition, 'component').facts[0].requiredWhen = { kind: 'FACT_EXISTS', factRef: local('component.aGate') };
    expectCode(condition, 'ONTOLOGY_V21_FACT_REF_INVALID');

    const derivation = makeSyntheticWorld();
    const base = getProfile(derivation, 'component');
    base.facts.push(derivedFact('component', 'baseLeak', [local('component.aDelta')], 'COPY'));
    base.derivedFactIds.push('component.baseLeak');
    expectCode(derivation, 'ONTOLOGY_V21_FACT_REF_INVALID');

    const policy = makeSyntheticWorld();
    policy.policies.push({ policyId: 'component.base_policy', ownerEntityType: 'component', factRefs: [local('component.aGate')], relationIds: [], rules: [], runtimeEnabled: false });
    getProfile(policy, 'component').policyIds.push('component.base_policy');
    expectCode(policy, 'ONTOLOGY_V21_FACT_REF_INVALID');

    const relationUse = makeSyntheticWorld();
    const baseProjection = fact('component', 'baseProjection', {
        dataType: 'NUMBER', unit: 'mm', sourceId: 'component.relation_projection', authority: 'DERIVED',
        businessRoles: ['FUNCTIONAL_TECHNICAL'],
        extra: { valueKind: 'RELATION_PROJECTION', relationProjection: { relationId: 'component.extension_uses_module_a', targetFactRef: related(['component.extension_uses_module_a'], 'module.value') } },
    });
    getProfile(relationUse, 'component').facts.push(baseProjection);
    expectCode(relationUse, 'ONTOLOGY_V21_EXTENSION_SCOPE_INVALID');
});

test('sibling extensions cannot read each other’s facts, policies or relations', () => {
    const condition = makeSyntheticWorld();
    getExtension(condition, 'component.feature_a').facts.find(item => item.factId === 'component.aConditional').requiredWhen = { kind: 'FACT_EXISTS', factRef: local('component.bGate') };
    expectCode(condition, 'ONTOLOGY_V21_FACT_REF_INVALID');

    const derivation = makeSyntheticWorld();
    getExtension(derivation, 'component.feature_a').facts.find(item => item.factId === 'component.aDerived').derivation.inputs = [local('component.baseAmount'), local('component.bGate')];
    expectCode(derivation, 'ONTOLOGY_V21_FACT_REF_INVALID');

    const policy = makeSyntheticWorld();
    policy.policies[0].factRefs = [local('component.bGate')];
    expectCode(policy, 'ONTOLOGY_V21_FACT_REF_INVALID');

    const relationUse = makeSyntheticWorld();
    const projection = getExtension(relationUse, 'component.feature_a').facts.find(item => item.factId === 'component.aProjectedValue');
    projection.relationProjection.relationId = 'component.extension_uses_module_b';
    projection.relationProjection.targetFactRef = related(['component.extension_uses_module_b'], 'module.value');
    expectCode(relationUse, 'ONTOLOGY_V21_EXTENSION_SCOPE_INVALID');
});

test('RELATED references qualify terminal extension facts and reject absent, wrong or base qualifiers', () => {
    const unqualified = makeSyntheticWorld();
    const derived = getProfile(unqualified, 'assembly').facts.find(item => item.factId === 'assembly.qualifiedAGate');
    derived.derivation.inputs = [related(['assembly.uses_component'], 'component.aGate')];
    expectCode(unqualified, 'ONTOLOGY_V21_FACT_REF_INVALID');

    const wrong = makeSyntheticWorld();
    const wrongDerived = getProfile(wrong, 'assembly').facts.find(item => item.factId === 'assembly.qualifiedAGate');
    wrongDerived.derivation.inputs = [related(['assembly.uses_component'], 'component.aGate', 'component.feature_b')];
    expectCode(wrong, 'ONTOLOGY_V21_FACT_REF_INVALID');

    const wrongType = makeSyntheticWorld();
    const wrongTypeDerived = getProfile(wrongType, 'assembly').facts.find(item => item.factId === 'assembly.qualifiedAGate');
    wrongTypeDerived.derivation.inputs = [related(['assembly.uses_component'], 'component.aGate', 'module.not_an_extension')];
    expectCode(wrongType, 'ONTOLOGY_V21_FACT_REF_INVALID');

    const baseQualifier = makeSyntheticWorld();
    const baseDerived = getProfile(baseQualifier, 'assembly').facts.find(item => item.factId === 'assembly.moduleValue');
    baseDerived.derivation.inputs = [related(['assembly.uses_component', 'component.uses_module'], 'module.value', 'component.feature_a')];
    expectCode(baseQualifier, 'ONTOLOGY_V21_FACT_REF_INVALID');
});

test('extension designation ownership and collision rules remain isolated and fail closed', () => {
    const siblingDesignation = makeSyntheticWorld();
    getExtension(siblingDesignation, 'component.feature_b').designations[0].components = ['component.category', 'component.aGate'];
    assert.throws(() => validateOntologyV21(siblingDesignation));

    const baseDesignation = makeSyntheticWorld();
    getProfile(baseDesignation, 'component').designations[0].components = ['component.aGate'];
    assert.throws(() => validateOntologyV21(baseDesignation));

    const factCollision = makeSyntheticWorld();
    getExtension(factCollision, 'component.feature_b').facts = [fact('component', 'aGate', { dataType: 'BOOLEAN', businessRoles: ['POLICY_INPUT'] })];
    expectCode(factCollision, 'ONTOLOGY_V21_COMPOSITION_COLLISION');

    const designationCollision = makeSyntheticWorld();
    getExtension(designationCollision, 'component.feature_b').designations[0].designationId = 'component.aDesignation';
    expectCode(designationCollision, 'ONTOLOGY_V21_COMPOSITION_COLLISION');
});

test('one-hop Relation Projection stays bound while generic Base-owned RELATED paths remain multi-hop', () => {
    const substitution = makeSyntheticWorld();
    substitution.relations.push(relation('component.uses_module_alternate', 'component', 'module', 'component.current'));
    getProfile(substitution, 'component').relationIds.push('component.uses_module_alternate');
    const projection = getExtension(substitution, 'component.feature_a').facts.find(item => item.factId === 'component.aProjectedValue');
    projection.relationProjection.targetFactRef = related(['component.uses_module_alternate'], 'module.value');
    expectCode(substitution, 'ONTOLOGY_V21_RELATION_PROJECTION_INVALID');

    const multiHop = makeSyntheticWorld();
    const multiHopProjection = getExtension(multiHop, 'component.feature_a').facts.find(item => item.factId === 'component.aProjectedValue');
    multiHopProjection.relationProjection.targetFactRef = related(['component.extension_uses_module_a', 'module.uses_reference_item'], 'reference_item.value');
    expectCode(multiHop, 'ONTOLOGY_V21_RELATION_PROJECTION_INVALID');

    assert.doesNotThrow(() => validateOntologyV21(makeSyntheticWorld()));
});

test('a RELATED path cannot traverse a conditional relation without that extension surface', () => {
    const contract = makeSyntheticWorld();
    const assembly = getProfile(contract, 'assembly');
    assembly.facts.push(derivedFact('assembly', 'invalidConditionalTraversal', [related(['assembly.uses_component', 'component.extension_uses_module_a'], 'module.value')], 'PROJECT_RELATED_FACT'));
    assembly.derivedFactIds.push('assembly.invalidConditionalTraversal');
    expectCode(contract, 'ONTOLOGY_V21_EXTENSION_SCOPE_INVALID');
});

test('derivations compose on one extension surface and derivation cycles remain fail closed', () => {
    const valid = makeSyntheticWorld();
    assert.doesNotThrow(() => validateOntologyV21(valid));

    const cycle = makeSyntheticWorld();
    const extension = getExtension(cycle, 'component.feature_a');
    extension.facts.push(derivedFact('component', 'aCycle', [local('component.aDerived')], 'COPY'));
    const aDerived = extension.facts.find(item => item.factId === 'component.aDerived');
    aDerived.derivation.operation = 'COPY';
    aDerived.derivation.inputs = [local('component.aCycle')];
    expectCode(cycle, 'ONTOLOGY_V21_DERIVATION_CYCLE');
});

test('Technical Knowledge stays arbitrary and cannot be promoted through FactRef, predicate or derivation syntax', () => {
    const contract = makeSyntheticWorld();
    const arbitraryEntries = ['insulation_note', 'temporary_measurement', 'customer_comment', 'test_condition'];
    assert.equal(contract.technicalKnowledgeTypes[0].allowsArbitraryKeys, true);
    assert.equal(arbitraryEntries.every(key => !contract.profiles.some(profileItem => profileItem.facts.some(item => item.factId.endsWith(`.${key}`)))), true);
    assert.doesNotThrow(() => validateOntologyV21(contract));

    const factRef = makeSyntheticWorld();
    getProfile(factRef, 'component').facts[0].requiredWhen = { kind: 'FACT_EXISTS', factRef: local('component.insulation_note') };
    expectCode(factRef, 'ONTOLOGY_V21_FACT_REF_INVALID');

    const predicate = makeSyntheticWorld();
    getExtension(predicate, 'component.feature_a').applicability = { kind: 'FACT_EXISTS', factRef: local('component.temporary_measurement') };
    expectCode(predicate, 'ONTOLOGY_V21_FACT_REF_INVALID');

    const derivation = makeSyntheticWorld();
    getExtension(derivation, 'component.feature_a').facts.find(item => item.factId === 'component.aDerived').derivation.inputs = [local('component.baseAmount'), local('component.customer_comment')];
    expectCode(derivation, 'ONTOLOGY_V21_FACT_REF_INVALID');
});

test('compatibility and preset declarations remain non-authoritative under composition', () => {
    const compatibility = makeSyntheticWorld();
    getExtension(compatibility, 'component.feature_a').facts[0] = fact('component', 'aGate', {
        dataType: 'BOOLEAN', sourceId: 'component.compatibility', authority: 'TEMPORARY_NON_AUTHORITATIVE',
        businessRoles: ['POLICY_INPUT'], extra: { directIdentityEvidence: true },
    });
    expectCode(compatibility, 'ONTOLOGY_V21_COMPATIBILITY_PRECEDENCE_INVALID');

    const compatibilityRelation = makeSyntheticWorld();
    compatibilityRelation.relations.find(item => item.relationId === 'component.uses_module').sourceRef = sourceRef('component.compatibility');
    expectCode(compatibilityRelation, 'ONTOLOGY_V21_RELATION_ENDPOINT_INVALID');

    const preset = makeSyntheticWorld();
    getExtension(preset, 'component.feature_a').facts[0] = fact('component', 'aGate', {
        dataType: 'BOOLEAN', sourceId: 'component.preset', authority: 'CANONICAL_CURRENT', businessRoles: ['POLICY_INPUT'],
    });
    expectCode(preset, 'ONTOLOGY_V2_FACT_AUTHORITY_INVALID');
});

test('nested runtime and executable declarations remain rejected, and the validator has no real-entity branches', () => {
    const runtime = makeSyntheticWorld();
    getExtension(runtime, 'component.feature_a').runtimeEnabled = true;
    expectCode(runtime, 'ONTOLOGY_V21_RUNTIME_ISOLATION_REQUIRED');

    const executable = makeSyntheticWorld();
    executable.policies[0].rules = [() => true];
    expectCode(executable, 'ONTOLOGY_V21_EXECUTABLE_DECLARATION_FORBIDDEN');

    const validator = require('fs').readFileSync(require('path').join(__dirname, '../api/ontology/v2_1/validator.cjs'), 'utf8');
    assert.doesNotMatch(validator, /entityType\s*={2,3}\s*['"](?:recipe|part|coil)['"]/i);
    assert.doesNotMatch(validator, /factId\s*={2,3}\s*['"][^'"]*(?:openOffset|isStainless|bearing)[^'"]*['"]/i);
});
