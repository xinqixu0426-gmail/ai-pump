'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { detectReferenceSurface } = require('../scripts/ai-experiments/business-policy-intent/referenceDetection.cjs');
const { parseReferenceMemo } = require('../scripts/ai-experiments/business-policy-intent/referenceResolver.cjs');
const { messagesForReferenceResolver } = require('../scripts/ai-experiments/business-policy-intent/referenceResolver.cjs');
const { messagesForRoleClassifier, parseRoleMemo } = require('../scripts/ai-experiments/business-policy-intent/roleClassifier.cjs');
const { buildNarrowBusinessReferenceHint } = require('../scripts/ai-experiments/business-policy-intent/referenceHint.cjs');
const { buildGroundingWorkingUtterance } = require('../scripts/ai-experiments/business-policy-intent/workingUtterance.cjs');
const { resolveReferenceFastPath } = require('../scripts/ai-experiments/business-policy-intent/referenceFastPath.cjs');
const { alignRoleExpressionToWorkingUtterance } = require('../scripts/ai-experiments/business-policy-intent/spanAlignment.cjs');
const { detectConceptQuestionFastPath } = require('../scripts/ai-experiments/business-policy-intent/conceptQuestionFastPath.cjs');
const { FANOUT_ENTITY_TYPES, runGroundingPipeline, computeGroundingGate, deriveFormalResult, validateCandidateProposals } = require('../scripts/ai-experiments/business-policy-intent/groundingPipeline.cjs');
const { refineQualifiedTargets } = require('../scripts/ai-experiments/business-policy-intent/qualifierRefinement.cjs');
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
        runReferenceResolver: async input => { assert.equal('businessMemo' in input, false); assert.equal('policyMemo' in input, false); assert.ok(input.businessReferenceHint); return reference; },
        runRoleClassifier: roleRunner || (async input => { assert.equal(input.businessMemo, 'Business Memo'); assert.equal(input.policyMemo, 'Policy Memo'); assert.equal(typeof input.workingUtterance, 'string'); assert.equal('userInput' in input, false); return role; }),
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
    assert.equal(result.probeResults.length, 0);
    assert.equal(roleCalls, 0);
    assert.equal(resolverCalls, 0);
});

test('Resolved reference remains language only before Role classification', () => {
    const result = parseReferenceMemo(referenceMemo('RESOLVED', '刚才那个线圈', '12-120'), { status: 'DETECTED', surface: '刚才那个线圈' }, '我先看看12-120。');
    assert.deepEqual(result, { status: 'RESOLVED', surface: '刚才那个线圈', resolvedLanguageReference: '12-120' });
    assert.equal(Object.hasOwn(result, 'entityType'), false);
    assert.equal(Object.hasOwn(result, 'canonicalId'), false);
});

test('Minimal Role protocol has no entity type, request class, grounding need, or query role', () => {
    const messages = messagesForRoleClassifier({ workingUtterance: 'V750换木箱多少钱？', businessMemo: 'B', policyMemo: 'P' });
    assert.doesNotMatch(messages[0].content, /ROLE:\s*原始语言表达\s*\|\s*(?:RECIPE|COIL|TEMPLATE|PART)/u);
    assert.deepEqual(parseRoleMemo('ROLE: V750 | FORMAL_ENTITY_CANDIDATE\nROLE: 换木箱 | CONFIG_VALUE'), {
        roles: [{ expression: 'V750', role: 'FORMAL_ENTITY_CANDIDATE' }, { expression: '换木箱', role: 'CONFIG_VALUE' }],
    });
});

test('Formal candidate means a resolver candidate for the current request, not an already unique identity', () => {
    const prompt = messagesForRoleClassifier({ workingUtterance: '12-120多少钱？', businessMemo: 'B', policyMemo: 'P' })[0].content;
    assert.match(prompt, /不要求已经唯一、canonical 或已绑定正式实体/u);
    assert.match(prompt, /12-120多少钱/u);
    assert.match(prompt, /FORMAL_ENTITY_CANDIDATE/u);
});

test('Narrow business reference hint exposes only prior owner expression and category', () => {
    const hint = buildNarrowBusinessReferenceHint({
        recentOwnerWording: '我先看看12-120。刚才看的是V750通用款。先看通用款模板。',
        businessMemo: '12-120 是线圈相关表达。\nV750通用款 是 Recipe 产品配置。\n通用款模板 是 Template 相关表达。',
    });
    assert.match(hint.text, /12-120：线圈\/线圈方案相关业务表达/u);
    assert.match(hint.text, /V750通用款：配方\/产品配置相关业务表达/u);
    assert.match(hint.text, /通用款模板：模板相关业务表达/u);
    assert.doesNotMatch(hint.text, /canonical|candidate|候选|成本|库存|\bid\b|\d+个/u);
});

