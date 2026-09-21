'use strict';

const { moneyGuardDecision } = require('../../api/services/aiMoneyGuard.cjs');
const { appendCrossCatalogCandidates } = require('../../api/services/aiCrossCatalogCandidates.cjs');
const { appendMissingCoilVariants } = require('../../api/services/aiCoilVariantAnswer.cjs');
const { enforceBusinessRules } = require('../../api/services/aiBusinessRulebook.cjs');
const {
    LEGACY_RELATION_REPAIR_STATES,
    legacyRelationMissingTools,
    legacyRelationRepairCall,
} = require('../../api/services/aiAssistantRuntime.cjs');
const { buildBusinessSemanticFrame } = require('../../api/business-semantics/frameBuilder.cjs');
const { enforceSemanticAnswerBoundary } = require('../../api/business-semantics/answerBoundary.cjs');

function execution(path, method = 'GET') {
    return { verified: true, kind: 'formal_api_query', calls: [{ method, path }] };
}

function result(name, data, path, extras = {}) {
    const rows = Array.isArray(data);
    return { name, result: { success: true, ...(rows ? {
        count: data.length,
        data,
        queryReceipt: { authoritative: true, totalCount: data.length, returnedCount: data.length,
            truncated: false, possiblyTruncated: false },
    } : { data }), ...extras, executionEvidence: execution(path, name === 'preview_recipe_cost' ? 'POST' : 'GET') } };
}

const recipe = Object.freeze({ id: 550, name: '配方-V550经典款', spec: 'V550', coilId: 220,
    partsJson: '[{"partId":202}]' });
const officialCoils = Object.freeze([
    Object.freeze({ id: 220, spec: '12', sheets: 220, material: '钢带', slotType: '小眼',
        schemeCode: 'COIL-0220-A', schemeStatus: 'official', cost: 102, stock: 4, copperBase: 88 }),
    Object.freeze({ id: 221, spec: '12', sheets: 220, material: '冷轧', slotType: '国标眼',
        schemeCode: 'COIL-0220-B', schemeStatus: 'official', cost: 111, stock: 2, copperBase: 88 }),
]);

function witnessInput(caseKey) {
    if (caseKey === 'LW-01') return {
        userText: '配方-V550经典款当前完整成本是多少',
        answer: '配方-V550经典款当前完整成本是 999 元。',
        toolResults: [
            result('get_all_recipes', [{ ...recipe }], '/api/recipes?keyword=V550'),
            result('full_calculate', { sourceOfTruth: 'costEngine', costBasis: 'currentFullCost',
                recipeCost: { recipeId: 550, recipeName: recipe.name }, totalCost: 201 }, '/api/cost/full-estimate'),
        ],
    };
    if (caseKey === 'LW-02') {
        const candidate = { entityType: 'part', entityLabel: '零件', canonicalId: 800,
            label: '泵壳-V800-平刀', model: '泵壳-V800-平刀' };
        return { userText: 'V800的成本是多少', answer: '没有找到 V800，请重新说明。', toolResults: [
            result('get_all_recipes', [], '/api/recipes?keyword=V800', { crossCatalogCandidates: [candidate] }),
            result('search_templates', [], '/api/templates?shellModel=V800'),
            { name: 'search_parts', result: { success: true, parts: [{ id: 800, model: candidate.model, price: 18.5 }],
                queryReceipt: { authoritative: true, totalCount: 1, returnedCount: 1, truncated: false, possiblyTruncated: false },
                executionEvidence: execution('/api/parts?keyword=V800') } },
        ] };
    }
    if (caseKey === 'LW-03') return { userText: '12-220线圈的成本是多少',
        answer: '12-220钢带小眼方案成本是 102 元。',
        toolResults: [result('search_coils', structuredClone(officialCoils), '/api/coils?spec=12&sheets=220')] };
    if (caseKey === 'LW-04') return { userText: 'V550整机成本是多少', answer: 'V550整机成本是 102 元。',
        toolResults: [result('search_coils', [structuredClone(officialCoils[0])], '/api/coils?spec=12&sheets=220')] };
    if (caseKey === 'LW-05') return { userText: '如果按铜价95算，V550的成本是多少',
        answer: 'V550成本是 201 元。', toolResults: [
            result('get_all_recipes', [{ ...recipe }], '/api/recipes?keyword=V550'),
            result('full_calculate', { sourceOfTruth: 'costEngine', costBasis: 'currentFullCost',
                recipeCost: { recipeId: 550, recipeName: recipe.name }, totalCost: 201 }, '/api/cost/full-estimate'),
            result('get_copper_price', { pricePerKg: 88, dbPrice: 88 }, '/api/copper-price'),
        ] };
    if (caseKey === 'LW-06') return { userText: '12-220钢带小眼线圈用在哪些配方',
        answer: '我暂时无法确认它用在哪些配方。', toolResults: [
            result('search_coils', [structuredClone(officialCoils[0])], '/api/coils?spec=12&sheets=220'),
            { name: 'get_recipes_by_coil', result: { success: true, relation: 'coil.recipes', complete: true,
                setCompleteness: 'COMPLETE', rootCoilId: 220, count: 1, totalCount: 1,
                data: [{ recipeId: 550, recipeName: recipe.name }], executionEvidence: execution('/api/relations/read') } },
        ] };
    throw new Error(`UNKNOWN_LEGACY_WITNESS:${caseKey}`);
}

