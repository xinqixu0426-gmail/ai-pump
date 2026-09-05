'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    V5_ENTITY_RESOLUTION_REGISTRY,
    validateEntityResolutionRegistry,
} = require('../api/services/ai-v5/entityResolutionRegistry.cjs');
const {
    resolveEntityTypeIndependent,
    validateLookupResponse,
} = require('../api/services/ai-v5/typeIndependentEntityResolver.cjs');
const { lookupEntities } = require('../api/routes/ai/internalApiClient.cjs');

function response(candidates = [], overrides = {}) {
    return {
        version: 1,
        status: 'OK',
        complete: true,
        attemptedEntityTypes: 6,
        candidateCount: candidates.length,
        candidates,
        ...overrides,
    };
}

function candidate(entityType, canonicalId = '1', matchKind = 'EXACT') {
    return { entityType, canonicalId, matchKind };
}

function optionsFor(result, extra = {}) {
    let calls = 0;
    return {
        options: {
            internalFetch: async () => { throw new Error('must not use transport in injected test'); },
            lookupEntities: async (_fetch, input) => {
                calls += 1;
                assert.equal(Object.hasOwn(input, 'entityType'), false);
                assert.deepEqual(input.entityTypes, V5_ENTITY_RESOLUTION_REGISTRY.map(entry => entry.entityType));
                return typeof result === 'function' ? result(input) : result;
            },
            ...extra,
        },
        calls: () => calls,
    };
}

test('six-type resolution registry is valid, read-only, and authoritative', () => {
    assert.equal(validateEntityResolutionRegistry(), true);
    assert.deepEqual(V5_ENTITY_RESOLUTION_REGISTRY.map(item => item.entityType), [
        'coil', 'customer', 'order', 'part', 'recipe', 'template',
    ]);
    assert.ok(V5_ENTITY_RESOLUTION_REGISTRY.every(item => item.readOnly));
});

test('one batch call resolves one unique authoritative candidate without a type hint', async () => {
    const harness = optionsFor(response([candidate('part', '42')]));
    const result = await resolveEntityTypeIndependent('800平刀', harness.options);
    assert.equal(harness.calls(), 1);
    assert.equal(result.status, 'RESOLVED');
    assert.equal(result.resolvedEntityType, 'part');
    assert.equal(result.canonicalIdentity, '42');
    assert.equal(result.rawMention, '800平刀');
});

test('same-type and cross-type multiplicity fail closed as ambiguous', async () => {
    const same = await resolveEntityTypeIndependent('same', optionsFor(response([
        candidate('part', '1'), candidate('part', '2'),
    ])).options);
    assert.equal(same.status, 'AMBIGUOUS');
    assert.deepEqual(same.reasonCodes, ['ENTITY_LOOKUP_SAME_TYPE_AMBIGUOUS']);
    const cross = await resolveEntityTypeIndependent('cross', optionsFor(response([
        candidate('part', '1'), candidate('coil', '2'),
    ])).options);
    assert.equal(cross.status, 'AMBIGUOUS');
    assert.deepEqual(cross.reasonCodes, ['ENTITY_LOOKUP_CROSS_TYPE_AMBIGUOUS']);
});

test('zero, incomplete, API errors, and timeouts stay distinct and fail closed', async () => {
    const zero = await resolveEntityTypeIndependent('missing', optionsFor(response()).options);
    assert.equal(zero.status, 'NOT_FOUND');
    const incomplete = await resolveEntityTypeIndependent('limited', optionsFor(response([
        candidate('part'),
    ], { status: 'INCOMPLETE', complete: false })).options);
    assert.equal(incomplete.status, 'ERROR');
    assert.deepEqual(incomplete.reasonCodes, ['ENTITY_LOOKUP_INCOMPLETE']);
    const apiError = await resolveEntityTypeIndependent('error', optionsFor(async () => {
        throw Object.assign(new Error('unavailable'), { code: 'ENTITY_LOOKUP_INTERNAL_ERROR' });
    }).options);
    assert.equal(apiError.status, 'ERROR');
    assert.deepEqual(apiError.reasonCodes, ['ENTITY_LOOKUP_INTERNAL_ERROR']);
    const timeout = await resolveEntityTypeIndependent('timeout', optionsFor(
        () => new Promise(() => {}), { timeoutMs: 10 }
    ).options);
    assert.equal(timeout.status, 'ERROR');
    assert.deepEqual(timeout.reasonCodes, ['ENTITY_LOOKUP_TIMEOUT']);
});

test('response validation rejects duplicates, overfetch, and malformed completeness', () => {
    assert.throws(() => validateLookupResponse(response([
        candidate('part'), candidate('part'),
    ]), 6));
    assert.throws(() => validateLookupResponse(response([{
        ...candidate('part'), businessValue: 1,
    }]), 6));
    assert.throws(() => validateLookupResponse(response([], { status: 'OK', complete: false }), 6));
});

test('raw source identity remains immutable for punctuation and numeric-like mentions', async () => {
    const mentions = ['v750-tokoy-', 'V750-A', '800平刀', 'abc-', 'a/b', 'a.b', 'a_b', 'a+b', '800'];
    for (const rawMention of mentions) {
        const harness = optionsFor(input => {
            assert.equal(input.mention, rawMention);
            return response([candidate('recipe')]);
        });
        const result = await resolveEntityTypeIndependent(rawMention, harness.options);
        assert.equal(result.rawMention, rawMention);
    }
    await assert.rejects(() => resolveEntityTypeIndependent(800, {}), TypeError);
});

test('internal API entity wrapper keeps mention and canonical IDs out of its trace', async () => {
    const trace = [];
    const internalFetch = async (_path, options) => {
        const request = JSON.parse(options.body);
        assert.equal(request.mention, 'private-mention');
        return new Response(JSON.stringify({
            success: true,
            data: response([candidate('part', 'private-id')]),
        }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    internalFetch.recordApiResult = entry => trace.push(entry);
    const result = await lookupEntities(internalFetch, {
        version: 1,
        mention: 'private-mention',
        entityTypes: V5_ENTITY_RESOLUTION_REGISTRY.map(entry => entry.entityType),
        matchPolicy: 'EXACT_OR_APPROVED_ALIAS',
    });
    assert.equal(result.candidates[0].canonicalId, 'private-id');
    const serializedTrace = JSON.stringify(trace);
    assert.equal(serializedTrace.includes('private-mention'), false);
    assert.equal(serializedTrace.includes('private-id'), false);
});

test('ten concurrent resolutions do not cross request identity or candidates', async () => {
    const inputs = Array.from({ length: 10 }, (_, index) => `request-${index}`);
    const results = await Promise.all(inputs.map(rawMention => resolveEntityTypeIndependent(rawMention, optionsFor(
        input => response([candidate('part', input.mention)])
    ).options)));
    assert.deepEqual(results.map(result => result.rawMention), inputs);
    assert.deepEqual(results.map(result => result.canonicalIdentity), inputs);
});
