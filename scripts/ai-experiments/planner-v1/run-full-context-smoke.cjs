'use strict';

const fs = require('fs');
const path = require('path');
const { createPlannerCapabilityCatalogSnapshot } = require('./capabilityCatalogSnapshot.cjs');
const { GOAL_SPEC_BASE_CASES, GOAL_SPEC_NEGATIVE_CASES } = require('./goalSpecCases.cjs');
const { buildFrozenFixtureCatalog } = require('./fullContextCatalog.cjs');
const { realMemos, environment } = require('./run-full-context-upstream-audit.cjs');
const { runFullContextPipeline } = require('./fullContextPipeline.cjs');
const { evaluateFullContextCase } = require('./fullContextEvaluator.cjs');

const root = path.resolve(__dirname, '../../..');
const ALL = Object.freeze([...GOAL_SPEC_BASE_CASES, ...GOAL_SPEC_NEGATIVE_CASES]);
const TARGETED_IDS = Object.freeze(['P-03', 'P-05', 'P-06', 'P-07', 'P-08', 'P-09', 'P-10', 'P-11', 'P-12', 'P-13', 'P-14', 'P-15', 'P-17', 'N-04', 'N-06', 'N-08']);
function median(values) { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; }
function auditMemos() { const file = path.join(root, 'planning/planner/M4-4K-Upstream-Handoff-Audit.json'); return new Map((fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).results : []).map(item => [item.id, item])); }
const memoCache = auditMemos();
async function memoFor(testCase, env) {
    const cached = memoCache.get(testCase.id);
    if (cached) return Object.freeze({ businessMemo: cached.businessMemo, policyMemo: cached.policyMemo, timings: cached.timings, source: 'REAL_AGENT_MEMO_AUDIT_CACHE', modelCallsThisRun: { business: 0, policy: 0 } });
    const memos = await realMemos(testCase.user, env);
    memoCache.set(testCase.id, memos);
    return Object.freeze({ ...memos, source: 'REAL_AGENT_MEMO_THIS_RUN', modelCallsThisRun: { business: 1, policy: 1 } });
}
function catalogFor(testCase, base) { const omit = new Set(testCase.catalogOmit || []); const visibleCapabilities = base.visibleCapabilities.filter(item => !omit.has(item.capabilityId)); return Object.freeze({ ...base, visibleCapabilities: Object.freeze(visibleCapabilities), plannerVisibleCapabilityCount: visibleCapabilities.length }); }
async function executeFullContext(testCase, env, catalogSnapshot, capabilityCatalog) {
    const memos = await memoFor(testCase, env);
    const output = await runFullContextPipeline({ rawOwnerInput: testCase.user, businessMemo: memos.businessMemo, policyMemo: memos.policyMemo, catalogSnapshot, capabilityCatalog: catalogFor(testCase, capabilityCatalog) }, { env });
    return Object.freeze({ id: testCase.id, user: testCase.user, memoSource: memos.source, memoTimings: memos.timings, memoModelCallsThisRun: memos.modelCallsThisRun, ...output, evaluation: evaluateFullContextCase(testCase, output), testCase });
}
function metrics(results) { return Object.freeze({ plannerPass: results.filter(item => item.evaluation.planner.overall === 'PASS').length, plannerFail: results.filter(item => item.evaluation.planner.overall === 'FAIL').length, compilerPass: results.filter(item => item.evaluation.compiler.overall === 'PASS').length, compilerFail: results.filter(item => item.evaluation.compiler.overall === 'FAIL').length, compilerNotRun: results.filter(item => item.evaluation.compiler.overall === 'NOT_RUN').length, finalPass: results.filter(item => item.evaluation.overall === 'PASS').length, finalFail: results.filter(item => item.evaluation.overall === 'FAIL').length, invalidReferences: results.reduce((n, item) => n + item.identity.violations.filter(code => code.includes('NOT_FOUND') || code.includes('MISMATCH')).length, 0), ambiguousReferences: results.filter(item => item.identity.status === 'AMBIGUOUS').length, silentAmbiguitySelections: results.filter(item => item.identity.violations.includes('SILENT_AMBIGUITY_SELECTION')).length, modelInventedIds: results.filter(item => item.identity.violations.includes('REFERENCE_NOT_FOUND')).length, writeExecutions: 0, dbWrites: 0, toolExecutions: 0 }); }
async function main({ scope = 'targeted', outputPath } = {}) {
    const env = environment(); const catalogSnapshot = buildFrozenFixtureCatalog(); const capabilityCatalog = createPlannerCapabilityCatalogSnapshot();
    const selected = scope === 'full' ? ALL : ALL.filter(item => TARGETED_IDS.includes(item.id));
    const results = [];
    for (const testCase of selected) results.push(await executeFullContext(testCase, env, catalogSnapshot, capabilityCatalog));
    const output = Object.freeze({ phase: 'M4-4K', scope, provider: 'DeepSeek', model: 'deepseek-chat', retryEnabled: false, catalogSourceMode: catalogSnapshot.sourceMode, catalogFidelityGap: 'Frozen 26-case entity fixture does not match current local production-style catalog; authenticated GET returned 401', catalogCounts: Object.fromEntries(Object.entries(catalogSnapshot.domains).map(([key, value]) => [key, value.count])), metrics: metrics(results), modelCalls: Object.freeze({ business: results.reduce((n, item) => n + item.memoModelCallsThisRun.business, 0), policy: results.reduce((n, item) => n + item.memoModelCallsThisRun.policy, 0), planner: results.length, grounding: 0, compiler: 0 }), performance: Object.freeze({ businessMedianMs: median(results.map(item => item.memoTimings.businessMs)), policyMedianMs: median(results.map(item => item.memoTimings.policyMs)), plannerMedianMs: median(results.map(item => item.timings.plannerMs)), planCompilerMedianMs: median(results.map(item => item.timings.planCompilerMs)), contextMedianChars: median(results.map(item => item.contextChars.total)) }), results });
    fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ scope, cases: results.length, metrics: output.metrics, modelCalls: output.modelCalls, performance: output.performance, failures: results.filter(item => item.evaluation.overall === 'FAIL').map(item => ({ id: item.id, failures: item.evaluation.failures })) }, null, 2));
    return output;
}
if (require.main === module) main({ scope: process.argv[2] || 'targeted', outputPath: process.argv[3] }).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { ALL, TARGETED_IDS, memoFor, executeFullContext, metrics, main, median, environment };
