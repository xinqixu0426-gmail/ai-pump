'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseDemandSlotsMemo } = require('../scripts/ai-experiments/planner-v1/demandSlotsMemo.cjs');
const { validateDemandSlots } = require('../scripts/ai-experiments/planner-v1/demandSlotsValidator.cjs');
const { compileDemandSlots } = require('../scripts/ai-experiments/planner-v1/demandSemanticCompiler.cjs');
const { writeOnlyBlockedPlan } = require('../scripts/ai-experiments/planner-v1/demandSlotsPipeline.cjs');
const { compilePlan } = require('../scripts/ai-experiments/planner-v1/planCompiler.cjs');
const { validatePlanContract } = require('../scripts/ai-experiments/planner-v1/planContractValidator.cjs');
const { buildPlannerContext } = require('../scripts/ai-experiments/planner-v1/plannerContext.cjs');
const { createPlannerCapabilityCatalogSnapshot } = require('../scripts/ai-experiments/planner-v1/capabilityCatalogSnapshot.cjs');
const { UPSTREAM_FIXTURES: U } = require('../scripts/ai-experiments/planner-v1/frozenUpstreamFixture.cjs');

const catalog = createPlannerCapabilityCatalogSnapshot();
function context(upstream, rawOwnerInput) { return buildPlannerContext({ rawOwnerInput, upstream, capabilityCatalog: catalog }); }
function slots({ shape, metric = 'NONE', relation = 'NONE', overrides = [], write = 'NO' }) { return parseDemandSlotsMemo([`RESULT_SHAPE: ${shape}`, `METRIC: ${metric}`, `RELATION_REQUEST: ${relation}`, ...(overrides.length ? overrides.map(item => `SCENARIO_OVERRIDE: ${item}`) : ['SCENARIO_OVERRIDE: NONE']), `WRITE_REQUIRED: ${write}`].join('\n')); }
function compiled(spec, upstream, owner) { const c = context(upstream, owner); const s = slots(spec); return { context: c, slots: s, validation: validateDemandSlots({ slots: s, context: c }), result: compileDemandSlots({ slots: s, context: c }) }; }
const pairRecipes = Object.freeze({ ...U.V750_GENERIC_QUALIFIED, finalGroundedTargets: Object.freeze([...U.V750_GENERIC_QUALIFIED.finalGroundedTargets, ...U.V110.finalGroundedTargets]) });
const pairCoils = Object.freeze({ ...U.COIL_A, finalGroundedTargets: Object.freeze([...U.COIL_A.finalGroundedTargets, ...U.COIL_130_A.finalGroundedTargets]) });

test('DS-01..09: deterministic semantic mapping', () => {
    const cases = [
        ['DS-01', { shape: 'VALUE', metric: 'COST' }, U.V750_GENERIC_QUALIFIED, '成本', 'CURRENT_COST'],
        ['DS-02', { shape: 'VALUE', metric: 'COST' }, pairCoils, '分别多少', 'CURRENT_COST'],
        ['DS-03', { shape: 'VALUE', metric: 'COST', overrides: ['加浮球 | FLOAT'] }, U.V750_GENERIC_QUALIFIED, '加浮球以后多少钱', 'SCENARIO_COST'],
        ['DS-04', { shape: 'DELTA', metric: 'COST' }, pairRecipes, '成本差多少', 'COST_DIFFERENCE'],
        ['DS-05', { shape: 'DELTA', metric: 'COST', overrides: ['做电泳 | SURFACE_TREATMENT'] }, U.V750_GENERIC_QUALIFIED, '做电泳成本增加多少', 'COST_DIFFERENCE'],
        ['DS-06', { shape: 'VALUE', relation: '哪个线圈' }, U.V750_GENERIC_QUALIFIED, '现在用哪个线圈', 'RELATION'],
        ['DS-07', { shape: 'LIST', relation: '固定件' }, U.TEMPLATE, '有哪些固定件', 'RELATION'],
        ['DS-08', { shape: 'COUNT' }, U.COIL_GENERIC, '有几个方案', 'CANDIDATE_SET'],
    ];
    for (const [id, spec, upstream, owner, fact] of cases) assert.deepEqual(compiled(spec, upstream, owner).result.requirement.goalFacts, [fact], id);
    const write = compiled({ shape: 'NONE', write: 'YES', overrides: ['木箱 | PACKAGING'] }, U.V750_GENERIC_QUALIFIED, '改成木箱并保存');
    assert.deepEqual(write.result.requirement.goalFacts, [], 'DS-09');
    assert.equal(write.result.requirement.writeOnly, true, 'DS-09');
});

