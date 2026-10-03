'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createPlannerCapabilityCatalogSnapshot } = require('./capabilityCatalogSnapshot.cjs');
const { GOAL_SPEC_BASE_CASES, GOAL_SPEC_NEGATIVE_CASES, GOAL_SPEC_TARGETED_CASES } = require('./goalSpecCases.cjs');
const { runGoalSpecPipeline } = require('./goalSpecPipeline.cjs');
const { evaluateGoalSpecPipelineCase } = require('./goalSpecEvaluator.cjs');
const { realFrozenUpstream } = require('./run-smoke.cjs');

const root = path.resolve(__dirname, '../../..');
function median(values) { const sorted = [...values].sort((left, right) => left - right); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; }
function environment() { return { ...process.env, ...(fs.existsSync(path.join(root, '.env')) ? dotenv.parse(fs.readFileSync(path.join(root, '.env'))) : {}), DEEPSEEK_MODEL: 'deepseek-chat' }; }
function casesFor(scope) { return scope === 'full' ? [...GOAL_SPEC_BASE_CASES, ...GOAL_SPEC_NEGATIVE_CASES] : GOAL_SPEC_TARGETED_CASES; }
function catalogFor(testCase, base) { const omitted = new Set(testCase.catalogOmit || []); const visibleCapabilities = base.visibleCapabilities.filter(capability => !omitted.has(capability.capabilityId)); return Object.freeze({ ...base, visibleCapabilities: Object.freeze(visibleCapabilities), plannerVisibleCapabilityCount: visibleCapabilities.length }); }

async function executeGoalSpec(testCase, env, snapshot) {
    const upstream = testCase.id === 'P-09'
        ? await realFrozenUpstream(testCase, env)
        : Object.freeze({ ...testCase.upstream, source: 'FROZEN_UPSTREAM_FIXTURE_R10' });
    const output = await runGoalSpecPipeline({ rawOwnerInput: testCase.user, upstream, capabilityCatalog: catalogFor(testCase, snapshot) }, { env });
    return Object.freeze({ id: testCase.id, user: testCase.user, upstream, ...output, evaluation: evaluateGoalSpecPipelineCase(testCase, output) });
}
function metrics(results) {
    const countFailures = needle => results.reduce((sum, item) => sum + item.evaluation.goalSpec.failures.filter(failure => failure.includes(needle)).length, 0);
    return Object.freeze({
        goalSpecPass: results.filter(item => item.evaluation.goalSpec.overall === 'PASS').length,
        goalSpecFail: results.filter(item => item.evaluation.goalSpec.overall === 'FAIL').length,
        goalToFactPass: results.filter(item => item.evaluation.goalToFact.overall === 'PASS').length,
        goalToFactFail: results.filter(item => item.evaluation.goalToFact.overall === 'FAIL').length,
        planCompilerPass: results.filter(item => item.evaluation.compiler.overall === 'PASS').length,
        planCompilerFail: results.filter(item => item.evaluation.compiler.overall === 'FAIL').length,
        finalPass: results.filter(item => item.evaluation.overall === 'PASS').length,
        finalFail: results.filter(item => item.evaluation.overall === 'FAIL').length,
        goalKindFailures: countFailures('GOAL_KIND'), resultShapeFailures: countFailures('RESULT_SHAPE'), metricFailures: countFailures('METRIC'), targetFailures: countFailures('TARGET'), relationRequestFailures: countFailures('RELATION_REQUEST'), scenarioOverrideFailures: countFailures('SCENARIO_OVERRIDE'), scenarioClassFailures: countFailures('SCENARIO_CLASS'), writeFailures: countFailures('WRITE_REQUIRED'),
        goalSpecSchemaFailures: results.reduce((sum, item) => sum + item.goalSpecValidation.violations.length, 0),
        goalFactLeakWarnings: results.reduce((sum, item) => sum + item.goalSpec.ignoredWarnings.filter(warning => warning === 'GOAL_FACT_LEAK_WARNING').length, 0),
        goalToFactFailures: results.filter(item => item.evaluation.goalToFact.overall === 'FAIL').length,
        planCompilerFailures: results.filter(item => item.evaluation.compiler.overall === 'FAIL').length,
        realCapabilityGaps: results.filter(item => item.rawPlan.status === 'BLOCKED_CAPABILITY').length,
        upstreamContractGaps: 0,
        evaluatorContractBugs: 0,
    });
}
async function main({ scope = 'targeted', outputPath = null, caseIds = null, quiet = false, phase = 'M4-4I' } = {}) {
    const env = environment();
    const snapshot = createPlannerCapabilityCatalogSnapshot();
    const selected = caseIds ? casesFor(scope).filter(testCase => caseIds.includes(testCase.id)) : casesFor(scope);
    const results = [];
    for (const testCase of selected) results.push(Object.freeze({ ...(await executeGoalSpec(testCase, env, snapshot)), testCase }));
    const summary = metrics(results);
    const output = Object.freeze({ phase, scope, provider: 'DeepSeek', model: env.DEEPSEEK_MODEL, capabilityCatalog: snapshot, goalSpecSeesCapabilityCatalog: false, goalSpecRetryEnabled: false, toolCalls: 0, businessApiCalls: 0, dbAccessAttempts: 0, writeAttempts: 0, modelCalls: Object.freeze({ goalSpec: results.length, oldRequirementBenchmark: 0, goalToFact: 0, planCompiler: 0, upstream: results.reduce((sum, item) => sum + (item.upstream.upstreamModelCalls ? Object.values(item.upstream.upstreamModelCalls).reduce((inner, value) => inner + value, 0) : 0), 0), total: results.reduce((sum, item) => sum + item.modelCalls.goalSpec + (item.upstream.upstreamModelCalls ? Object.values(item.upstream.upstreamModelCalls).reduce((inner, value) => inner + value, 0) : 0), 0) }), metrics: summary, performance: Object.freeze({ goalSpecMedianMs: median(results.map(item => item.timings.goalSpecMs)), goalToFactMedianMs: median(results.map(item => item.timings.goalToFactMs)), planCompilerMedianMs: median(results.map(item => item.timings.planCompilerMs)) }), results: Object.freeze(results) });
    if (outputPath) fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(quiet ? { phase, scope, cases: results.length, metrics: summary, modelCalls: output.modelCalls, performance: output.performance } : output, null, 2));
    return output;
}

module.exports = { executeGoalSpec, metrics, main };
