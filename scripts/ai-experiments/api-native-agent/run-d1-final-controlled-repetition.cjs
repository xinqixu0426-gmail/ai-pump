'use strict';

// Explicit opt-in reliability runner for a later Final Acceptance.  Importing
// this module only exposes its deterministic plan; it never starts a model.
const fs = require('node:fs');
const path = require('node:path');
const { startD1R1ControlledFixture } = require('./d1r1ControlledFixture.cjs');
const { environment } = require('./run-d1-r1-controlled.cjs');
const { CASES, runCandidateCase } = require('./run-d1-final-controlled.cjs');
const { buildControlledOracles } = require('./d1FinalAcceptanceOracles.cjs');
const { compareDatabaseSnapshots, databaseSnapshot } = require('./d1FinalAcceptanceEvaluator.cjs');
const { FINAL_V2_ARTIFACTS, serializeRun } = require('./d1FinalAcceptanceEvidence.cjs');
const { productDriftFromGit } = require('./d1FinalProductDriftGuard.cjs');

const REPETITION_CASE_IDS = Object.freeze(['D1-01', 'D1-03', 'D1-04', 'D1-05', 'D1-06', 'D1-07', 'D1-08']);
const RUNS_PER_CASE = 3;

function buildRepetitionPlan(cases = CASES, runsPerCase = RUNS_PER_CASE) {
    const inputs = new Map(cases);
    return Object.freeze(REPETITION_CASE_IDS.flatMap(caseId => Array.from({ length: runsPerCase }, (_, index) => Object.freeze({
        caseId, runNumber: index + 1, runId: `${caseId}-run-${index + 1}`, rawOwnerInput: inputs.get(caseId),
    }))));
}
async function main(outputDirectory = path.join(process.cwd(), 'planning/ai-native-api')) {
    if (process.env.D1_FINAL_ALLOW_MODEL_RUN !== '1') throw new Error('D1_FINAL_MODEL_RUN_REQUIRES_EXPLICIT_OPT_IN');
    const fixture = await startD1R1ControlledFixture();
    try {
        const { executeToolCall } = require('../../../api/routes/ai/executor.cjs');
        const before = databaseSnapshot(fixture.db);
        const oracleById = await buildControlledOracles(executeToolCall, fixture.ids);
        const env = environment(); const results = [];
        for (const plan of buildRepetitionPlan()) {
            const item = await runCandidateCase({ id: plan.caseId, rawOwnerInput: plan.rawOwnerInput, oracle: oracleById[plan.caseId] }, env, executeToolCall);
            results.push(serializeRun({ ...item, runId: plan.runId, runNumber: plan.runNumber }));
        }
        const output = Object.freeze({ phase: 'M5-D1-FINAL-V2', fixtureRuntime: fixture.fixtureKind, modelCallsEnabled: true, plannedRuns: buildRepetitionPlan().length,
            database: compareDatabaseSnapshots(before, databaseSnapshot(fixture.db)), productDrift: productDriftFromGit(), results });
        fs.mkdirSync(outputDirectory, { recursive: true });
        fs.writeFileSync(path.join(outputDirectory, FINAL_V2_ARTIFACTS.controlledRepetition), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
        return output;
    } finally { await fixture.close(); }
}
if (require.main === module) main(process.env.D1_FINAL_OUTPUT_DIR || undefined).then(result => console.log(JSON.stringify({ plannedRuns: result.plannedRuns, database: result.database }, null, 2))).catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = { REPETITION_CASE_IDS, RUNS_PER_CASE, buildRepetitionPlan, main };
