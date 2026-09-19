'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BusinessEvidencePlanV1, EnforcementFlag, MAX_SEMANTIC_EVIDENCE_CALLS } = require('../api/business-semantics/evidencePlanContract.cjs');
const { FactCapabilityRegistry } = require('../api/business-semantics/factCapabilityRegistry.cjs');
const { buildBusinessEvidencePlan } = require('../api/business-semantics/evidencePlanner.cjs');
const { validateBusinessEvidencePlan } = require('../api/business-semantics/evidencePlanValidator.cjs');
const { buildBusinessSemanticFrame } = require('../api/business-semantics/frameBuilder.cjs');
const { enforceSemanticAnswerBoundary } = require('../api/business-semantics/answerBoundary.cjs');
const { semanticCaseFixtures, result, recipe, recipeResult, coilResult, coils220 } = require('./helpers/businessSemanticFrameFixture.cjs');

test('BusinessEvidencePlanV1 is immutable, default-off named, bounded to the derived three-call maximum', () => {
    assert.equal(BusinessEvidencePlanV1.version, 1);
    assert.equal(EnforcementFlag, 'AI_BUSINESS_SEMANTIC_ENFORCEMENT_CANARY_ENABLED');
    assert.equal(MAX_SEMANTIC_EVIDENCE_CALLS, 3);
    assert.equal(Object.isFrozen(BusinessEvidencePlanV1), true);
    assert.equal(Object.isFrozen(FactCapabilityRegistry), true);
});

test('all semantic facts have one reviewed existing-capability registry entry', () => {
    assert.deepEqual(Object.keys(FactCapabilityRegistry).sort(), [...BusinessEvidencePlanV1.factTypes].sort());
    for (const mapping of Object.values(FactCapabilityRegistry)) {
        assert.equal(mapping.sourcePolicy, 'FORMAL_API_ONLY');
        assert.ok(typeof mapping.capability === 'string' || Array.isArray(mapping.capability));
    }
});

test('BU-04 resolves the recipe before bounded current-cost and formal copper-basis reads', () => {
    const userText = '如果按照铜价95算，V550的成本是多少';
    const first = buildBusinessEvidencePlan({ userText });
    assert.equal(validateBusinessEvidencePlan(first), true);
    assert.deepEqual(first.execution.calls.map(item => item.capability), ['get_all_recipes']);
    const resolvedRecipe = recipeResult();
    resolvedRecipe.result.data[0].coilSpec = '12';
    resolvedRecipe.result.data[0].coilSheets = 200;
    const second = buildBusinessEvidencePlan({ userText, toolResults: [resolvedRecipe], plannedCallCount: 1 });
    assert.deepEqual(second.execution.calls.map(item => item.capability), ['full_calculate', 'search_coils']);
    assert.equal(second.execution.calls[0].argumentProvenance[0].source, 'VERIFIED_PRIOR_FACT');
});

test('BU-06 waits for canonical recipe and coil evidence before the sole bounded preview', () => {
    const userText = 'V550大脚板-2寸-经典款，线圈用12-200的';
    const first = buildBusinessEvidencePlan({ userText });
    assert.deepEqual(first.execution.calls.map(item => item.capability).sort(), ['get_all_recipes', 'search_coils']);
    const second = buildBusinessEvidencePlan({ userText, toolResults: [recipeResult(), coilResult(require('./helpers/businessSemanticFrameFixture.cjs').coils200, 200)], plannedCallCount: 2 });
    assert.deepEqual(second.execution.calls.map(item => item.capability), ['preview_recipe_cost']);
    assert.deepEqual(second.execution.calls[0].dependsOnFacts, ['RECIPE_CANONICAL_IDENTITY', 'RECIPE_BASE_CONFIGURATION', 'COIL_CANONICAL_IDENTITY']);
    assert.equal(second.execution.calls[0].arguments.useRecipeBaseline, false);
});

test('BU-10 ambiguity stops before cost preview and exposes the complete formal candidate set', () => {
    const userText = 'V550大脚板-2寸-经典款，线圈换成12-220重新算';
    const plan = buildBusinessEvidencePlan({ userText, toolResults: [recipeResult(), coilResult(coils220, 220)], plannedCallCount: 2 });
    assert.deepEqual(plan.execution.calls, []);
    const frame = buildBusinessSemanticFrame({ userText, toolResults: [recipeResult(), coilResult(coils220, 220)], stage: 'POST_EVIDENCE' });
    const boundary = enforceSemanticAnswerBoundary({ frame, answer: '总成本 123 元', toolResults: [recipeResult(), coilResult(coils220, 220)], userText });
    assert.equal(boundary.status, 'NEEDS_CLARIFICATION');
    assert.match(boundary.answer, /钢带\/小眼/);
    assert.match(boundary.answer, /冷轧\/国标眼/);
    assert.doesNotMatch(boundary.answer, /总成本\s*123/);
});

