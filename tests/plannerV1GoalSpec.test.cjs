'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseGoalSpecMemo } = require('../scripts/ai-experiments/planner-v1/goalSpecMemo.cjs');
const { normalizeGoalSpec } = require('../scripts/ai-experiments/planner-v1/goalSpecNormalizer.cjs');
const { validateGoalSpec } = require('../scripts/ai-experiments/planner-v1/goalSpecValidator.cjs');
const { compileGoalSpecToRequirement } = require('../scripts/ai-experiments/planner-v1/goalToFactCompiler.cjs');
const { createPlannerCapabilityCatalogSnapshot } = require('../scripts/ai-experiments/planner-v1/capabilityCatalogSnapshot.cjs');
const { UPSTREAM_FIXTURES: U } = require('../scripts/ai-experiments/planner-v1/frozenUpstreamFixture.cjs');

const catalog = createPlannerCapabilityCatalogSnapshot();
function context(upstream, rawOwnerInput) { return { rawOwnerInput, ...upstream, capabilityCatalog: catalog }; }
function spec(lines, upstream, rawOwnerInput) { const c = context(upstream, rawOwnerInput); const normalized = normalizeGoalSpec({ goalSpec: parseGoalSpecMemo(lines.join('\n')), context: c }); return { context: c, goalSpec: normalized.goalSpec, normalized }; }
function lines({ kind, shape, metric = 'NONE', target = 'V750通用款', relation = null, overrides = [], write = 'NO' }) { return [`GOAL_KIND: ${kind}`, `RESULT_SHAPE: ${shape}`, `METRIC: ${metric}`, ...(target ? [`TARGET: ${target}`] : ['TARGET: NONE']), ...(relation ? [`RELATION_REQUEST: ${relation}`] : ['RELATION_REQUEST: NONE']), ...overrides.map(override => `SCENARIO_OVERRIDE: ${override}`), `WRITE_REQUIRED: ${write}`]; }

test('GS-01 to GS-12 compile normalized Owner Goal Specs into stable internal facts and selection', () => {
    const explain = spec(lines({ kind: 'EXPLAIN', shape: 'DETAIL', target: null }), U.CONCEPT, '模板和配方有什么区别？');
    assert.equal(compileGoalSpecToRequirement({ goalSpec: explain.goalSpec, context: explain.context }).status, 'NO_FORMAL_FACT_REQUIRED');
    const value = spec(lines({ kind: 'READ_VALUE', shape: 'VALUE', metric: 'COST' }), U.V750_GENERIC_QUALIFIED, 'V750通用款成本');
    assert.deepEqual(compileGoalSpecToRequirement({ goalSpec: value.goalSpec, context: value.context }).goalFacts, ['CURRENT_COST']);
    const relation = spec(lines({ kind: 'READ_RELATION', shape: 'VALUE', relation: '现在用哪个线圈' }), U.V750_GENERIC_QUALIFIED, 'V750通用款现在用哪个线圈');
    assert.deepEqual(compileGoalSpecToRequirement({ goalSpec: relation.goalSpec, context: relation.context }).goalFacts, ['RELATION']);
    const list = spec(lines({ kind: 'LIST', shape: 'LIST', target: '通用款模板', relation: '固定件' }), U.TEMPLATE, '通用款模板有哪些固定件');
    assert.deepEqual(compileGoalSpecToRequirement({ goalSpec: list.goalSpec, context: list.context }).goalFacts, ['RELATION']);
    const count = spec(lines({ kind: 'COUNT', shape: 'COUNT', target: '12-120' }), U.COIL_GENERIC, '12-120有几个方案');
    const countRequirement = compileGoalSpecToRequirement({ goalSpec: count.goalSpec, context: count.context });
    assert.deepEqual(countRequirement.goalFacts, ['CANDIDATE_SET']);
    assert.equal(countRequirement.selectionRequirement, 'WHOLE_SET');
    const preview = spec(lines({ kind: 'PREVIEW_SCENARIO', shape: 'VALUE', metric: 'COST', overrides: ['加浮球 | FLOAT'] }), U.V750_GENERIC_QUALIFIED, 'V750通用款加浮球以后多少钱');
    assert.deepEqual(compileGoalSpecToRequirement({ goalSpec: preview.goalSpec, context: preview.context }).goalFacts, ['SCENARIO_COST']);
    const compareTargets = spec([...lines({ kind: 'COMPARE_TARGETS', shape: 'DELTA', metric: 'COST' }), 'TARGET: V110'], Object.freeze({ ...U.V750_GENERIC_QUALIFIED, finalGroundedTargets: Object.freeze([...U.V750_GENERIC_QUALIFIED.finalGroundedTargets, ...U.V110.finalGroundedTargets]) }), 'V750通用款和V110成本差多少');
    assert.deepEqual(compileGoalSpecToRequirement({ goalSpec: compareTargets.goalSpec, context: compareTargets.context }).goalFacts, ['COST_DIFFERENCE']);
    const compareScenario = spec(lines({ kind: 'COMPARE_SCENARIO', shape: 'DELTA', metric: 'COST', overrides: ['做电泳 | SURFACE_TREATMENT'] }), U.V750_GENERIC_QUALIFIED, 'V750通用款做电泳成本增加多少');
    assert.deepEqual(compileGoalSpecToRequirement({ goalSpec: compareScenario.goalSpec, context: compareScenario.context }).goalFacts, ['COST_DIFFERENCE']);
    assert.equal(compileGoalSpecToRequirement({ goalSpec: value.goalSpec, context: value.context }).selectionRequirement, 'NONE');
    const ambiguousValue = spec(lines({ kind: 'READ_VALUE', shape: 'VALUE', metric: 'COST', target: 'V750' }), U.V750_GENERIC, 'V750成本');
    assert.equal(compileGoalSpecToRequirement({ goalSpec: ambiguousValue.goalSpec, context: ambiguousValue.context }).selectionRequirement, 'SINGLE_TARGET_REQUIRED');
    assert.equal(countRequirement.selectionRequirement, 'WHOLE_SET');
    assert.equal(compileGoalSpecToRequirement({ goalSpec: compareTargets.goalSpec, context: compareTargets.context }).selectionRequirement, 'NONE');
});

