'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createPlannerCapabilityCatalogSnapshot } = require('./capabilityCatalogSnapshot.cjs');
const { GOAL_SPEC_BASE_CASES, GOAL_SPEC_NEGATIVE_CASES } = require('./goalSpecCases.cjs');
const { buildFrozenFixtureCatalog, buildPlannerCatalogSnapshot } = require('./fullContextCatalog.cjs');
const { environment } = require('./run-full-context-upstream-audit.cjs');
const { runMinimalPlannerPipeline } = require('./minimalPlannerPipeline.cjs');
const { evaluateMinimalCase } = require('./minimalPlannerEvaluator.cjs');
const { createInternalFetch, getJson } = require('../../../api/routes/ai/internalApiClient.cjs');

const root = path.resolve(__dirname, '../../..');
const ALL = Object.freeze([...GOAL_SPEC_BASE_CASES, ...GOAL_SPEC_NEGATIVE_CASES]);
const TARGETED = Object.freeze(['P-03', 'P-05', 'P-06', 'P-07', 'P-08', 'P-09', 'P-10', 'P-11', 'P-12', 'P-13', 'P-14', 'P-15', 'P-17', 'N-04', 'N-06', 'N-08']);
const REPEAT = Object.freeze(['P-03', 'P-07', 'P-08', 'P-11', 'P-12', 'P-13', 'P-14', 'P-15', 'P-17', 'N-06']);
const oldEvidence = JSON.parse(fs.readFileSync(path.join(root, 'planning/planner/M4-4K-Full-Context-Full.json'), 'utf8'));
const memoCache = new Map(oldEvidence.results.map(item => [item.id, { businessMemo: item.input.businessMemo, policyMemo: item.input.policyMemo, source: 'M4-4K_REAL_AGENT_MEMO_REPLAY' }]));
function median(values) { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; }
function capabilityFor(testCase, base) { const omit = new Set(testCase.catalogOmit || []); return { ...base, visibleCapabilities: base.visibleCapabilities.filter(item => !omit.has(item.capabilityId)) }; }
async function executeFrozen(testCase, env, catalog, capabilityCatalog) {
    const memos = memoCache.get(testCase.id); if (!memos) throw new Error(`REAL_UPSTREAM_MEMO_MISSING:${testCase.id}`);
    const output = await runMinimalPlannerPipeline({ rawOwnerInput: testCase.user, recentConversation: '', businessMemo: memos.businessMemo, policyMemo: memos.policyMemo, catalogSnapshot: catalog, capabilityCatalog: capabilityFor(testCase, capabilityCatalog) }, { env });
    return { id: testCase.id, user: testCase.user, memoSource: memos.source, ...output, evaluation: evaluateMinimalCase(testCase, output), testCase };
}
function summarize(results) {
    const count = state => results.filter(item => item.evaluation.overall === state).length;
    return { pass: count('PASS'), fail: count('FAIL'), compilerPass: results.filter(item => item.evaluation.compiler.overall === 'PASS').length, compilerFail: results.filter(item => item.evaluation.compiler.overall === 'FAIL').length, inventedIdFields: results.filter(item => /(?:SELECTED_REFERENCE|FORMAL_ID|CANONICAL_ID):/u.test(item.rawPlannerMemo)).length, silentFirstBindings: results.filter(item => item.resolutions.some(resolution => ['MULTIPLE', 'MULTIPLE_TYPE'].includes(resolution.status) && item.adapted?.context.finalGroundedTargets.some(target => target.status === 'EXACT' && resolution.matches.some(match => match.canonicalId === target.canonicalId && match.entityType === target.entityType)))).length, writeExecutions: 0, businessApiWrites: 0, dbWrites: 0, llmSql: results.filter(item => /(?:SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET)/iu.test(item.rawPlannerMemo)).length };
}
async function frozen(scope, outputPath) {
    const env = environment(); const catalog = buildFrozenFixtureCatalog(); const capabilities = createPlannerCapabilityCatalogSnapshot(); const cases = new Map(ALL.map(item => [item.id, item]));
    const selected = scope === 'targeted' ? TARGETED : scope === 'repeat' ? REPEAT.flatMap(id => Array.from({ length: 5 }, (_, i) => ({ ...cases.get(id), repeatRun: i + 1 }))) : ALL;
    const results = [];
    for (const item of selected) results.push(await executeFrozen(typeof item === 'string' ? cases.get(item) : item, env, catalog, capabilities));
    const summaries = scope === 'repeat' ? REPEAT.map(id => ({ id, pass: results.filter(item => item.id === id && item.evaluation.overall === 'PASS').length, fail: results.filter(item => item.id === id && item.evaluation.overall === 'FAIL').length })) : null;
    const evidence = { phase: 'M4-4L', scope: `frozen-${scope}`, plannerModel: 'DeepSeek/deepseek-chat', plannerRetry: false, catalogSourceMode: catalog.sourceMode, fullMemoSource: 'M4-4K genuine complete Business/Policy Agent outputs', summaries, metrics: summarize(results), modelCalls: { planner: results.length, business: 0, policy: 0, resolver: 0, semanticCompiler: 0, planCompiler: 0 }, performance: { plannerMedianMs: median(results.map(item => item.timings.plannerMs)), resolverMedianMs: median(results.map(item => item.timings.resolverMs)), semanticCompilerMedianMs: median(results.map(item => item.timings.semanticCompilerMs)), contextMedianChars: median(results.map(item => item.contextChars.total)) }, results };
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ scope, metrics: evidence.metrics, summaries, failures: results.filter(item => item.evaluation.overall === 'FAIL').map(item => ({ id: item.id, failures: item.evaluation.failures })) }, null, 2));
    return evidence;
}
async function officialCatalog() {
    dotenv.config({ path: path.join(root, '.env'), quiet: true });
    const internalFetch = createInternalFetch();
    return buildPlannerCatalogSnapshot({ getJson: route => getJson(internalFetch, route) });
}
async function audit(outputPath) {
    const catalog = await officialCatalog();
    const evidence = { phase: 'M4-4L', authentication: { previous401RootCause: 'M4-4K targeted localhost:3002 while current configured PORT is 3012; request omitted established x-internal-secret read channel', fix: 'reuse existing internalApiClient createInternalFetch + getJson for GET only', productionAuthChanged: false, writeCredentialUsed: false, credentialsPersisted: false }, sourceMode: catalog.sourceMode, sources: Object.fromEntries(Object.entries(catalog.domains).map(([key, group]) => [key, group.source])), counts: Object.fromEntries(Object.entries(catalog.domains).map(([key, group]) => [key, group.count])), serializedChars: catalog.serializedChars, estimatedTokens: catalog.estimatedTokens, snapshotAt: catalog.snapshotAt, snapshot: catalog };
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ authentication: evidence.authentication, counts: evidence.counts, chars: evidence.serializedChars, tokens: evidence.estimatedTokens }));
    return catalog;
}
async function main(mode, outputPath) { return mode === 'catalog' ? audit(outputPath) : frozen(mode, outputPath); }
if (require.main === module) main(process.argv[2], process.argv[3]).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { ALL, TARGETED, REPEAT, memoCache, median, summarize, frozen, officialCatalog, audit, executeFrozen };