test('Reference prompt receives a narrow category hint, not a Business or Policy Memo', () => {
    const messages = messagesForReferenceResolver({
        userInput: '刚才那个线圈多少钱？',
        recentOwnerWording: '我先看看12-120。',
        referenceSurface: '刚才那个线圈',
        businessReferenceHint: { text: '12-120：线圈/线圈方案相关业务表达' },
    });
    assert.match(messages[0].content, /12-120：线圈\/线圈方案相关业务表达/u);
    assert.doesNotMatch(messages[0].content, /Business Memo（帮助理解|Policy Memo（帮助保留/u);
});

test('Reference parsing rejects an antecedent absent from recent owner wording', () => {
    const result = parseReferenceMemo(referenceMemo('RESOLVED', '它', 'V750'), { status: 'DETECTED', surface: '它' }, '我先看看12-120。');
    assert.equal(result.status, 'UNRESOLVED');
});

test('Resolved reference uses an exact deterministic working-utterance rewrite with provenance', () => {
    const result = buildGroundingWorkingUtterance({
        rawOwnerInput: '刚才那个线圈多少钱？',
        reference: { status: 'RESOLVED', surface: '刚才那个线圈', resolvedLanguageReference: '12-120' },
    });
    assert.equal(result.workingUtterance, '12-120多少钱？');
    assert.deepEqual(result.rewrite, {
        applied: true,
        sourceSurface: '刚才那个线圈',
        replacement: '12-120',
        rawOwnerInput: '刚才那个线圈多少钱？',
        workingUtterance: '12-120多少钱？',
        source: 'RESOLVED_OWNER_LANGUAGE_REFERENCE',
        failure: null,
    });
});

test('No reference keeps raw owner language and an unresolved reference never rewrites', () => {
    const none = buildGroundingWorkingUtterance({ rawOwnerInput: 'V750换木箱多少钱？', reference: { status: 'NONE' } });
    const unresolved = buildGroundingWorkingUtterance({ rawOwnerInput: '这个多少钱？', reference: { status: 'UNRESOLVED', surface: '这个' } });
    assert.equal(none.workingUtterance, 'V750换木箱多少钱？');
    assert.equal(none.rewrite.applied, false);
    assert.equal(unresolved.workingUtterance, '这个多少钱？');
    assert.equal(unresolved.rewrite.applied, false);
});

test('Rewrite mismatch fails closed without a Role or resolver input', () => {
    const result = buildGroundingWorkingUtterance({
        rawOwnerInput: '刚才那个线圈多少钱？',
        reference: { status: 'RESOLVED', surface: '不存在的指代', resolvedLanguageReference: '12-120' },
    });
    assert.equal(result.rewrite.failure, 'REFERENCE_REWRITE_MISMATCH');
});

test('Resolved-reference Role input is rewritten and old reference target is filtered before resolver', async () => {
    const resolverCalls = [];
    const result = await run('刚才那个线圈多少钱？', {
        reference: referenceMemo('RESOLVED', '刚才那个线圈', '12-120'),
        role: roleMemo(['ROLE: 刚才那个线圈 | FORMAL_ENTITY_CANDIDATE', 'ROLE: 12-120 | FORMAL_ENTITY_CANDIDATE']),
        resolver: async input => { resolverCalls.push(input); return notFound(input.entityType, input.mention); },
    }, '我先看看12-120。');
    assert.equal(result.workingUtterance, '12-120多少钱？');
    assert.deepEqual(result.candidateProposals.map(target => target.expression), ['12-120']);
    assert.deepEqual(result.rejectedCandidateProposals, [{ expression: '刚才那个线圈', reason: 'NO_MATCH' }]);
    assert.equal(resolverCalls.length, 4);
    assert.ok(resolverCalls.every(call => call.mention === '12-120'));
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
    assert.deepEqual(result.candidateProposals, [{ expression: 'V750', role: 'FORMAL_ENTITY_CANDIDATE', source: 'ROLE_CLASSIFIER', sourceExpression: 'V750', alignedWorkingSpan: 'V750', workingUtterance: 'V750换木箱多少钱？' }]);
});