test('DS-10..14: selection comes only from frozen Grounding and slots', () => {
    const cases = [
        ['DS-10', { shape: 'VALUE', metric: 'COST' }, U.V750_GENERIC_QUALIFIED, 'NONE'],
        ['DS-11', { shape: 'VALUE', metric: 'COST' }, U.V750_GENERIC, 'SINGLE_TARGET_REQUIRED'],
        ['DS-12', { shape: 'COUNT' }, U.COIL_GENERIC, 'WHOLE_SET'],
        ['DS-13', { shape: 'VALUE', metric: 'COST' }, pairCoils, 'NONE'],
        ['DS-14', { shape: 'DELTA', metric: 'COST' }, pairRecipes, 'NONE'],
    ];
    for (const [id, spec, upstream, expected] of cases) assert.equal(compiled(spec, upstream, 'owner').result.requirement.selectionRequirement, expected, id);
});

test('DS-15..21: exact provenance and closed combinations', () => {
    const checks = [
        ['DS-15', { shape: 'DELTA', metric: 'COST', overrides: ['增加电泳 | SURFACE_TREATMENT'] }, '做电泳成本增加多少', 'SCENARIO_OVERRIDE_NOT_IN_OWNER_WORDING'],
        ['DS-16', { shape: 'VALUE', relation: '当前关系' }, '现在用哪个线圈', 'RELATION_REQUEST_NOT_IN_OWNER_WORDING'],
        ['DS-17', { shape: 'INVALID' }, 'owner', 'RESULT_SHAPE_INVALID'],
        ['DS-18', { shape: 'VALUE', metric: 'PRICE' }, 'owner', 'METRIC_INVALID'],
        ['DS-19', { shape: 'VALUE', metric: 'COST', overrides: ['木箱 | UNKNOWN'] }, '换木箱', 'SCENARIO_CLASS_INVALID'],
        ['DS-20', { shape: 'DELTA', metric: 'NONE' }, '差多少', 'SLOT_COMBINATION_INVALID'],
    ];
    for (const [id, spec, owner, code] of checks) assert.ok(compiled(spec, U.V750_GENERIC_QUALIFIED, owner).validation.violations.includes(code), id);
    assert.equal(compiled({ shape: 'NONE', write: 'YES', overrides: ['木箱 | PACKAGING'] }, U.V750_GENERIC_QUALIFIED, '木箱并保存').validation.validationStatus, 'VALID', 'DS-21');
});

test('DS-22..24: cardinality cannot decide comparison; write-only path is safe', () => {
    const delta = compiled({ shape: 'DELTA', metric: 'COST' }, pairRecipes, '两配方成本差多少');
    const values = compiled({ shape: 'VALUE', metric: 'COST' }, pairCoils, '两个线圈成本分别多少');
    assert.deepEqual(delta.result.requirement.goalFacts, ['COST_DIFFERENCE'], 'DS-22');
    assert.deepEqual(values.result.requirement.goalFacts, ['CURRENT_COST'], 'DS-23');
    const write = compiled({ shape: 'NONE', write: 'YES', overrides: ['木箱 | PACKAGING'] }, U.V750_GENERIC_QUALIFIED, '包装改成木箱并保存');
    const plan = writeOnlyBlockedPlan(write.result.requirement, write.context);
    assert.equal(plan.status, 'BLOCKED_POLICY', 'DS-24');
    assert.equal(plan.steps.length, 0, 'DS-24');
    assert.equal(validatePlanContract({ plan, context: write.context }).validationStatus, 'VALID', 'DS-24');
    const unresolvedWrite = compiled({ shape: 'NONE', write: 'YES' }, U.UNRESOLVED, '把这个保存');
    const unresolvedPlan = writeOnlyBlockedPlan(unresolvedWrite.result.requirement, unresolvedWrite.context);
    assert.equal(unresolvedPlan.status, 'BLOCKED_GROUNDING');
    assert.equal(unresolvedPlan.steps.length, 0);
    assert.equal(validatePlanContract({ plan: unresolvedPlan, context: unresolvedWrite.context }).validationStatus, 'VALID');
    assert.equal(compilePlan({ requirement: delta.result.requirement, context: delta.context }).status, 'READY', 'DS-22');
});

test('Demand Slots model prompt does not contain catalog, goal-kind/fact or output target fields', () => {
    const { messagesForDemandSlots } = require('../scripts/ai-experiments/planner-v1/ownerDemandSlotsAgent.cjs');
    const content = messagesForDemandSlots(context(U.V750_GENERIC_QUALIFIED, '查成本'))[0].content;
    assert.doesNotMatch(content, /cost\.recipe_difference|recipes\.current_costs|GOAL_KIND|GOAL_FACT|^TARGET:/mu);
    assert.equal(parseDemandSlotsMemo('GOAL_KIND: READ_VALUE\nTARGET: V750').forbiddenFields.length, 2);
});
