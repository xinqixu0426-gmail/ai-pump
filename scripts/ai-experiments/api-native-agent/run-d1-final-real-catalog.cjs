'use strict';

// Explicit opt-in read/preview-only real-catalog acceptance runner. The
// builder first obtains formal dynamic oracles; no test data is inserted.
const fs = require('node:fs');
const path = require('node:path');
const { freshMemos, environment } = require('./run-d1-r1-controlled.cjs');
const { runApiNativeAgentCandidate } = require('./apiNativeAgentCandidate.cjs');
const { buildRealCatalogCases } = require('./d1FinalAcceptanceOracles.cjs');
const { classifyRun, compareDatabaseSnapshots, databaseSnapshot } = require('./d1FinalAcceptanceEvaluator.cjs');
const { productDriftFromGit } = require('./d1FinalProductDriftGuard.cjs');

async function main(outputDirectory = path.join(process.cwd(), 'planning/ai-native-api')) {
    if (process.env.D1_FINAL_ALLOW_MODEL_RUN !== '1') throw new Error('D1_FINAL_MODEL_RUN_REQUIRES_EXPLICIT_OPT_IN');
    const { executeToolCall } = require('../../../api/routes/ai/executor.cjs');
    const { db } = require('../../../api/db.cjs');
    const before = databaseSnapshot(db);
    const discovery = await buildRealCatalogCases(executeToolCall);
    const env = environment(); const results = [];
    for (const testCase of discovery.cases) {
        const memos = await freshMemos(testCase.rawOwnerInput, env);
        const candidate = await runApiNativeAgentCandidate({ rawOwnerInput: testCase.rawOwnerInput, businessMemo: memos.businessMemo, policyMemo: memos.policyMemo, env }, { executeToolCall });
        results.push(Object.freeze({ id: testCase.id, rawOwnerInput: testCase.rawOwnerInput, oracle: testCase.oracle, candidate, memoTimings: memos.timings, ...classifyRun(testCase, candidate) }));
    }
    const database = compareDatabaseSnapshots(before, databaseSnapshot(db));
    const output = Object.freeze({ phase: 'M5-D1-FINAL', readPreviewOnly: true, modelCallsEnabled: true, productDrift: productDriftFromGit(), catalog: discovery.catalog, dataLimitations: discovery.limitations, database,
        results: results.map(item => ({ id: item.id, rawOwnerInput: item.rawOwnerInput, oracle: item.oracle, outcome: item.outcome, safety: item.safety, declaredStatus: item.declaredStatus, memoTimings: item.memoTimings, metrics: item.candidate.metrics, formalOutcomeReceipts: item.candidate.formalOutcomeReceipts, answerValidation: item.candidate.answerValidation })) });
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(path.join(outputDirectory, 'M5-D1-FINAL-Real-Catalog.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    return output;
}
if (require.main === module) main(process.env.D1_FINAL_OUTPUT_DIR || undefined).then(result => console.log(JSON.stringify({ cases: result.results.length, dataLimitations: result.dataLimitations.length, database: result.database }, null, 2))).catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { main };
