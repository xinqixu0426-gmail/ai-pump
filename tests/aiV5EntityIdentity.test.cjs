'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createV5Task } = require('../api/services/ai-v5/contracts.cjs');
const {
    V5_BUSINESS_ONTOLOGY_VERSION,
    V5_ENTITY_TYPE_REGISTRY,
    auditOntologyConsistency,
    getV5EntityType,
    listV5EntityTypes,
    validateBusinessOntology,
    validateCapabilityOntologyReferences,
    validateEntityTypeDefinition,
} = require('../api/services/ai-v5/businessOntology.cjs');
const {
    createV5EntityIdentity,
    detectIdentityTransformation,
    detectUntrackedIdentityLoss,
    shapeOf,
    validateResolverInputIdentity,
    validateV5EntityIdentity,
} = require('../api/services/ai-v5/entityIdentity.cjs');
const {
    V5_RESOLVER_INPUT_POLICIES,
    resolveV5EntityIdentity,
} = require('../api/services/ai-v5/entityResolverAdapter.cjs');
const {
    evaluateExactIdentityCases,
    evaluateFlatBladeIdentityCases,
    evaluateP06IdentityCorpus,
} = require('../api/services/ai-v5/entityShadowEvaluation.cjs');
const p06Cases = require('../docs/ai-observability/data/p06-failure-cases.json');

const NOW = '2026-01-01T00:00:00.000Z';

function unresolved(overrides = {}) {
    return createV5EntityIdentity({
        version: 1,
        entityType: 'recipe',
        rawMention: 'v750-tokoy-',
        normalizedMention: 'v750-tokoy',
        canonicalEntityId: null,
        canonicalBusinessKey: null,
        resolutionStatus: 'UNRESOLVED',
        matchType: 'NOT_RESOLVED',
        source: 'TASK_BOUNDARY',
        resolverPath: null,
        ...overrides,
    });
}

function ontologyDefinition(overrides = {}) {
    return {
        version: 1,
        entityType: 'test_entity',
        canonicalIdKind: 'DATABASE_PRIMARY_KEY',
        identitySource: 'database:test.id',
        displayNameSource: 'database:test.name',
        aliasSupport: false,
        normalizationPolicyId: 'NONE',
        resolverAdapter: 'NOT_AVAILABLE',
        ...overrides,
    };
}

test('ontology V1 is versioned, validated, immutable and grounded', () => {
    assert.equal(V5_BUSINESS_ONTOLOGY_VERSION, 1);
    assert.equal(validateBusinessOntology(), true);
    assert.equal(listV5EntityTypes().length, 19);
    assert.equal(Object.isFrozen(V5_ENTITY_TYPE_REGISTRY), true);
    for (const definition of listV5EntityTypes()) {
        assert.equal(typeof definition.identitySource, 'string');
        assert.notEqual(definition.identitySource, '');
    }
});

test('ontology rejects unknown version, duplicate types, missing identity source and invalid adapter', () => {
    assert.throws(() => validateEntityTypeDefinition(ontologyDefinition({ version: 2 })), /Unsupported ontology version/);
    assert.throws(() => validateBusinessOntology([ontologyDefinition(), ontologyDefinition()]), /Duplicate entity type/);
    assert.throws(() => validateEntityTypeDefinition(ontologyDefinition({ identitySource: '' })), /identitySource/);
    assert.throws(() => validateEntityTypeDefinition(ontologyDefinition({ resolverAdapter: 'MAGIC' })), /resolverAdapter/);
});

test('all V5-B capability entity references exist and unknown references are rejected', () => {
    const check = validateCapabilityOntologyReferences();
    assert.equal(check.valid, true);
    assert.deepEqual(check.unknown, []);
    const bad = validateCapabilityOntologyReferences([{ requiredEntityTypes: ['missing_entity'] }]);
    assert.equal(bad.valid, false);
    assert.deepEqual(bad.unknown, ['missing_entity']);
});

test('ontology consistency explicitly separates supported and unsupported resolver types', () => {
    const audit = auditOntologyConsistency();
    assert.deepEqual(audit.missing, []);
    assert.deepEqual(audit.legacyOnly, []);
    assert.deepEqual(audit.resolverSupported, ['coil', 'customer', 'order', 'part', 'recipe', 'template']);
    assert.equal(audit.unsupported.includes('global'), true);
    assert.equal(getV5EntityType('global').identitySource, 'NOT_AVAILABLE');
});

test('punctuation and numeric-like regression set preserves raw mention exactly', () => {
    const mentions = ['v750-tokoy-', 'V750-A', 'abc-', '-a-', 'a/b', 'a.b', 'a_b', 'a+b', '800平刀', '800', '"800"'];
    for (const rawMention of mentions) {
        const identity = unresolved({ rawMention, normalizedMention: null });
        assert.equal(identity.rawMention, rawMention);
        assert.equal(typeof identity.rawMention, 'string');
    }
});

