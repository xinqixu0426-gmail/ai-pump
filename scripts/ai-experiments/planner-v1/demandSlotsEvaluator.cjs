'use strict';

const { evaluateCompiledPlan, evaluateCompilerSafety } = require('./plannerEvaluator.cjs');
const { ownerSpanExists } = require('./demandSlotsValidator.cjs');

function evaluatesExpectedSpan(actual, expected) { return ownerSpanExists(expected, actual) || ownerSpanExists(actual, expected); }
function evaluateDemandSlots(testCase, output) {
    const expected = testCase.slotsExpected;
    const actual = output.slots;
    const failures = [...output.slotValidation.violations];
    if (actual.resultShape !== expected.resultShape) failures.push('RESULT_SHAPE_INCORRECT');
    if (actual.metric !== expected.metric) failures.push('METRIC_INCORRECT');
    if (actual.writeRequired !== (expected.write || 'NO')) failures.push('WRITE_REQUIRED_INCORRECT');
    if (expected.relationRequest && (!actual.relationRequest || !evaluatesExpectedSpan(actual.relationRequest, expected.relationRequest))) failures.push('RELATION_REQUEST_INCORRECT');
    if (!expected.relationRequest && actual.relationRequest) failures.push('RELATION_REQUEST_UNNECESSARY');
    const expectedOverrides = expected.overrides || [];
    if (actual.scenarioOverrides.length !== expectedOverrides.length) failures.push('SCENARIO_OVERRIDE_COUNT_INCORRECT');
    for (const [index, expression] of expectedOverrides.entries()) {
        const matching = actual.scenarioOverrides.filter(item => evaluatesExpectedSpan(item.expression, expression));
        if (!matching.length) failures.push(`SCENARIO_OVERRIDE_LOSS:${expression}`);
        else if (!matching.some(item => item.scenarioClass === expected.classes[index])) failures.push(`SCENARIO_CLASS_INCORRECT:${expression}`);
    }
    return Object.freeze({ overall: failures.length ? 'FAIL' : 'PASS', failures: Object.freeze([...new Set(failures)]) });
}
function evaluateDemandSlotsPipeline(testCase, output) {
    const slots = evaluateDemandSlots(testCase, output);
    const semantic = output.semantic.semanticStatus === 'COMPILABLE' && output.requirement.status === (testCase.requirement?.status || output.requirement.status) ? Object.freeze({ overall: 'PASS', failures: [] }) : Object.freeze({ overall: 'FAIL', failures: ['SEMANTIC_COMPILER_INCOMPLETE'] });
    let planCompiler;
    if (!output.rawPlan) planCompiler = Object.freeze({ overall: 'NOT_RUN', failures: [] });
    else if (slots.overall === 'PASS' && semantic.overall === 'PASS') planCompiler = evaluateCompiledPlan(testCase, output);
    else planCompiler = evaluateCompilerSafety(output);
    const failures = [...slots.failures, ...semantic.failures, ...planCompiler.failures];
    return Object.freeze({ overall: failures.length || !output.rawPlan ? 'FAIL' : 'PASS', failures: Object.freeze([...new Set(failures)]), slots, semanticCompiler: semantic, planCompiler, planStatus: output.rawPlan?.status || 'NOT_COMPILED' });
}
module.exports = { evaluateDemandSlots, evaluateDemandSlotsPipeline };
