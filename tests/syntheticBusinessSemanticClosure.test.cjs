'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBusinessSemanticFrame } = require('../api/business-semantics/frameBuilder.cjs');
const { deterministicSemanticAnswer } = require('../api/business-semantics/answerBoundary.cjs');
const { classifyQuestion } = require('../api/business-semantics/questionSemantics.cjs');
const { buildBusinessEvidencePlan } = require('../api/business-semantics/evidencePlanner.cjs');
const { resolveRelationRoot } = require('../api/ontology/relationRootCanonical.cjs');
const { bindRelation } = require('../api/ontology/relationBinder.cjs');

const evidence = path => ({ verified: true, kind: 'formal_api_query', calls: [{ method: 'POST', path }] });

test('formal persisted recipe alias becomes a canonical relation root and ambiguous alias fails closed', async () => {
    const intent = { relationId: 'recipe.uses_coil', fromType: 'recipe', mention: '老V750耐腐款', eligible: true };
    const found = await resolveRelationRoot(intent, { resolveIdentity: async () => ({
        status: 'found', identity: { recipeId: 75, recipeName: '配方-V750耐腐经典款-12-160',
            matchKind: 'APPROVED_ALIAS', matchedAlias: '老V750耐腐款' },
        calls: [{ method: 'POST', path: '/api/entity-lookup' }],
    }) });
    assert.equal(found.resolved, true);
    assert.equal(found.receipt.status, 'approved_alias');
    const binding = bindRelation({ ontologyVersion: 1, userText: '老V750耐腐款用的线圈是什么',
        canonicalReceipts: [found.receipt] });
    assert.equal(binding.status, 'BOUND');
    assert.deepEqual(binding.root, { entityType: 'recipe', canonicalId: '75' });

    const ambiguous = await resolveRelationRoot(intent, { resolveIdentity: async () => ({
        status: 'ambiguous', calls: [{ method: 'POST', path: '/api/entity-lookup' }],
    }) });
    assert.equal(ambiguous.resolved, false);
    assert.equal(ambiguous.reason, 'AMBIGUOUS_NAME');
});

test('verified structured recipe key may bind only with descriptor corroboration', async () => {
    const intent = { relationId: 'recipe.uses_coil', fromType: 'recipe',
        mention: 'V1100高扬程这个配方', eligible: true };
    const found = await resolveRelationRoot(intent, { resolveIdentity: async request => {
        assert.equal(request.mention, 'V1100高扬程');
        return { status: 'found', identity: { recipeId: 1100, recipeName: '配方-V1100高扬程-12-220',
            matchKind: 'STRUCTURED_CANONICAL_KEY', canonicalKey: 'V1100', descriptorVerified: true },
        calls: [{ method: 'POST', path: '/api/entity-lookup' }] };
    } });
    assert.equal(found.resolved, true);
    assert.equal(found.receipt.status, 'structured_canonical_key');
    assert.equal(bindRelation({ ontologyVersion: 1, userText: 'V1100高扬程这个配方用的是什么线圈',
        canonicalReceipts: [found.receipt] }).status, 'BOUND');
});

test('complete formal relation receipt satisfies semantic completeness without cross-catalog evidence', () => {
    const userText = '轴承-202被哪些配方使用';
    const toolResults = [{ name: 'get_recipes_by_part', result: {
        success: true, relation: 'part.contained_in_recipe', complete: true,
        root: { entityType: 'part', canonicalId: '202' }, count: 1, totalCount: 1,
        data: [{ recipeId: 550, recipeName: '配方-V550经典款' }],
        executionEvidence: evidence('/api/relations/resolve'),
    } }];
    const frame = buildBusinessSemanticFrame({ userText, toolResults, stage: 'POST_EVIDENCE' });
    assert.equal(frame.completeness.status, 'COMPLETE');
    assert.deepEqual(frame.evidence.requiredFacts, ['FORMAL_RELATION_RESULT']);
    assert.deepEqual(frame.evidence.missingFacts, []);
    assert.doesNotMatch(deterministicSemanticAnswer(frame, toolResults, userText), /CROSS_CATALOG_CANDIDATES/);
    assert.match(deterministicSemanticAnswer(frame, toolResults, userText), /V550/);
});

