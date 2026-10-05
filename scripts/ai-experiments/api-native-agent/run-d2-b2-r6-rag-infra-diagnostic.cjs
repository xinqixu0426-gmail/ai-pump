'use strict';

// One-case, non-acceptance diagnostic for the real RAG path. It deliberately
// writes outside the acceptance staging root and can never be finalized into
// an R6 acceptance artifact.
const fs = require('node:fs');
const path = require('node:path');
const durable = require('./d2B2R6DurableFreshRunner.cjs');
const { sanitizeEvidence, scanForSecrets } = require('./d2B2AcceptanceEvidence.cjs');
const { superviseDurableCase } = require('./d2B2R6ProcessSupervisor.cjs');

function requireText(value, code) { if (typeof value !== 'string' || !value.trim()) throw new Error(code); return value.trim(); }
function writeDiagnostic(target, value) {
    const content = `${JSON.stringify(sanitizeEvidence(value), null, 2)}\n`;
    if (!scanForSecrets(content).pass) throw new Error('R6_RAG_DIAGNOSTIC_SECRET_SCAN_FAILED');
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content, { encoding: 'utf8', flag: 'wx' });
}
async function runDiagnostic(options = {}) {
    if (process.env.D2_B2_ALLOW_MODEL_RUN !== '1') throw new Error('D2_B2_MODEL_RUN_REQUIRES_EXPLICIT_OPT_IN');
    const runId = requireText(options.runId || process.env.R6_RAG_DIAGNOSTIC_RUN_ID, 'R6_RAG_DIAGNOSTIC_RUN_ID_REQUIRED');
    const manifestPath = path.resolve(requireText(options.manifestPath || process.env.R6_RAG_DIAGNOSTIC_MANIFEST, 'R6_RAG_DIAGNOSTIC_MANIFEST_REQUIRED'));
    const evidenceDirectory = path.resolve(options.evidenceDirectory || process.env.R6_RAG_DIAGNOSTIC_OUTPUT_DIR || path.join(process.cwd(), 'planning/ai-native-api'));
    const diagnosticRoot = path.join(evidenceDirectory, 'M5-D2-B2-diagnostics', runId);
    const outputDirectory = path.join(diagnosticRoot, 'isolated-staging');
    const reportPath = path.join(diagnosticRoot, 'diagnostic.json');
    const suite = 'rag'; const caseKey = 'RAG-01';
    durable.createFreshBatch(outputDirectory, { suite, batchRunId: runId, manifestPath });
    let processObservation = null; let error = null;
    try {
        await superviseDurableCase({ cliPath: path.join(__dirname, 'run-d2-b2-r6-durable.cjs'), outputDirectory, suite,
            batchRunId: runId, caseKey, manifestPath, environment: process.env, timeoutMs: options.timeoutMs });
    } catch (caught) { error = caught; processObservation = caught?.observation || null; }
    const state = durable.loadBatch(outputDirectory, { suite, batchRunId: runId, manifestPath });
    const phases = durable.lifecyclePhases(state, caseKey, 1); const launcher = durable.launcherReceipts(state, caseKey).at(-1) || processObservation;
    const checkpointPath = path.join(state.directory, 'cases', `${caseKey}.json`);
    const checkpoint = fs.existsSync(checkpointPath) ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) : null;
    const phaseNames = phases.map(item => item.phase);
    const report = Object.freeze({ runId, evidencePurpose: 'NON_ACCEPTANCE_DIAGNOSTIC', countedAsAcceptance: false,
        suite, caseKey, parentPid: launcher?.parentPid || process.pid, childPid: launcher?.childPid || null,
        startedAt: launcher?.startedAt || phases[0]?.observedAt || null, endedAt: launcher?.endedAt || new Date().toISOString(),
        phases: phaseNames, providerRequestEmitted: phaseNames.includes('PROVIDER_REQUEST_EMITTED'),
        providerRequestCompleted: phaseNames.includes('PROVIDER_REQUEST_COMPLETED'), fixtureOpened: phaseNames.includes('FIXTURE_OPENED'),
        fixtureCleanupStarted: phaseNames.includes('FIXTURE_CLEANUP_START'), fixtureCleanupCompleted: phaseNames.includes('FIXTURE_CLEANUP_COMPLETED'),
        checkpointAttempted: phaseNames.includes('CHECKPOINT_WRITE_START'), checkpointWritten: Boolean(checkpoint),
        semanticPass: checkpoint?.semanticPass ?? null, databaseMutations: checkpoint?.database?.mutations ?? null,
        exitCode: launcher?.exitCode ?? null, signal: launcher?.signal ?? null, outerTimeout: launcher?.outerTimeout === true,
        lastPhase: launcher?.lastPhase || phaseNames.at(-1) || 'UNKNOWN', classification: error ? launcher?.classification || 'UNKNOWN' : 'COMPLETED',
        stdout: launcher?.stdout || '', stderr: launcher?.stderr || '', errorCode: error?.code || null, secretScan: 'PASS' });
    writeDiagnostic(reportPath, report);
    if (error) throw Object.assign(error, { diagnosticReportPath: reportPath });
    return Object.freeze({ reportPath, report });
}
if (require.main === module) runDiagnostic().then(value => console.log(JSON.stringify(value, null, 2))).catch(error => {
    console.error(JSON.stringify({ code: error?.code || 'R6_RAG_DIAGNOSTIC_FAILED', message: error?.message, diagnosticReportPath: error?.diagnosticReportPath || null })); process.exitCode = 1;
});

module.exports = { runDiagnostic, writeDiagnostic };