test('BU-09 remains alias-unresolved and replaces a false not-found claim with clarification', () => {
    const input = semanticCaseFixtures()['BU-09'];
    const frame = buildBusinessSemanticFrame({ ...input, stage: 'POST_EVIDENCE' });
    const plan = buildBusinessEvidencePlan(input);
    assert.deepEqual(plan.execution.calls.map(item => item.capability), ['get_all_recipes']);
    const boundary = enforceSemanticAnswerBoundary({ frame, answer: '系统没有找到 V550。', toolResults: input.toolResults, userText: input.userText });
    assert.equal(frame.completeness.status, 'NEEDS_CLARIFICATION');
    assert.match(boundary.answer, /正式别名映射/);
    assert.match(boundary.answer, /不能据此断言对象不存在/);
});

test('mutations M1-M8 fail safe at frame or answer boundary', () => {
    const fixtures = semanticCaseFixtures();
    const missingCost = buildBusinessSemanticFrame({ userText: fixtures['BU-01'].userText, toolResults: [], stage: 'POST_EVIDENCE' });
    assert.notEqual(missingCost.completeness.status, 'COMPLETE'); // M1
    const wrongLevel = buildBusinessSemanticFrame({ userText: fixtures['BU-01'].userText,
        toolResults: [result('calculate_coil_cost', { coilId: 2, totalCost: 88 }, '/api/coils/calculate')], stage: 'POST_EVIDENCE' });
    assert.notEqual(wrongLevel.completeness.status, 'COMPLETE'); // M2
    const unsupported = buildBusinessSemanticFrame({ ...fixtures['BU-04'], stage: 'POST_EVIDENCE' });
    assert.doesNotMatch(enforceSemanticAnswerBoundary({ frame: unsupported, answer: '按铜价95算成本是300元',
        toolResults: fixtures['BU-04'].toolResults, userText: fixtures['BU-04'].userText }).answer, /按铜价95算成本是300/); // M3
    const ambiguous = buildBusinessSemanticFrame({ ...fixtures['BU-10'], stage: 'POST_EVIDENCE' });
    assert.equal(ambiguous.completeness.status, 'NEEDS_CLARIFICATION'); // M4
    const partialAbsence = buildBusinessSemanticFrame({ userText: fixtures['BU-07'].userText,
        toolResults: [fixtures['BU-07'].toolResults[0]], stage: 'POST_EVIDENCE' });
    assert.notEqual(partialAbsence.completeness.status, 'NOT_FOUND_VERIFIED'); // M5
    const failed = buildBusinessSemanticFrame({ userText: fixtures['BU-01'].userText,
        toolResults: [{ name: 'get_all_recipes', result: { success: false, code: 'TIMEOUT' } }], stage: 'POST_EVIDENCE' });
    assert.equal(failed.completeness.status, 'NEEDS_EVIDENCE'); // M6
    const partialBoundary = enforceSemanticAnswerBoundary({ frame: partialAbsence, answer: '已经全部核实，系统没有 V900。',
        toolResults: [fixtures['BU-07'].toolResults[0]], userText: fixtures['BU-07'].userText });
    assert.doesNotMatch(partialBoundary.answer, /已经全部核实/); // M7
    const selected = enforceSemanticAnswerBoundary({ frame: ambiguous, answer: '采用钢带小眼方案，总成本123元。',
        toolResults: fixtures['BU-10'].toolResults, userText: fixtures['BU-10'].userText });
    assert.match(selected.answer, /请确认材质和槽眼/); // M8
});

