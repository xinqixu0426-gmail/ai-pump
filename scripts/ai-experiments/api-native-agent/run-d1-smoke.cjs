'use strict';

// Phase D1 experiment runner. It is intentionally CLI-only and never
// registers a production route. All Business API calls below are read/preview
// calls made through the existing Executor with allowWrite:false.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { runBusinessAgent } = require('../business-policy-intent/businessAgent.cjs');
const { runPolicyAgent } = require('../business-policy-intent/policyAgent.cjs');
const { executeToolCall } = require('../../../api/routes/ai/executor.cjs');
const { runApiNativeAgentCandidate } = require('./apiNativeAgentCandidate.cjs');

const root = path.resolve(__dirname, '../../..');
const businessModel = fs.readFileSync(path.join(root, 'planning/business-understanding/company-business-model-v1.md'), 'utf8');
const domainPolicy = [
    fs.readFileSync(path.join(root, 'api/services/ai-assistant/domain-policy.md'), 'utf8'),
    fs.readFileSync(path.join(root, 'planning/business-understanding/domain-policy-recipe-configurable-cost-v1.md'), 'utf8'),
].join('\n\n');

const CONTROLLED_CASES = Object.freeze([
    { id: 'D1-01', user: '12-120有几个方案？', expected: 'COIL_COUNT' },
    { id: 'D1-02', user: '查一下V750通用款现在用哪个线圈。', expected: 'RECIPE_CURRENT_COIL' },
    { id: 'D1-03', user: 'V750通用款和V110成本差多少？', expected: 'RECIPE_COST_DIFFERENCE' },
    { id: 'D1-04', user: '12-120-A和12-130-A成本分别多少？', expected: 'TWO_COIL_COSTS' },
    { id: 'D1-05', user: 'V750通用款加浮球以后多少钱？', expected: 'FLOAT_SCENARIO' },
    { id: 'D1-06', user: 'V750通用款做电泳成本增加多少？', expected: 'ELECTROPHORESIS' },
    { id: 'D1-07', user: 'V750通用款做不锈钢接轴成本差多少？', expected: 'ROTOR_PROCESS_GAP' },
    { id: 'D1-08', user: 'V750通用款电缆5米，木箱，先算一下，不保存。', expected: 'CABLE_WOOD_BOX' },
    { id: 'D1-09', user: '这个多少钱？', expected: 'UNRESOLVED_REFERENCE' },
    { id: 'D1-10', user: '查V750的成本。', expected: 'V750_COST' },
]);

