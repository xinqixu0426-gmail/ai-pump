'use strict';

// Acceptance-only local process supervisor. The worker owns semantic and
// catchable-error receipts; this parent records process exit, signal and outer
// timeout observations that a terminated worker cannot persist itself.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const durable = require('./d2B2R6DurableFreshRunner.cjs');

const DEFAULT_CASE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_CAPTURE_BYTES = 16 * 1024;

function appendBounded(current, chunk, limit = MAX_CAPTURE_BYTES) {
    const combined = Buffer.concat([current, Buffer.from(chunk)]);
    return combined.length <= limit ? combined : combined.subarray(combined.length - limit);
}
function safeOutput(buffer) {
    return buffer.toString('utf8').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
}
function classifyProcessResult(result) {
    if (result.timedOut) return 'TIMEOUT_ABORT';
    if (result.signal) return 'CHILD_SIGNAL';
    if (result.exitCode === 0) return 'COMPLETED';
    if (Number.isInteger(result.exitCode)) return 'CHILD_NONZERO_EXIT';
    return 'EXTERNAL_TERMINATION_UNKNOWN';
}
function runObservedChild({ command, args = [], environment = process.env, cwd = process.cwd(), timeoutMs = DEFAULT_CASE_TIMEOUT_MS, spawnImpl = spawn }) {
    return new Promise((resolve, reject) => {
        const startedAt = new Date().toISOString(); const started = Date.now();
        let stdout = Buffer.alloc(0); let stderr = Buffer.alloc(0); let timedOut = false; let settled = false;
        const child = spawnImpl(command, args, { cwd, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
        const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
        child.stdout?.on('data', chunk => { stdout = appendBounded(stdout, chunk); });
        child.stderr?.on('data', chunk => { stderr = appendBounded(stderr, chunk); });
        child.once('error', error => { clearTimeout(timer); if (settled) return; settled = true; reject(error); });
        child.once('close', (exitCode, signal) => {
            clearTimeout(timer); if (settled) return; settled = true;
            const result = Object.freeze({ parentPid: process.pid, childPid: child.pid || null, startedAt, endedAt: new Date().toISOString(),
                durationMs: Date.now() - started, exitCode, signal: signal || null, timedOut, stdout: safeOutput(stdout), stderr: safeOutput(stderr) });
            resolve(Object.freeze({ ...result, classification: classifyProcessResult(result) }));
        });
    });
}
function checkpointFor(state, caseKey) {
    const target = path.join(state.directory, 'cases', `${caseKey}.json`);
    return fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : null;
}
async function superviseDurableCase({ cliPath, outputDirectory, suite, batchRunId, caseKey, manifestPath, environment = process.env,
    timeoutMs = DEFAULT_CASE_TIMEOUT_MS, childRunner = runObservedChild }) {
    const common = { suite, batchRunId, caseKey, manifestPath };
    const state = durable.loadBatch(outputDirectory, common);
    const priorAttempts = durable.attemptPaths(state, caseKey).length;
    const childEnvironment = { ...environment, R6_DURABLE_ACTION: 'CASE', R6_DURABLE_SUITE: suite, R6_DURABLE_BATCH_RUN_ID: batchRunId,
        R6_DURABLE_CASE_KEY: caseKey, R6_DURABLE_MANIFEST: manifestPath, R6_DURABLE_OUTPUT_DIR: outputDirectory,
        R6_DURABLE_CASE_WORKER: '1' };
    const observed = await childRunner({ command: process.execPath, args: [cliPath], environment: childEnvironment, cwd: process.cwd(), timeoutMs });
    const attemptNumber = priorAttempts + 1;
    const phases = durable.lifecyclePhases(state, caseKey, attemptNumber);
    const checkpoint = checkpointFor(state, caseKey);
    const launcher = Object.freeze({ status: checkpoint && observed.exitCode === 0 ? 'COMPLETED' : 'FAILED_INFRA', classification: observed.classification,
        parentPid: observed.parentPid, childPid: observed.childPid, startedAt: observed.startedAt, endedAt: observed.endedAt,
        durationMs: observed.durationMs, exitCode: observed.exitCode, signal: observed.signal, outerTimeout: observed.timedOut,
        lastPhase: phases.at(-1)?.phase || 'CHILD_NOT_STARTED', checkpointWritten: Boolean(checkpoint),
        stdout: observed.stdout, stderr: observed.stderr });
    durable.recordLauncherReceipt(outputDirectory, common, launcher);
    if (!checkpoint || observed.exitCode !== 0) {
        const error = new Error(`R6_DURABLE_CHILD_FAILED:${launcher.classification}`);
        error.code = 'R6_DURABLE_CHILD_FAILED'; error.observation = launcher; throw error;
    }
    return Object.freeze({ action: 'CASE', suite, batchRunId, caseKey, checkpointWritten: true,
        semanticPass: checkpoint.semanticPass === true, durationMs: checkpoint.durationMs, databaseMutations: checkpoint.database.mutations,
        process: launcher });
}

module.exports = { DEFAULT_CASE_TIMEOUT_MS, MAX_CAPTURE_BYTES, classifyProcessResult, runObservedChild, superviseDurableCase };