test('normalized mention remains separate and raw case/punctuation cannot be overwritten', () => {
    const identity = unresolved({ rawMention: 'V750-A', normalizedMention: 'v750-a' });
    assert.equal(identity.rawMention, 'V750-A');
    assert.equal(identity.normalizedMention, 'v750-a');
    assert.equal(identity.identityPreservationStatus, 'TRANSFORMED_TRACKED');
    assert.equal(Object.isFrozen(identity), true);
});

test('numeric value is not silently coerced into numeric-like raw identity', () => {
    assert.throws(() => unresolved({ rawMention: 800, normalizedMention: null }), /never coerced/);
    assert.equal(unresolved({ rawMention: '800', normalizedMention: null }).rawMention, '800');
});

test('canonical ID and display name are never inferred from mention fields', () => {
    const identity = unresolved({ displayName: 'Displayed Recipe' });
    assert.equal(identity.canonicalEntityId, null);
    assert.equal(identity.canonicalBusinessKey, null);
    assert.equal(identity.displayName, 'Displayed Recipe');
    assert.throws(() => createV5EntityIdentity({
        ...identity,
        canonicalEntityId: identity.normalizedMention,
        resolutionStatus: 'RESOLVED',
        matchType: 'EXACT',
        source: 'NORMALIZATION',
        resolverPath: 'normalizer',
    }), /trusted formal source/);
});

test('ambiguous and not-found identities cannot contain fabricated canonical IDs', () => {
    for (const resolutionStatus of ['AMBIGUOUS', 'NOT_FOUND']) {
        assert.throws(() => createV5EntityIdentity({
            ...unresolved(),
            canonicalEntityId: 99,
            resolutionStatus,
            matchType: resolutionStatus === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'NOT_FOUND',
        }), /cannot contain a fabricated canonical identity/);
    }
    assert.throws(() => createV5EntityIdentity({
        ...unresolved(),
        resolutionStatus: 'RESOLVED',
        matchType: 'NOT_FOUND',
        canonicalEntityId: 1,
        source: 'FORMAL_BUSINESS_SOURCE',
        resolverPath: 'formal.test',
    }), /incompatible/);
});

test('V5Task entityContext accepts the immutable V5 identity core without changing it', () => {
    const identity = unresolved();
    const before = JSON.stringify(identity);
    const task = createV5Task({
        version: 1,
        taskId: 'entity-task',
        state: 'RESOLVING_ENTITY',
        createdAt: NOW,
        updatedAt: NOW,
        intent: null,
        entityContext: [identity],
        requestedCapability: null,
        execution: {},
        verification: null,
        failure: null,
        metadata: {},
        stateHistory: [],
    });
    assert.equal(task.entityContext[0].rawMention, 'v750-tokoy-');
    assert.equal(task.entityContext[0].normalizedMention, 'v750-tokoy');
    assert.equal(task.entityContext[0].canonicalEntityId, null);
    assert.equal(JSON.stringify(identity), before);
});

test('damage detector reports length, punctuation, digits, case and whitespace without content', () => {
    assert.deepEqual(detectIdentityTransformation('v750-tokoy-', 'v750-tokoy'), {
        lengthDelta: -1,
        punctuationDelta: -1,
        digitDelta: 0,
        caseChanged: false,
        whitespaceChanged: false,
        contentChanged: true,
    });
    assert.equal(detectIdentityTransformation('V750-A', 'v750-a').caseChanged, true);
    assert.equal(detectIdentityTransformation('a b', 'ab').whitespaceChanged, true);
    assert.equal(Object.hasOwn(detectIdentityTransformation('secret', 'changed'), 'before'), false);
});

test('tracked normalization and untracked pre-resolver loss are distinguishable', () => {
    assert.equal(unresolved().identityPreservationStatus, 'TRANSFORMED_TRACKED');
    const loss = detectUntrackedIdentityLoss({ length: 11, punctuationCount: 2 }, { length: 10, punctuationCount: 1 });
    assert.equal(loss.status, 'TRANSFORMED_UNTRACKED');
    assert.equal(loss.lengthDelta, -1);
    assert.equal(loss.punctuationDelta, -1);
    assert.equal(detectUntrackedIdentityLoss(null, null).status, 'UNKNOWN');
});

test('resolver input boundary accepts only exact rawMention and reports damage otherwise', () => {
    assert.equal(validateResolverInputIdentity(unresolved(), 'v750-tokoy-').valid, true);
    const rejected = validateResolverInputIdentity(unresolved(), 'v750-tokoy');
    assert.equal(rejected.valid, false);
    assert.equal(rejected.code, 'V5_IDENTITY_INPUT_MISMATCH');
    assert.equal(rejected.damage.punctuationDelta, -1);
});

test('resolver adapter input policy is explicit for every supported current resolver type', () => {
    assert.deepEqual(Object.keys(V5_RESOLVER_INPUT_POLICIES).sort(), ['coil', 'customer', 'order', 'part', 'recipe', 'template']);
    for (const policy of Object.values(V5_RESOLVER_INPUT_POLICIES)) {
        assert.equal(policy.v5InputField, 'rawMention');
        assert.equal(policy.existingV4InputSource, 'tool_argument');
        assert.equal(policy.mutationAllowed, false);
    }
});

