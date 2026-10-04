'use strict';

// Explicit opt-in CLI for a later frozen Final Acceptance. This module never
// runs at import time; FH1 only unit-tests its deterministic dependencies.
const fs = require('node:fs');
const path = require('node:path');
const { startD1R1ControlledFixture } = require('./d1r1ControlledFixture.cjs');
const { freshMemos, environment } = require('./run-d1-r1-controlled.cjs');
const { runApiNativeAgentCandidate } = require('./apiNativeAgentCandidate.cjs');
const { buildControlledOracles } = require('./d1FinalAcceptanceOracles.cjs');
const { classifyRun, compareDatabaseSnapshots, databaseSnapshot } = require('./d1FinalAcceptanceEvaluator.cjs');
const { productDriftFromGit } = require('./d1FinalProductDriftGuard.cjs');

const CASES = Object.freeze([
    ['D1-01', '12-120有几个方案？'], ['D1-02', '查一下V750通用款现在用哪个线圈。'], ['D1-03', 'V750通用款和V110成本差多少？'],
    ['D1-04', '12-120-A和12-130-A成本分别多少？'], ['D1-05', 'V750通用款加浮球以后多少钱？'], ['D1-06', 'V750通用款做电泳成本增加多少？'],
    ['D1-07', 'V750通用款做不锈钢接轴成本差多少？'], ['D1-08', 'V750通用款电缆5米，木箱，先算一下，不保存。'],
    ['D1-09', '这个多少钱？'], ['D1-10', '查V750的成本。'],
]);

async function runCandidateCase(testCase, env, executeToolCall) {
    const memos = await freshMemos(testCase.rawOwnerInput, env);
    const candidate = await runApiNativeAgentCandidate({ rawOwnerInput: testCase.rawOwnerInput, businessMemo: memos.businessMemo, policyMemo: memos.policyMemo, env }, { executeToolCall });
    return Object.freeze({ ...testCase, candidate, memoTimings: memos.timings, ...classifyRun(testCase, candidate) });
}
async function main(outputDirectory = path.join(process.cwd(), 'planning/ai-native-api')) {
    if (process.env.D1_FINAL_ALLOW_MODEL_RUN !== '1') throw new Error('D1_FINAL_MODEL_RUN_REQUIRES_EXPLICIT_OPT_IN');
    const fixture = await startD1R1ControlledFixture();
    try {
        const { executeToolCall } = require('../../../api/routes/ai/executor.cjs');
        const before = databaseSnapshot(fixture.db);
        const oracleById = await buildControlledOracles(executeToolCall, fixture.ids);
        const env = environment(); const results = [];
        for (const [id, rawOwnerInput] of CASES) results.push(await runCandidateCase({ id, rawOwnerInput, oracle: oracleById[id] }, env, executeToolCall));
        const database = compareDatabaseSnapshots(before, databaseSnapshot(fixture.db));
        const output = Object.freeze({ phase: 'M5-D1-FINAL', fixtureRuntime: fixture.fixtureKind, modelCallsEnabled: true, database, productDrift: productDriftFromGit(),
            results: results.map(item => ({ id: item.id, rawOwnerInput: item.rawOwnerInput, outcome: item.outcome, safety: item.safety, declaredStatus: item.declaredStatus, memoTimings: item.memoTimings, metrics: item.candidate.metrics, formalOutcomeReceipts: item.candidate.formalOutcomeReceipts, answerValidation: item.candidate.answerValidation })) });
        fs.mkdirSync(outputDirectory, { recursive: true });
        fs.writeFileSync(path.join(outputDirectory, 'M5-D1-FINAL-Controlled-Smoke.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
        return output;
    } finally { await fixture.close(); }
}
if (require.main === module) main(process.env.D1_FINAL_OUTPUT_DIR || undefined).then(result => console.log(JSON.stringify({ cases: result.results.length, database: result.database }, null, 2))).catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { CASES, main, runCandidateCase };
