'use strict';

// D2-B2 real discovery is deliberately read/preview-only.  Environment setup
// precedes imports of runtime clients, and the runner never writes canonical
// acceptance files itself.
const path = require('node:path');
const fs = require('node:fs');
const dotenv = require('dotenv');
const { createExclusiveRun, requireRunId, writeStagedRun } = require('./d2B2AcceptanceStaging.cjs');
const { databaseSnapshot, compareDatabaseSnapshots } = require('./d2B2AcceptanceEvaluator.cjs');

function environment() {
    const envPath = path.join(path.resolve(__dirname, '../../..'), '.env');
    if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false, quiet: true });
    return Object.freeze({ ...process.env, DEEPSEEK_MODEL: 'deepseek-chat', AI_CONTEXT_WINDOW_TOKENS: process.env.D1_R1_CONTEXT_WINDOW_TOKENS || '65536' });
}
function assertRealDatabaseSource(env = process.env, db = null) {
    if (env.PUMP_TEST_DATABASE_PATH || env.NODE_ENV === 'test' || env.NODE_TEST_CONTEXT) throw new Error('D2_B2_REAL_CATALOG_REQUIRES_LOCAL_BUSINESS_DB');
    if (db?.name && (path.basename(String(db.name)) !== 'pump.db' || /(?:\/tmp\/|pump-tests-|fixture)/iu.test(String(db.name)))) throw new Error('D2_B2_REAL_CATALOG_REQUIRES_LOCAL_BUSINESS_DB');
    return Object.freeze({ databaseSource: 'LOCAL_BUSINESS_DB', pathCategory: 'LOCAL_NON_TEMP' });
}
function initializeRealHarness(options = {}) {
    const env = (options.environment || environment)();
    (options.assertDatabaseSource || assertRealDatabaseSource)(process.env);
    const requireModule = options.requireModule || require;
    const { executeToolCall } = requireModule('../../../api/routes/ai/executor.cjs');
    const { db } = requireModule('../../../api/db.cjs');
    const database = (options.assertDatabaseSource || assertRealDatabaseSource)(process.env, db);
    return Object.freeze({ env, database, executeToolCall, db });
}
async function formal(executeToolCall, name, args) {
    const result = await executeToolCall(name, args, { allowWrite: false });
    return result?.success && result?.verified ? result : null;
}
async function buildRealCatalogDiscovery({ db, executeToolCall }) {
    const limitations = []; const cases = [];
    const order = db.prepare('SELECT id, contract_no FROM orders ORDER BY id DESC LIMIT 1').get();
    const purchase = await formal(executeToolCall, 'get_purchase_overview', {});
    if (order?.id) {
        const detail = await formal(executeToolCall, 'get_order_detail', { orderId: order.id });
        const readiness = await formal(executeToolCall, 'check_order_readiness', { orderId: order.id });
        if (detail) cases.push({ id: 'REAL-W1-01', oracle: { kind: 'ORDER_DETAIL', orderId: order.id }, formal: detail }); else limitations.push('REAL-W1-01:FORMAL_DETAIL_UNAVAILABLE');
        if (readiness) cases.push({ id: 'REAL-W1-02', oracle: { kind: 'READINESS', orderId: order.id }, formal: readiness }); else limitations.push('REAL-W1-02:FORMAL_READINESS_UNAVAILABLE');
        const shortages = readiness?.data?.shortages || readiness?.shortages || [];
        const tasks = purchase?.data?.tasks || purchase?.tasks || [];
        if (shortages.some(row => row?.partId && tasks.some(task => Number(task?.partId) === Number(row.partId)))) cases.push({ id: 'REAL-W1-05', oracle: { kind: 'SHORTAGE_PURCHASE', orderId: order.id }, formal: { readiness, purchase } });
        else limitations.push('REAL-W1-05:NO_SHARED_CANONICAL_MATERIAL');
    } else { limitations.push('REAL-W1-01/02:NO_ORDER'); }
    if (purchase) cases.push({ id: 'REAL-W1-03', oracle: { kind: 'PURCHASE_OVERVIEW' }, formal: purchase }); else limitations.push('REAL-W1-03:FORMAL_PURCHASE_UNAVAILABLE');
    const recipe = db.prepare('SELECT id FROM recipes ORDER BY id DESC LIMIT 1').get();
    if (recipe?.id) {
        const virtual = await formal(executeToolCall, 'preview_virtual_readiness', { version: 1, basisRef: { kind: 'RECIPE_SCENARIO', recipeId: recipe.id, comparisonInput: { version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [] }, scenarioKey: 'base' }, quantity: 1 });
        if (virtual) cases.push({ id: 'REAL-W1-04', oracle: { kind: 'VIRTUAL_READINESS', recipeId: recipe.id }, formal: virtual }); else limitations.push('REAL-W1-04:FORMAL_VIRTUAL_READINESS_UNAVAILABLE');
    } else limitations.push('REAL-W1-04:NO_RECIPE');
    return Object.freeze({ cases, limitations });
}
async function main(outputDirectory = path.join(process.cwd(), 'planning/ai-native-api')) {
    const preflight = process.env.D2_B2_PREFLIGHT_ONLY === '1';
    if (!preflight && process.env.D2_B2_ALLOW_MODEL_RUN !== '1') throw new Error('D2_B2_MODEL_RUN_REQUIRES_EXPLICIT_OPT_IN');
    const harness = initializeRealHarness(); const before = databaseSnapshot(harness.db);
    const discovery = await buildRealCatalogDiscovery(harness);
    const output = Object.freeze({ phase: 'M5-D2-B2', kind: 'real', runId: requireRunId(process.env.D2_B2_RUN_ID), preflight, modelCallsEnabled: false, readPreviewOnly: true, databaseSource: harness.database, discovery, database: compareDatabaseSnapshots(before, databaseSnapshot(harness.db)), results: [] });
    writeStagedRun(createExclusiveRun(outputDirectory, { kind: 'real', runId: output.runId }), output);
    return output;
}
if (require.main === module) main(process.env.D2_B2_OUTPUT_DIR).then(result => console.log(JSON.stringify({ preflight: result.preflight, cases: result.discovery.cases.map(item => item.id), database: result.database }, null, 2))).catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { assertRealDatabaseSource, buildRealCatalogDiscovery, environment, initializeRealHarness, main };