test('existing resolver adapter receives rawMention, projects result, and mutates neither input nor fixture', () => {
    const identity = unresolved();
    const formalResult = { data: [{ id: 7, name: 'v750-tokoy-', spec: 'fixture' }] };
    const identityBefore = JSON.stringify(identity);
    const resultBefore = JSON.stringify(formalResult);
    let receivedMention = null;
    const projected = resolveV5EntityIdentity(identity, {
        formalResult,
        resolver(input) {
            receivedMention = input.originalMention;
            return {
                status: 'exact',
                selected: {
                    id: 7,
                    stableIdentity: { primaryStableId: '7', stableBusinessKeys: { name: 'v750-tokoy-' } },
                },
            };
        },
    });
    assert.equal(receivedMention, 'v750-tokoy-');
    assert.equal(projected.identity.resolutionStatus, 'RESOLVED');
    assert.equal(projected.identity.matchType, 'EXACT');
    assert.equal(projected.identity.canonicalEntityId, 7);
    assert.deepEqual(projected.identity.canonicalBusinessKey, { name: 'name', value: 'v750-tokoy-' });
    assert.equal(projected.identity.rawMention, 'v750-tokoy-');
    assert.equal(JSON.stringify(identity), identityBefore);
    assert.equal(JSON.stringify(formalResult), resultBefore);
});

test('default existing formal resolver is reused read-only for exact, ambiguous and not-found results', () => {
    const exact = resolveV5EntityIdentity(unresolved(), {
        formalResult: { data: [{ id: 8, name: 'v750-tokoy-', spec: '' }] },
        sourceCapability: 'get_all_recipes',
    });
    assert.equal(exact.identity.resolutionStatus, 'RESOLVED');
    assert.equal(exact.identity.canonicalEntityId, 8);
    const ambiguous = resolveV5EntityIdentity(unresolved({ rawMention: 'v750', normalizedMention: null }), {
        formalResult: { data: [{ id: 1, name: 'v750-alpha' }, { id: 2, name: 'v750-beta' }] },
    });
    assert.equal(ambiguous.identity.resolutionStatus, 'AMBIGUOUS');
    assert.equal(ambiguous.identity.canonicalEntityId, null);
    const missing = resolveV5EntityIdentity(unresolved(), { formalResult: { data: [] } });
    assert.equal(missing.identity.resolutionStatus, 'NOT_FOUND');
    assert.equal(missing.identity.canonicalEntityId, null);
});

test('unsupported ontology type is explicit and does not call a resolver', () => {
    let called = false;
    const identity = unresolved({ entityType: 'quotation', rawMention: 'Q-1', normalizedMention: null });
    const result = resolveV5EntityIdentity(identity, { formalResult: {}, resolver() { called = true; } });
    assert.equal(result.status, 'UNSUPPORTED');
    assert.equal(called, false);
});

test('P06 Exact Identity shadow preserves 3/3, prevents two identity losses, and does not claim the C02 failure', () => {
    const exact = evaluateExactIdentityCases(p06Cases);
    assert.equal(exact.length, 3);
    assert.equal(exact.filter(item => item.v5PreservesOriginalMention).length, 3);
    assert.equal(exact.filter(item => item.v5DetectsLossBeforeResolver).length, 2);
    assert.equal(exact.filter(item => item.resolverValidMatchForReceivedInput).length, 3);
    assert.equal(exact.filter(item => item.outcome === 'PREVENTED').length, 2);
    assert.equal(exact.filter(item => item.outcome === 'NOT_ADDRESSED').length, 1);
});

test('800 flat-blade identity-only fixture preserves raw and keeps canonical identity separate on all paths', () => {
    const flatBlade = evaluateFlatBladeIdentityCases(p06Cases);
    assert.equal(flatBlade.length, 3);
    assert.equal(flatBlade.filter(item => item.rawPreserved).length, 3);
    assert.equal(flatBlade.filter(item => item.canonicalSeparated).length, 3);
    assert.equal(flatBlade.filter(item => item.pathIdentityMetadataAvailable).length, 0);
});

test('P06 corpus metrics exclude paths without sufficient identity metadata', () => {
    const evaluation = evaluateP06IdentityCorpus(p06Cases);
    assert.deepEqual(evaluation.metrics, {
        evaluated: 15,
        sufficientIdentityMetadata: 3,
        projectable: 3,
        preservationPass: 3,
        damageDetectable: 2,
        insufficientData: 12,
    });
});

test('shape detection preserves numeric string semantics without returning content', () => {
    assert.deepEqual(shapeOf('"800"'), { length: 5, punctuationCount: 2, digitCount: 3 });
    assert.equal(Object.values(shapeOf('"800"')).includes('"800"'), false);
    assert.equal(validateV5EntityIdentity(unresolved()).rawMention, 'v750-tokoy-');
});
