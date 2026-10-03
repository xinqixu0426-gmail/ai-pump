'use strict';

const { evaluateCompiledPlan, evaluateCompilerSafety } = require('./plannerEvaluator.cjs');
const { ownerSpanExists } = require('./demandSlotsValidator.cjs');
function spanMatches(actual, expected) { return ownerSpanExists(expected, actual) || ownerSpanExists(actual, expected); }
function expectedResult(testCase, memo) {
    if (testCase.id === 'P-17') return memo.requestedResult === 'NONE';
    if (testCase.goalSpec.relationRequest && testCase.goalSpec.resultShape === 'VALUE') return ['VALUE', 'DETAIL'].includes(memo.requestedResult);
    return memo.requestedResult === testCase.goalSpec.resultShape;
}
function evaluateMinimalCase(testCase, output) {
    const spec = testCase.goalSpec; const memo = output.memo; const failures = [...output.memoValidation.violations];
    if (!expectedResult(testCase, memo)) failures.push('REQUESTED_RESULT_INCORRECT');
    if (memo.metric !== (testCase.id === 'P-17' ? 'NONE' : spec.metric)) failures.push('METRIC_INCORRECT');
    if (memo.writeRequired !== (spec.write || 'NO')) failures.push('WRITE_REQUIRED_INCORRECT');
    if (spec.relationRequest && (!memo.relationRequest || !spanMatches(memo.relationRequest, spec.relationRequest))) failures.push('RELATION_REQUEST_INCORRECT');
    if (!spec.relationRequest && memo.relationRequest) failures.push('RELATION_REQUEST_UNNECESSARY');
    if (memo.scenarioChanges.length !== (spec.overrides || []).length) failures.push('SCENARIO_CHANGE_COUNT_INCORRECT');
    for (const [index, phrase] of (spec.overrides || []).entries()) {
        const matches = memo.scenarioChanges.filter(item => spanMatches(item.expression, phrase));
        if (!matches.length) failures.push(`SCENARIO_CHANGE_MISSING:${phrase}`);
        else if (!matches.some(item => item.scenarioClass === spec.classes[index])) failures.push(`SCENARIO_CLASS_INCORRECT:${phrase}`);
    }
    const expectedTargets = testCase.upstream.finalGroundedTargets || [];
    const actualExact = output.resolutions.filter(item => item.status === 'EXACT');
    const actualMultiple = output.resolutions.filter(item => ['MULTIPLE', 'MULTIPLE_TYPE'].includes(item.status));
    const expectedMultiple = expectedTargets.some(item => ['MULTIPLE', 'MULTIPLE_TYPE'].includes(item.status));
    if (expectedMultiple && (actualMultiple.length !== 1 || output.resolutions.length !== 1)) failures.push('CANDIDATE_SET_NOT_PRESERVED');
    else if (!expectedMultiple && spec.targetCount > 0 && (actualExact.length !== spec.targetCount || output.resolutions.length !== spec.targetCount)) failures.push('REFERENCE_MENTION_LOSS');
    if (testCase.upstream.groundingResult === 'UNRESOLVED' && output.resolutions.some(item => item.status === 'EXACT')) failures.push('UNRESOLVED_REFERENCE_BOUND');
    if (output.resolutions.some(item => item.status === 'NOT_FOUND') && spec.targetCount > 0) failures.push('FORMAL_REFERENCE_NOT_FOUND');
    if (output.compileError) failures.push(`COMPILER_EXCEPTION:${output.compileError.code}`);
    const planner = Object.freeze({ overall: failures.length ? 'FAIL' : 'PASS', failures: Object.freeze([...new Set(failures)]) });
    const safeExecution = { toolCalls: 0, businessApiCalls: 0, dbAccessAttempts: 0, writeAttempts: 0 };
    const compiler = !output.adapted ? Object.freeze({ overall: 'NOT_RUN', failures: [] }) : planner.overall === 'PASS'
        ? evaluateCompiledPlan(testCase, { rawPlan: output.adapted.rawPlan, validation: output.validation, context: output.adapted.context, execution: safeExecution })
        : evaluateCompilerSafety({ rawPlan: output.adapted.rawPlan, validation: output.validation, execution: safeExecution });
    return Object.freeze({ overall: planner.overall === 'PASS' && compiler.overall === 'PASS' ? 'PASS' : 'FAIL', failures: Object.freeze([...new Set([...planner.failures, ...compiler.failures])]), planner, compiler, planStatus: output.adapted?.rawPlan.status || 'NOT_COMPILED' });
}
module.exports = { evaluateMinimalCase, spanMatches, expectedResult };
