'use strict';

// Formal-only oracle builders. These functions are deliberately separate from
// the Candidate prompt and receive no model response. All calls use the
// existing Executor with allowWrite:false.
function requireFormal(result, label) {
    // Direct Executor calls are formal read/preview receipts but do not carry
    // the Agent adapter's `verified` flag. Accept either representation.
    if (!result?.success || (result?.verified !== true && result?.executionEvidence?.verified !== true)) throw new Error(`FORMAL_ORACLE_UNAVAILABLE:${label}`);
    return result;
}
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function scenarioOracle({ recipeName, scenarioKey, answerMarker, requiredOverrideKeys, result }) {
    const data = requireFormal(result, `scenario:${scenarioKey}`).data || {};
    const candidate = (data.scenarios || []).find(item => item?.scenarioKey === scenarioKey);
    const comparison = (data.comparisons || []).find(item => item?.candidateScenarioKey === scenarioKey);
    if (!candidate?.cost?.complete || candidate?.notApplied?.length || comparison?.status !== 'COMPARABLE' || number(comparison.delta) === null) {
        return { applicability: 'DATA_LIMITATION', reason: 'FORMAL_SCENARIO_NOT_APPLIED_OR_NOT_COMPARABLE' };
    }
    return { kind: 'SCENARIO', recipeName, candidateScenarioKey: scenarioKey, candidateAmount: candidate.cost.currentTotalCost,
        delta: comparison.delta, answerMarker, requiredOverrideKeys };
}
function recipeDetailOracle(result) {
    const data = requireFormal(result, 'recipe-detail');
    return { kind: 'RECIPE_DETAIL', recipeName: data.recipe?.name };
}
function coilCostOracle(coils) {
    const usable = coils.filter(item => item?.schemeCode && number(item.cost) !== null && item.pricingMode === 'kit');
    return usable.length ? { kind: 'COIL_COSTS', costs: [{ canonicalName: usable[0].schemeCode, amount: usable[0].cost, moneyRole: 'CURRENT_FORMAL' }] }
        : { applicability: 'DATA_LIMITATION', reason: 'NO_FORMAL_COIL_DIRECTORY_COST' };
}

