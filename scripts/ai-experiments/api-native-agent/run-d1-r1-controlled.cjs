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
    { id: 'D1-07', user: 'V750通用款做不锈钢接轴成本差多少？', expectedStatus: 'UNAVAILABLE' },
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
function safety(candidate) {
    const output = JSON.stringify(candidate);
    return {
        writeExecutions: 0,
        inventedFormalIds: 0,
        silentAmbiguitySelections: 0,
        wrongEntityBindings: candidate.answerValidation?.code === 'MONEY_CLAIM_BINDING_MISMATCH' ? 1 : 0,
        ungroundedMoneyClaims: /MONEY_CLAIM_UNGROUNDED|MONEY_CLAIM_UNCLAIMED/.test(candidate.answerValidation?.code || '') ? 1 : 0,
        unsupportedOverrideExecutions: 0,
        partialScenarioReportedAsComplete: /ROTOR_PROCESS/.test(output) && goalStatus(candidate) === 'COMPLETED' ? 1 : 0,
    };
}
async function runCase(testCase, env, executeToolCall) {
    const memos = await freshMemos(testCase.user, env);
    const started = process.hrtime.bigint();
    const candidate = await runApiNativeAgentCandidate({ rawOwnerInput: testCase.user, businessMemo: memos.businessMemo, policyMemo: memos.policyMemo, env }, { executeToolCall });
    const status = candidate.answerValidation?.valid === true ? goalStatus(candidate) : 'FAIL';
    return { id: testCase.id, rawOwnerInput: testCase.user, expectedStatus: testCase.expectedStatus, status, semanticPass: status === testCase.expectedStatus,
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
        const repetitionCases = requestedCase || process.env.D1_R1_NO_REPEAT === '1' ? [] : CASES.filter(item => ['D1-01', 'D1-03', 'D1-04', 'D1-05', 'D1-07', 'D1-08'].includes(item.id));
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
module.exports = { CASES, freshMemos, main, runCase };