test('runtime enforcement performs two deterministic reads, one synthesis call, no writes, and returns boundary output', async () => {
    const { runAiAssistant } = require('../api/services/aiAssistantRuntime.cjs');
    let providerCalls = 0;
    const executed = [];
    const response = await runAiAssistant({ messages: [{ role: 'user', content: '假如线重按0.8算，12-140的成本是多少' }],
        env: { AI_BUSINESS_SEMANTIC_ENFORCEMENT_CANARY_ENABLED: 'true', AI_LOCAL_TOOL_SHORTLIST_ENABLED: 'true' } }, {
        loadMemory: async () => ({ items: [] }), loadCorrections: () => '',
        executeToolCall: async (name, args) => {
            executed.push({ name, args });
            if (name === 'search_coils') return { success: true, data: [{ id: 7, spec: '12', sheets: 140, material: '钢带', slotType: '小眼', schemeStatus: 'official', cost: 80, stock: 1 }],
                queryReceipt: { authoritative: true, totalCount: 1, returnedCount: 1, truncated: false, possiblyTruncated: false },
                executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/coils?spec=12&sheets=140' }] } };
            if (name === 'calculate_coil_cost') return { success: true, data: { coilId: 7, spec: '12', sheets: 140, wireWeight: 0.8,
                requestedWireWeight: 0.8, appliedWireWeight: 0.8, wireWeightAuthority: 'OVERRIDABLE', overrideStatus: 'APPLIED',
                isCustomWireWeight: true, totalCost: 91 },
                executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'POST', path: '/api/coils/calculate' }] } };
            throw new Error(`unexpected ${name}`);
        },
        fetchAiProvider: async () => { providerCalls += 1; return { json: async () => ({ choices: [{ message: { content: '模型草稿' } }] }) }; },
    });
    assert.deepEqual(executed.map(item => item.name), ['search_coils', 'calculate_coil_cost']);
    assert.equal(providerCalls, 1);
    assert.match(response.finalContent, /线重 0\.8/);
    assert.match(response.finalContent, /91\.00 元/);
    assert.equal(response.telemetry.businessSemanticEnforcement.plannedReads, 2);
    assert.equal(response.toolResults.every(item => item.planningSource === 'BUSINESS_SEMANTIC_EVIDENCE_PLAN'), true);
    assert.equal(response.toolResults.some(item => /^(create|update|delete|adjust|execute|save)_/.test(item.name)), false);
});

test('P3-A formal recipe alias resolves the same canonical target in five runtime runs', async () => {
    const { runAiAssistant } = require('../api/services/aiAssistantRuntime.cjs');
    let providerCalls = 0;
    const offered = [];
    const canonicalTargets = [];
    for (let run = 0; run < 5; run += 1) {
        const response = await runAiAssistant({ messages: [{ role: 'user', content: '老V550经典款的成本是多少' }],
            env: { AI_BUSINESS_SEMANTIC_ENFORCEMENT_CANARY_ENABLED: 'true' } }, {
            loadMemory: async () => ({ items: [] }), loadCorrections: () => '',
            executeToolCall: async (name, args) => {
                if (name === 'get_all_recipes') {
                    assert.deepEqual(args, { keyword: '老V550经典款' });
                    return result(name, [{ ...recipe, currentCost: undefined }], '/api/recipes/1', {
                        identityResolution: {
                            entityType: 'recipe', state: 'FORMAL_ALIAS_MATCH', candidateCount: 1,
                            canonicalType: 'recipe', canonicalId: '1', canonicalCurrentName: recipe.name,
                            matchedAlias: '老V550经典款', provenance: { kind: 'formal_persisted_alias', sourceOfTruth: 'catalog_name_aliases+catalog_identity_profiles+recipes', targetActive: true },
                        },
                    }).result;
                }
                assert.equal(name, 'full_calculate');
                assert.deepEqual(args, { recipeName: recipe.name });
                return result(name, { recipeCost: { recipeId: 1, recipeName: recipe.name, recipeSpec: 'V550' }, totalCost: 201 }, '/api/cost/full-estimate').result;
            },
            fetchAiProvider: async (_messages, options) => { providerCalls += 1; offered.push(options.tools || []);
                return { json: async () => ({ choices: [{ message: { content: '模型草稿' } }] }) }; },
        });
        assert.deepEqual(response.toolResults.map(item => item.name), ['get_all_recipes', 'full_calculate']);
        assert.equal(response.toolResults.every(item => item.planningSource === 'BUSINESS_SEMANTIC_EVIDENCE_PLAN'), true);
        assert.match(response.finalContent, new RegExp(recipe.name));
        assert.match(response.finalContent, /201\.00 元/);
        canonicalTargets.push(buildBusinessSemanticFrame({ userText: '老V550经典款的成本是多少', toolResults: response.toolResults,
            stage: 'POST_EVIDENCE' }).subject.canonicalId);
    }
    assert.equal(providerCalls, 5);
    assert.deepEqual(offered, [[], [], [], [], []]);
    assert.deepEqual(canonicalTargets, [1, 1, 1, 1, 1]);
});

