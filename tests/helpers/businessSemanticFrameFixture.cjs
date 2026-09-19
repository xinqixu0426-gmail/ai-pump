'use strict';

const definition = require('../fixtures/business-understanding-benchmark-v1.json');

function result(name, data, path, extras = {}) {
    const rows = Array.isArray(data) ? data : null;
    return { name, result: { success: true, ...(rows ? {
        count: rows.length, data: rows,
        queryReceipt: { authoritative: true, totalCount: rows.length, returnedCount: rows.length, truncated: false, possiblyTruncated: false },
    } : { data }), ...extras, executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path }] } } };
}

function withCalls(item, calls) {
    item.result.executionEvidence.calls = calls.map(([method, path]) => ({ method, path }));
    return item;
}

const recipe = { id: 1, name: '配方-V550大脚板-2寸-经典款-12-200', spec: 'V550', coilId: 2,
    partsJson: '[{"partId":1}]', currentCost: { currentTotalCost: 201 } };
const coils200 = [
    { id: 2, spec: '12', sheets: 200, material: '钢带', slotType: '小眼', schemeStatus: 'official', cost: 88, stock: 7 },
    { id: 3, spec: '12', sheets: 200, material: '冷轧', slotType: '国标眼', schemeStatus: 'official', cost: 96, stock: 3 },
];
const coils220 = [
    { id: 4, spec: '12', sheets: 220, material: '钢带', slotType: '小眼', schemeStatus: 'official', cost: 102, stock: 4 },
    { id: 5, spec: '12', sheets: 220, material: '冷轧', slotType: '国标眼', schemeStatus: 'official', cost: 111, stock: 2 },
];

function recipeResult() { return result('get_all_recipes', [structuredClone(recipe)], '/api/recipes?keyword=V550'); }
function coilResult(rows, sheets) { return result('search_coils', structuredClone(rows), `/api/coils?spec=12&sheets=${sheets}`); }
function catalogNegative() {
    return [
        result('get_all_recipes', [], '/api/recipes?keyword=V900'),
        result('search_templates', [], '/api/templates?shellModel=V900'),
        result('search_parts', [], '/api/parts?keyword=V900'),
    ];
}

function semanticCaseFixtures() {
    const questions = Object.fromEntries(definition.coreCases.map(item => [item.caseKey, item.question]));
    return {
        'BU-01': { userText: questions['BU-01'], toolResults: [recipeResult()] },
        'BU-02': { userText: questions['BU-02'], toolResults: [coilResult(coils220, 220)] },
        'BU-03': { userText: questions['BU-03'], toolResults: [{ name: 'get_recipe_detail', result: { success: false,
            crossCatalogCandidates: [{ entityType: 'part', canonicalId: 5, label: '泵壳-V800-平刀' }],
            executionEvidence: { verified: true, kind: 'formal_api_query_failure', calls: [
                { method: 'GET', path: '/api/recipes?keyword=V800' }, { method: 'GET', path: '/api/templates?shellModel=V800' },
                { method: 'GET', path: '/api/parts?keyword=V800' },
            ] } } }] },
        'BU-04': { userText: questions['BU-04'], toolResults: [
            result('full_calculate', { recipeCost: { recipeId: 1, recipeName: recipe.name, recipeSpec: 'V550' }, totalCost: 201 }, '/api/cost/full-estimate'),
            result('get_copper_price', { pricePerKg: 88 }, '/api/copper-price'),
        ] },
        'BU-05': { userText: questions['BU-05'], toolResults: [result('calculate_coil_cost', {
            coilId: 1, spec: '12', sheets: 140, material: '钢带', slotType: '小眼', wireWeight: 0.8,
            requestedWireWeight: 0.8, appliedWireWeight: 0.8, wireWeightAuthority: 'OVERRIDABLE',
            overrideStatus: 'APPLIED', isCustomWireWeight: true, totalCost: 91,
        }, '/api/coils/calculate')] },
        'BU-06': { userText: questions['BU-06'], toolResults: [recipeResult(), coilResult(coils200, 200)] },
        'BU-07': { userText: questions['BU-07'], toolResults: catalogNegative() },
        'BU-08': { userText: questions['BU-08'], toolResults: [coilResult(coils200, 200)] },
        'BU-09': { userText: questions['BU-09'], toolResults: [{ name: 'preview_recipe_cost', result: { success: false,
            code: 'AI_RESOURCE_NOT_FOUND', executionEvidence: { verified: true, kind: 'formal_api_query_failure', calls: [{ method: 'GET', path: '/api/recipes' }] } } }] },
        'BU-10': { userText: questions['BU-10'], toolResults: [recipeResult(), coilResult(coils220, 220)] },
    };
}

module.exports = { catalogNegative, coilResult, coils200, coils220, recipe, recipeResult, result, semanticCaseFixtures };
