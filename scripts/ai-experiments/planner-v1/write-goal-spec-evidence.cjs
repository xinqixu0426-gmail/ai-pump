'use strict';

const fs = require('fs');
const path = require('path');
const { GOAL_SPEC_BASE_CASES, GOAL_SPEC_NEGATIVE_CASES } = require('./goalSpecCases.cjs');
const { parseGoalSpecMemo } = require('./goalSpecMemo.cjs');
const { normalizeGoalSpec } = require('./goalSpecNormalizer.cjs');
const { validateGoalSpec } = require('./goalSpecValidator.cjs');
const { compileGoalSpecToRequirement } = require('./goalToFactCompiler.cjs');
const { createPlannerCapabilityCatalogSnapshot } = require('./capabilityCatalogSnapshot.cjs');
const { UPSTREAM_FIXTURES: U } = require('./frozenUpstreamFixture.cjs');

const root = path.resolve(__dirname, '../../..');
const catalog = createPlannerCapabilityCatalogSnapshot();
function check(id, pass, finding) { return Object.freeze({ id, pass: Boolean(pass), finding }); }
function context(upstream, rawOwnerInput) { return { rawOwnerInput, ...upstream, capabilityCatalog: catalog }; }
function parsed(lines, upstream, rawOwnerInput) { const c = context(upstream, rawOwnerInput); const normalized = normalizeGoalSpec({ goalSpec: parseGoalSpecMemo(lines.join('\n')), context: c }); return { c, goalSpec: normalized.goalSpec }; }
function memo(kind, shape, metric, extras = []) { return [`GOAL_KIND: ${kind}`, `RESULT_SHAPE: ${shape}`, `METRIC: ${metric}`, 'TARGET: V750通用款', ...extras, 'WRITE_REQUIRED: NO']; }

