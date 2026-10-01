'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { detectReferenceSurface } = require('../scripts/ai-experiments/business-policy-intent/referenceDetection.cjs');
const { parseReferenceMemo } = require('../scripts/ai-experiments/business-policy-intent/referenceResolver.cjs');
const { parseRoleMemo } = require('../scripts/ai-experiments/business-policy-intent/roleClassifier.cjs');
const { runGroundingPipeline, computeGroundingGate } = require('../scripts/ai-experiments/business-policy-intent/groundingPipeline.cjs');
const { createGroundingFixture } = require('../scripts/ai-experiments/business-policy-intent/groundingFixture.cjs');

const root = path.resolve(__dirname, '..');
function roleMemo(requestClass, lines) { return [`REQUEST_CLASS: ${requestClass}`, ...lines].join('\n'); }
function referenceMemo(status, surface, resolved = 'NONE') { return `REFERENCE_STATUS: ${status}\nREFERENCE_SURFACE: ${surface}\nRESOLVED_LANGUAGE_REFERENCE: ${resolved}`; }

function dependencies({ reference = null, role, resolver }) {
    return {
        runBusinessAgent: async input => { assert.equal(input.businessModel, 'BUSINESS_MODEL'); return 'Business Memo'; },
        runPolicyAgent: async input => { assert.equal(input.domainPolicy, 'DOMAIN_POLICY'); return 'Policy Memo'; },
        runReferenceResolver: async input => { assert.equal(input.userInput.length > 0, true); assert.equal('businessMemo' in input, false); assert.equal('policyMemo' in input, false); return reference; },
        runRoleClassifier: async input => { assert.equal(input.businessMemo, 'Business Memo'); assert.equal(input.policyMemo, 'Policy Memo'); return role; },
        resolveAgentEntity: resolver || (async () => ({ status: 'NOT_FOUND', canonicalId: null, candidates: [] })),
    };
}

async function run(userInput, config, recentOwnerWording = '') {
    return runGroundingPipeline({ userInput, recentOwnerWording, businessModel: 'BUSINESS_MODEL', domainPolicy: 'DOMAIN_POLICY' }, dependencies(config));
}

test('Reference detector recognizes a surface only, preferring the full phrase', () => {
    assert.deepEqual(detectReferenceSurface('刚才那个线圈多少钱？'), { status: 'DETECTED', surface: '刚才那个线圈' });
    assert.deepEqual(detectReferenceSurface('V750多少钱？'), { status: 'NONE', surface: null });
});

test('No reference surface performs no Reference LLM call', async () => {
    const result = await run('V750换木箱多少钱？', {
        reference: null,
        role: roleMemo('FORMAL_FACT_OR_ACTION', ['ROLE: V750 | FORMAL_ENTITY_CANDIDATE | RECIPE', 'ROLE: 木箱 | CONFIG_VALUE | NONE', 'ROLE: 多少钱 | QUERY_ONLY | NONE']),
    });
    assert.equal(result.modelCalls.reference, 0);
});

test('Unresolved reference fails closed before resolver and never promotes a config value', async () => {
    let resolverCalls = 0;
    const result = await run('这个换木箱多少钱？', {
        reference: referenceMemo('UNRESOLVED', '这个'),
        role: roleMemo('FORMAL_FACT_OR_ACTION', ['ROLE: 这个 | REFERENCE | NONE', 'ROLE: 木箱 | CONFIG_VALUE | NONE', 'ROLE: 多少钱 | QUERY_ONLY | NONE']),
        resolver: async () => { resolverCalls += 1; throw new Error('must not resolve'); },
    });
    assert.equal(result.reference.status, 'UNRESOLVED');
    assert.equal(result.gate, 'STOP_UNRESOLVED_REFERENCE');
    assert.equal(result.formalTargets.length, 0);
    assert.equal(result.resolutions.length, 0);
    assert.equal(resolverCalls, 0);
});

test('Resolved reference returns language only; it does not introduce an entity type or ID', () => {
    const result = parseReferenceMemo(referenceMemo('RESOLVED', '刚才那个线圈', '12-120'), { status: 'DETECTED', surface: '刚才那个线圈' });
    assert.deepEqual(result, { status: 'RESOLVED', surface: '刚才那个线圈', resolvedLanguageReference: '12-120' });
    assert.equal(Object.hasOwn(result, 'entityType'), false);
    assert.equal(Object.hasOwn(result, 'canonicalId'), false);
});