test('P3-B supplier-kit wire weight remains truthfully unsupported in five runtime runs', async () => {
    const { runAiAssistant } = require('../api/services/aiAssistantRuntime.cjs');
    for (let run = 0; run < 5; run += 1) {
        const response = await runAiAssistant({ messages: [{ role: 'user', content: '假如线重按0.8算，12-140的成本是多少' }],
            env: { AI_BUSINESS_SEMANTIC_ENFORCEMENT_CANARY_ENABLED: 'true', AI_LOCAL_TOOL_SHORTLIST_ENABLED: 'true' } }, {
            loadMemory: async () => ({ items: [] }), loadCorrections: () => '',
            executeToolCall: async name => name === 'search_coils' ? {
                success: true,
                data: [{ id: 7, spec: '12', sheets: 140, material: '钢带', slotType: '小眼', schemeStatus: 'official', pricingMode: 'kit', kitPrice: 70, cost: 70, stock: 1 }],
                queryReceipt: { authoritative: true, totalCount: 1, returnedCount: 1, truncated: false, possiblyTruncated: false },
                executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/coils?spec=12&sheets=140' }] },
            } : {
                success: true,
                data: { coilId: 7, spec: '12', sheets: 140, pricingMode: 'kit', kitPrice: 70, totalCost: 70,
                    wireWeight: 0.5, requestedWireWeight: 0.8, appliedWireWeight: null,
                    wireWeightAuthority: 'NON_OVERRIDABLE', overrideStatus: 'UNSUPPORTED_FOR_PRICING_MODE', isCustomWireWeight: false },
                executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'POST', path: '/api/coils/calculate' }] },
            },
            fetchAiProvider: async () => ({ json: async () => ({ choices: [{ message: { content: '模型草稿' } }] }) }),
        });
        assert.match(response.finalContent, /线重 0\.8 未被正式能力应用/);
        assert.doesNotMatch(response.finalContent, /已按用户指定线重/);
        const frame = buildBusinessSemanticFrame({ userText: '假如线重按0.8算，12-140的成本是多少',
            toolResults: response.toolResults, stage: 'POST_EVIDENCE' });
        assert.equal(frame.evidence.facts.find(item => item.factType === 'COIL_OVERRIDE_APPLIED').state, 'UNSUPPORTED');
    }
});

test('P3-B semantic layer never promotes an invented or legacy override claim without formal applied evidence', () => {
    const userText = '假如线重按0.8算，12-140的成本是多少';
    const toolResults = [
        coilResult([{ id: 7, spec: '12', sheets: 140, material: '钢带', slotType: '小眼', schemeStatus: 'official', cost: 80, stock: 1 }], 140),
        result('calculate_coil_cost', { coilId: 7, spec: '12', sheets: 140, wireWeight: 0.8,
            isCustomWireWeight: true, totalCost: 91 }, '/api/coils/calculate'),
    ];
    const frame = buildBusinessSemanticFrame({ userText, toolResults, stage: 'POST_EVIDENCE' });
    assert.notEqual(frame.evidence.facts.find(item => item.factType === 'COIL_OVERRIDE_APPLIED').state, 'VERIFIED');
    assert.notEqual(frame.completeness.status, 'COMPLETE');
});

test('P3-A get_all_recipes consumes formal alias authority before bounded canonical detail read', async () => {
    const { executeQueryTool } = require('../api/routes/ai/executors/queryExecutors.cjs');
    const calls = [];
    const internalFetch = async (path, options = {}) => {
        calls.push({ path, method: options.method || 'GET' });
        const data = path === '/api/recipes?keyword=%E8%80%81V550%E7%BB%8F%E5%85%B8%E6%AC%BE' ? [] : path === '/api/entity-lookup' ? {
            version: 1, status: 'OK', complete: true, attemptedEntityTypes: 1, candidateCount: 1,
            candidates: [{ entityType: 'recipe', canonicalId: '1', matchKind: 'APPROVED_ALIAS' }],
            resolutions: [{ entityType: 'recipe', state: 'FORMAL_ALIAS_MATCH', candidateCount: 1,
                canonicalType: 'recipe', canonicalId: '1', canonicalCurrentName: recipe.name, matchedAlias: '老V550经典款',
                provenance: { kind: 'formal_persisted_alias', sourceOfTruth: 'catalog_name_aliases+catalog_identity_profiles+recipes', targetActive: true } }],
        } : { ...recipe, currentCost: undefined };
        return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data }) };
    };
    internalFetch.recordApiResult = () => {};
    const output = await executeQueryTool('get_all_recipes', { keyword: '老V550经典款' }, internalFetch);
    assert.deepEqual(calls, [
        { path: '/api/recipes?keyword=%E8%80%81V550%E7%BB%8F%E5%85%B8%E6%AC%BE', method: 'GET' },
        { path: '/api/entity-lookup', method: 'POST' },
        { path: '/api/recipes/1', method: 'GET' },
    ]);
    assert.equal(output.count, 1);
    assert.equal(output.data[0].id, 1);
    assert.equal(output.identityResolution.state, 'FORMAL_ALIAS_MATCH');
    assert.equal(output.identityResolution.canonicalCurrentName, recipe.name);
});
