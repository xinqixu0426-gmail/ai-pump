'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ontologyV2 } = require('../api/ontology/v2/contract.cjs');
const { validateOntologyV2 } = require('../api/ontology/v2/validator.cjs');
const { coilProfile } = require('../api/ontology/v2/entities/coil.cjs');
const {
    ontologyV21,
    OntologyV21ContractRevision,
    SourceAuthority,
    SourceKind,
    ProvenancePurpose,
    FactValueKind,
    RelationCardinality,
    FactRefScope,
    PredicateKind,
    DerivationOperation,
    MaterializationPolicy,
    roleCatalogV21,
    technicalKnowledgeEntrySchema,
    V21Schema,
    defineV21Source,
    defineV21ExtensionProfile,
    defineV21TechnicalKnowledgeCollection,
} = require('../api/ontology/v2_1/index.cjs');

function v21CoilProfile() {
    return ontologyV21.profiles.find(profile => profile.entityType === 'coil');
}

test('V2.1 loading leaves the frozen V2 Coil contract and validator behavior unchanged', () => {
    const v2Before = JSON.stringify(ontologyV2);
    assert.deepEqual(validateOntologyV2(ontologyV2), {
        version: 2, sourceCount: 7, profileCount: 1, factCount: 28, designationCount: 1, runtimeEnabled: false,
    });
    assert.equal(JSON.stringify(ontologyV2), v2Before);
    assert.equal(ontologyV2.profiles[0], coilProfile);
    assert.equal('contractRevision' in ontologyV2, false);
});

test('V2.1 is an immutable, separately addressed contract-only lift', () => {
    assert.equal(ontologyV21.version, 2);
    assert.equal(ontologyV21.contractRevision, OntologyV21ContractRevision);
    assert.equal(ontologyV21.runtimeEnabled, false);
    assert.equal(ontologyV21.storesBusinessValues, false);
    assert.equal(ontologyV21.isBusinessSourceOfTruth, false);
    assert.equal(ontologyV21.access, 'CONTRACT_ONLY_NO_RUNTIME');
    assert.equal(Object.isFrozen(ontologyV21), true);
    assert.deepEqual(ontologyV21.extensions, []);
    assert.deepEqual(ontologyV21.relations, []);
    assert.deepEqual(ontologyV21.policies, []);
    assert.deepEqual(ontologyV21.technicalKnowledgeTypes, []);
});

test('V2 Coil is lifted additively with empty optional V2.1 capabilities', () => {
    const lifted = v21CoilProfile();
    assert.notEqual(lifted, coilProfile);
    assert.equal(lifted.facts, coilProfile.facts);
    assert.equal(lifted.designations, coilProfile.designations);
    assert.equal(lifted.selectionPolicy, coilProfile.selectionPolicy);
    assert.deepEqual(lifted.relationIds, []);
    assert.deepEqual(lifted.derivedFactIds, []);
    assert.deepEqual(lifted.policyIds, []);
    assert.equal(lifted.technicalKnowledge, null);
    assert.equal(Object.isFrozen(lifted), true);
    assert.equal('relationIds' in coilProfile, false);
    assert.equal('derivedFactIds' in coilProfile, false);
    assert.equal('policyIds' in coilProfile, false);
    assert.equal('technicalKnowledge' in coilProfile, false);
});

test('V2.1 adds only the approved declarative role and provenance-purpose vocabulary', () => {
    const roleIds = roleCatalogV21.map(role => role.roleId);
    ['FUNCTIONAL_TECHNICAL', 'TECHNICAL_KNOWLEDGE', 'POLICY_INPUT'].forEach(roleId => assert.ok(roleIds.includes(roleId), roleId));
    assert.ok(roleIds.includes('COST_INPUT'));
    assert.equal(roleIds.includes('RELATION_BACKED'), false);
    assert.equal(Object.isFrozen(roleCatalogV21), true);
    assert.deepEqual(Object.values(ProvenancePurpose), [
        'CURRENT_RESOURCE', 'RELATION_PROJECTION', 'PRESET_INITIALIZATION', 'COMPATIBILITY_ADAPTER', 'KNOWLEDGE_METADATA',
    ]);
    ontologyV21.sources.forEach(source => {
        assert.equal(source.provenancePurpose, ProvenancePurpose.CURRENT_RESOURCE);
        assert.ok(ontologyV2.sources.some(v2Source => v2Source.sourceId === source.sourceId));
    });
});

