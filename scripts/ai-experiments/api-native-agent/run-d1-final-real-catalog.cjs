'use strict';

// Explicit opt-in read/preview-only real-catalog acceptance runner. The
// builder first obtains formal dynamic oracles; no test data is inserted.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

function environment() {
    const envPath = path.join(path.resolve(__dirname, '../../..'), '.env');
    if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false, quiet: true });
    return { ...process.env, DEEPSEEK_MODEL: 'deepseek-chat', AI_CONTEXT_WINDOW_TOKENS: process.env.D1_R1_CONTEXT_WINDOW_TOKENS || '65536' };
}

function assertRealDatabaseSource(env = process.env) {
    if (env.PUMP_TEST_DATABASE_PATH || env.NODE_ENV === 'test' || env.NODE_TEST_CONTEXT) {
        throw new Error('D1_FINAL_REAL_CATALOG_REQUIRES_LOCAL_BUSINESS_DB');
    }
    return Object.freeze({ databaseSource: 'LOCAL_BUSINESS_DB', pathCategory: 'LOCAL_NON_TEMP' });
}

function initializeRealHarness(options = {}) {
    // Environment precedes all runtime imports that may use read credentials.
    const env = (options.environment || environment)();
    const database = (options.assertDatabaseSource || assertRealDatabaseSource)(process.env);
    const requireModule = options.requireModule || require;
    const { executeToolCall } = requireModule('../../../api/routes/ai/executor.cjs');
    const { db } = requireModule('../../../api/db.cjs');
    return Object.freeze({ env, database, executeToolCall, db });
}

async function main(outputDirectory = path.join(process.cwd(), 'planning/ai-native-api')) {
    if (process.env.D1_FINAL_ALLOW_MODEL_RUN !== '1') throw new Error('D1_FINAL_MODEL_RUN_REQUIRES_EXPLICIT_OPT_IN');
    const { env, database: databaseSource, executeToolCall, db } = initializeRealHarness();
    const { freshMemos } = require('./run-d1-r1-controlled.cjs');
    const { runApiNativeAgentCandidate } = require('./apiNativeAgentCandidate.cjs');
    const { buildRealCatalogCases } = require('./d1FinalAcceptanceOracles.cjs');
    const { classifyRun, compareDatabaseSnapshots, databaseSnapshot } = require('./d1FinalAcceptanceEvaluator.cjs');
    const { productDriftFromGit } = require('./d1FinalProductDriftGuard.cjs');
    const { FINAL_V2_ARTIFACTS, serializeRun } = require('./d1FinalAcceptanceEvidence.cjs');
    const before = databaseSnapshot(db);
    const discovery = await buildRealCatalogCases(executeToolCall);
    const results = [];
    for (const testCase of discovery.cases) {
        const memos = await freshMemos(testCase.rawOwnerInput, env);
        const candidate = await runApiNativeAgentCandidate({ rawOwnerInput: testCase.rawOwnerInput, businessMemo: memos.businessMemo, policyMemo: memos.policyMemo, env }, { executeToolCall });
        results.push(Object.freeze({ id: testCase.id, rawOwnerInput: testCase.rawOwnerInput, oracle: testCase.oracle, candidate, businessMemoHash: require('node:crypto').createHash('sha256').update(memos.businessMemo).digest('hex'), policyMemoHash: require('node:crypto').createHash('sha256').update(memos.policyMemo).digest('hex'), memoTimings: memos.timings, ...classifyRun(testCase, candidate) }));
    }
    const database = compareDatabaseSnapshots(before, databaseSnapshot(db));
    const output = Object.freeze({ phase: 'M5-D1-FINAL-V2', readPreviewOnly: true, modelCallsEnabled: true, productDrift: productDriftFromGit(), databaseSource, catalog: discovery.catalog, dataLimitations: discovery.limitations, database,
        results: results.map(item => serializeRun(item)) });
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(path.join(outputDirectory, FINAL_V2_ARTIFACTS.realCatalog), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    return output;
}
if (require.main === module) main(process.env.D1_FINAL_OUTPUT_DIR || undefined).then(result => console.log(JSON.stringify({ cases: result.results.length, dataLimitations: result.dataLimitations.length, database: result.database }, null, 2))).catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { assertRealDatabaseSource, initializeRealHarness, main };
