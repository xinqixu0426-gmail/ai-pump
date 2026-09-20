'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const definition = require('./fixtures/production-shape-regression-v1.json');
const { authoritativeCoilCandidateScope } = require('../api/business-semantics/authoritativeCandidateScope.cjs');
const { deterministicSemanticAnswer } = require('../api/business-semantics/answerBoundary.cjs');
const { buildBusinessEvidencePlan } = require('../api/business-semantics/evidencePlanner.cjs');
const { buildBusinessSemanticFrame } = require('../api/business-semantics/frameBuilder.cjs');
const { classifyQuestion } = require('../api/business-semantics/questionSemantics.cjs');
const { validateBusinessSemanticFrame } = require('../api/business-semantics/validator.cjs');

function question(caseKey) {
    return definition.cases.find(item => item.caseKey === caseKey).question;
}

function result(name, data, path, extras = {}) {
    const rows = Array.isArray(data) ? data : null;
    return { name, result: { success: true, ...(rows ? {
        count: rows.length,
        data,
        queryReceipt: {
            authoritative: true,
            totalCount: rows.length,
            returnedCount: rows.length,
            truncated: false,
            possiblyTruncated: false,
        },
    } : { data }), ...extras, executionEvidence: {
        verified: true,
        kind: 'formal_api_query',
        calls: [{ method: name === 'preview_recipe_cost' ? 'POST' : 'GET', path }],
    } } };
}

const baseRecipe = {
    id: 21,
    name: '基准水泵配方',
    spec: 'P4R-FIXTURE',
    coilId: 1,
    partsJson: '[{"partId":301}]',
};
const official200 = {
    id: 12,
    spec: '12',
    sheets: 200,
    material: '钢带',
    slotType: '小眼',
    schemeStatus: 'official',
    cost: 88,
    stock: 0,
};
const testing200 = {
    id: 5,
    spec: '12',
    sheets: 200,
    material: '钢带',
    slotType: '小眼',
    schemeStatus: 'testing',
    cost: 87,
    stock: 100,
};

function recipeResult() {
    return result('get_all_recipes', [structuredClone(baseRecipe)], '/api/recipes?keyword=base');
}

test('ProductionShapeRegressionV1 is separately versioned with PS-01 through PS-05', () => {
    assert.equal(definition.version, 'ProductionShapeRegressionV1');
    assert.deepEqual(definition.cases.map(item => item.caseKey), ['PS-01', 'PS-02', 'PS-03', 'PS-04', 'PS-05']);
});

test('PS-01: a complete official inventory set is COMPLETE despite a testing sibling', () => {
    const userText = question('PS-01');
    const coils = result('search_coils', [official200, testing200], '/api/coils?spec=12&sheets=200');
    const frame = buildBusinessSemanticFrame({ userText, toolResults: [coils], stage: 'POST_EVIDENCE' });
    assert.equal(validateBusinessSemanticFrame(frame), true);
    assert.equal(frame.completeness.status, 'COMPLETE');
    assert.deepEqual(frame.evidence.facts.find(item => item.factType === 'COIL_OFFICIAL_VARIANT_SET').canonicalIds, [12]);
    assert.deepEqual(frame.evidence.facts.find(item => item.factType === 'COIL_VARIANT_INVENTORY').canonicalIds, [12]);
    assert.match(deterministicSemanticAnswer(frame, [coils], userText), /无货 0/);
    assert.doesNotMatch(deterministicSemanticAnswer(frame, [coils], userText), /有货 100/);
    const testingScope = authoritativeCoilCandidateScope([official200, testing200], classifyQuestion('12-200 测试方案库存'));
    assert.deepEqual(testingScope.rows.map(row => row.id), [5]);
});

test('PS-02: a verified catalog price is retained and labelled as part unit cost', () => {
    const userText = question('PS-02');
    const toolResults = [
        result('get_all_recipes', [], '/api/recipes?keyword=bearing'),
        result('search_templates', [], '/api/templates?shellModel=bearing'),
        result('search_parts', [{ id: 149, model: '轴承-201', category: '轴承', supplier: 'fixture', price: 1.1, stock: 0 }], '/api/parts?keyword=bearing'),
    ];
    const frame = buildBusinessSemanticFrame({ userText, toolResults, stage: 'POST_EVIDENCE' });
    const initialPlan = buildBusinessEvidencePlan({ userText });
    assert.deepEqual(initialPlan.execution.calls.map(item => item.capability), ['get_all_recipes']);
    const catalogPlan = buildBusinessEvidencePlan({ userText, toolResults: [toolResults[0]], plannedCallCount: 1 });
    assert.deepEqual(catalogPlan.execution.calls.map(item => item.capability), ['search_templates', 'search_parts']);
    assert.equal(validateBusinessSemanticFrame(frame), true);
    assert.equal(frame.completeness.status, 'COMPLETE');
    assert.equal(frame.cost.requestedBasis, 'PART_CATALOG_UNIT_COST');
    assert.equal(frame.cost.actualBasis, 'PART_CATALOG_UNIT_COST');
    assert.ok(frame.evidence.verifiedFacts.includes('PART_CATALOG_UNIT_COST'));
    const answer = deterministicSemanticAnswer(frame, toolResults, userText);
    assert.match(answer, /1\.10 元/);
    assert.match(answer, /零件目录单位成本/);
    assert.match(answer, /不是整机或配方成本/);
});