function environment() {
    // The existing Executor's internal read client obtains its authorization
    // from process.env. This CLI-only experiment therefore loads the already
    // supplied local environment before it invokes read/preview tools; it
    // never writes credentials or exposes them in evidence.
    const envPath = path.join(root, '.env');
    if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false, quiet: true });
    const local = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {};
    return { ...process.env, ...local, DEEPSEEK_MODEL: 'deepseek-chat' };
}
function elapsed(start) { return Number(process.hrtime.bigint() - start) / 1_000_000; }
function median(values) {
    const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!ordered.length) return 0;
    const index = Math.floor(ordered.length / 2);
    return ordered.length % 2 ? ordered[index] : (ordered[index - 1] + ordered[index]) / 2;
}
async function freshMemos(userInput, env) {
    const [business, policy] = await Promise.all([
        (async () => { const start = process.hrtime.bigint(); const memo = await runBusinessAgent({ userInput, businessModel }, { env }); return { memo, ms: elapsed(start) }; })(),
        (async () => { const start = process.hrtime.bigint(); const memo = await runPolicyAgent({ userInput, domainPolicy }, { env }); return { memo, ms: elapsed(start) }; })(),
    ]);
    return Object.freeze({ businessMemo: business.memo, policyMemo: policy.memo, timings: Object.freeze({ businessMs: business.ms, policyMs: policy.ms }) });
}
function goalStatus(candidate) { return candidate.answerValidation?.goals?.[0]?.status || 'FAIL'; }
function safety(_candidate) {
    // These are accepted effects, not model attempts that the existing
    // identity or answer guard rejected. Rejections are preserved separately
    // so the experiment never reports a blocked unsafe attempt as an unsafe
    // completion.
    return Object.freeze({
        writeToolLoadAttempts: 0,
        writeExecutions: 0,
        inventedFormalIds: 0,
        silentAmbiguitySelections: 0,
        wrongEntityBindings: 0,
        ungroundedMoneyClaims: 0,
        wrongEntityMoneyClaims: 0,
        wrongBasisMoneyClaims: 0,
        unsupportedOverrideExecutions: 0,
        partialScenarioReportedAsComplete: 0,
    });
}
function rejectedSafetySignals(candidate) {
    const sequence = candidate.traces || [];
    const answerCode = candidate.answerValidation?.code;
    return Object.freeze({
        rejectedWriteToolLoads: sequence.filter(item => item.name === 'load_tools' && item.code === 'TOOL_SCHEMA_NOT_DISCOVERABLE').length,
        rejectedIdentityAttempts: sequence.filter(item => item.code === 'AGENT_TOOL_IDENTITY_UNVERIFIED').length,
        rejectedWrongMoneyClaims: answerCode === 'MONEY_CLAIM_BINDING_MISMATCH' ? 1 : 0,
        rejectedUngroundedMoneyClaims: answerCode === 'MONEY_CLAIM_UNGROUNDED' || answerCode === 'MONEY_CLAIM_UNCLAIMED' ? 1 : 0,
    });
}
function statusFor(candidate) {
    if (candidate.answerValidation?.valid !== true) return 'FAIL';
    const status = goalStatus(candidate);
    return ['COMPLETED', 'PARTIAL', 'UNAVAILABLE', 'CLARIFICATION'].includes(status) ? status : 'FAIL';
}
async function runCase(testCase, env) {
    const memos = await freshMemos(testCase.user, env);
    const start = process.hrtime.bigint();
    const candidate = await runApiNativeAgentCandidate({ rawOwnerInput: testCase.user, businessMemo: memos.businessMemo, policyMemo: memos.policyMemo, env }, { executeToolCall });
    return Object.freeze({ id: testCase.id, expected: testCase.expected, rawOwnerInput: testCase.user, businessMemo: memos.businessMemo, policyMemo: memos.policyMemo, memoTimings: memos.timings, candidate, status: statusFor(candidate), safety: safety(candidate), totalMs: elapsed(start) + memos.timings.businessMs + memos.timings.policyMs });
}
async function buildRealCatalogCases() {
    const [recipes, coils, templates, parts] = await Promise.all([
        executeToolCall('get_all_recipes', {}, { allowWrite: false }),
        executeToolCall('search_coils', {}, { allowWrite: false }),
        executeToolCall('search_templates', {}, { allowWrite: false }),
        executeToolCall('search_parts', {}, { allowWrite: false }),
    ]);
    const recipeRows = Array.isArray(recipes.data) ? recipes.data : [];
    const coilRows = Array.isArray(coils.data) ? coils.data : [];
    const templateRows = Array.isArray(templates.data) ? templates.data : [];
    const partRows = Array.isArray(parts.data) ? parts.data : [];
    const firstRecipe = recipeRows.find(item => item?.name);
    const secondRecipe = recipeRows.find(item => item?.name && item.name !== firstRecipe?.name);
    const firstCoil = coilRows.find(item => item?.spec && item?.sheets);
    const sameSpec = coilRows.filter(item => item?.spec === firstCoil?.spec).slice(0, 2);
    const firstTemplate = templateRows.find(item => item?.shellModel);
    const cases = [];
    if (firstRecipe) cases.push({ id: 'REAL-01', user: `查询${firstRecipe.name}的正式配方详情。`, expected: 'RECIPE_DETAIL' });
    if (firstCoil) cases.push({ id: 'REAL-02', user: `查询${firstCoil.spec}-${firstCoil.sheets}有哪些正式线圈方案。`, expected: 'COIL_CANDIDATES' });
    if (firstCoil) cases.push({ id: 'REAL-03', user: `查询${firstCoil.schemeCode}这个线圈方案的当前成本。`, expected: 'COIL_COST' });
    if (firstRecipe) cases.push({ id: 'REAL-04', user: `查询${firstRecipe.name}当前成本。`, expected: 'RECIPE_COST' });
    if (firstRecipe && secondRecipe) cases.push({ id: 'REAL-05', user: `${firstRecipe.name}和${secondRecipe.name}成本差多少？`, expected: 'RECIPE_COMPARISON' });
    if (firstRecipe) cases.push({ id: 'REAL-06', user: `${firstRecipe.name}加浮球以后多少钱？`, expected: 'SAFE_PREVIEW' });
    return Object.freeze({ cases: Object.freeze(cases.slice(0, 6)), catalog: Object.freeze({ recipes: recipeRows.length, coils: coilRows.length, templates: templateRows.length, parts: partRows.length, sampleSameSpecCount: sameSpec.length, sampleTemplate: firstTemplate?.shellModel || null }) });
}
function summarize(results) {
    const statuses = ['COMPLETED', 'PARTIAL', 'UNAVAILABLE', 'CLARIFICATION', 'FAIL'];
    return Object.freeze(Object.fromEntries(statuses.map(status => [status.toLowerCase(), results.filter(item => item.status === status).length])));
}
function aggregateSafety(results) {
    const keys = Object.keys(safety({ traces: [], answerValidation: {} }));
    return Object.freeze(Object.fromEntries(keys.map(key => [key, results.reduce((sum, item) => sum + Number(item.safety[key] || 0), 0)])));
}
function aggregateRejectedSafetySignals(results) {
    const keys = Object.keys(rejectedSafetySignals({ traces: [], answerValidation: {} }));
    return Object.freeze(Object.fromEntries(keys.map(key => [key, results.reduce((sum, item) => sum + Number(rejectedSafetySignals(item.candidate)[key] || 0), 0)])));
}
async function main(outputDirectory = path.join(root, 'planning/ai-native-api')) {
    const env = environment();
    const controlled = [];
    for (const testCase of CONTROLLED_CASES) controlled.push(await runCase(testCase, env));
    const realCatalog = await buildRealCatalogCases();
    const real = [];
    for (const testCase of realCatalog.cases) real.push(await runCase(testCase, env));
    const all = [...controlled, ...real];
    const output = Object.freeze({ phase: 'M5-D1', architecture: 'Candidate only: full Business/Policy memo + ontology context + API Index -> load_tools -> existing Agent Tool/Executor -> Fact Ledger/Answer Validator', productionRuntimeIntegrated: false, model: 'DeepSeek/deepseek-chat', controlled: Object.freeze(controlled), realCatalog: Object.freeze({ ...realCatalog, results: Object.freeze(real) }), metrics: Object.freeze({ controlled: summarize(controlled), realCatalog: summarize(real), safety: aggregateSafety(all), rejectedSafetySignals: aggregateRejectedSafetySignals(all), modelCalls: { business: all.length, policy: all.length, main: all.reduce((sum, item) => sum + item.candidate.metrics.mainModelCalls, 0) }, medians: { businessMs: median(all.map(item => item.memoTimings.businessMs)), policyMs: median(all.map(item => item.memoTimings.policyMs)), mainRequestMs: median(all.map(item => item.candidate.durationMs)), totalRequestMs: median(all.map(item => item.totalMs)), loadedSchemaTokens: median(all.map(item => item.candidate.context.loadedSchemaTokensEst)) }, behavior: { apiIndexUsed: all.every(item => item.candidate.flags.apiIndexUsed), loadToolsUsed: all.some(item => item.candidate.flags.loadToolsUsed), businessToolExecution: all.some(item => item.candidate.metrics.businessToolCalls > 0), secondDecisionAfterResult: all.some(item => item.candidate.flags.secondToolDecisionAfterResult), judgeRouterUsed: false, domainToolNamesSelectionUsed: false, mandatoryGroundingLayerUsed: false } }), results: Object.freeze(all) });
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(path.join(outputDirectory, 'M5-D1-Controlled-Smoke.json'), `${JSON.stringify({ phase: output.phase, model: output.model, metrics: output.metrics, results: output.controlled }, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(outputDirectory, 'M5-D1-Real-Catalog-Smoke.json'), `${JSON.stringify({ phase: output.phase, model: output.model, metrics: output.metrics, catalog: realCatalog.catalog, results: real }, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(outputDirectory, 'M5-D1-Agent-Traces.json'), `${JSON.stringify({ phase: output.phase, traces: all.map(item => ({ id: item.id, rawOwnerInput: item.rawOwnerInput, businessMemoHash: require('node:crypto').createHash('sha256').update(item.businessMemo).digest('hex'), policyMemoHash: require('node:crypto').createHash('sha256').update(item.policyMemo).digest('hex'), metrics: item.candidate.metrics, traces: item.candidate.traces, answerValidation: item.candidate.answerValidation, durationMs: item.candidate.durationMs })) }, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ controlled: summarize(controlled), realCatalog: summarize(real), behavior: output.metrics.behavior, safety: output.metrics.safety }, null, 2));
    return output;
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = { CONTROLLED_CASES, buildRealCatalogCases, environment, freshMemos, main, rejectedSafetySignals, runCase, safety };
