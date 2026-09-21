'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deterministicSemanticAnswer } = require('../api/business-semantics/answerBoundary.cjs');
const { buildBusinessEvidencePlan } = require('../api/business-semantics/evidencePlanner.cjs');
const { buildBusinessSemanticFrame } = require('../api/business-semantics/frameBuilder.cjs');
const { classifyQuestion } = require('../api/business-semantics/questionSemantics.cjs');
const { validateBusinessSemanticFrame } = require('../api/business-semantics/validator.cjs');

const QUESTION = 'V750大脚板-2寸-经典款如果改成12-120钢带小眼正式线圈，当前成本是多少？只做试算，不要保存。';
const recipe = { id: 13, name: 'V750大脚板-2寸-经典款', spec: '', coilId: 2, coilSpec: '12', coilSheets: 140,
    coilMaterial: '钢带', coilSlotType: '小眼', partsJson: '[{"partId":176}]', savedTotalCost: 288.16 };
const overrideCoil = { id: 9, spec: '12', sheets: 120, material: '钢带', slotType: '小眼', schemeStatus: 'official',
    pricingMode: 'calculated', cost: 102.5, stock: 3 };

function verified(name, data, path, extras = {}) {
    const rows = Array.isArray(data);
    return { name, result: { success: true, ...(rows ? { data, count: data.length,
        queryReceipt: { authoritative: true, totalCount: data.length, returnedCount: data.length,
            truncated: false, possiblyTruncated: false } } : { data }), ...extras,
    executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: name === 'get_all_recipes' ? 'GET' : 'POST', path }] } } };
}
function recipeResult(row = recipe) { return verified('get_all_recipes', [structuredClone(row)], '/api/recipes?keyword=V750'); }
function coilResult() { return verified('search_coils', [structuredClone(overrideCoil)], '/api/coils?spec=12&sheets=120'); }
function preview(overrides = {}) {
    return verified('preview_recipe_cost', {
        recipeId: 13,
        recipeName: recipe.name,
        sourceOfTruth: 'costEngine',
        costBasis: 'overridePreview',
        pricingComplete: true,
        currentTotalCost: 274.42,
        configurationSnapshot: { coilId: 9, coilSpec: '12', coilSheets: 120, coilMaterial: '钢带', coilSlotType: '小眼' },
        ...overrides,
    }, '/api/recipes/13/cost-preview');
}
function currentPreview(overrides = {}) {
    return verified('preview_recipe_cost', { recipeId: 13, recipeName: recipe.name, sourceOfTruth: 'costEngine',
        costBasis: 'currentFullCost', pricingComplete: true, currentTotalCost: 288.16, ...overrides }, '/api/recipes/current-costs');
}

test('SC-01: 生产失败句形进入配置覆盖，正式预览完整且不要求铜价', () => {
    const semantics = classifyQuestion(QUESTION);
    assert.equal(semantics.kind, 'CONFIGURATION_OVERRIDE');
    assert.equal(semantics.configurationOverride, true);
    const toolResults = [recipeResult(), coilResult(), preview()];
    const frame = buildBusinessSemanticFrame({ userText: QUESTION, toolResults, stage: 'POST_EVIDENCE' });
    assert.equal(validateBusinessSemanticFrame(frame), true);
    assert.equal(frame.completeness.status, 'COMPLETE');
    assert.ok(frame.evidence.verifiedFacts.includes('RECIPE_CURRENT_FULL_COST'));
    assert.equal(frame.evidence.requiredFacts.includes('CURRENT_COPPER_PRICE_BASIS'), false);
    assert.match(deterministicSemanticAnswer(frame, toolResults, QUESTION), /274\.42 元/);
});