test('Concept-only roles stop without a resolver and no QUERY_ONLY line is required', async () => {
    let resolverCalls = 0;
    const result = await run('模板和配方有什么区别？', {
        role: roleMemo(['ROLE: 模板 | CONCEPT_ONLY', 'ROLE: 配方 | CONCEPT_ONLY']),
        resolver: async () => { resolverCalls += 1; throw new Error('must not resolve'); },
    });
    assert.equal(result.gate, 'STOP_CONCEPT_ONLY');
    assert.equal(result.probeResults.length, 0);
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
        assert.equal(result.probeResults.length, 1);
        assert.equal(result.probeResults[0].entityType, 'coil');
        assert.equal(result.probeResults[0].status, 'MULTIPLE');
        assert.equal(result.probeResults[0].canonicalId, null);
        assert.equal(result.probeResults[0].candidates.length, 2);
        assert.equal(result.finalGroundedTargets.length, 1);
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

test('Multi-target exact owner-language Role output fans out independently', async () => {
    const calls = [];
    await run('通用款V750、豪贝款V750成本分别多少？', {
        role: roleMemo(['ROLE: 通用款V750 | FORMAL_ENTITY_CANDIDATE', 'ROLE: 豪贝款V750 | FORMAL_ENTITY_CANDIDATE']),
        resolver: async input => { calls.push(input); return notFound(input.entityType, input.mention); },
    });
    assert.equal(calls.length, 8);
    assert.equal(calls.filter(call => call.mention === '通用款V750').length, 4);
    assert.equal(calls.filter(call => call.mention === '豪贝款V750').length, 4);
});

test('Evaluator accepts a supported semantic span and records safely filtered output as a warning', () => {
    const base = { reference: { status: 'NONE', surface: null, resolvedLanguageReference: null }, workingUtterance: 'V750换木箱多少钱？', gate: 'STOP_NO_FORMAL_TARGET', candidateProposals: [], probeResults: [], finalGroundedTargets: [], modelCalls: { role: 1 }, roleMemo: 'ROLE: 换木箱 | CONFIG_VALUE', roles: [{ expression: '换木箱', role: 'CONFIG_VALUE' }] };
    const pass = evaluateGrounding({ user: 'V750换木箱多少钱？', referenceStatus: 'NONE', roles: [{ terms: ['木箱'], role: 'CONFIG_VALUE' }], gate: 'STOP_NO_FORMAL_TARGET', roleCalls: 1, resolverCalls: 0 }, base);
    assert.equal(pass.overall, 'PASS');
    const warning = evaluateGrounding({ user: 'V750换木箱多少钱？', referenceStatus: 'NONE', roles: [{ terms: ['木箱'], role: 'CONFIG_VALUE' }], gate: 'STOP_NO_FORMAL_TARGET', roleCalls: 1, resolverCalls: 0 }, { ...base, roles: [{ expression: '纸箱换木箱', role: 'CONFIG_VALUE' }] });
    assert.equal(warning.overall, 'PASS');
    assert.match(warning.warnings.join(','), /ROLE_OUT_OF_WORKING_UTTERANCE_WARNING/);
});

test('Deterministic Reference Fast Path resolves only a unique compatible owner-language antecedent', () => {
    const coil = resolveReferenceFastPath({
        userInput: '刚才那个线圈多少钱？', recentOwnerWording: '我先看看12-120。', referenceSurface: '刚才那个线圈',
        businessReferenceHint: { entries: [{ expression: '12-120', category: '线圈/线圈方案相关业务表达' }] },
    });
    assert.equal(coil.mode, 'SAFE_RESOLVED');
    assert.equal(coil.resolvedLanguageReference, '12-120');
    const incompatible = resolveReferenceFastPath({
        userInput: '刚才那个线圈多少钱？', recentOwnerWording: '我先看看V750。', referenceSurface: '刚才那个线圈',
        businessReferenceHint: { entries: [{ expression: 'V750', category: '配方/产品配置相关业务表达' }] },
    });
    assert.equal(incompatible.mode, 'SAFE_UNRESOLVED');
});

test('Conservative span alignment only normalizes whitespace and joiners, then returns working text', () => {
    assert.deepEqual(alignRoleExpressionToWorkingUtterance('V750-通用款', 'V750通用款现在成本多少？'), {
        status: 'UNIQUE_MATCH', expression: 'V750-通用款', alignedExpression: 'V750通用款', matchCount: 1,
    });
    assert.equal(alignRoleExpressionToWorkingUtterance('V750豪贝款', 'V750通用款现在成本多少？').status, 'NO_MATCH');
    assert.equal(alignRoleExpressionToWorkingUtterance('12-120', '12-120和12-120分别多少钱？').status, 'AMBIGUOUS');
});

test('High-precision Concept Fast Path detects only explicit definition, comparison, and classification grammar', () => {
    for (const utterance of ['V750是什么？', '12-120是什么意思？', '模板和配方有什么区别？', '不锈钢接轴在我们业务里算什么？', '浮球在我们这里是配置还是固定件？', '木箱和纸箱在我们系统里分别算什么？']) {
        assert.equal(detectConceptQuestionFastPath(utterance).status, 'MATCHED_CONCEPT_ONLY', utterance);
    }
    for (const utterance of ['V750多少钱？', 'V750现在成本多少？', '12-120有几个方案？', '通用款模板有哪些固定件？', 'V750现在用哪个线圈？', '木箱和纸箱分别多少钱？', 'V750和V110分别成本多少？']) {
        assert.equal(detectConceptQuestionFastPath(utterance).status, 'NOT_MATCHED', utterance);
    }
});

test('Resolver probes validate candidate proposals and exclude unsupported proposal noise from final targets', () => {
    const supported = { mention: 'V750', entityType: 'recipe', status: 'MULTIPLE', canonicalId: null, canonicalName: null, candidates: [{ canonicalId: '11', canonicalName: 'V750-通用款' }, { canonicalId: '12', canonicalName: 'V750-豪贝款' }], proposal: { expression: 'V750' } };
    const unresolved = { mention: 'V750成本', entityType: null, status: 'UNRESOLVED', candidates: [], proposal: { expression: 'V750成本' } };
    const result = validateCandidateProposals({ probeResults: [supported, unresolved], workingUtterance: '查一下V750成本。' });
    assert.deepEqual(result.finalGroundedTargets.map(item => item.mention), ['V750']);
    assert.deepEqual(result.unresolvedProposalWarnings.map(item => item.expression), ['V750成本']);
    assert.equal(result.finalGroundedTargets.some(item => item.status === 'UNRESOLVED'), false);
});

test('Qualifier refinement derives a complete exact set from supported multiple resolver evidence', () => {
    const base = { mention: 'V750', entityType: 'recipe', status: 'MULTIPLE', candidates: [{ canonicalId: '11', canonicalName: 'V750-通用款' }, { canonicalId: '12', canonicalName: 'V750-豪贝款' }] };
    const refinement = refineQualifiedTargets({ supportedProbeResults: [base], unresolvedProbeResults: [{ mention: '通用款' }, { mention: '豪贝款' }], workingUtterance: '通用款和豪贝款的V750成本分别多少？' });
    assert.equal(refinement.replacements.get('V750').length, 2);
    assert.deepEqual(refinement.replacements.get('V750').map(item => item.canonicalName), ['V750-通用款', 'V750-豪贝款']);
});

test('Concept Fast Path stops before Role and resolver, but unresolved reference retains priority', async () => {
    let roleCalls = 0;
    let resolverCalls = 0;
    const concept = await run('V750是什么？', {
        role: 'must not run',
        runRoleClassifier: async () => { roleCalls += 1; throw new Error('must not classify'); },
        resolver: async () => { resolverCalls += 1; throw new Error('must not resolve'); },
    });
    assert.equal(concept.conceptFastPath.status, 'MATCHED_CONCEPT_ONLY');
    assert.equal(concept.gate, 'STOP_CONCEPT_ONLY');
    assert.equal(concept.modelCalls.role, 0);
    assert.equal(roleCalls, 0);
    assert.equal(resolverCalls, 0);
    const unresolved = await run('这个是什么？', {
        role: 'must not run',
        runRoleClassifier: async () => { throw new Error('must not classify'); },
    });
    assert.equal(unresolved.gate, 'STOP_UNRESOLVED_REFERENCE');
    assert.equal(unresolved.conceptFastPath, null);
});

test('Resolved reference is rewritten before Concept Fast Path and formal facts continue to Role', async () => {
    let conceptRoleCalls = 0;
    const concept = await run('这个是什么意思？', {
        role: 'must not run',
        runRoleClassifier: async () => { conceptRoleCalls += 1; throw new Error('must not classify'); },
    }, '我先看看12-120。');
    assert.equal(concept.reference.status, 'RESOLVED');
    assert.equal(concept.workingUtterance, '12-120是什么意思？');
    assert.equal(concept.conceptFastPath.status, 'MATCHED_CONCEPT_ONLY');
    assert.equal(conceptRoleCalls, 0);
    let factRoleCalls = 0;
    const fact = await run('这个多少钱？', {
        role: roleMemo(['ROLE: 12-120 | FORMAL_ENTITY_CANDIDATE']),
        runRoleClassifier: async input => { factRoleCalls += 1; assert.equal(input.workingUtterance, '12-120多少钱？'); return roleMemo(['ROLE: 12-120 | FORMAL_ENTITY_CANDIDATE']); },
    }, '我先看看12-120。');
    assert.equal(fact.conceptFastPath.status, 'NOT_MATCHED');
    assert.equal(factRoleCalls, 1);
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
