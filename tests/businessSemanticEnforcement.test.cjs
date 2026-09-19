'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BusinessEvidencePlanV1, EnforcementFlag, MAX_SEMANTIC_EVIDENCE_CALLS } = require('../api/business-semantics/evidencePlanContract.cjs');
const { FactCapabilityRegistry } = require('../api/business-semantics/factCapabilityRegistry.cjs');
const { buildBusinessEvidencePlan } = require('../api/business-semantics/evidencePlanner.cjs');
const { validateBusinessEvidencePlan } = require('../api/business-semantics/evidencePlanValidator.cjs');
const { buildBusinessSemanticFrame } = require('../api/business-semantics/frameBuilder.cjs');
const { enforceSemanticAnswerBoundary } = require('../api/business-semantics/answerBoundary.cjs');
const { semanticCaseFixtures, result, recipeResult, coilResult, coils220 } = require('./helpers/businessSemanticFrameFixture.cjs');

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
            if (name === 'calculate_coil_cost') return { success: true, data: { coilId: 7, spec: '12', sheets: 140, wireWeight: 0.8, isCustomWireWeight: true, totalCost: 91 },
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

test('runtime alias clarification performs one candidate read, offers no model tools, and remains deterministic', async () => {
    const { runAiAssistant } = require('../api/services/aiAssistantRuntime.cjs');
    let providerCalls = 0;
    const offered = [];
    const response = await runAiAssistant({ messages: [{ role: 'user', content: '老V550经典款的成本是多少' }],
        env: { AI_BUSINESS_SEMANTIC_ENFORCEMENT_CANARY_ENABLED: 'true' } }, {
        loadMemory: async () => ({ items: [] }), loadCorrections: () => '',
        executeToolCall: async (name, args) => {
            assert.equal(name, 'get_all_recipes');
            assert.deepEqual(args, { keyword: 'V550' });
            return recipeResult().result;
        },
        fetchAiProvider: async (_messages, options) => { providerCalls += 1; offered.push(options.tools || []);
            return { json: async () => ({ choices: [{ message: { content: '模型草稿' } }] }) }; },
    });
    assert.equal(providerCalls, 1);
    assert.deepEqual(offered, [[]]);
    assert.deepEqual(response.toolResults.map(item => item.name), ['get_all_recipes']);
    assert.equal(response.toolResults[0].planningSource, 'BUSINESS_SEMANTIC_EVIDENCE_PLAN');
    assert.match(response.finalContent, /正式别名映射/);
});