test('verified empty relation keeps the requested target and testing inventory stays testing', () => {
    const relationText = '12-240钢带小眼线圈被哪些配方使用';
    const relationTools = [{ name: 'search_coils', result: {
        success: true, data: [{ id: 240, spec: '12', sheets: 240, material: '钢带', slotType: '小眼', schemeStatus: 'official' }],
        queryReceipt: { authoritative: true, totalCount: 1, returnedCount: 1, truncated: false, possiblyTruncated: false },
        executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/coils?spec=12&sheets=240' }] },
    } }, { name: 'get_recipes_by_coil', result: {
        success: true, relation: 'coil.recipes', complete: true, setCompleteness: 'COMPLETE', rootCoilId: 240,
        count: 0, totalCount: 0, data: [], executionEvidence: evidence('/api/relations/read'),
    } }];
    const relationFrame = buildBusinessSemanticFrame({ userText: relationText, toolResults: relationTools, stage: 'POST_EVIDENCE' });
    const relationAnswer = deterministicSemanticAnswer(relationFrame, relationTools, relationText);
    assert.equal(relationFrame.completeness.status, 'COMPLETE');
    assert.match(relationAnswer, /12-240/);
    assert.match(relationAnswer, /没有/);

    const inventoryText = '12-200的测试方案库存是多少';
    const inventoryTools = [{ name: 'search_coils', result: {
        success: true, data: [{ id: 13, spec: '12', sheets: 200, material: '钢带', slotType: '小眼',
            schemeCode: 'T-12-200', schemeStatus: 'testing', stock: 99, cost: 81 }],
        queryReceipt: { authoritative: true, totalCount: 1, returnedCount: 1, truncated: false, possiblyTruncated: false },
        executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/coils' }] },
    } }];
    const inventoryFrame = buildBusinessSemanticFrame({ userText: inventoryText, toolResults: inventoryTools, stage: 'POST_EVIDENCE' });
    const inventoryAnswer = deterministicSemanticAnswer(inventoryFrame, inventoryTools, inventoryText);
    assert.match(inventoryAnswer, /测试方案/);
    assert.doesNotMatch(inventoryAnswer, /正式方案/);
    assert.match(inventoryAnswer, /99/);
});

test('a relation receipt for a different coil root is rejected and explicit missing coil is verified', () => {
    const userText = '99-999线圈被哪些配方使用';
    const toolResults = [{ name: 'search_coils', result: {
        success: true, data: [],
        queryReceipt: { authoritative: true, totalCount: 0, returnedCount: 0, truncated: false, possiblyTruncated: false },
        executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/coils?spec=99&sheets=999' }] },
    } }, { name: 'get_recipes_by_coil', result: {
        success: true, relation: 'coil.recipes', complete: true, setCompleteness: 'COMPLETE', rootCoilId: 1,
        count: 1, totalCount: 1, data: [{ recipeId: 550, recipeName: '配方-V550' }],
        executionEvidence: evidence('/api/relations/read'),
    } }];
    const frame = buildBusinessSemanticFrame({ userText, toolResults, stage: 'POST_EVIDENCE' });
    const answer = deterministicSemanticAnswer(frame, toolResults, userText);
    assert.equal(frame.subject.resolutionStatus, 'NOT_FOUND');
    assert.equal(frame.completeness.status, 'NOT_FOUND_VERIFIED');
    assert.match(answer, /99-999/);
    assert.match(answer, /未找到/);
    assert.doesNotMatch(answer, /V550/);
});

test('formal alias current-name question extracts only the alias token', () => {
    const semantics = classifyQuestion('老V750耐腐款现在的正式名称是什么');
    assert.equal(semantics.requestedIdentity.token, '老V750耐腐款');
});

test('non-V historical alias is recipe-scoped and unfiltered model read cannot satisfy identity resolution', () => {
    const userText = '老停产样机的成本是多少';
    assert.equal(classifyQuestion(userText).requestedType, 'recipe');
    const unfiltered = [{ name: 'get_all_recipes', args: {}, result: {
        success: true, data: [{ id: 1, name: '配方-V550' }],
        executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/recipes' }] },
    } }];
    const plan = buildBusinessEvidencePlan({ userText, toolResults: unfiltered });
    assert.deepEqual(plan.execution.calls.map(item => [item.capability, item.arguments]), [
        ['get_all_recipes', { keyword: '老停产样机' }],
    ]);
});

test('part unit-price wording keeps the exact catalog token', () => {
    const semantics = classifyQuestion('轴承-202的单位价格是多少');
    assert.equal(semantics.requestedIdentity.token, '轴承-202');
});

test('explicit coil material and slot select the verified relation root among same-spec rows', () => {
    const userText = '12-200钢带小眼线圈被哪些配方使用';
    const toolResults = [{ name: 'search_coils', result: {
        success: true, data: [
            { id: 1, spec: '12', sheets: 200, material: '钢带', slotType: '小眼', schemeStatus: 'official' },
            { id: 2, spec: '12', sheets: 200, material: '冷轧', slotType: '国标眼', schemeStatus: 'official' },
        ], queryReceipt: { authoritative: true, totalCount: 2, returnedCount: 2, truncated: false, possiblyTruncated: false },
        executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/coils?spec=12&sheets=200' }] },
    } }, { name: 'get_recipes_by_coil', result: {
        success: true, relation: 'coil.recipes', complete: true, setCompleteness: 'COMPLETE', rootCoilId: 1,
        count: 1, totalCount: 1, data: [{ recipeId: 550, recipeName: '配方-V550' }],
        executionEvidence: evidence('/api/relations/read'),
    } }];
    const frame = buildBusinessSemanticFrame({ userText, toolResults, stage: 'POST_EVIDENCE' });
    assert.equal(frame.completeness.status, 'COMPLETE');
    assert.match(deterministicSemanticAnswer(frame, toolResults, userText), /V550/);
});
