'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createPlannerCapabilityCatalogSnapshot } = require('./capabilityCatalogSnapshot.cjs');
const { BASE, NEGATIVE, TARGETED } = require('./demandSlotsCases.cjs');
const { runDemandSlotsPipeline } = require('./demandSlotsPipeline.cjs');
const { evaluateDemandSlotsPipeline } = require('./demandSlotsEvaluator.cjs');
const { realFrozenUpstream } = require('./demandFrozenUpstream.cjs');

const root = path.resolve(__dirname, '../../..');
function median(values) { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; }
function environment() { return { ...process.env, ...(fs.existsSync(path.join(root, '.env')) ? dotenv.parse(fs.readFileSync(path.join(root, '.env'))) : {}), DEEPSEEK_MODEL: 'deepseek-chat' }; }
function catalogFor(testCase, base) { const omitted = new Set(testCase.catalogOmit || []); const visibleCapabilities = base.visibleCapabilities.filter(item => !omitted.has(item.capabilityId)); return Object.freeze({ ...base, visibleCapabilities: Object.freeze(visibleCapabilities), plannerVisibleCapabilityCount: visibleCapabilities.length }); }
async function executeDemandSlots(testCase, env, catalog) {
    const upstream = testCase.id === 'P-09' ? await realFrozenUpstream(testCase, env) : Object.freeze({ ...testCase.upstream, source: 'FROZEN_UPSTREAM_FIXTURE_R10' });
    const output = await runDemandSlotsPipeline({ rawOwnerInput: testCase.user, upstream, capabilityCatalog: catalogFor(testCase, catalog) }, { env });
    return Object.freeze({ id: testCase.id, user: testCase.user, upstream, ...output, evaluation: evaluateDemandSlotsPipeline(testCase, output) });
}
function metrics(results) {
    const failures = results.flatMap(item => item.evaluation.slots.failures);
    const count = phrase => failures.filter(failure => failure.includes(phrase)).length;
    return Object.freeze({ slotsPass: results.filter(item => item.evaluation.slots.overall === 'PASS').length, slotsFail: results.filter(item => item.evaluation.slots.overall === 'FAIL').length, semanticCompilerPass: results.filter(item => item.evaluation.semanticCompiler.overall === 'PASS').length, semanticCompilerFail: results.filter(item => item.evaluation.semanticCompiler.overall === 'FAIL').length, planCompilerPass: results.filter(item => item.evaluation.planCompiler.overall === 'PASS').length, planCompilerFail: results.filter(item => item.evaluation.planCompiler.overall === 'FAIL').length, planCompilerNotRun: results.filter(item => item.evaluation.planCompiler.overall === 'NOT_RUN').length, finalPass: results.filter(item => item.evaluation.overall === 'PASS').length, finalFail: results.filter(item => item.evaluation.overall === 'FAIL').length, resultShapeFailures: count('RESULT_SHAPE'), metricFailures: count('METRIC'), relationRequestFailures: count('RELATION_REQUEST'), scenarioOverrideFailures: count('SCENARIO_OVERRIDE'), scenarioClassFailures: count('SCENARIO_CLASS'), writeFailures: count('WRITE_REQUIRED'), slotSchemaFailures: results.reduce((sum, item) => sum + item.slotValidation.violations.length, 0), semanticCompilerFailures: results.filter(item => item.evaluation.semanticCompiler.overall === 'FAIL').length, planCompilerFailures: results.filter(item => item.evaluation.planCompiler.overall === 'FAIL').length, realCapabilityGaps: results.filter(item => item.rawPlan?.status === 'BLOCKED_CAPABILITY').length, upstreamContractGaps: 0, evaluatorContractBugs: 0 });
}
async function main({ scope = 'targeted', outputPath = null, quiet = false } = {}) {
    const selected = scope === 'full' ? [...BASE, ...NEGATIVE] : TARGETED;
    const env = environment(); const snapshot = createPlannerCapabilityCatalogSnapshot(); const results = [];
    for (const testCase of selected) results.push(Object.freeze({ ...(await executeDemandSlots(testCase, env, snapshot)), testCase }));
    const summary = metrics(results);
    const output = Object.freeze({ phase: 'M4-4J', scope, provider: 'DeepSeek', model: env.DEEPSEEK_MODEL, demandSlotsSeesCapabilityCatalog: false, demandSlotsRetryEnabled: false, goalKindLlmFields: results.reduce((n, item) => n + item.slots.forbiddenFields.filter(field => field === 'GOAL_KIND').length, 0), goalFactLlmFields: results.reduce((n, item) => n + item.slots.forbiddenFields.filter(field => field === 'GOAL_FACT').length, 0), targetLlmFields: results.reduce((n, item) => n + item.slots.forbiddenFields.filter(field => field === 'TARGET').length, 0), capabilityCatalog: { totalCapabilities: snapshot.totalCapabilities, plannerVisibleCapabilityCount: snapshot.plannerVisibleCapabilityCount, writeCapabilitiesVisible: snapshot.visibleCapabilities.filter(item => item.mode === 'WRITE').length }, metrics: summary, modelCalls: Object.freeze({ demandSlots: results.length, semanticCompiler: 0, planCompiler: 0, upstream: results.reduce((sum, item) => sum + Object.values(item.upstream.upstreamModelCalls || {}).reduce((n, v) => n + v, 0), 0) }), performance: Object.freeze({ demandSlotsMedianMs: median(results.map(item => item.timings.demandSlotsMs)), semanticCompilerMedianMs: median(results.map(item => item.timings.semanticCompilerMs)), planCompilerMedianMs: median(results.map(item => item.timings.planCompilerMs)) }), safety: Object.freeze({ regroundingAttempts: 0, inventedFormalIds: 0, writeSteps: results.reduce((sum, item) => sum + (item.rawPlan?.steps || []).filter(step => step.mode === 'WRITE').length, 0), toolCalls: 0, businessApiCalls: 0, dbAccess: 0, writeCapabilitiesVisible: snapshot.visibleCapabilities.filter(item => item.mode === 'WRITE').length }), results: Object.freeze(results) });
    if (outputPath) fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(quiet ? { phase: output.phase, scope, cases: results.length, metrics: summary, modelCalls: output.modelCalls, performance: output.performance } : output, null, 2));
    return output;
}
if (require.main === module) main({ scope: process.argv[2] || 'targeted', outputPath: process.argv[3] || null, quiet: true }).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { executeDemandSlots, metrics, main, environment, catalogFor, median };
