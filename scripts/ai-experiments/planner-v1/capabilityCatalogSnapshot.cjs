'use strict';

const { listBusinessCapabilities } = require('../../../api/capabilities/registry.cjs');

const PLANNER_VISIBLE_IDS = Object.freeze(['templates.detail', 'recipes.current_costs', 'relations.read', 'cost.recipe_difference', 'coils.list', 'recipes.scenario_compare_preview']);
const FACT_CLASSES = Object.freeze(['FORMAL_DETAIL', 'CURRENT_COST', 'RELATION', 'CANDIDATE_SET', 'SCENARIO_COST', 'SCENARIO_COMPARISON', 'COST_DIFFERENCE', 'DERIVED_COMPUTE', 'OTHER']);

// Planner-facing projection of the authoritative registry plus cited read-only
// implementation contracts. It is not a second registry and exposes no API
// route, executor, schema, or database implementation to the Planner.
const SEMANTICS = Object.freeze({
    'templates.detail': Object.freeze({ targetTypes: ['template'], targetCardinality: 'ONE', accepts: ['one_formally_grounded_template'], produces: ['FORMAL_DETAIL', 'RELATION'], directGoalClasses: ['template_detail', 'fixed_part_list'], notFor: ['recipe_cost', 'coil_cost'], provenance: ['api/capabilities/registry.cjs:templates.detail', 'api/routes/templates.cjs:template detail query'] }),
    'recipes.current_costs': Object.freeze({ targetTypes: ['recipe'], targetCardinality: 'ONE_OR_SET', accepts: ['one_or_more_formally_grounded_recipes'], produces: ['CURRENT_COST'], directGoalClasses: ['recipe_current_cost'], notFor: ['coil_cost', 'scenario_override'], provenance: ['api/capabilities/registry.cjs:recipes.current_costs', 'api/services/currentRecipeCost.cjs'] }),
    'relations.read': Object.freeze({ targetTypes: ['recipe', 'template', 'coil', 'part'], targetCardinality: 'ONE', accepts: ['one_formally_grounded_relation_root'], produces: ['RELATION'], directGoalClasses: ['current_relation'], notFor: ['cost_calculation', 'scenario_override'], provenance: ['api/capabilities/registry.cjs:relations.read', 'api/routes/ai/executors/queryExecutors.cjs'] }),
    'cost.recipe_difference': Object.freeze({ targetTypes: ['recipe_pair'], targetCardinality: 'TWO', accepts: ['two_formally_grounded_recipes'], produces: ['COST_DIFFERENCE', 'CURRENT_COST'], directGoalClasses: ['recipe_cost_difference'], notFor: ['single_recipe_cost', 'coil_cost', 'scenario_override'], provenance: ['api/capabilities/registry.cjs:cost.recipe_difference', 'api/services/costQueries.cjs:getRecipeDifference'] }),
    'coils.list': Object.freeze({ targetTypes: ['coil'], targetCardinality: 'ONE_OR_SET', accepts: ['one_or_more_formally_grounded_coil_schemes'], produces: ['FORMAL_DETAIL', 'CURRENT_COST', 'CANDIDATE_SET'], directGoalClasses: ['coil_current_cost', 'coil_detail', 'coil_candidate_set'], notFor: ['recipe_current_cost', 'recipe_scenario_override'], provenance: ['api/capabilities/registry.cjs:coils.list', 'api/routes/coils.cjs:GET list', 'api/db.cjs:coilRow'] }),
    'recipes.scenario_compare_preview': Object.freeze({ targetTypes: ['recipe'], targetCardinality: 'ONE', accepts: ['one_formally_grounded_recipe', 'explicit_owner_scenario_overrides', 'formal_packaging_part_selection_when_packaging_changes'], produces: ['CURRENT_COST', 'SCENARIO_COST', 'SCENARIO_COMPARISON', 'COST_DIFFERENCE', 'FORMAL_DETAIL'], directGoalClasses: ['recipe_scenario_cost', 'recipe_scenario_comparison'], scenarioClasses: Object.freeze({ FLOAT: 'SUPPORTED', CABLE: 'SUPPORTED', COIL: 'SUPPORTED', BARREL: 'SUPPORTED', SURFACE_TREATMENT: 'SUPPORTED', PACKAGING: 'FORMAL_BINDING_REQUIRED', ROTOR_PROCESS: 'UNSUPPORTED', OTHER: 'UNKNOWN' }), notFor: ['stainless_shaft_joint_override', 'unbound_packaging_material_name'], provenance: ['api/capabilities/registry.cjs:recipes.scenario_compare_preview', 'api/services/recipeScenarioComparison.cjs:ALLOWED_OVERRIDES,compare'] }),
});