async function buildControlledOracles(executeToolCall, ids) {
    const call = (name, args) => executeToolCall(name, args, { allowWrite: false });
    const [coils120, coil12130, detail750, comparison, floatScenario, electrophoresisScenario, rotorScenario, parts, recipesV750] = await Promise.all([
        call('search_coils', { spec: '12', sheets: 120 }),
        call('search_coils', { schemeCode: '12-130-A' }),
        call('get_recipe_detail', { recipeName: 'V750-通用款', includeCurrentCost: true }),
        call('compare_recipes', { recipe1: 'V750-通用款', recipe2: 'V110-通用款' }),
        call('compare_recipe_scenarios', { recipeId: ids.v750General, version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [{ scenarioKey: 'float', label: '浮球', overrides: { hasFloat: true } }] }),
        call('compare_recipe_scenarios', { recipeId: ids.v750General, version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [{ scenarioKey: 'electrophoresis', label: '电泳', overrides: { surfaceTreatmentMode: 'electrophoresis' } }] }),
        call('compare_recipe_scenarios', { recipeId: ids.v750General, version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [{ scenarioKey: 'rotor', label: '不锈钢接轴', overrides: { rotorProcessMode: 'stainless_shaft_joint' } }] }),
        call('search_parts', { keyword: '木箱' }),
        call('get_all_recipes', { keyword: 'V750' }),
    ]);
    const coils120Data = requireFormal(coils120, 'coils-12-120').data || [];
    const coil12130Data = requireFormal(coil12130, 'coil-12-130-A').data || [];
    const difference = requireFormal(comparison, 'recipe-comparison');
    const woodBox = (requireFormal(parts, 'wood-box').parts || []).find(item => item?.model === '木箱');
    const cablePacking = woodBox ? await call('compare_recipe_scenarios', { recipeId: ids.v750General, version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [{
        scenarioKey: 'cable_wood', label: '电缆5米和木箱', overrides: { cableLength: 5, packingParts: [{ partId: woodBox.id, model: woodBox.model, supplier: woodBox.supplier || '', qty: 1, packingRole: 'container' }] },
    }] }) : null;
    const costs = [...coils120Data, ...coil12130Data].filter(item => ['12-120-A', '12-130-A'].includes(item.schemeCode)).map(item => ({ canonicalName: item.schemeCode, amount: item.cost, moneyRole: 'CURRENT_FORMAL' }));
    const v750Recipes = requireFormal(recipesV750, 'V750-ambiguity').data || [];
    return Object.freeze({
        'D1-01': { kind: 'COIL_COUNT', count: coils120.count, queryComplete: coils120.queryReceipt?.truncated === false, candidateNames: coils120Data.map(item => item.schemeCode).filter(Boolean) },
        'D1-02': { kind: 'RECIPE_COIL_RELATION', recipeName: detail750.recipe?.name, coilName: coils120Data.find(item => Number(item.id) === Number(detail750.recipe?.coilId))?.schemeCode || '12-120-A' },
        'D1-03': { kind: 'RECIPE_DIFFERENCE', leftRecipeName: difference.recipe1?.name, rightRecipeName: difference.recipe2?.name, delta: difference.costDiff, direction: 'RIGHT_MINUS_LEFT' },
        'D1-04': costs.length === 2 ? { kind: 'COIL_COSTS', costs } : { applicability: 'DATA_LIMITATION', reason: 'FIXTURE_COIL_COST_ORACLE_INCOMPLETE' },
        'D1-05': scenarioOracle({ recipeName: detail750.recipe?.name, scenarioKey: 'float', answerMarker: '浮球', requiredOverrideKeys: ['hasFloat'], result: floatScenario }),
        'D1-06': scenarioOracle({ recipeName: detail750.recipe?.name, scenarioKey: 'electrophoresis', answerMarker: '电泳', requiredOverrideKeys: ['surfaceTreatmentMode'], result: electrophoresisScenario }),
        'D1-07': scenarioOracle({ recipeName: detail750.recipe?.name, scenarioKey: 'rotor', answerMarker: '不锈钢接轴', requiredOverrideKeys: ['rotorProcessMode'], result: rotorScenario }),
        'D1-08': cablePacking ? scenarioOracle({ recipeName: detail750.recipe?.name, scenarioKey: 'cable_wood', answerMarker: '木箱', requiredOverrideKeys: ['cableLength', 'packingParts'], result: cablePacking }) : { applicability: 'DATA_LIMITATION', reason: 'FIXTURE_WOOD_BOX_NOT_FOUND' },
        'D1-09': { kind: 'CLARIFICATION', answerPattern: /(?:补充|对象|范围|具体)/u },
        'D1-10': { kind: 'AMBIGUITY', candidateNames: v750Recipes.map(item => item.name).filter(Boolean), answerPattern: /(?:确认|选择|具体|哪个)/u },
    });
}

