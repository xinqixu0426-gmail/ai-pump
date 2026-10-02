'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createPlannerCapabilityCatalogSnapshot } = require('../scripts/ai-experiments/planner-v1/capabilityCatalogSnapshot.cjs');
const { compilePlan } = require('../scripts/ai-experiments/planner-v1/planCompiler.cjs');
const { validatePlanContract } = require('../scripts/ai-experiments/planner-v1/planContractValidator.cjs');
const { UPSTREAM_FIXTURES: U } = require('../scripts/ai-experiments/planner-v1/frozenUpstreamFixture.cjs');
const { exact } = require('../scripts/ai-experiments/planner-v1/frozenUpstreamFixture.cjs');
const { canCapabilitySatisfyStep } = require('../scripts/ai-experiments/planner-v1/capabilityCatalogSnapshot.cjs');

const catalog = createPlannerCapabilityCatalogSnapshot();
function context(upstream) { return { rawOwnerInput: 'fixture', ...upstream, capabilityCatalog: catalog, admission: {} }; }
function requirement({ status = 'READY', facts = [], selectionRequirement = 'NONE', overrides = [], writeRequired = 'NO' } = {}) { return { status, ownerGoal: 'fixture', targets: [], goalFacts: facts, selectionRequirement, scenarioOverrides: overrides.map(([expression, scenarioClass]) => ({ expression, scenarioClass })), writeRequired }; }
function compile(input, upstream) { const plan = compilePlan({ requirement: input, context: context(upstream) }); return { plan, validation: validatePlanContract({ plan, context: context(upstream) }) }; }

test('C-01 to C-04 grounding and selection compilation is deterministic', () => {
    assert.equal(compile(requirement({ status: 'UNRESOLVED_GROUNDING' }), U.UNRESOLVED).plan.status, 'BLOCKED_GROUNDING');
    assert.equal(compile(requirement({ facts: ['CURRENT_COST'] }), U.V750_GENERIC_QUALIFIED).plan.steps[0].capability, 'recipes.current_costs');
    assert.equal(compile(requirement({ facts: ['CURRENT_COST'], selectionRequirement: 'SINGLE_TARGET_REQUIRED' }), U.COIL_GENERIC).plan.status, 'BLOCKED_AMBIGUITY');
    assert.equal(compile(requirement({ facts: ['CANDIDATE_SET'], selectionRequirement: 'WHOLE_SET' }), U.COIL_GENERIC).plan.status, 'NO_TOOL_REQUIRED');
});

test('C-05 to C-09 typed capability matching chooses only compatible authoritative reads', () => {
    assert.equal(compile(requirement({ facts: ['CURRENT_COST'] }), U.V750_GENERIC_QUALIFIED).plan.steps[0].capability, 'recipes.current_costs');
    const pair = { ...U.V750_GENERIC_QUALIFIED, finalGroundedTargets: [...U.V750_GENERIC_QUALIFIED.finalGroundedTargets, exact('V110', 'recipe', 14, 'V110-通用款')] };
    assert.equal(compile(requirement({ facts: ['COST_DIFFERENCE'] }), pair).plan.steps[0].capability, 'cost.recipe_difference');
    const coils = { ...U.COIL_A, finalGroundedTargets: [...U.COIL_A.finalGroundedTargets, exact('12-130-A', 'coil', 3, '12-130 普通小眼')] };
    assert.equal(compile(requirement({ facts: ['CURRENT_COST'] }), coils).plan.steps[0].capability, 'coils.list');
    assert.equal(compile(requirement({ facts: ['RELATION'] }), U.V750_GENERIC_QUALIFIED).plan.steps[0].capability, 'relations.read');
    assert.equal(compile(requirement({ facts: ['FORMAL_DETAIL'] }), U.TEMPLATE).plan.steps[0].capability, 'templates.detail');
});

test('C-10 to C-15 scenario capability support is contract-driven and all-or-nothing', () => {
    assert.equal(compile(requirement({ facts: ['SCENARIO_COST'], overrides: [['加浮球', 'FLOAT']] }), U.V750_GENERIC_QUALIFIED).plan.status, 'READY');
    assert.equal(compile(requirement({ facts: ['SCENARIO_COMPARISON'], overrides: [['电缆5米', 'CABLE']] }), U.V750_GENERIC_QUALIFIED).plan.status, 'READY');
    assert.equal(compile(requirement({ facts: ['SCENARIO_COMPARISON'], overrides: [['做电泳', 'SURFACE_TREATMENT']] }), U.V750_GENERIC_QUALIFIED).plan.status, 'READY');
    assert.equal(compile(requirement({ facts: ['SCENARIO_COMPARISON'], overrides: [['木箱', 'PACKAGING']] }), U.V750_GENERIC_QUALIFIED).plan.status, 'BLOCKED_CAPABILITY');
    assert.equal(compile(requirement({ facts: ['SCENARIO_COMPARISON'], overrides: [['不锈钢接轴', 'ROTOR_PROCESS']] }), U.V750_GENERIC_QUALIFIED).plan.status, 'BLOCKED_CAPABILITY');
    assert.equal(compile(requirement({ facts: ['SCENARIO_COMPARISON'], overrides: [['电缆5米', 'CABLE'], ['木箱', 'PACKAGING']] }), U.V750_GENERIC_QUALIFIED).plan.status, 'BLOCKED_CAPABILITY');
});

test('C-16 and C-17 write-stage compilation remains safe', () => {
    const write = compile(requirement({ facts: ['SCENARIO_COMPARISON'], overrides: [['加浮球', 'FLOAT']], writeRequired: 'YES' }), U.V750_GENERIC_QUALIFIED).plan;
    assert.equal(write.status, 'BLOCKED_POLICY');
    assert.equal(write.steps.some(step => step.mode === 'WRITE'), false);
    assert.equal(compile(requirement({ facts: ['SCENARIO_COMPARISON'], overrides: [['加浮球', 'FLOAT']], writeRequired: 'NO' }), U.V750_GENERIC_QUALIFIED).plan.status, 'READY');
});

test('C-18 to C-20 pair and set multi-output contracts validate without type leakage', () => {
    const byId = new Map(catalog.visibleCapabilities.map(item => [item.capabilityId, item]));
    const left = U.V750_GENERIC_QUALIFIED.finalGroundedTargets[0];
    const right = exact('V110', 'recipe', 14, 'V110-通用款');
    const pairFacts = [{ factClass: 'CURRENT_COST' }, { factClass: 'CURRENT_COST' }, { factClass: 'COST_DIFFERENCE' }];
    assert.equal(canCapabilitySatisfyStep({ capability: byId.get('cost.recipe_difference'), facts: pairFacts, targets: [left, right] }), 'YES');
    const coils = [U.COIL_A.finalGroundedTargets[0], exact('12-130-A', 'coil', 3, '12-130 普通小眼')];
    assert.equal(canCapabilitySatisfyStep({ capability: byId.get('coils.list'), facts: [{ factClass: 'CURRENT_COST' }], targets: coils }), 'YES');
    assert.equal(canCapabilitySatisfyStep({ capability: byId.get('recipes.current_costs'), facts: [{ factClass: 'CURRENT_COST' }], targets: coils }), 'NO');
});
