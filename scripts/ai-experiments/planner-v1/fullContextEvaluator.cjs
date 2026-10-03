'use strict';

const { evaluateCompiledPlan, evaluateCompilerSafety } = require('./plannerEvaluator.cjs');
const { ownerSpanExists } = require('./demandSlotsValidator.cjs');

function spanMatches(actual, expected) { return ownerSpanExists(expected, actual) || ownerSpanExists(actual, expected); }
function expectedMode(testCase) { return ['P-01', 'P-02'].includes(testCase.id) ? 'EXPLAIN' : testCase.id === 'P-17' ? 'WRITE' : (testCase.goalSpec?.overrides?.length ? 'PREVIEW' : 'READ'); }
function evaluateFullContextCase(testCase, output) {
    const spec = testCase.goalSpec; const memo = output.memo;
    const failures = [...output.memoValidation.violations];
    if (memo.requestMode !== expectedMode(testCase)) failures.push('REQUEST_MODE_INCORRECT');
    if (memo.requestedResult !== (testCase.id === 'P-17' ? 'NONE' : spec.resultShape)) failures.push('REQUESTED_RESULT_INCORRECT');
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
    const identity = output.identity;
    if (identity.violations.length) failures.push(...identity.violations);
    if (testCase.upstream.groundingResult === 'UNRESOLVED' && !['NOT_FOUND', 'AMBIGUOUS'].includes(identity.status)) failures.push('UNRESOLVED_REFERENCE_ACCEPTED');
    if (spec.targetCount > 0 && !['AMBIGUOUS', 'VALID'].includes(identity.status)) failures.push('IDENTITY_NOT_VERIFIED');
    if (spec.targetCount === 2 && identity.validatedReferences.length !== 2) failures.push('MULTI_TARGET_LOSS');
    if (spec.targetCount === 1 && testCase.upstream.groundingResult !== 'MULTIPLE' && identity.validatedReferences.length !== 1) failures.push('TARGET_LOSS');
    const planner = Object.freeze({ overall: failures.length ? 'FAIL' : 'PASS', failures: Object.freeze([...new Set(failures)]) });
    const compiler = !output.adapted ? Object.freeze({ overall: 'NOT_RUN', failures: [] }) : planner.overall === 'PASS' ? evaluateCompiledPlan(testCase, { rawPlan: output.adapted.rawPlan, validation: output.validation, context: output.adapted.context, execution: { toolCalls: 0, businessApiCalls: 0, dbAccessAttempts: 0, writeAttempts: 0 } }) : evaluateCompilerSafety({ rawPlan: output.adapted.rawPlan, validation: output.validation, execution: { toolCalls: 0, businessApiCalls: 0, dbAccessAttempts: 0, writeAttempts: 0 } });
    return Object.freeze({ overall: planner.overall === 'PASS' && compiler.overall === 'PASS' ? 'PASS' : 'FAIL', failures: Object.freeze([...new Set([...planner.failures, ...compiler.failures])]), planner, compiler, planStatus: output.adapted?.rawPlan.status || 'NOT_COMPILED' });
}
module.exports = { evaluateFullContextCase, expectedMode };
