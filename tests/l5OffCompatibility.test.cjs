'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/l5-off-compatibility-v1.json');
const {
    VERSION,
    buildCompatibilityRead,
    exactCanonicalRecipeEvidence,
    enforceCompatibilityAnswer,
} = require('../api/services/l5OffCompatibility.cjs');
const { runAiAssistant } = require('../api/services/aiAssistantRuntime.cjs');

const verifiedList = rows => ({
    name: 'get_all_recipes',
    args: { keyword: 'V550' },
    result: {
        success: true,
        data: rows,
        queryReceipt: {
            authoritative: true,
            totalCount: rows.length,
            returnedCount: rows.length,
            truncated: false,
            possiblyTruncated: false,
        },
        executionEvidence: { verified: true, kind: 'formal_api_query' },
    },
});

test('L5OffCompatibilityV1 fixture is versioned and freezes the production failure wording', () => {
    assert.equal(fixture.version, VERSION);
    assert.equal(fixture.cases.length, 8);
    assert.equal(fixture.productionFailureCase.id, 'L5-OFF-COMPAT-01');
    assert.equal(fixture.productionFailureCase.question, 'V550大脚板-2寸-经典款当前完整成本是多少');
    assert.equal(fixture.productionFailureCase.fixtureRecipe.id, 501);
    assert.equal(fixture.productionFailureCase.fixtureRecipe.spec, '');
});

test('OC-01 blank optional spec does not invalidate an exact current-name span', () => {
    const row = fixture.productionFailureCase.fixtureRecipe;
    const toolResults = [verifiedList([row])];
    const evidence = exactCanonicalRecipeEvidence(fixture.productionFailureCase.question, toolResults);
    assert.equal(evidence.status, 'EXACT_CANONICAL_NAME');
    assert.equal(evidence.canonical.id, 501);
    const boundary = enforceCompatibilityAnswer({
        userText: fixture.productionFailureCase.question,
        toolResults,
        answer: '正式配方库中未找到该配方。',
    });
    assert.equal(boundary.replaced, true);
    assert.match(boundary.answer, /配方.*存在（ID 501）/u);
    assert.match(boundary.answer, /历史成本快照/u);
    assert.doesNotMatch(boundary.answer, /当前完整成本为\s*¥?266\.74/u);
});

test('OC-02 populated spec preserves the same exact current-name authority', () => {
    const row = { id: 502, name: 'V550大脚板-2寸-升级款', spec: 'V550', savedTotalCost: 270 };
    assert.equal(exactCanonicalRecipeEvidence(`${row.name}当前成本是多少`, [verifiedList([row])]).status,
        'EXACT_CANONICAL_NAME');
});

test('OC-03/OC-04 structured descriptor matching remains separate from exact-name authority', () => {
    const exact = { id: 503, name: 'V550耐腐款', spec: '' };
    assert.equal(exactCanonicalRecipeEvidence('V550耐腐款成本是多少', [verifiedList([exact])]).status,
        'EXACT_CANONICAL_NAME');
    assert.equal(exactCanonicalRecipeEvidence('V550经典款成本是多少', [verifiedList([exact])]).status,
        'NOT_FOUND');
});

test('OC-05 nonexistent and OC-06 ambiguous identities fail closed', () => {
    assert.equal(exactCanonicalRecipeEvidence('V900不存在款成本是多少', [verifiedList([])]).status, 'NOT_FOUND');
    const rows = [
        { id: 504, name: 'V550重复款', spec: '' },
        { id: 505, name: 'V550重复款', spec: '' },
    ];
    assert.equal(exactCanonicalRecipeEvidence('V550重复款成本是多少', [verifiedList(rows)]).status, 'AMBIGUOUS');
    const answer = '找到多个候选，请确认。';
    assert.equal(enforceCompatibilityAnswer({ userText: 'V550重复款成本是多少', toolResults: [verifiedList(rows)], answer }).answer, answer);
});

test('OC-07 plans one bounded formal recipe read and labels saved cost as historical', () => {
    assert.deepEqual(buildCompatibilityRead(fixture.productionFailureCase.question), {
        capability: 'get_all_recipes', arguments: { keyword: 'V550' },
    });
    const row = fixture.productionFailureCase.fixtureRecipe;
    const boundary = enforceCompatibilityAnswer({
        userText: fixture.productionFailureCase.question,
        toolResults: [verifiedList([row])],
        answer: 'V550大脚板-2寸-经典款当前完整成本为 266.74 元。',
    });
    assert.equal(boundary.replaced, true);
    assert.match(boundary.answer, /保存的历史成本快照/u);
});

test('a verified current-cost receipt is preserved instead of being downgraded to unavailable', () => {
    const row = fixture.productionFailureCase.fixtureRecipe;
    const current = {
        name: 'preview_recipe_cost',
        result: {
            success: true,
            data: { currentTotalCost: 271.25 },
            executionEvidence: { verified: true, kind: 'formal_api_query' },
        },
    };
    const boundary = enforceCompatibilityAnswer({
        userText: fixture.productionFailureCase.question,
        toolResults: [verifiedList([row]), current],
        answer: '正式配方库中未找到该配方。',
    });
    assert.match(boundary.answer, /正式当前完整成本为 ¥271\.25/u);
});

test('OC-08 ordinary coil, part and catalog queries receive no recipe compatibility read', () => {
    for (const question of ['12-140库存多少', '轴承-202多少钱', '找一下零件 V550']) {
        assert.equal(buildCompatibilityRead(question), null, question);
    }
});

test('incomplete or unverified lists cannot become canonical identity', () => {
    const row = fixture.productionFailureCase.fixtureRecipe;
    const item = verifiedList([row]);
    item.result.queryReceipt.truncated = true;
    assert.equal(exactCanonicalRecipeEvidence(fixture.productionFailureCase.question, [item]).status, 'NOT_FOUND');
});

test('runtime plans the bounded identity read before the model and blocks a false not-found conclusion', async () => {
    const question = fixture.productionFailureCase.question;
    const row = fixture.productionFailureCase.fixtureRecipe;
    const executed = [];
    const result = await runAiAssistant({
        messages: [{ role: 'user', content: question }],
        confirmationSubject: 'test-owner',
        conversationId: 'l5-off-compat-runtime',
        impactEnforcementCanaryEligible: true,
        env: {
            AI_PROVIDER: 'deepseek',
            AI_BUSINESS_IMPACT_SHADOW_ENABLED: 'false',
            AI_BUSINESS_IMPACT_ENFORCEMENT_CANARY_ENABLED: 'false',
        },
    }, {
        loadMemory: async () => ({ items: [] }),
        loadCorrections: () => '',
        fetchAiProvider: async () => ({
            json: async () => ({ choices: [{ message: { content: '正式配方库中未找到该配方。' } }] }),
        }),
        executeToolCall: async (name, args) => {
            executed.push({ name, args });
            assert.equal(name, 'get_all_recipes');
            assert.deepEqual(args, { keyword: 'V550' });
            return verifiedList([row]).result;
        },
    });
    assert.deepEqual(executed, [{ name: 'get_all_recipes', args: { keyword: 'V550' } }]);
    assert.match(result.finalContent, /配方.*存在（ID 501）/u);
    assert.match(result.finalContent, /历史成本快照/u);
    assert.equal(result.telemetry.businessImpactEnforcement.projectionCalls, 0);
    assert.equal(result.telemetry.l5OffCompatibility.canonicalStatus, 'EXACT_CANONICAL_NAME');
    assert.equal(result.telemetry.l5OffCompatibility.replaced, true);
});
