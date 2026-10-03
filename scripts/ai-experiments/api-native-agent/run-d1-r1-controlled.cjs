'use strict';

// CLI-only D1-R1 controlled acceptance runner.  It deliberately starts the
// existing isolated HTTP runtime, seeds only its temporary DB, then sends all
// Agent tool calls through the ordinary Executor and formal routes.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { runBusinessAgent } = require('../business-policy-intent/businessAgent.cjs');
const { runPolicyAgent } = require('../business-policy-intent/policyAgent.cjs');
const { runApiNativeAgentCandidate } = require('./apiNativeAgentCandidate.cjs');
const { startD1R1ControlledFixture } = require('./d1r1ControlledFixture.cjs');
const { buildApiIndex } = require('../../../api/services/ai-assistant/apiIndex.cjs');

const root = path.resolve(__dirname, '../../..');
const businessModel = fs.readFileSync(path.join(root, 'planning/business-understanding/company-business-model-v1.md'), 'utf8');
const domainPolicy = [
    fs.readFileSync(path.join(root, 'api/services/ai-assistant/domain-policy.md'), 'utf8'),
    fs.readFileSync(path.join(root, 'planning/business-understanding/domain-policy-recipe-configurable-cost-v1.md'), 'utf8'),
].join('\n\n');
const CASES = Object.freeze([
    { id: 'D1-01', user: '12-120有几个方案？', expectedStatus: 'COMPLETED' },
    { id: 'D1-02', user: '查一下V750通用款现在用哪个线圈。', expectedStatus: 'COMPLETED' },
    { id: 'D1-03', user: 'V750通用款和V110成本差多少？', expectedStatus: 'COMPLETED' },
    { id: 'D1-04', user: '12-120-A和12-130-A成本分别多少？', expectedStatus: 'COMPLETED' },
    { id: 'D1-05', user: 'V750通用款加浮球以后多少钱？', expectedStatus: 'COMPLETED' },
    { id: 'D1-06', user: 'V750通用款做电泳成本增加多少？', expectedStatus: 'COMPLETED' },
    { id: 'D1-07', user: 'V750通用款做不锈钢接轴成本差多少？', expectedStatus: 'COMPLETED' },
    { id: 'D1-08', user: 'V750通用款电缆5米，木箱，先算一下，不保存。', expectedStatus: 'COMPLETED' },
    { id: 'D1-09', user: '这个多少钱？', expectedStatus: 'CLARIFICATION' },
    { id: 'D1-10', user: '查V750的成本。', expectedStatus: 'CLARIFICATION' },
]);