function legacyOutcome(caseKey, input, bypass = false) {
    if (bypass) return { triggered: false, answer: input.answer };
    if (caseKey === 'LW-01') {
        const decision = moneyGuardDecision(input.answer, input.toolResults);
        return { triggered: decision.action !== 'none', trigger: decision.action,
            answer: decision.action === 'append' ? `${input.answer}\n\n${decision.summary}` : decision.summary };
    }
    if (caseKey === 'LW-02') {
        const answer = appendCrossCatalogCandidates(input.answer, input.toolResults);
        return { triggered: answer !== input.answer, trigger: 'append_candidate', answer };
    }
    if (caseKey === 'LW-03') {
        const answer = appendMissingCoilVariants(input.answer, input.toolResults);
        return { triggered: answer !== input.answer, trigger: 'append_variants', answer };
    }
    if (caseKey === 'LW-04' || caseKey === 'LW-05') {
        const outcome = enforceBusinessRules(input);
        return { triggered: outcome.applied.length > 0, trigger: outcome.applied[0] || null, answer: outcome.answer };
    }
    if (caseKey === 'LW-06') {
        const initial = legacyRelationMissingTools([], LEGACY_RELATION_REPAIR_STATES.NONE);
        const second = legacyRelationMissingTools([input.toolResults[0]], LEGACY_RELATION_REPAIR_STATES.COIL_ID_DISCOVERY);
        const call = legacyRelationRepairCall('get_recipes_by_coil', input.userText, [input.toolResults[0]]);
        return { triggered: initial[0] === 'search_coils' && second[0] === 'get_recipes_by_coil'
            && JSON.parse(call.function.arguments).coilId === 220,
        trigger: 'search_coils_then_get_recipes_by_coil', answer: input.answer };
    }
    throw new Error(`UNKNOWN_LEGACY_WITNESS:${caseKey}`);
}

function semanticOutcome(input) {
    const frame = buildBusinessSemanticFrame({ userText: input.userText, toolResults: input.toolResults, stage: 'POST_EVIDENCE' });
    const boundary = enforceSemanticAnswerBoundary({ frame, answer: input.answer,
        toolResults: input.toolResults, userText: input.userText });
    return { status: frame.completeness.status, answer: boundary.answer, replaced: boundary.replaced,
        verifiedFacts: frame.evidence.verifiedFacts, missingFacts: frame.evidence.missingFacts };
}

function runLegacyWitness(caseKey, { bypass = false } = {}) {
    const input = witnessInput(caseKey);
    return { caseKey, input, legacy: legacyOutcome(caseKey, input, bypass), semantic: semanticOutcome(input), bypass };
}

module.exports = { officialCoils, recipe, result, runLegacyWitness, witnessInput };