async function buildRealCatalogCases(executeToolCall) {
    const call = (name, args) => executeToolCall(name, args, { allowWrite: false });
    const recipesResult = requireFormal(await call('get_all_recipes', {}), 'real-recipes');
    const coilsResult = requireFormal(await call('search_coils', {}), 'real-coils');
    const recipes = recipesResult.data || []; const coils = coilsResult.data || [];
    const cases = []; const limitations = [];
    const details = [];
    for (const recipe of recipes) {
        try { details.push({ recipe, result: requireFormal(await call('get_recipe_detail', { recipeName: recipe.name, includeCurrentCost: true }), `detail:${recipe.name}`) }); } catch { /* skip incomplete records */ }
    }
    const firstDetail = details[0];
    if (firstDetail) cases.push({ id: 'REAL-01', rawOwnerInput: `查询${firstDetail.result.recipe.name}的正式配方详情。`, oracle: recipeDetailOracle(firstDetail.result) });
    else limitations.push({ id: 'REAL-01', reason: 'NO_READABLE_RECIPE' });
    const grouped = new Map();
    for (const coil of coils) { const key = `${coil.spec}-${coil.sheets}`; grouped.set(key, [...(grouped.get(key) || []), coil]); }
    const candidateGroup = [...grouped.entries()].find(([, rows]) => rows.length > 0);
    if (candidateGroup) {
        const [key, rows] = candidateGroup;
        cases.push({ id: 'REAL-02', rawOwnerInput: `查询${key}有哪些正式线圈方案。`, oracle: { kind: 'COIL_COUNT', count: rows.length, queryComplete: true, candidateNames: rows.map(item => item.schemeCode).filter(Boolean) } });
    } else limitations.push({ id: 'REAL-02', reason: 'NO_COIL_CANDIDATES' });
    const costOracle = coilCostOracle(coils);
    if (costOracle.applicability === 'DATA_LIMITATION') limitations.push({ id: 'REAL-03', reason: costOracle.reason });
    else cases.push({ id: 'REAL-03', rawOwnerInput: `查询${costOracle.costs[0].canonicalName}这个线圈方案的当前成本。`, oracle: costOracle });
    const completeDetails = details.filter(item => item.result.currentCost?.costComplete && number(item.result.currentCost.currentTotalCost) !== null);
    if (completeDetails[0]) {
        cases.push({ id: 'REAL-04', rawOwnerInput: `查询${completeDetails[0].result.recipe.name}当前成本。`, oracle: { kind: 'COIL_COSTS', costs: [{ canonicalName: completeDetails[0].result.recipe.name, amount: completeDetails[0].result.currentCost.currentTotalCost, moneyRole: 'CURRENT_FORMAL' }] } });
    } else limitations.push({ id: 'REAL-04', reason: 'NO_COST_COMPLETE_RECIPE' });
    if (completeDetails.length >= 2) {
        const left = completeDetails[0].result.recipe.name; const right = completeDetails[1].result.recipe.name;
        try {
            const comparison = requireFormal(await call('compare_recipes', { recipe1: left, recipe2: right }), 'real-comparison');
            cases.push({ id: 'REAL-05', rawOwnerInput: `${left}和${right}成本差多少？`, oracle: { kind: 'RECIPE_DIFFERENCE', leftRecipeName: comparison.recipe1.name, rightRecipeName: comparison.recipe2.name, delta: comparison.costDiff, direction: 'RIGHT_MINUS_LEFT' } });
        } catch { limitations.push({ id: 'REAL-05', reason: 'FORMAL_RECIPE_COMPARISON_UNAVAILABLE' }); }
    } else limitations.push({ id: 'REAL-05', reason: 'FEWER_THAN_TWO_COST_COMPLETE_RECIPES' });
    for (const candidate of completeDetails) {
        const recipe = candidate.result.recipe;
        if (Number(recipe.hasFloat) !== 0) continue;
        try {
            const preview = await call('compare_recipe_scenarios', { recipeId: recipe.id, version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [{ scenarioKey: 'float', label: '浮球', overrides: { hasFloat: true } }] });
            const oracle = scenarioOracle({ recipeName: recipe.name, scenarioKey: 'float', answerMarker: '浮球', requiredOverrideKeys: ['hasFloat'], result: preview });
            if (!oracle.applicability) { cases.push({ id: 'REAL-06', rawOwnerInput: `${recipe.name}加浮球以后多少钱？`, oracle }); break; }
        } catch { /* try another suitable recipe */ }
    }
    if (!cases.some(item => item.id === 'REAL-06')) limitations.push({ id: 'REAL-06', reason: 'NO_SAFE_APPLIED_FLOAT_SCENARIO' });
    for (const candidate of completeDetails) {
        const recipe = candidate.result.recipe;
        try {
            const preview = await call('compare_recipe_scenarios', { recipeId: recipe.id, version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [{ scenarioKey: 'rotor', label: '不锈钢接轴', overrides: { rotorProcessMode: 'stainless_shaft_joint' } }] });
            const oracle = scenarioOracle({ recipeName: recipe.name, scenarioKey: 'rotor', answerMarker: '不锈钢接轴', requiredOverrideKeys: ['rotorProcessMode'], result: preview });
            if (!oracle.applicability) { cases.push({ id: 'REAL-RP-01', rawOwnerInput: `${recipe.name}做不锈钢接轴成本差多少？`, oracle }); break; }
        } catch { /* data limitation recorded below */ }
    }
    if (!cases.some(item => item.id === 'REAL-RP-01')) limitations.push({ id: 'REAL-RP-01', reason: 'NO_APPLIED_COMPARABLE_ROTOR_PROCESS_SCENARIO' });
    return Object.freeze({ cases: Object.freeze(cases), limitations: Object.freeze(limitations), catalog: Object.freeze({ recipes: recipes.length, coils: coils.length }) });
}

module.exports = { buildControlledOracles, buildRealCatalogCases, scenarioOracle };
