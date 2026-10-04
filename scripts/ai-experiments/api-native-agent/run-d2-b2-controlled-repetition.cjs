'use strict';
const path = require('node:path');
const { startD2B2ControlledFixture } = require('./d2B2ControlledFixture.cjs');
const { finalAcceptanceEnvironment } = require('./run-d1-final-controlled.cjs');
const { CASES, runCandidateCase } = require('./run-d2-b2-controlled.cjs');
const { buildControlledOracles } = require('./d2B2AcceptanceOracles.cjs');
const { databaseSnapshot, compareDatabaseSnapshots } = require('./d2B2AcceptanceEvaluator.cjs');
const { serializeRun } = require('./d2B2AcceptanceEvidence.cjs');
const { createExclusiveRun, requireRunId, writeStagedRun } = require('./d2B2AcceptanceStaging.cjs');
const REPETITION_CASE_IDS = Object.freeze(['W1-01', 'W1-03', 'W1-06', 'W1-07', 'W1-08']); const RUNS_PER_CASE = 3;
function plan() { const prompts = new Map(CASES); return Object.freeze(REPETITION_CASE_IDS.flatMap(id => Array.from({ length: RUNS_PER_CASE }, (_, i) => ({ id, runId: `${id}-run-${i + 1}`, runNumber: i + 1, rawOwnerInput: prompts.get(id) })))); }
async function main(outputDirectory = path.join(process.cwd(), 'planning/ai-native-api')) {
    if (process.env.D2_B2_ALLOW_MODEL_RUN !== '1') throw new Error('D2_B2_MODEL_RUN_REQUIRES_EXPLICIT_OPT_IN');
    const env = finalAcceptanceEnvironment(); const fixture = await startD2B2ControlledFixture();
    try { const { executeToolCall } = require('../../../api/routes/ai/executor.cjs'); const before = databaseSnapshot(fixture.db); const oracles = await buildControlledOracles(executeToolCall, fixture.ids);
        if (process.env.D2_B2_PREFLIGHT_ONLY === '1') return { phase: 'M5-D2-B2', preflight: true, plannedRuns: plan().length, oracleCount: Object.keys(oracles).length, modelCallsEnabled: false };
        const results = []; for (const item of plan()) results.push(serializeRun({ ...(await runCandidateCase({ id: item.id, rawOwnerInput: item.rawOwnerInput, oracle: oracles[item.id] }, env, executeToolCall)), runId: item.runId, runNumber: item.runNumber }));
        const output = { phase: 'M5-D2-B2', kind: 'repetition', runId: requireRunId(process.env.D2_B2_RUN_ID), fixtureRuntime: fixture.fixtureKind, plannedRuns: plan().length, modelCallsEnabled: true, database: compareDatabaseSnapshots(before, databaseSnapshot(fixture.db)), results };
        writeStagedRun(createExclusiveRun(outputDirectory, { kind: 'repetition', runId: output.runId }), output); return output;
    } finally { await fixture.close(); }
}
if (require.main === module) main(process.env.D2_B2_OUTPUT_DIR).then(result => console.log(JSON.stringify({ preflight: result.preflight === true, plannedRuns: result.plannedRuns, database: result.database || null }, null, 2))).catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { REPETITION_CASE_IDS, RUNS_PER_CASE, plan, main };
