'use strict';

const { evaluateCompiledPlan, preservesOwnerSpan } = require('./plannerEvaluator.cjs');

function evaluateGoalSpecCase(testCase, output) {
    const expected = testCase.goalSpec || {};
    const goalSpec = output.goalSpec;
    const failures = [];
    if (output.goalSpecValidation.validationStatus !== 'VALID') failures.push(...output.goalSpecValidation.violations.map(item => item.code));
    if (expected.goalKind && goalSpec.goalKind !== expected.goalKind) failures.push('GOAL_KIND_INCORRECT');
    if (expected.resultShape && goalSpec.resultShape !== expected.resultShape) failures.push('RESULT_SHAPE_INCORRECT');
    if (expected.metric && goalSpec.metric !== expected.metric) failures.push('METRIC_INCORRECT');
    if (expected.write && goalSpec.writeRequired !== expected.write) failures.push('WRITE_REQUIRED_INCORRECT');
    if (expected.relationRequest && !preservesOwnerSpan(goalSpec.relationRequest || '', expected.relationRequest)) failures.push('RELATION_REQUEST_INCORRECT');
    for (const [index, expression] of (expected.overrides || []).entries()) {
        const actual = goalSpec.scenarioOverrides.filter(override => preservesOwnerSpan(override.expression, expression));
        if (!actual.length) failures.push(`SCENARIO_OVERRIDE_LOSS:${expression}`);
        else if (expected.classes?.[index] && !actual.some(override => override.scenarioClass === expected.classes[index])) failures.push(`SCENARIO_CLASS_INCORRECT:${expression}`);
    }
    if (expected.targetCount !== undefined && goalSpec.targets.length !== expected.targetCount) failures.push('TARGET_CARDINALITY_INCORRECT');
    if (goalSpec.ignoredWarnings.includes('GOAL_FACT_LEAK_WARNING')) failures.push('GOAL_FACT_LEAK_WARNING');
    return Object.freeze({ overall: failures.length ? 'FAIL' : 'PASS', failures: Object.freeze([...new Set(failures)]) });
}

function evaluateGoalSpecPipelineCase(testCase, output) {
    const goalSpec = evaluateGoalSpecCase(testCase, output);
    const compiler = goalSpec.overall === 'PASS'
        ? evaluateCompiledPlan(testCase, Object.freeze({ ...output, requirement: output.goalToFactRequirement, requirementMemo: output.goalSpecMemo }))
        : Object.freeze({ overall: output.validation.validationStatus === 'INVALID' ? 'FAIL' : 'PASS', failures: Object.freeze([]) });
    const failures = [...goalSpec.failures, ...compiler.failures];
    return Object.freeze({ overall: failures.length ? 'FAIL' : 'PASS', failures: Object.freeze([...new Set(failures)]), goalSpec, goalToFact: Object.freeze({ overall: output.goalSpecValidation.validationStatus === 'VALID' ? 'PASS' : 'FAIL', failures: output.goalSpecValidation.violations }), compiler, planStatus: output.rawPlan.status });
}

module.exports = { evaluateGoalSpecCase, evaluateGoalSpecPipelineCase };