test('SC-02: 普通当前配方成本由同配方 currentFullCost 回执完成，无铜价读取', () => {
    const userText = `${recipe.name}当前完整成本是多少`;
    const toolResults = [recipeResult(), currentPreview()];
    const frame = buildBusinessSemanticFrame({ userText, toolResults, stage: 'POST_EVIDENCE' });
    assert.equal(frame.completeness.status, 'COMPLETE');
    assert.equal(frame.evidence.requiredFacts.includes('CURRENT_COPPER_PRICE_BASIS'), false);
    const plan = buildBusinessEvidencePlan({ userText, toolResults: [recipeResult()], plannedCallCount: 1 });
    assert.deepEqual(plan.execution.calls.map(item => item.capability), ['full_calculate']);
});

test('SC-03: 假设铜价 95 仍为不支持请求，且保留铜价语义', () => {
    const userText = '如果按照铜价95算，V750的成本是多少';
    const frame = buildBusinessSemanticFrame({ userText, toolResults: [recipeResult(), currentPreview()], stage: 'POST_EVIDENCE' });
    assert.equal(frame.completeness.status, 'UNSUPPORTED_REQUEST');
    assert.ok(frame.evidence.requiredFacts.includes('CURRENT_COPPER_PRICE_BASIS'));
    assert.ok(frame.obligations.requiredDisclosures.includes('DISCLOSE_UNSUPPORTED_HYPOTHETICAL'));
});

test('SC-04: 明确查当前铜价基准必须有独立铜价证据，配方总额不能替代', () => {
    const userText = '系统当前正式铜价基准是多少？';
    const plan = buildBusinessEvidencePlan({ userText });
    assert.deepEqual(plan.execution.calls.map(item => item.capability), ['get_copper_price']);
    const withoutCopper = buildBusinessSemanticFrame({ userText, toolResults: [currentPreview()], stage: 'POST_EVIDENCE' });
    assert.notEqual(withoutCopper.completeness.status, 'COMPLETE');
    assert.ok(withoutCopper.evidence.missingFacts.includes('CURRENT_COPPER_PRICE_BASIS'));
    const copper = verified('get_copper_price', { pricePerKg: 88 }, '/api/copper-price');
    const complete = buildBusinessSemanticFrame({ userText, toolResults: [copper], stage: 'POST_EVIDENCE' });
    assert.equal(complete.completeness.status, 'COMPLETE');
    assert.match(deterministicSemanticAnswer(complete, [copper], userText), /88/);
    const combinedQuestion = `${recipe.name}当前成本和系统采用的铜价基准是多少`;
    const combinedPlan = buildBusinessEvidencePlan({ userText: combinedQuestion, toolResults: [recipeResult()], plannedCallCount: 1 });
    assert.deepEqual(combinedPlan.execution.calls.map(item => item.capability), ['full_calculate', 'get_copper_price']);
});

test('SC-05/06: 保存快照或线圈成本都不能完成整机当前成本', () => {
    const userText = `${recipe.name}当前完整成本是多少`;
    const savedOnly = buildBusinessSemanticFrame({ userText, toolResults: [recipeResult()], stage: 'POST_EVIDENCE' });
    assert.notEqual(savedOnly.completeness.status, 'COMPLETE');
    assert.ok(savedOnly.evidence.missingFacts.includes('RECIPE_CURRENT_FULL_COST'));
    const coilOnly = buildBusinessSemanticFrame({ userText, toolResults: [recipeResult(),
        verified('calculate_coil_cost', { coilId: 2, totalCost: 116.99 }, '/api/coils/calculate')], stage: 'POST_EVIDENCE' });
    assert.notEqual(coilOnly.completeness.status, 'COMPLETE');
});