test('PS-03: verified not-found retains bounded requested text without inventing identity', () => {
    const userText = question('PS-03');
    const toolResults = [
        result('get_all_recipes', [], '/api/recipes?keyword=missing'),
        result('search_templates', [], '/api/templates?shellModel=missing'),
        result('search_parts', [], '/api/parts?keyword=missing'),
    ];
    const frame = buildBusinessSemanticFrame({ userText, toolResults, stage: 'POST_EVIDENCE' });
    const initialPlan = buildBusinessEvidencePlan({ userText });
    assert.deepEqual(initialPlan.execution.calls.map(item => item.capability), ['get_all_recipes']);
    const catalogPlan = buildBusinessEvidencePlan({ userText, toolResults: [toolResults[0]], plannedCallCount: 1 });
    assert.deepEqual(catalogPlan.execution.calls.map(item => item.capability), ['search_templates', 'search_parts']);
    assert.equal(validateBusinessSemanticFrame(frame), true);
    assert.equal(frame.completeness.status, 'NOT_FOUND_VERIFIED');
    assert.equal(frame.subject.requestedToken, 'P4R-不存在-900');
    assert.equal(frame.subject.canonicalType, null);
    assert.equal(frame.subject.canonicalId, null);
    assert.match(deterministicSemanticAnswer(frame, toolResults, userText), /P4R-不存在-900/);
});

test('PS-04: one official override plus a testing sibling becomes COMPLETE only after formal preview', () => {
    const userText = question('PS-04');
    const coils = result('search_coils', [official200, testing200], '/api/coils?spec=12&sheets=200');
    const withoutPreview = buildBusinessSemanticFrame({ userText, toolResults: [recipeResult(), coils], stage: 'POST_EVIDENCE' });
    assert.equal(withoutPreview.completeness.status, 'PARTIAL_VERIFIED');
    assert.ok(withoutPreview.evidence.missingFacts.includes('RECIPE_CURRENT_FULL_COST'));
    const plan = buildBusinessEvidencePlan({ userText, toolResults: [recipeResult(), coils], plannedCallCount: 2 });
    assert.equal(plan.execution.calls.length, 1);
    assert.equal(plan.execution.calls[0].capability, 'preview_recipe_cost');
    assert.equal(plan.execution.calls[0].arguments.overrides.coilId, 12);
    const preview = result('preview_recipe_cost', {
        recipeId: 21,
        recipeName: baseRecipe.name,
        currentTotalCost: 316.61,
        sourceOfTruth: 'costEngine',
        costBasis: 'overridePreview',
    }, '/api/recipes/21/cost-preview');
    const toolResults = [recipeResult(), coils, preview];
    const frame = buildBusinessSemanticFrame({ userText, toolResults, stage: 'POST_EVIDENCE' });
    assert.equal(validateBusinessSemanticFrame(frame), true);
    assert.equal(frame.completeness.status, 'COMPLETE');
    assert.equal(frame.override.supportStatus, 'SUPPORTED_OVERRIDE');
    assert.deepEqual(frame.evidence.facts.find(item => item.factType === 'COIL_CANONICAL_IDENTITY').canonicalIds, [12]);
    assert.match(deterministicSemanticAnswer(frame, toolResults, userText), /316\.61 元/);
});

test('PS-05: two official override targets remain ambiguous even with a testing sibling', () => {
    const userText = question('PS-05');
    const coils = result('search_coils', [
        { ...official200, id: 22, sheets: 220, stock: 4 },
        { ...official200, id: 23, sheets: 220, material: '冷轧', slotType: '国标眼', stock: 2 },
        { ...testing200, id: 24, sheets: 220 },
    ], '/api/coils?spec=12&sheets=220');
    const toolResults = [recipeResult(), coils];
    const frame = buildBusinessSemanticFrame({ userText, toolResults, stage: 'POST_EVIDENCE' });
    assert.equal(validateBusinessSemanticFrame(frame), true);
    assert.equal(frame.completeness.status, 'NEEDS_CLARIFICATION');
    assert.equal(frame.override.supportStatus, 'AMBIGUOUS_OVERRIDE');
    assert.equal(frame.ambiguity.candidateCount, 2);
    assert.deepEqual(buildBusinessEvidencePlan({ userText, toolResults, plannedCallCount: 2 }).execution.calls, []);
    const answer = deterministicSemanticAnswer(frame, toolResults, userText);
    assert.match(answer, /2 套正式线圈方案/);
    assert.doesNotMatch(answer, /正式试算的当前完整成本/);
});
