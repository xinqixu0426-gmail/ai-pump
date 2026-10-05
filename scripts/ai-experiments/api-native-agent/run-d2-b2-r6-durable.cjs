'use strict';

// Frozen command surface for a single durable acceptance operation.  CASE has
// no callback/module/oracle/prompt override: it always uses the executor above.
const path = require('node:path');
const durable = require('./d2B2R6DurableFreshRunner.cjs');
const { executeDurableCase } = require('./d2B2R6DurableCaseExecutor.cjs');
const { superviseDurableCase } = require('./d2B2R6ProcessSupervisor.cjs');

const ACTIONS = Object.freeze(['CREATE', 'CASE', 'INSPECT', 'FINALIZE']);
function required(environment, key) {
    const value = environment[key];
    if (typeof value !== 'string' || !value.trim()) throw new Error(`R6_DURABLE_${key}_REQUIRED`);
    return value.trim();
}
function settings(environment = process.env) {
    const action = required(environment, 'R6_DURABLE_ACTION').toUpperCase();
    if (!ACTIONS.includes(action)) throw new Error('R6_DURABLE_ACTION_INVALID');
    return Object.freeze({
        action,
        suite: required(environment, 'R6_DURABLE_SUITE'),
        batchRunId: required(environment, 'R6_DURABLE_BATCH_RUN_ID'),
        manifestPath: path.resolve(required(environment, 'R6_DURABLE_MANIFEST')),
        outputDirectory: path.resolve(required(environment, 'R6_DURABLE_OUTPUT_DIR')),
        caseKey: action === 'CASE' ? required(environment, 'R6_DURABLE_CASE_KEY') : null,
    });
}
function receipt(action, settingsValue, value) {
    if (action !== 'CASE') return value;
    return Object.freeze({ action, suite: settingsValue.suite, batchRunId: settingsValue.batchRunId, caseKey: settingsValue.caseKey,
        checkpointWritten: true, semanticPass: value.semanticPass === true, durationMs: value.durationMs, databaseMutations: value.database.mutations });
}
async function run(environment = process.env, testDependencies = null) {
    const options = settings(environment);
    const common = { suite: options.suite, batchRunId: options.batchRunId, manifestPath: options.manifestPath };
    if (options.action === 'CREATE') return durable.createFreshBatch(options.outputDirectory, common);
    if (options.action === 'INSPECT') return durable.inspectFreshBatch(options.outputDirectory, common);
    if (options.action === 'FINALIZE') return durable.finalizeFreshSuite(options.outputDirectory, common);
    const checkpoint = await durable.runFreshCase(options.outputDirectory, { ...common, caseKey: options.caseKey,
        executeCase: (slot, freeze, lifecycle) => executeDurableCase({ suite: options.suite, caseKey: options.caseKey, slot, freeze, lifecycle }, testDependencies?.caseExecutorDependencies || null) });
    return receipt(options.action, options, checkpoint);
}
async function main(environment = process.env) {
    const options = settings(environment);
    if (options.action !== 'CASE' || environment.R6_DURABLE_CASE_WORKER === '1') return run(environment);
    return superviseDurableCase({ cliPath: __filename, outputDirectory: options.outputDirectory, suite: options.suite,
        batchRunId: options.batchRunId, caseKey: options.caseKey, manifestPath: options.manifestPath, environment });
}
if (require.main === module) main().then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error(error?.stack || error?.message || String(error)); process.exitCode = 1; });
module.exports = { ACTIONS, main, receipt, run, settings };
