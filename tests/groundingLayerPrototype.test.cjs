'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { messagesForGrounding } = require('../scripts/ai-experiments/business-policy-intent/groundingAgent.cjs');
const { runGroundingPipeline } = require('../scripts/ai-experiments/business-policy-intent/groundingPipeline.cjs');
const { createGroundingFixture } = require('../scripts/ai-experiments/business-policy-intent/groundingFixture.cjs');
const { evaluateGrounding } = require('../scripts/ai-experiments/business-policy-intent/groundingEvaluator.cjs');

const root = path.resolve(__dirname, '..');
function memo(lines) { return lines.join('\n'); }
function dependencies(groundingMemo, fixture) {
    return {
        runBusinessAgent: async input => { assert.equal(input.businessModel, 'BUSINESS_MODEL'); return 'Business Memo'; },
        runPolicyAgent: async input => { assert.equal(input.domainPolicy, 'DOMAIN_POLICY'); return 'Policy Memo'; },
        runGroundingAgent: async input => { assert.equal(input.businessMemo, 'Business Memo'); assert.equal(input.policyMemo, 'Policy Memo'); return groundingMemo; },
        lookupEntities: async (_fetch, request) => fixture.lookupEntities(request),
        internalFetch: () => { throw new Error('must not fetch'); },
    };
}

test('Grounding receives raw Owner input plus both frozen memos; Intent is absent from this chain', async () => {
    const fixture = createGroundingFixture();
    try {
        const result = await runGroundingPipeline({ userInput: '12-120多少钱？', recentOwnerWording: '', businessModel: 'BUSINESS_MODEL', domainPolicy: 'DOMAIN_POLICY' }, dependencies(memo([
            'Grounding Need: REQUIRED', 'Reference: NONE', 'Language Target: 12-120 | coil', 'Expected Business Type: coil',
        ]), fixture));
        assert.equal(result.resolutions.length, 1);
        assert.equal(result.resolutions[0].result.status, 'AMBIGUOUS');
        assert.equal('intentMemo' in result, false);
        assert.equal('utteranceMemo' in result, false);
    } finally { fixture.close(); }
});

test('Concept questions stop at NOT_REQUIRED and do not call the formal resolver', async () => {
    const fixture = createGroundingFixture();
    let resolverCalls = 0;
    try {
        const result = await runGroundingPipeline({ userInput: '模板和配方有什么区别？', recentOwnerWording: '', businessModel: 'BUSINESS_MODEL', domainPolicy: 'DOMAIN_POLICY' }, {
            ...dependencies('Grounding Need: NOT_REQUIRED\nReference: NONE\nExpected Business Type: none', fixture),
            lookupEntities: async () => { resolverCalls += 1; throw new Error('not required'); },
        });
        assert.equal(result.resolutions.length, 0);
        assert.equal(resolverCalls, 0);
    } finally { fixture.close(); }
});

test('Formal entity lookup preserves multiple candidates, exact aliases, and no writes', async () => {
    const fixture = createGroundingFixture();
    try {
        const before = fixture.db.totalChanges;
        const result = await runGroundingPipeline({ userInput: 'V750、V110现在分别多少钱？', recentOwnerWording: '', businessModel: 'BUSINESS_MODEL', domainPolicy: 'DOMAIN_POLICY' }, dependencies(memo([
            'Grounding Need: REQUIRED', 'Reference: NONE', 'Language Target: V750 | recipe', 'Language Target: V110 | recipe', 'Expected Business Type: recipe',
        ]), fixture));
        assert.equal(result.resolutions.length, 2);
        assert.equal(result.resolutions[0].result.status, 'AMBIGUOUS');
        assert.equal(result.resolutions[0].result.canonicalId, null);
        assert.equal(result.resolutions[0].result.candidates.length, 2);
        assert.equal(result.resolutions[1].result.status, 'RESOLVED');
        assert.equal(fixture.db.totalChanges, before);
    } finally { fixture.close(); }
});

test('Reference result stays unresolved without a raw Owner antecedent and is never guessed', () => {
    const evaluation = evaluateGrounding({ id: 'G-12', need: 'REQUIRED', reference: 'UNRESOLVED' }, {
        groundingMemo: 'Grounding Need: REQUIRED\nReference: UNRESOLVED\nExpected Business Type: unknown', resolutions: [],
    });
    assert.equal(evaluation.overall, 'PASS');
});

test('Grounding prompt exposes no business tools or write instruction while receiving bounded sources', () => {
    const messages = messagesForGrounding({ userInput: 'V750成本多少？', recentOwnerWording: '上一轮 V750', businessMemo: 'BUSINESS_MEMO', policyMemo: 'POLICY_MEMO' });
    assert.match(messages[0].content, /V750成本多少|上一轮 V750|BUSINESS_MEMO|POLICY_MEMO/);
    assert.doesNotMatch(messages[0].content, /costEngine|API selection|Tool selection/iu);
});

test('Business and Policy source files remain frozen and production runtime does not import the prototype', () => {
    const business = fs.readFileSync(path.join(root, 'scripts/ai-experiments/business-policy-intent/businessAgent.cjs'), 'utf8');
    const policy = fs.readFileSync(path.join(root, 'scripts/ai-experiments/business-policy-intent/policyAgent.cjs'), 'utf8');
    assert.match(business, /Company Business Model（这是你唯一知识源）/);
    assert.match(policy, /Domain Policy（这是你唯一规则源）/);
    for (const runtime of ['runtime.cjs', 'judge.cjs', 'mainAgent.cjs', 'capabilityBroker.cjs']) {
        assert.doesNotMatch(fs.readFileSync(path.join(root, 'api/services/ai-assistant', runtime), 'utf8'), /business-policy-intent/);
    }
});
