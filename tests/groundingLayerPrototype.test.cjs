'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { detectReferenceSurface } = require('../scripts/ai-experiments/business-policy-intent/referenceDetection.cjs');
const { parseReferenceMemo } = require('../scripts/ai-experiments/business-policy-intent/referenceResolver.cjs');
const { messagesForRoleClassifier, parseRoleMemo } = require('../scripts/ai-experiments/business-policy-intent/roleClassifier.cjs');
const { FANOUT_ENTITY_TYPES, runGroundingPipeline, computeGroundingGate, deriveFormalResult } = require('../scripts/ai-experiments/business-policy-intent/groundingPipeline.cjs');
const { createGroundingFixture } = require('../scripts/ai-experiments/business-policy-intent/groundingFixture.cjs');
const { evaluateGrounding } = require('../scripts/ai-experiments/business-policy-intent/groundingEvaluator.cjs');

const root = path.resolve(__dirname, '..');
function referenceMemo(status, surface, resolved = 'NONE') { return `REFERENCE_STATUS: ${status}\nREFERENCE_SURFACE: ${surface}\nRESOLVED_LANGUAGE_REFERENCE: ${resolved}`; }
function roleMemo(lines) { return lines.join('\n'); }
function notFound(entityType, mention) { return { entityType, mention, status: 'NOT_FOUND', canonicalId: null, canonicalName: null, candidates: [] }; }

function dependencies({ reference = null, role, resolver, runRoleClassifier: roleRunner }) {
    return {
        runBusinessAgent: async input => { assert.equal(input.businessModel, 'BUSINESS_MODEL'); return 'Business Memo'; },
        runPolicyAgent: async input => { assert.equal(input.domainPolicy, 'DOMAIN_POLICY'); return 'Policy Memo'; },
        runReferenceResolver: async input => { assert.equal('businessMemo' in input, false); assert.equal('policyMemo' in input, false); return reference; },
        runRoleClassifier: roleRunner || (async input => { assert.equal(input.businessMemo, 'Business Memo'); assert.equal(input.policyMemo, 'Policy Memo'); return role; }),
        resolveAgentEntity: resolver || (async input => notFound(input.entityType, input.mention)),
    };
}
async function run(userInput, config, recentOwnerWording = '') {
    return runGroundingPipeline({ userInput, recentOwnerWording, businessModel: 'BUSINESS_MODEL', domainPolicy: 'DOMAIN_POLICY' }, dependencies(config));
}

test('Reference detector recognizes a surface only and skips the model when none exists', () => {
    assert.deepEqual(detectReferenceSurface('刚才那个线圈多少钱？'), { status: 'DETECTED', surface: '刚才那个线圈' });
    assert.deepEqual(detectReferenceSurface('V750多少钱？'), { status: 'NONE', surface: null });
});

test('Unresolved reference is an early stop before Role and resolver calls', async () => {
    let roleCalls = 0;
    let resolverCalls = 0;
    const result = await run('这个换木箱多少钱？', {
        reference: referenceMemo('UNRESOLVED', '这个'),
        role: 'must not run',
        runRoleClassifier: async () => { roleCalls += 1; throw new Error('must not classify'); },
        resolver: async () => { resolverCalls += 1; throw new Error('must not resolve'); },
    });
    assert.equal(result.gate, 'STOP_UNRESOLVED_REFERENCE');
    assert.equal(result.modelCalls.role, 0);
    assert.equal(result.formalResults.length, 0);
    assert.equal(roleCalls, 0);
    assert.equal(resolverCalls, 0);
});

test('Resolved reference remains language only before Role classification', () => {
    const result = parseReferenceMemo(referenceMemo('RESOLVED', '刚才那个线圈', '12-120'), { status: 'DETECTED', surface: '刚才那个线圈' });
    assert.deepEqual(result, { status: 'RESOLVED', surface: '刚才那个线圈', resolvedLanguageReference: '12-120' });
    assert.equal(Object.hasOwn(result, 'entityType'), false);
    assert.equal(Object.hasOwn(result, 'canonicalId'), false);
});

test('Minimal Role protocol has no entity type, request class, grounding need, or query role', () => {
    const messages = messagesForRoleClassifier({ userInput: 'V750换木箱多少钱？', businessMemo: 'B', policyMemo: 'P', reference: { status: 'NONE' } });
    assert.doesNotMatch(messages[0].content, /REQUEST_CLASS|GROUNDING_NEED|QUERY_ONLY|RECIPE\/COIL/u);
    assert.deepEqual(parseRoleMemo('ROLE: V750 | FORMAL_ENTITY_CANDIDATE\nROLE: 换木箱 | CONFIG_VALUE'), {
        roles: [{ expression: 'V750', role: 'FORMAL_ENTITY_CANDIDATE' }, { expression: '换木箱', role: 'CONFIG_VALUE' }],
    });
});

test('No reference surface has zero Reference calls and Role output drives a formal-only fan-out', async () => {
    const calls = [];
    const result = await run('V750换木箱多少钱？', {
        role: roleMemo(['ROLE: V750 | FORMAL_ENTITY_CANDIDATE', 'ROLE: 换木箱 | CONFIG_VALUE']),
        resolver: async input => { calls.push(input); return notFound(input.entityType, input.mention); },
    });
    assert.equal(result.modelCalls.reference, 0);
    assert.equal(result.gate, 'RUN');
    assert.deepEqual(calls, FANOUT_ENTITY_TYPES.map(entityType => ({ entityType, mention: 'V750' })));
    assert.deepEqual(result.formalTargets, [{ mention: 'V750' }]);
});