test('Concept-only request is a deterministic no-resolver stop', async () => {
    let resolverCalls = 0;
    const result = await run('模板和配方有什么区别？', {
        role: roleMemo('CONCEPT_ONLY', ['ROLE: 模板 | CONCEPT_ONLY | NONE', 'ROLE: 配方 | CONCEPT_ONLY | NONE', 'ROLE: 区别 | QUERY_ONLY | NONE']),
        resolver: async () => { resolverCalls += 1; throw new Error('must not resolve'); },
    });
    assert.equal(result.groundingNeed, 'NOT_REQUIRED');
    assert.equal(result.gate, 'STOP_NOT_REQUIRED');
    assert.equal(resolverCalls, 0);
});

test('No formal candidate is a deterministic no-resolver stop', () => {
    const gate = computeGroundingGate({ requestClass: 'FORMAL_FACT_OR_ACTION', referenceStatus: 'NONE', roles: [{ expression: '木箱', role: 'CONFIG_VALUE', entityType: null }] });
    assert.equal(gate.gate, 'STOP_NO_FORMAL_TARGET');
    assert.equal(gate.formalTargets.length, 0);
});

test('Only formal candidates reach the resolver; config and query roles never do', async () => {
    const calls = [];
    const result = await run('V750换木箱多少钱？', {
        role: roleMemo('FORMAL_FACT_OR_ACTION', ['ROLE: V750 | FORMAL_ENTITY_CANDIDATE | RECIPE', 'ROLE: 木箱 | CONFIG_VALUE | NONE', 'ROLE: 多少钱 | QUERY_ONLY | NONE']),
        resolver: async request => { calls.push(request); return { status: 'NOT_FOUND', canonicalId: null, candidates: [] }; },
    });
    assert.deepEqual(calls, [{ entityType: 'recipe', mention: 'V750' }]);
    assert.equal(result.gate, 'RUN');
});

test('Multiple targets and style qualifiers survive role parsing and resolver calls', async () => {
    const calls = [];
    const result = await run('通用款和豪贝款的V750成本分别多少？', {
        role: roleMemo('FORMAL_FACT_OR_ACTION', ['ROLE: 通用款V750 | FORMAL_ENTITY_CANDIDATE | RECIPE', 'ROLE: 豪贝款V750 | FORMAL_ENTITY_CANDIDATE | RECIPE', 'ROLE: 成本 | QUERY_ONLY | NONE']),
        resolver: async request => { calls.push(request); return { status: 'NOT_FOUND', canonicalId: null, candidates: [] }; },
    });
    assert.deepEqual(result.formalTargets, [{ mention: '通用款V750', entityType: 'recipe' }, { mention: '豪贝款V750', entityType: 'recipe' }]);
    assert.equal(calls.length, 2);
});

test('Formal resolver preserves MULTIPLE without first-result binding and does not write', async () => {
    const fixture = createGroundingFixture();
    try {
        const before = fixture.db.totalChanges;
        const result = await run('12-120多少钱？', {
            role: roleMemo('FORMAL_FACT_OR_ACTION', ['ROLE: 12-120 | FORMAL_ENTITY_CANDIDATE | COIL', 'ROLE: 多少钱 | QUERY_ONLY | NONE']),
            resolver: async request => require('../api/ontology/agentResolver.cjs').resolveAgentEntity(request, { lookupEntities: async (_fetch, lookupRequest) => fixture.lookupEntities(lookupRequest), internalFetch: () => { throw new Error('no fetch'); } }),
        });
        assert.equal(result.resolutions[0].result.status, 'AMBIGUOUS');
        assert.equal(result.resolutions[0].result.canonicalId, null);
        assert.equal(result.resolutions[0].result.candidates.length, 2);
        assert.equal(fixture.db.totalChanges, before);
    } finally { fixture.close(); }
});

test('Role parser rejects unsupported entity labels and cannot turn them into resolver targets', () => {
    const parsed = parseRoleMemo('REQUEST_CLASS: FORMAL_FACT_OR_ACTION\nROLE: 木箱 | FORMAL_ENTITY_CANDIDATE | RECIPE\nROLE: x | FORMAL_ENTITY_CANDIDATE | CUSTOMER');
    assert.equal(parsed.roles.length, 1);
    assert.equal(parsed.roles[0].entityType, 'recipe');
});

test('Business and Policy remain frozen and no production runtime imports this prototype', () => {
    const business = fs.readFileSync(path.join(root, 'scripts/ai-experiments/business-policy-intent/businessAgent.cjs'), 'utf8');
    const policy = fs.readFileSync(path.join(root, 'scripts/ai-experiments/business-policy-intent/policyAgent.cjs'), 'utf8');
    assert.match(business, /Company Business Model（这是你唯一知识源）/);
    assert.match(policy, /Domain Policy（这是你唯一规则源）/);
    for (const runtime of ['runtime.cjs', 'judge.cjs', 'mainAgent.cjs', 'capabilityBroker.cjs']) {
        assert.doesNotMatch(fs.readFileSync(path.join(root, 'api/services/ai-assistant', runtime), 'utf8'), /business-policy-intent/);
    }
});