test('SC-07/08 and M1-M4: 成本回执必须同配方、有口径并证明覆盖已应用', () => {
    for (const badPreview of [
        preview({ configurationSnapshot: { coilId: 2, coilSpec: '12', coilSheets: 140 } }),
        preview({ recipeId: 99 }),
        preview({ costBasis: undefined }),
        preview({ sourceOfTruth: undefined }),
    ]) {
        const frame = buildBusinessSemanticFrame({ userText: QUESTION, toolResults: [recipeResult(), coilResult(), badPreview], stage: 'POST_EVIDENCE' });
        assert.notEqual(frame.completeness.status, 'COMPLETE');
        assert.ok(frame.evidence.missingFacts.includes('RECIPE_CURRENT_FULL_COST'));
    }
    const unlabelledFull = verified('full_calculate', {
        recipeCost: { recipeId: 13, recipeName: recipe.name }, totalCost: 288.16,
    }, '/api/cost/full-estimate');
    const unlabelledFrame = buildBusinessSemanticFrame({ userText: `${recipe.name}当前完整成本是多少`,
        toolResults: [unlabelledFull], stage: 'POST_EVIDENCE' });
    assert.notEqual(unlabelledFrame.completeness.status, 'COMPLETE');
    assert.ok(unlabelledFrame.evidence.missingFacts.includes('RECIPE_CURRENT_FULL_COST'));
    const valid = preview();
    const unrelated = currentPreview({ recipeId: 99, currentTotalCost: 999.99 });
    const frame = buildBusinessSemanticFrame({ userText: QUESTION,
        toolResults: [recipeResult(), coilResult(), unrelated, valid], stage: 'POST_EVIDENCE' });
    assert.equal(frame.completeness.status, 'COMPLETE');
    assert.match(deterministicSemanticAnswer(frame, [recipeResult(), coilResult(), unrelated, valid], QUESTION), /274\.42 元/);
    assert.doesNotMatch(deterministicSemanticAnswer(frame, [recipeResult(), coilResult(), unrelated, valid], QUESTION), /999\.99/);
});

test('M5/M6: 假设铜价不能丢掉铜价要求，整机总额不能冒充铜价证据', () => {
    const userText = '假如按铜价95算，V750的成本是多少';
    const frame = buildBusinessSemanticFrame({ userText, toolResults: [recipeResult(), currentPreview()], stage: 'POST_EVIDENCE' });
    assert.ok(frame.evidence.requiredFacts.includes('CURRENT_COPPER_PRICE_BASIS'));
    assert.ok(frame.evidence.missingFacts.includes('CURRENT_COPPER_PRICE_BASIS'));
    assert.equal(frame.evidence.verifiedFacts.includes('CURRENT_COPPER_PRICE_BASIS'), false);
});

test('SC-01 runtime: 严格串行读取配方、正式线圈和覆盖预览，不读铜价', async () => {
    const { runAiAssistant } = require('../api/services/aiAssistantRuntime.cjs');
    const executed = [];
    let providerCalls = 0;
    const response = await runAiAssistant({ messages: [{ role: 'user', content: QUESTION }],
        env: { AI_BUSINESS_SEMANTIC_ENFORCEMENT_CANARY_ENABLED: 'true', AI_LOCAL_TOOL_SHORTLIST_ENABLED: 'true' } }, {
        loadMemory: async () => ({ items: [] }),
        loadCorrections: () => '',
        executeToolCall: async (name, args) => {
            executed.push({ name, args });
            if (name === 'get_all_recipes') return recipeResult().result;
            if (name === 'search_coils') return coilResult().result;
            if (name === 'preview_recipe_cost') {
                assert.equal(args.recipeId, 13);
                assert.equal(args.overrides.coilId, 9);
                return preview().result;
            }
            throw new Error(`unexpected semantic read ${name}`);
        },
        fetchAiProvider: async () => {
            providerCalls += 1;
            return { json: async () => ({ choices: [{ message: { content: '模型草稿' } }] }) };
        },
    });
    assert.deepEqual(executed.map(item => item.name), ['get_all_recipes', 'search_coils', 'preview_recipe_cost']);
    assert.equal(executed.some(item => item.name === 'get_copper_price'), false);
    assert.equal(providerCalls, 1);
    assert.match(response.finalContent, /274\.42 元/);
    assert.equal(response.telemetry.businessSemanticEnforcement.plannedReads, 3);
});
