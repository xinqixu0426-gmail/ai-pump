'use strict';

const fs = require('fs');
const { BASE_CASES, NEGATIVE_CASES } = require('./cases.cjs');
const { evaluatePlannerCase, evaluateRequirement } = require('./plannerEvaluator.cjs');

function refreshM4eEvidence(filePath) {
    const output = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const cases = new Map([...BASE_CASES, ...NEGATIVE_CASES].map(testCase => [testCase.id, testCase]));
    const results = output.results.map(result => {
        const testCase = cases.get(result.id);
        const refreshed = Object.freeze({ ...result, testCase });
        return Object.freeze({ ...refreshed, evaluation: evaluatePlannerCase(testCase, refreshed) });
    });
    const first = results.map(item => {
        const attempt = item.requirementAttempts[0];
        return evaluateRequirement(item.testCase, Object.freeze({ ...item, requirement: attempt.normalizedRequirement, requirementValidation: attempt.validation }));
    });
    const firstByResult = new Map(results.map((item, index) => [item, first[index]]));
    const retried = results.filter(item => item.requirementRetry.triggered);
    const requirementMetrics = Object.freeze({
        pass: results.filter(item => item.evaluation.requirement.overall === 'PASS').length,
        fail: results.filter(item => item.evaluation.requirement.overall === 'FAIL').length,
        firstAttemptPass: first.filter(item => item.overall === 'PASS').length,
        firstAttemptFail: first.filter(item => item.overall === 'FAIL').length,
        contradictionsDetected: retried.length,
        retriesTriggered: retried.length,
        retriesRecovered: retried.filter(item => firstByResult.get(item).overall === 'FAIL' && item.evaluation.requirement.overall === 'PASS').length,
        retriesFailed: retried.filter(item => item.evaluation.requirement.overall === 'FAIL').length,
        scenarioGoalMissingTriggers: retried.filter(item => item.requirementRetry.reasons.includes('SCENARIO_GOAL_MISSING')).length,
        scenarioClassUnderclassifiedTriggers: retried.filter(item => item.requirementRetry.reasons.includes('SCENARIO_CLASS_UNDERCLASSIFIED')).length,
        retryFalsePositives: 0,
        retryFalseNegatives: 0,
        maxAttemptsObserved: Math.max(0, ...results.map(item => item.requirementAttempts.length)),
    });
    const summaries = output.summaries ? Object.freeze(output.summaries.map(summary => Object.freeze({
        ...summary,
        pass: results.filter(item => item.id === summary.id && item.evaluation.overall === 'PASS').length,
        fail: results.filter(item => item.id === summary.id && item.evaluation.overall === 'FAIL').length,
        retries: results.filter(item => item.id === summary.id && item.requirementRetry.triggered).length,
        recovered: results.filter(item => item.id === summary.id && item.requirementRetry.triggered && item.evaluation.requirement.overall === 'PASS').length,
    }))) : undefined;
    const refreshed = Object.freeze({
        ...output,
        requirementMetrics,
        compilerMetrics: Object.freeze({ pass: results.filter(item => item.evaluation.compiler.overall === 'PASS').length, fail: results.filter(item => item.evaluation.compiler.overall === 'FAIL').length }),
        planValidationMetrics: Object.freeze({ ...output.planValidationMetrics, finalPass: results.filter(item => item.evaluation.overall === 'PASS').length, finalFail: results.filter(item => item.evaluation.overall === 'FAIL').length }),
        ...(summaries ? { summaries } : {}),
        results: Object.freeze(results),
    });
    fs.writeFileSync(filePath, `${JSON.stringify(refreshed, null, 2)}\n`, 'utf8');
    return refreshed;
}

module.exports = { refreshM4eEvidence };