function writeGoalSpecEvidence() {
    const explain = parsed(['GOAL_KIND: EXPLAIN', 'RESULT_SHAPE: DETAIL', 'METRIC: NONE', 'TARGET: NONE', 'RELATION_REQUEST: NONE', 'WRITE_REQUIRED: NO'], U.CONCEPT, '模板和配方有什么区别？');
    const value = parsed(memo('READ_VALUE', 'VALUE', 'COST'), U.V750_GENERIC_QUALIFIED, 'V750通用款成本');
    const relation = parsed(memo('READ_RELATION', 'VALUE', 'NONE', ['RELATION_REQUEST: 现在用哪个线圈']), U.V750_GENERIC_QUALIFIED, 'V750通用款现在用哪个线圈');
    const list = parsed(['GOAL_KIND: LIST', 'RESULT_SHAPE: LIST', 'METRIC: NONE', 'TARGET: 通用款模板', 'RELATION_REQUEST: 固定件', 'WRITE_REQUIRED: NO'], U.TEMPLATE, '通用款模板有哪些固定件？');
    const count = parsed(['GOAL_KIND: COUNT', 'RESULT_SHAPE: COUNT', 'METRIC: NONE', 'TARGET: 12-120', 'WRITE_REQUIRED: NO'], U.COIL_GENERIC, '12-120有几个方案？');
    const preview = parsed(memo('PREVIEW_SCENARIO', 'VALUE', 'COST', ['SCENARIO_OVERRIDE: 加浮球 | FLOAT']), U.V750_GENERIC_QUALIFIED, 'V750通用款加浮球以后多少钱？');
    const compare = parsed(memo('COMPARE_SCENARIO', 'DELTA', 'COST', ['SCENARIO_OVERRIDE: 做电泳 | SURFACE_TREATMENT']), U.V750_GENERIC_QUALIFIED, 'V750通用款做电泳成本增加多少？');
    const invalidShape = parsed(['GOAL_KIND: COUNT', 'RESULT_SHAPE: DELTA', 'METRIC: NONE', 'TARGET: 12-120', 'WRITE_REQUIRED: NO'], U.COIL_GENERIC, '12-120有几个方案？');
    const absentScenario = parsed(memo('COMPARE_SCENARIO', 'DELTA', 'COST'), U.V750_GENERIC_QUALIFIED, 'V750通用款成本差多少？');
    const invalidOverride = parsed(memo('COMPARE_SCENARIO', 'DELTA', 'COST', ['SCENARIO_OVERRIDE: 增加电泳 | SURFACE_TREATMENT']), U.V750_GENERIC_QUALIFIED, 'V750通用款做电泳成本增加多少？');
    const invalidRelation = parsed(memo('READ_RELATION', 'VALUE', 'NONE', ['RELATION_REQUEST: 当前关系']), U.V750_GENERIC_QUALIFIED, 'V750通用款现在用哪个线圈？');
    const invalidTarget = parsed(['GOAL_KIND: READ_VALUE', 'RESULT_SHAPE: VALUE', 'METRIC: COST', 'TARGET: V999', 'WRITE_REQUIRED: NO'], U.V750_GENERIC_QUALIFIED, 'V750通用款成本');
    const twoTargets = Object.freeze({ ...U.V750_GENERIC_QUALIFIED, finalGroundedTargets: Object.freeze([...U.V750_GENERIC_QUALIFIED.finalGroundedTargets, ...U.V110.finalGroundedTargets]) });
    const pair = parsed([...memo('COMPARE_TARGETS', 'DELTA', 'COST'), 'TARGET: V110'], twoTargets, 'V750通用款和V110成本差多少？');
    const leaked = parseGoalSpecMemo([...memo('READ_VALUE', 'VALUE', 'COST'), 'GOAL_FACT: CURRENT_COST'].join('\n'));
    const cases = Object.freeze([
        check('GS-01', compileGoalSpecToRequirement({ goalSpec: explain.goalSpec, context: explain.c }).status === 'NO_FORMAL_FACT_REQUIRED', 'EXPLAIN compiles to no formal fact'),
        check('GS-02', compileGoalSpecToRequirement({ goalSpec: value.goalSpec, context: value.c }).goalFacts[0] === 'CURRENT_COST', 'READ_VALUE COST compiles to CURRENT_COST'),
        check('GS-03', compileGoalSpecToRequirement({ goalSpec: relation.goalSpec, context: relation.c }).goalFacts[0] === 'RELATION', 'READ_RELATION compiles to RELATION'),
        check('GS-04', compileGoalSpecToRequirement({ goalSpec: list.goalSpec, context: list.c }).goalFacts[0] === 'RELATION', 'LIST relation compiles to RELATION'),
        check('GS-05', compileGoalSpecToRequirement({ goalSpec: count.goalSpec, context: count.c }).goalFacts[0] === 'CANDIDATE_SET', 'COUNT compiles to CANDIDATE_SET'),
        check('GS-06', compileGoalSpecToRequirement({ goalSpec: preview.goalSpec, context: preview.c }).goalFacts[0] === 'SCENARIO_COST', 'PREVIEW_SCENARIO VALUE COST compiles to SCENARIO_COST'),
        check('GS-07', compileGoalSpecToRequirement({ goalSpec: pair.goalSpec, context: pair.c }).goalFacts[0] === 'COST_DIFFERENCE', 'COMPARE_TARGETS DELTA COST compiles to COST_DIFFERENCE'),
        check('GS-08', compileGoalSpecToRequirement({ goalSpec: compare.goalSpec, context: compare.c }).goalFacts[0] === 'COST_DIFFERENCE', 'COMPARE_SCENARIO DELTA COST compiles to COST_DIFFERENCE'),
        check('GS-09', compileGoalSpecToRequirement({ goalSpec: value.goalSpec, context: value.c }).selectionRequirement === 'NONE', 'EXACT target selection is NONE'),
        check('GS-10', compileGoalSpecToRequirement({ goalSpec: parsed(['GOAL_KIND: READ_VALUE', 'RESULT_SHAPE: VALUE', 'METRIC: COST', 'TARGET: V750', 'WRITE_REQUIRED: NO'], U.V750_GENERIC, 'V750成本').goalSpec, context: context(U.V750_GENERIC, 'V750成本') }).selectionRequirement === 'SINGLE_TARGET_REQUIRED', 'MULTIPLE READ_VALUE requires single target'),
        check('GS-11', compileGoalSpecToRequirement({ goalSpec: count.goalSpec, context: count.c }).selectionRequirement === 'WHOLE_SET', 'MULTIPLE COUNT consumes whole set'),
        check('GS-12', compileGoalSpecToRequirement({ goalSpec: pair.goalSpec, context: pair.c }).selectionRequirement === 'NONE', 'explicit pair comparison is not ambiguity'),
        check('GS-13', validateGoalSpec({ goalSpec: invalidShape.goalSpec, context: invalidShape.c }).violations.some(item => item.code === 'GOAL_SPEC_KIND_SHAPE_INVALID'), 'COUNT + DELTA is invalid'),
        check('GS-14', validateGoalSpec({ goalSpec: absentScenario.goalSpec, context: absentScenario.c }).violations.some(item => item.code === 'GOAL_SPEC_SCENARIO_OVERRIDE_MISSING'), 'COMPARE_SCENARIO requires override'),
        check('GS-15', (() => { const item = parsed(memo('PREVIEW_SCENARIO', 'VALUE', 'COST'), U.V750_GENERIC_QUALIFIED, 'V750通用款多少钱？'); return validateGoalSpec({ goalSpec: item.goalSpec, context: item.c }).violations.some(violation => violation.code === 'GOAL_SPEC_SCENARIO_OVERRIDE_MISSING'); })(), 'PREVIEW_SCENARIO requires override'),
        check('GS-16', validateGoalSpec({ goalSpec: invalidOverride.goalSpec, context: invalidOverride.c }).violations.some(item => item.code === 'GOAL_SPEC_OVERRIDE_NOT_IN_OWNER_WORDING'), 'scenario override provenance stays strict'),
        check('GS-17', validateGoalSpec({ goalSpec: invalidRelation.goalSpec, context: invalidRelation.c }).violations.some(item => item.code === 'GOAL_SPEC_RELATION_REQUEST_NOT_IN_OWNER_WORDING'), 'relation request provenance stays strict'),
        check('GS-18', validateGoalSpec({ goalSpec: invalidTarget.goalSpec, context: invalidTarget.c }).violations.some(item => item.code === 'GOAL_SPEC_TARGET_NOT_FROM_GROUNDING'), 'target must derive from frozen Grounding'),
        check('GS-19', leaked.ignoredWarnings.includes('GOAL_FACT_LEAK_WARNING'), 'leaked old GOAL_FACT line is ignored and observed'),
    ]);
    const output = Object.freeze({ phase: 'M4-4I', suite: 'owner-goal-spec-v1', passed: cases.filter(item => item.pass).length, failed: cases.filter(item => !item.pass).length, cases });
    fs.writeFileSync(path.join(root, 'planning/planner/M4-4I-Goal-Spec-Tests.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    const mapping = Object.freeze([...GOAL_SPEC_BASE_CASES, ...GOAL_SPEC_NEGATIVE_CASES].map(testCase => Object.freeze({ id: testCase.id, user: testCase.user, expectedGoalSpec: testCase.goalSpec, formalTargetCardinality: testCase.goalSpec.targetCount, expectedPlanStatus: testCase.status })));
    fs.writeFileSync(path.join(root, 'planning/planner/M4-4I-Goal-Spec-Case-Mapping.json'), `${JSON.stringify({ phase: 'M4-4I', cases: mapping }, null, 2)}\n`, 'utf8');
    return output;
}

module.exports = { writeGoalSpecEvidence };