function plannerModeFor(capability) { return capability.operation === 'preview' ? 'PREVIEW' : 'READ'; }
function normalized(value) { return String(value || '').normalize('NFKC').replace(/[\s\-－–—]/gu, '').toLowerCase(); }
function targetTypesForFact(fact, targets = []) {
    const source = normalized(fact?.target);
    const matching = targets.filter(target => [target.mention, target.canonicalName].some(value => value && source.includes(normalized(value))));
    const types = [...new Set(matching.map(target => target.entityType).filter(Boolean))];
    if (types.length === 1 && matching.length >= 2 && types[0] === 'recipe') return ['recipe_pair'];
    return types;
}
function cardinalityCompatible(expected, actual) { return expected === 'ONE_OR_SET' || (expected === 'ONE' && actual === 1) || (expected === 'TWO' && actual === 2) || (expected === 'SET' && actual >= 1); }
function canCapabilitySatisfyFact({ capability, fact, targets = [] }) {
    if (!capability || !fact) return 'UNKNOWN';
    if (fact.factClass === 'OTHER') return 'UNKNOWN';
    if (!capability.produces?.includes(fact.factClass)) return 'NO';
    const targetTypes = targetTypesForFact(fact, targets);
    if (!targetTypes.length) return 'UNKNOWN';
    const targetCount = targets.filter(target => targetTypes.includes(target.entityType) || (targetTypes.includes('recipe_pair') && target.entityType === 'recipe')).length;
    if (!targetTypes.every(type => capability.targetTypes.includes(type))) return 'NO';
    return cardinalityCompatible(capability.targetCardinality, targetCount) ? 'YES' : 'NO';
}

// Step satisfaction is intentionally broader than an isolated fact check. A
// pair capability can authoritatively return the two constituent current-cost
// details and their difference in a single response.
function canCapabilitySatisfyStep({ capability, facts = [], targets = [] }) {
    if (!capability || !facts.length) return 'UNKNOWN';
    if (facts.some(fact => !capability.produces?.includes(fact.factClass))) return 'NO';
    if (!targets.length) return 'UNKNOWN';
    const targetTypes = [...new Set(targets.map(target => target.entityType).filter(Boolean))];
    const targetCount = targets.length;
    const pairFacts = facts.some(fact => fact.factClass === 'COST_DIFFERENCE');
    if (capability.targetTypes.includes('recipe_pair') && pairFacts) {
        return targetCount === 2 && targetTypes.length === 1 && targetTypes[0] === 'recipe' ? 'YES' : 'NO';
    }
    if (!targetTypes.length || !targetTypes.every(type => capability.targetTypes.includes(type))) return 'NO';
    return cardinalityCompatible(capability.targetCardinality, targetCount) ? 'YES' : 'NO';
}

function createPlannerCapabilityCatalogSnapshot() {
    const all = listBusinessCapabilities();
    const byId = new Map(all.map(capability => [capability.capabilityId, capability]));
    const visible = PLANNER_VISIBLE_IDS.map(capabilityId => {
        const capability = byId.get(capabilityId);
        if (!capability) throw new Error(`PLANNER_CAPABILITY_NOT_REGISTERED:${capabilityId}`);
        if (!['query', 'preview'].includes(capability.operation)) throw new Error(`PLANNER_CAPABILITY_NOT_READ_ONLY:${capabilityId}`);
        const semantic = SEMANTICS[capabilityId];
        if (!semantic) throw new Error(`SEMANTIC_METADATA_UNRESOLVED:${capabilityId}`);
        return Object.freeze({ capabilityId, mode: plannerModeFor(capability), domain: capability.domain, description: `${semantic.directGoalClasses.join('、')} 的正式只读能力。`, sourceRequirement: 'AUTHORITATIVE_BUSINESS_SOURCE', ...semantic });
    });
    const operationCounts = all.reduce((counts, capability) => ({ ...counts, [capability.operation]: (counts[capability.operation] || 0) + 1 }), {});
    const hiddenWrite = all.filter(capability => ['command', 'maintenance'].includes(capability.operation));
    return Object.freeze({ source: 'api/capabilities/registry.cjs:listBusinessCapabilities', registryPath: 'api/capabilities/registry.cjs', totalCapabilities: all.length, operationCounts: Object.freeze(operationCounts), factClasses: FACT_CLASSES, visibleCapabilities: Object.freeze(visible), visibleReadCapabilities: visible.filter(capability => capability.mode === 'READ').length, visibleAnalysisCapabilities: 0, visiblePreviewCapabilities: visible.filter(capability => capability.mode === 'PREVIEW').length, hiddenWriteCapabilities: hiddenWrite.length, plannerVisibleCapabilityCount: visible.length, plannerWriteCapabilitiesVisible: 0 });
}

module.exports = { PLANNER_VISIBLE_IDS, FACT_CLASSES, SEMANTICS, canCapabilitySatisfyFact, canCapabilitySatisfyStep, targetTypesForFact, createPlannerCapabilityCatalogSnapshot };