function environment() {
    const envPath = path.join(root, '.env');
    if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false, quiet: true });
    // Candidate-only evidence runs preserve the complete frozen memos and
    // canonical schemas.  The provider supports this context; the production
    // default's conservative 32K local guard is therefore raised only in the
    // isolated CLI environment, never in runtime configuration.
    return { ...process.env, DEEPSEEK_MODEL: 'deepseek-chat', AI_CONTEXT_WINDOW_TOKENS: process.env.D1_R1_CONTEXT_WINDOW_TOKENS || '65536' };
}
function elapsed(start) { return Number(process.hrtime.bigint() - start) / 1_000_000; }
async function freshMemos(userInput, env) {
    const [business, policy] = await Promise.all([
        (async () => { const started = process.hrtime.bigint(); const memo = await runBusinessAgent({ userInput, businessModel }, { env }); return { memo, ms: elapsed(started) }; })(),
        (async () => { const started = process.hrtime.bigint(); const memo = await runPolicyAgent({ userInput, domainPolicy }, { env }); return { memo, ms: elapsed(started) }; })(),
    ]);
    return { businessMemo: business.memo, policyMemo: policy.memo, timings: { businessMs: business.ms, policyMs: policy.ms } };
}
function goalStatus(candidate) { return candidate.answerValidation?.goals?.[0]?.status || 'FAIL'; }
function citedFacts(candidate) {
    const facts = new Map((candidate.factLedger?.facts || []).map(fact => [fact.factId, fact]));
    const ids = new Set([...(candidate.answerValidation?.claims || []), ...(candidate.answerValidation?.goals || [])].flatMap(item => item.factIds || []));
    return [...ids].map(id => facts.get(id)).filter(Boolean);
}
function hasMoneyFor(facts, canonicalName) {
    return facts.some(fact => fact?.entity?.canonicalName === canonicalName && fact?.unit === 'CNY'
        && ['CURRENT_FORMAL', 'CURRENT_BASE', 'SCENARIO_CANDIDATE'].includes(fact?.qualifiers?.moneyRole));
}
function answerHasAmount(answer, facts, canonicalName) {
    return facts.filter(fact => fact?.entity?.canonicalName === canonicalName && fact?.unit === 'CNY')
        .some(fact => String(answer || '').includes(String(fact.value)));
}
// This is a test-only business outcome oracle.  It validates evidence and
// delivered answer content, rather than treating a model-selected status as
// proof of completion.  It does not calculate any cost itself.
function evaluateBusinessOutcome(testCase, candidate) {
    const answer = String(candidate.answerValidation?.answer || candidate.answer || '');
    const status = goalStatus(candidate); const facts = citedFacts(candidate);
    const valid = candidate.answerValidation?.valid === true;
    const scenario = fact => fact?.qualifiers?.moneyRole === 'SCENARIO_CANDIDATE';
    let pass = false; let reason = 'UNRECOGNIZED_CASE';
    switch (testCase.id) {
        case 'D1-01': pass = status === 'COMPLETED' && /2\s*(?:个|套|种|方案)/.test(answer) && facts.some(fact => /(?:count|totalCount)$/i.test(fact.predicate || '') && Number(fact.value) === 2); reason = 'FORMAL_COMPLETE_COIL_COUNT_REQUIRED'; break;
        case 'D1-02': pass = status === 'COMPLETED' && /V750/.test(answer) && /12-120-A/.test(answer) && facts.some(fact => /12-120-A/.test(String(fact.value || '')) || fact.entity?.canonicalName === 'V750-通用款'); reason = 'FORMAL_RECIPE_COIL_RELATION_REQUIRED'; break;
        case 'D1-03': pass = status === 'COMPLETED' && facts.some(fact => fact.predicate === 'recipe_cost_difference') && /10(?:\.0+)?\s*(?:元|CNY)/.test(answer); reason = 'FORMAL_RECIPE_DIFFERENCE_REQUIRED'; break;
        case 'D1-04': {
            const names = ['12-120-A', '12-130-A'];
            pass = status === 'COMPLETED' && names.every(name => hasMoneyFor(facts, name) && answer.includes(name) && answerHasAmount(answer, facts, name));
            reason = 'TWO_DISTINCT_FORMAL_COIL_COSTS_REQUIRED'; break;
        }
        case 'D1-05': pass = status === 'COMPLETED' && facts.some(scenario) && facts.some(fact => fact?.qualifiers?.moneyRole === 'SCENARIO_DIFFERENCE') && /浮球/.test(answer); reason = 'APPLIED_FLOAT_SCENARIO_REQUIRED'; break;
        case 'D1-06': pass = status === 'COMPLETED' && facts.some(fact => fact?.qualifiers?.moneyRole === 'SCENARIO_DIFFERENCE') && /电泳/.test(answer) && /(?:增加|差额|高)/.test(answer); reason = 'APPLIED_ELECTROPHORESIS_DELTA_REQUIRED'; break;
        case 'D1-07': pass = status === 'COMPLETED'
            && facts.some(fact => fact?.qualifiers?.moneyRole === 'SCENARIO_CANDIDATE')
            && facts.some(fact => fact?.qualifiers?.moneyRole === 'SCENARIO_DIFFERENCE')
            && (candidate.formalOutcomeReceipts || []).some(receipt => receipt.applicationStatus === 'APPLIED'
                && receipt.comparisonStatus === 'COMPARABLE'
                && receipt.appliedOverrideKeys?.includes('rotorProcessMode'))
            && /(?:不锈钢接轴|转子工艺)/.test(answer);
            reason = 'APPLIED_ROTOR_PROCESS_SCENARIO_REQUIRED'; break;
        case 'D1-08': pass = status === 'COMPLETED' && facts.some(scenario) && facts.some(fact => fact?.qualifiers?.moneyRole === 'SCENARIO_DIFFERENCE') && /(?:电缆|5米)/.test(answer) && /木箱/.test(answer); reason = 'APPLIED_CABLE_AND_PACKING_SCENARIO_REQUIRED'; break;
        case 'D1-09': pass = status === 'CLARIFICATION' && /(?:补充|对象|范围|具体)/.test(answer); reason = 'UNRESOLVED_REFERENCE_CLARIFICATION_REQUIRED'; break;
        case 'D1-10': pass = status === 'CLARIFICATION' && /(?:V750|通用款|豪贝款)/.test(answer) && /(?:确认|选择|具体|哪个)/.test(answer); reason = 'AMBIGUOUS_V750_CLARIFICATION_REQUIRED'; break;
        default: break;
    }
    return Object.freeze({ validEnvelope: valid, declaredStatus: status, pass: valid && pass, reason, citedFactIds: facts.map(fact => fact.factId) });
}
function safety(candidate) {
    const inventory = new Map(buildApiIndex().fullInventory.map(item => [item.toolName, item]));
    const traces = candidate.traces || [];
    const writeAttempts = traces.filter(trace => inventory.get(trace.name)?.access === 'write');
    const writeExecutions = writeAttempts.filter(trace => trace.businessExecution === true).length;
    const scenarioReceipts = Array.isArray(candidate.formalOutcomeReceipts) ? candidate.formalOutcomeReceipts : [];
    const rejectedScenarioOutcomes = scenarioReceipts.filter(receipt => [
        'REQUESTED_CHANGE_NOT_APPLIED', 'NON_COMPARABLE',
    ].includes(receipt?.capabilityOutcome));
    return {
        writeToolAttempts: writeAttempts.length,
        writeExecutions,
        inventedFormalIds: traces.filter(trace => trace.code === 'AGENT_TOOL_IDENTITY_UNVERIFIED').length,
        silentAmbiguitySelections: /identity_ambiguous/.test(JSON.stringify(candidate.factLedger || {})) && goalStatus(candidate) === 'COMPLETED' ? 1 : 0,
        wrongEntityBindings: candidate.answerValidation?.code === 'MONEY_CLAIM_BINDING_MISMATCH' ? 1 : 0,
        ungroundedMoneyClaims: /MONEY_CLAIM_UNGROUNDED|MONEY_CLAIM_UNCLAIMED/.test(candidate.answerValidation?.code || '') ? 1 : 0,
        // These are derived from formal scenario receipts, not written as a
        // presumed zero. A rejected/no-op scenario must not be delivered as a
        // completed scenario result.
        unsupportedOverrideExecutions: rejectedScenarioOutcomes.length,
        partialScenarioReportedAsComplete: goalStatus(candidate) === 'COMPLETED' && rejectedScenarioOutcomes.length > 0 ? 1 : 0,
    };
}
async function runCase(testCase, env, executeToolCall) {
    const memos = await freshMemos(testCase.user, env);
    const started = process.hrtime.bigint();
    const candidate = await runApiNativeAgentCandidate({ rawOwnerInput: testCase.user, businessMemo: memos.businessMemo, policyMemo: memos.policyMemo, env }, { executeToolCall });
    const status = candidate.answerValidation?.valid === true ? goalStatus(candidate) : 'FAIL';
    const outcome = evaluateBusinessOutcome(testCase, candidate);
    return { id: testCase.id, rawOwnerInput: testCase.user, expectedStatus: testCase.expectedStatus, status, semanticPass: outcome.pass, businessOutcome: outcome,
        memoTimings: memos.timings, businessMemo: memos.businessMemo, policyMemo: memos.policyMemo, candidate, safety: safety(candidate), totalMs: elapsed(started) + memos.timings.businessMs + memos.timings.policyMs };
}
function summary(results) {
    const statuses = ['COMPLETED', 'PARTIAL', 'UNAVAILABLE', 'CLARIFICATION', 'FAIL'];
    return Object.fromEntries([...statuses.map(status => [status.toLowerCase(), results.filter(item => item.status === status).length]), ['semanticPass', results.filter(item => item.semanticPass).length], ['semanticFail', results.filter(item => !item.semanticPass).length]]);
}
function sanitizedTrace(result) {
    return { id: result.id, rawOwnerInput: result.rawOwnerInput, businessMemoHash: crypto.createHash('sha256').update(result.businessMemo).digest('hex'), policyMemoHash: crypto.createHash('sha256').update(result.policyMemo).digest('hex'),
        status: result.status, semanticPass: result.semanticPass, metrics: result.candidate.metrics, traces: result.candidate.traces, answerValidation: result.candidate.answerValidation, context: result.candidate.context, durationMs: result.candidate.durationMs };
}
async function main(outputDirectory = path.join(root, 'planning/ai-native-api')) {
    const env = environment();
    const fixture = await startD1R1ControlledFixture();
    try {
        // Delayed require ensures the executor binds the temporary runtime's PORT/DB.
        const { executeToolCall } = require('../../../api/routes/ai/executor.cjs');
        const requestedCase = String(process.env.D1_R1_CASE || '').trim();
        const smokeCases = requestedCase ? CASES.filter(item => item.id === requestedCase) : CASES;
        if (requestedCase && smokeCases.length !== 1) throw new Error(`UNKNOWN_D1_R1_CASE:${requestedCase}`);
        const results = [];
        for (const testCase of smokeCases) results.push(await runCase(testCase, env, executeToolCall));
        const repetitionCases = requestedCase || process.env.D1_R1_NO_REPEAT === '1' ? [] : CASES.filter(item => ['D1-01', 'D1-03', 'D1-04', 'D1-05', 'D1-06', 'D1-07', 'D1-08'].includes(item.id));
        const repetitions = [];
        for (const testCase of repetitionCases) for (let run = 1; run <= 3; run += 1) repetitions.push({ run, ...(await runCase(testCase, env, executeToolCall)) });
        fs.mkdirSync(outputDirectory, { recursive: true });
        const fixtureEvidence = { phase: 'M5-D1-R1', fixtureRuntime: 'isolated temporary SQLite + real Express routes + real Executor', isolatedDb: fixture.filename, localBusinessDbTouched: false, productionDbTouched: false, mockBusinessResults: false,
            ids: fixture.ids, results, summary: summary(results) };
        const repeatEvidence = { phase: 'M5-D1-R1', runsPerCase: 3, cases: repetitionCases.map(item => item.id), results: repetitions.map(sanitizedTrace), summary: summary(repetitions) };
        fs.writeFileSync(path.join(outputDirectory, 'M5-D1-R1-Controlled-Fixture-Smoke.json'), `${JSON.stringify(fixtureEvidence, null, 2)}\n`, 'utf8');
        fs.writeFileSync(path.join(outputDirectory, 'M5-D1-R1-Controlled-Repetition.json'), `${JSON.stringify(repeatEvidence, null, 2)}\n`, 'utf8');
        fs.writeFileSync(path.join(outputDirectory, 'M5-D1-R1-Agent-Traces.json'), `${JSON.stringify({ phase: 'M5-D1-R1', controlled: results.map(sanitizedTrace), repetition: repetitions.map(sanitizedTrace) }, null, 2)}\n`, 'utf8');
        console.log(JSON.stringify({ controlled: summary(results), repetition: summary(repetitions), fixture: fixture.fixtureKind }, null, 2));
        return { fixtureEvidence, repeatEvidence };
    } finally { await fixture.close(); }
}
if (require.main === module) main(process.env.D1_R1_OUTPUT_DIR || undefined).catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { CASES, evaluateBusinessOutcome, freshMemos, main, runCase, safety };