test('GS-13 to GS-18 validate schema, owner provenance and frozen target boundaries', () => {
    const invalidShape = spec(lines({ kind: 'COUNT', shape: 'DELTA', target: '12-120' }), U.COIL_GENERIC, '12-120有几个方案');
    assert.ok(validateGoalSpec(invalidShape).violations.some(item => item.code === 'GOAL_SPEC_KIND_SHAPE_INVALID'));
    const noScenarioCompare = spec(lines({ kind: 'COMPARE_SCENARIO', shape: 'DELTA', metric: 'COST' }), U.V750_GENERIC_QUALIFIED, 'V750通用款成本差多少');
    assert.ok(validateGoalSpec(noScenarioCompare).violations.some(item => item.code === 'GOAL_SPEC_SCENARIO_OVERRIDE_MISSING'));
    const noScenarioPreview = spec(lines({ kind: 'PREVIEW_SCENARIO', shape: 'VALUE', metric: 'COST' }), U.V750_GENERIC_QUALIFIED, 'V750通用款多少钱');
    assert.ok(validateGoalSpec(noScenarioPreview).violations.some(item => item.code === 'GOAL_SPEC_SCENARIO_OVERRIDE_MISSING'));
    const badOverride = spec(lines({ kind: 'COMPARE_SCENARIO', shape: 'DELTA', metric: 'COST', overrides: ['增加电泳 | SURFACE_TREATMENT'] }), U.V750_GENERIC_QUALIFIED, 'V750通用款做电泳成本增加多少');
    assert.ok(validateGoalSpec(badOverride).violations.some(item => item.code === 'GOAL_SPEC_OVERRIDE_NOT_IN_OWNER_WORDING'));
    const badRelation = spec(lines({ kind: 'READ_RELATION', shape: 'VALUE', relation: '当前关系' }), U.V750_GENERIC_QUALIFIED, 'V750通用款现在用哪个线圈');
    assert.ok(validateGoalSpec(badRelation).violations.some(item => item.code === 'GOAL_SPEC_RELATION_REQUEST_NOT_IN_OWNER_WORDING'));
    const badTarget = spec(lines({ kind: 'READ_VALUE', shape: 'VALUE', metric: 'COST', target: 'V999' }), U.V750_GENERIC_QUALIFIED, 'V750通用款成本');
    assert.ok(validateGoalSpec(badTarget).violations.some(item => item.code === 'GOAL_SPEC_TARGET_NOT_FROM_GROUNDING'));
});

test('Goal Spec parser ignores leaked GOAL_FACT lines and keeps them observable', () => {
    const parsed = parseGoalSpecMemo([...lines({ kind: 'READ_VALUE', shape: 'VALUE', metric: 'COST' }), 'GOAL_FACT: CURRENT_COST'].join('\n'));
    assert.ok(parsed.ignoredWarnings.includes('GOAL_FACT_LEAK_WARNING'));
});