test('V2.1 exposes the approved generic declaration catalogs without an evaluator', () => {
    assert.deepEqual(Object.values(FactValueKind), ['DIRECT', 'RELATION_PROJECTION', 'DERIVED']);
    assert.deepEqual(Object.values(RelationCardinality), ['ZERO_OR_ONE', 'EXACTLY_ONE', 'ZERO_OR_MANY', 'ONE_OR_MANY']);
    assert.deepEqual(Object.values(FactRefScope), ['LOCAL', 'RELATED']);
    assert.deepEqual(Object.values(PredicateKind), ['FACT_EQUALS', 'FACT_EXISTS', 'RELATION_EXISTS', 'ALL_OF']);
    assert.deepEqual(Object.values(DerivationOperation), ['COPY', 'SUBTRACT', 'PROJECT_RELATED_FACT']);
    assert.deepEqual(Object.values(MaterializationPolicy), ['COMPUTE_ON_READ', 'MATERIALIZED_CACHE', 'NEVER_MATERIALIZE']);
    assert.ok(V21Schema.source.includes('provenancePurpose'));
    assert.ok(V21Schema.factOptional.includes('derivation'));
    assert.ok(V21Schema.extensionProfile.includes('runtimeEnabled'));
    assert.ok(V21Schema.policy.includes('relationIds'));
    assert.equal(SourceAuthority.UNRESOLVED, 'UNRESOLVED');
    assert.equal(SourceKind.FORMAL_PROJECTION, 'FORMAL_PROJECTION');
});

test('Technical Knowledge is structurally generic and extension definitions cannot own identity', () => {
    const knowledge = defineV21TechnicalKnowledgeCollection({
        collectionId: 'synthetic.technical_knowledge',
        ownerEntityType: 'synthetic',
        entrySchema: technicalKnowledgeEntrySchema,
        allowsArbitraryKeys: true,
        searchable: true,
        aiReadable: true,
    });
    assert.equal(knowledge.allowsArbitraryKeys, true);
    assert.equal(knowledge.defaultClassification, 'TECHNICAL_KNOWLEDGE');
    assert.equal(knowledge.runtimeEnabled, false);
    assert.deepEqual(knowledge.entrySchema.requiredFields, ['key', 'label', 'value']);
    assert.equal(knowledge.entrySchema.requiredFields.includes('syntheticInsulationClass'), false);

    const extension = defineV21ExtensionProfile({
        extensionId: 'synthetic.extension',
        baseEntityType: 'synthetic',
        identity: { canonicalId: 'must_not_escape_into_contract' },
        applicability: { kind: 'FACT_EXISTS', factRef: { scope: 'LOCAL', factId: 'synthetic.category' } },
        facts: [],
        designations: [],
        relationIds: [],
        policyIds: [],
        technicalKnowledge: null,
    });
    assert.equal('identity' in extension, false);
    assert.equal(extension.runtimeEnabled, false);

    const source = defineV21Source({
        sourceId: 'synthetic.current', authority: 'CANONICAL_CURRENT', sourceKind: 'RAW_CURRENT_RESOURCE',
        provenancePurpose: 'CURRENT_RESOURCE', inputSourceIds: [], sourceOfTruth: 'Synthetic declaration only',
        readBoundary: 'TEST_ONLY_NO_RUNTIME', storesValueInOntology: true,
    });
    assert.equal(source.storesValueInOntology, false);
});

test('V2.1 contract modules import only pure ontology declarations', () => {
    const directory = path.join(__dirname, '..', 'api', 'ontology', 'v2_1');
    const prohibitedImports = [
        /require\(['"][^'"]*\/db(?:\.cjs)?['"]\)/,
        /require\(['"][^'"]*services\//,
        /require\(['"][^'"]*costEngine/,
        /require\(['"][^'"]*recipeBomEngine/,
        /require\(['"][^'"]*tools\.cjs['"]\)/,
        /require\(['"][^'"]*routes\//,
    ];
    fs.readdirSync(directory).filter(file => file.endsWith('.cjs')).forEach(file => {
        const content = fs.readFileSync(path.join(directory, file), 'utf8');
        prohibitedImports.forEach(pattern => assert.doesNotMatch(content, pattern, file));
    });
});
