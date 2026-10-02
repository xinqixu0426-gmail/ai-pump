'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createPlannerCapabilityCatalogSnapshot } = require('./capabilityCatalogSnapshot.cjs');
const { TARGETED_CASES, BASE_CASES, NEGATIVE_CASES } = require('./cases.cjs');
const { runPlannerPipeline } = require('./plannerPipeline.cjs');
const { evaluatePlannerCase, evaluateRequirement } = require('./plannerEvaluator.cjs');
const { runGroundingPipeline } = require('../business-policy-intent/groundingPipeline.cjs');
const { createGroundingFixture } = require('../business-policy-intent/groundingFixture.cjs');

const root = path.resolve(__dirname, '../../..');
const scope = process.argv[2] || 'targeted';
const outputPath = process.argv[3] || null;
const businessModel = fs.readFileSync(path.join(root, 'planning/business-understanding/company-business-model-v1.md'), 'utf8');
const domainPolicy = [
    fs.readFileSync(path.join(root, 'api/services/ai-assistant/domain-policy.md'), 'utf8'),
    fs.readFileSync(path.join(root, 'planning/business-understanding/domain-policy-recipe-configurable-cost-v1.md'), 'utf8'),
].join('\n\n');

function median(values) { const sorted = [...values].sort((left, right) => left - right); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; }
function selectedCases(runScope = scope, caseIds = null) {
    const source = runScope === 'full' ? [...BASE_CASES, ...NEGATIVE_CASES] : TARGETED_CASES;
    if (!caseIds?.length) return source;
    const requested = new Set(caseIds);
    return source.filter(testCase => requested.has(testCase.id));
}
function catalogFor(testCase, base) {
    const omitted = new Set(testCase.catalogOmit || []);
    return Object.freeze({ ...base, visibleCapabilities: Object.freeze(base.visibleCapabilities.filter(capability => !omitted.has(capability.capabilityId))), plannerVisibleCapabilityCount: base.visibleCapabilities.filter(capability => !omitted.has(capability.capabilityId)).length });
}
async function realFrozenUpstream(testCase, env) {
    const fixture = createGroundingFixture();
    try {
        const result = await runGroundingPipeline({ userInput: testCase.user, recentOwnerWording: '', businessModel, domainPolicy }, {
            env,
            lookupEntities: async (_fetch, request) => fixture.lookupEntities(request),
            internalFetch: () => { throw new Error('PLANNER_REAL_UPSTREAM_FIXTURE_LOOKUP_DOES_NOT_FETCH'); },
        });
        return Object.freeze({ groundingResult: result.gate === 'RUN' ? 'RESOLVED' : result.gate, finalGroundedTargets: result.finalGroundedTargets, groundingAmbiguity: result.finalGroundedTargets.some(target => target.status === 'MULTIPLE') ? 'MULTIPLE formal candidates' : 'NONE', businessMemo: result.businessMemo, policyMemo: result.policyMemo, upstreamTimings: result.timings, upstreamModelCalls: result.modelCalls, source: 'REAL_FROZEN_UPSTREAM_CHAIN' });
    } finally { fixture.close(); }
}
async function execute(testCase, env, snapshot) {
    const useRealUpstream = testCase.id === 'P-09';
    const upstream = useRealUpstream ? await realFrozenUpstream(testCase, env) : Object.freeze({ ...testCase.upstream, source: 'FROZEN_UPSTREAM_FIXTURE_R10' });
    const output = await runPlannerPipeline({ rawOwnerInput: testCase.user, upstream, capabilityCatalog: catalogFor(testCase, snapshot) }, { env });
    return Object.freeze({ id: testCase.id, user: testCase.user, upstreamSource: upstream.source, upstream, ...output, evaluation: evaluatePlannerCase(testCase, output) });
}
function firstAttemptEvaluation(testCase, result) {
    const first = result.requirementAttempts[0];
    return evaluateRequirement(testCase, Object.freeze({ ...result, requirement: first.normalizedRequirement, requirementValidation: first.validation }));
}
function retryMetrics(results) {
    const first = results.map(item => Object.freeze({ item, evaluation: firstAttemptEvaluation(item.testCase, item) }));
    const retried = results.filter(item => item.requirementRetry.triggered);
    return Object.freeze({
        firstAttemptPass: first.filter(item => item.evaluation.overall === 'PASS').length,
        firstAttemptFail: first.filter(item => item.evaluation.overall === 'FAIL').length,
        contradictionsDetected: retried.length,
        retriesTriggered: retried.length,
        retriesRecovered: retried.filter(item => first.find(value => value.item === item).evaluation.overall === 'FAIL' && item.evaluation.requirement.overall === 'PASS').length,
        retriesFailed: retried.filter(item => item.evaluation.requirement.overall === 'FAIL').length,
        scenarioGoalMissingTriggers: retried.filter(item => item.requirementRetry.reasons.includes('SCENARIO_GOAL_MISSING')).length,
        scenarioClassUnderclassifiedTriggers: retried.filter(item => item.requirementRetry.reasons.includes('SCENARIO_CLASS_UNDERCLASSIFIED')).length,
        retryFalsePositives: retried.filter(item => first.find(value => value.item === item).evaluation.overall === 'PASS').length,
        retryFalseNegatives: first.filter(item => item.item.requirementRetry.triggered === false && item.item.requirement.scenarioOverrides.length && item.item.requirement.goalFacts.includes('CURRENT_COST') && !item.item.requirement.goalFacts.some(fact => ['SCENARIO_COST', 'SCENARIO_COMPARISON', 'COST_DIFFERENCE'].includes(fact))).length,
        maxAttemptsObserved: Math.max(0, ...results.map(item => item.requirementAttempts.length)),
    });
}
async function main({ runScope = scope, runOutputPath = outputPath, caseIds = null, quiet = false, phase = 'M4-4D' } = {}) {
    const env = { ...process.env, ...(fs.existsSync(path.join(root, '.env')) ? dotenv.parse(fs.readFileSync(path.join(root, '.env'))) : {}), DEEPSEEK_MODEL: 'deepseek-chat' };
    const snapshot = createPlannerCapabilityCatalogSnapshot();
    const results = [];
    for (const testCase of selectedCases(runScope, caseIds)) {
        const result = await execute(testCase, env, snapshot);
        results.push(Object.freeze({ ...result, testCase }));
    }
    const validation = results.map(item => item.validation);
    const retries = retryMetrics(results);
    const output = Object.freeze({ phase, scope: runScope, provider: 'DeepSeek', model: env.DEEPSEEK_MODEL, capabilityCatalog: snapshot, toolCalls: 0, businessApiCalls: 0, dbAccessAttempts: 0, writeAttempts: 0, modelCalls: Object.freeze({ requirementFirst: results.length, requirementRetry: results.reduce((sum, item) => sum + Math.max(0, item.modelCalls.requirementPlanner - 1), 0), requirement: results.reduce((sum, item) => sum + item.modelCalls.requirementPlanner, 0), planCompiler: 0, upstream: results.reduce((sum, item) => sum + (item.upstream.upstreamModelCalls ? Object.values(item.upstream.upstreamModelCalls).reduce((inner, value) => inner + value, 0) : 0), 0), total: results.reduce((sum, item) => sum + item.modelCalls.requirementPlanner + (item.upstream.upstreamModelCalls ? Object.values(item.upstream.upstreamModelCalls).reduce((inner, value) => inner + value, 0) : 0), 0) }), requirementMetrics: Object.freeze({ pass: results.filter(item => item.evaluation.requirement.overall === 'PASS').length, fail: results.filter(item => item.evaluation.requirement.overall === 'FAIL').length, ...retries }), compilerMetrics: Object.freeze({ pass: results.filter(item => item.evaluation.compiler.overall === 'PASS').length, fail: results.filter(item => item.evaluation.compiler.overall === 'FAIL').length }), planValidationMetrics: Object.freeze({ finalPass: results.filter(item => item.evaluation.overall === 'PASS').length, finalFail: results.filter(item => item.evaluation.overall === 'FAIL').length, validatedPlanPass: validation.filter(item => item.validationStatus === 'VALID').length, planContractViolations: validation.reduce((sum, item) => sum + item.violations.length, 0), compilerModelCalls: 0, capabilityTargetTypeMismatches: validation.reduce((sum, item) => sum + item.violations.filter(violation => violation.code === 'CAPABILITY_OUTPUT_MISMATCH').length, 0), statusGroundingContradictions: validation.reduce((sum, item) => sum + item.violations.filter(violation => violation.code === 'STATUS_GROUNDING_CONTRADICTION').length, 0), blockedRequiredFactViolations: validation.reduce((sum, item) => sum + item.violations.filter(violation => violation.code === 'BLOCKED_REQUIRED_FACT_VIOLATION').length, 0), multiOutputStepCount: results.reduce((sum, item) => sum + item.rawPlan.steps.filter(step => String(step.produces).includes(',')).length, 0) }), performance: Object.freeze({ requirementFirstMedianMs: median(results.map(item => item.timings.requirementFirstMs)), requirementRetryMedianMs: median(results.filter(item => item.timings.requirementRetryMs).map(item => item.timings.requirementRetryMs)), requirementRetryRate: results.length ? retries.retriesTriggered / results.length : 0, requirementPlannerMedianMs: median(results.map(item => item.timings.requirementPlannerMs)), planCompilerMedianMs: median(results.map(item => item.timings.planCompilerMs)), businessMedianMs: median(results.map(item => item.upstream.upstreamTimings?.businessMs || 0).filter(Boolean)), policyMedianMs: median(results.map(item => item.upstream.upstreamTimings?.policyMs || 0).filter(Boolean)), groundingMedianMs: median(results.map(item => item.upstream.upstreamTimings?.totalMs || 0).filter(Boolean)), totalRealChainMedianMs: median(results.filter(item => item.upstream.upstreamTimings).map(item => item.timings.requirementPlannerMs + item.upstream.upstreamTimings.totalMs)), totalMedianMs: median(results.map(item => item.timings.requirementPlannerMs + (item.upstream.upstreamTimings?.totalMs || 0)))}), results });
    if (runOutputPath) fs.writeFileSync(runOutputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(quiet ? { phase: output.phase, scope: output.scope, cases: results.length, requirement: output.requirementMetrics, compiler: output.compilerMetrics, final: output.planValidationMetrics, modelCalls: output.modelCalls } : { ...output, results: results.map(item => ({ id: item.id, evaluation: item.evaluation, plannerMemo: item.plannerMemo, upstreamSource: item.upstreamSource, upstream: { groundingResult: item.upstream.groundingResult, finalGroundedTargets: item.upstream.finalGroundedTargets } })) }, null, 2));
}
if (require.main === module || process.argv.length >= 3) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

module.exports = { execute, selectedCases, main, firstAttemptEvaluation, retryMetrics };