test('Concept-only roles stop without a resolver and no QUERY_ONLY line is required', async () => {
    let resolverCalls = 0;
    const result = await run('模板和配方有什么区别？', {
        role: roleMemo(['ROLE: 模板 | CONCEPT_ONLY', 'ROLE: 配方 | CONCEPT_ONLY']),
        resolver: async () => { resolverCalls += 1; throw new Error('must not resolve'); },
    });
    assert.equal(result.gate, 'STOP_CONCEPT_ONLY');
    assert.equal(result.formalResults.length, 0);
    assert.equal(resolverCalls, 0);
});

test('Config-only output stops without a resolver', () => {
    const gate = computeGroundingGate({ referenceStatus: 'NONE', roles: [{ expression: '木箱', role: 'CONFIG_VALUE' }] });
    assert.equal(gate.gate, 'STOP_NO_FORMAL_TARGET');
});

test('Resolver evidence, not the model, derives a MULTIPLE coil entity type without first-result binding', async () => {
    const fixture = createGroundingFixture();
    try {
        const before = fixture.db.totalChanges;
        const result = await run('12-120多少钱？', {
            role: roleMemo(['ROLE: 12-120 | FORMAL_ENTITY_CANDIDATE']),
            resolver: async request => require('../api/ontology/agentResolver.cjs').resolveAgentEntity(request, { lookupEntities: async (_fetch, lookupRequest) => fixture.lookupEntities(lookupRequest), internalFetch: () => { throw new Error('no fetch'); } }),
        });
        assert.equal(result.formalResults.length, 1);
        assert.equal(result.formalResults[0].entityType, 'coil');
        assert.equal(result.formalResults[0].status, 'MULTIPLE');
        assert.equal(result.formalResults[0].canonicalId, null);
        assert.equal(result.formalResults[0].candidates.length, 2);
        assert.equal(fixture.db.totalChanges, before);
    } finally { fixture.close(); }
});

test('Cross-type resolver evidence remains MULTIPLE_TYPE rather than choosing a type', () => {
    const result = deriveFormalResult('same', [
        { entityType: 'recipe', result: { status: 'RESOLVED', canonicalId: '1', canonicalName: 'R', candidates: [] }, resolverMs: 0 },
        { entityType: 'part', result: { status: 'RESOLVED', canonicalId: '2', canonicalName: 'P', candidates: [] }, resolverMs: 0 },
    ]);
    assert.equal(result.status, 'MULTIPLE_TYPE');
    assert.equal(result.entityType, null);
});

test('Multi-target qualifier-preserving Role output fans out independently', async () => {
    const calls = [];
    await run('通用款和豪贝款的V750成本分别多少？', {
        role: roleMemo(['ROLE: 通用款V750 | FORMAL_ENTITY_CANDIDATE', 'ROLE: 豪贝款V750 | FORMAL_ENTITY_CANDIDATE']),
        resolver: async input => { calls.push(input); return notFound(input.entityType, input.mention); },
    });
    assert.equal(calls.length, 8);
    assert.equal(calls.filter(call => call.mention === '通用款V750').length, 4);
    assert.equal(calls.filter(call => call.mention === '豪贝款V750').length, 4);
});

test('Evaluator accepts a supported semantic span and rejects unsupported added source text', () => {
    const base = { reference: { status: 'NONE', surface: null, resolvedLanguageReference: null }, gate: 'STOP_NO_FORMAL_TARGET', formalTargets: [], formalResults: [], modelCalls: { role: 1 }, roleMemo: 'ROLE: 换木箱 | CONFIG_VALUE', roles: [{ expression: '换木箱', role: 'CONFIG_VALUE' }] };
    const pass = evaluateGrounding({ user: 'V750换木箱多少钱？', referenceStatus: 'NONE', roles: [{ terms: ['木箱'], role: 'CONFIG_VALUE' }], gate: 'STOP_NO_FORMAL_TARGET', roleCalls: 1, resolverCalls: 0 }, base);
    assert.equal(pass.overall, 'PASS');
    const fail = evaluateGrounding({ user: 'V750换木箱多少钱？', referenceStatus: 'NONE', roles: [{ terms: ['木箱'], role: 'CONFIG_VALUE' }], gate: 'STOP_NO_FORMAL_TARGET', roleCalls: 1, resolverCalls: 0 }, { ...base, roles: [{ expression: '纸箱换木箱', role: 'CONFIG_VALUE' }] });
    assert.match(fail.failures.join(','), /UNSUPPORTED_ROLE_SPAN/);
});

test('Business and Policy remain frozen, Intent is absent, and production Runtime imports no prototype', () => {
    const business = fs.readFileSync(path.join(root, 'scripts/ai-experiments/business-policy-intent/businessAgent.cjs'), 'utf8');
    const policy = fs.readFileSync(path.join(root, 'scripts/ai-experiments/business-policy-intent/policyAgent.cjs'), 'utf8');
    const pipeline = fs.readFileSync(path.join(root, 'scripts/ai-experiments/business-policy-intent/groundingPipeline.cjs'), 'utf8');
    assert.match(business, /Company Business Model（这是你唯一知识源）/);
    assert.match(policy, /Domain Policy（这是你唯一规则源）/);
    assert.doesNotMatch(pipeline, /intentAgent|utteranceExtractor.*require/iu);
    for (const runtime of ['runtime.cjs', 'judge.cjs', 'mainAgent.cjs', 'capabilityBroker.cjs']) assert.doesNotMatch(fs.readFileSync(path.join(root, 'api/services/ai-assistant', runtime), 'utf8'), /business-policy-intent/);
});
