'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createPlannerCapabilityCatalogSnapshot } = require('./capabilityCatalogSnapshot.cjs');
const { TARGETED_CASES, BASE_CASES, NEGATIVE_CASES } = require('./cases.cjs');
const { runPlannerPipeline } = require('./plannerPipeline.cjs');
const { evaluatePlannerCase } = require('./plannerEvaluator.cjs');
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
function selectedCases() { return scope === 'full' ? [...BASE_CASES, ...NEGATIVE_CASES] : TARGETED_CASES; }
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
async function main() {
    const env = { ...process.env, ...(fs.existsSync(path.join(root, '.env')) ? dotenv.parse(fs.readFileSync(path.join(root, '.env'))) : {}), DEEPSEEK_MODEL: 'deepseek-chat' };
    const snapshot = createPlannerCapabilityCatalogSnapshot();
    const results = [];
    for (const testCase of selectedCases()) results.push(await execute(testCase, env, snapshot));
    const validation = results.map(item => item.validation);
    const output = Object.freeze({ phase: 'M4-4C', scope, provider: 'DeepSeek', model: env.DEEPSEEK_MODEL, capabilityCatalog: snapshot, toolCalls: 0, businessApiCalls: 0, dbAccessAttempts: 0, writeAttempts: 0, modelCalls: results.reduce((sum, item) => sum + item.modelCalls.planner + (item.upstream.upstreamModelCalls ? Object.values(item.upstream.upstreamModelCalls).reduce((inner, value) => inner + value, 0) : 0), 0), planValidationMetrics: Object.freeze({ rawPlanPass: results.filter(item => item.evaluation.overall === 'PASS').length, rawPlanFail: results.filter(item => item.evaluation.overall === 'FAIL').length, validatedPlanPass: validation.filter(item => item.validationStatus === 'VALID').length, validatedPlanBlocked: validation.filter(item => item.validationStatus === 'SAFE_BLOCKED').length, planContractViolations: validation.reduce((sum, item) => sum + item.violations.length, 0), invalidStatusCount: validation.reduce((sum, item) => sum + item.violations.filter(violation => violation.code === 'PLAN_STATUS_INVALID').length, 0), blockedPlanStepViolations: validation.reduce((sum, item) => sum + item.metrics.blockedPlanStepViolations, 0), writeStagePolicyViolations: validation.reduce((sum, item) => sum + item.metrics.writeStagePolicyViolations, 0), computeValidationFailures: validation.reduce((sum, item) => sum + item.violations.filter(violation => violation.code.startsWith('COMPUTE_')).length, 0), computeCapabilityLookupAttempts: validation.reduce((sum, item) => sum + item.metrics.computeCapabilityLookupAttempts, 0), capabilityTargetTypeMismatches: validation.reduce((sum, item) => sum + item.violations.filter(violation => violation.code === 'CAPABILITY_OUTPUT_MISMATCH').length, 0), statusGroundingContradictions: validation.reduce((sum, item) => sum + item.violations.filter(violation => violation.code === 'STATUS_GROUNDING_CONTRADICTION').length, 0), statusPolicyContradictions: validation.reduce((sum, item) => sum + item.violations.filter(violation => violation.code === 'STATUS_POLICY_CONTRADICTION').length, 0), blockedRequiredFactViolations: validation.reduce((sum, item) => sum + item.violations.filter(violation => violation.code === 'BLOCKED_REQUIRED_FACT_VIOLATION').length, 0), multiOutputStepCount: results.reduce((sum, item) => sum + item.rawPlan.steps.filter(step => String(step.produces).includes(',')).length, 0) }), performance: Object.freeze({ plannerMedianMs: median(results.map(item => item.timings.plannerMs)), businessMedianMs: median(results.map(item => item.upstream.upstreamTimings?.businessMs || 0).filter(Boolean)), policyMedianMs: median(results.map(item => item.upstream.upstreamTimings?.policyMs || 0).filter(Boolean)), groundingMedianMs: median(results.map(item => item.upstream.upstreamTimings?.totalMs || 0).filter(Boolean)), totalRealChainMedianMs: median(results.filter(item => item.upstream.upstreamTimings).map(item => item.timings.plannerMs + item.upstream.upstreamTimings.totalMs)), totalMedianMs: median(results.map(item => item.timings.plannerMs + (item.upstream.upstreamTimings?.totalMs || 0)))}), results });
    if (outputPath) fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ ...output, results: results.map(item => ({ id: item.id, evaluation: item.evaluation, plannerMemo: item.plannerMemo, upstreamSource: item.upstreamSource, upstream: { groundingResult: item.upstream.groundingResult, finalGroundedTargets: item.upstream.finalGroundedTargets } })) }, null, 2));
}
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

module.exports = { execute, selectedCases };
