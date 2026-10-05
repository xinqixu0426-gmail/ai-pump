'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const durable = require('../scripts/ai-experiments/api-native-agent/d2B2R6DurableFreshRunner.cjs');
const { freezeManifestData } = require('../scripts/ai-experiments/api-native-agent/d2B2R6FreezeVerifier.cjs');
const supervisor = require('../scripts/ai-experiments/api-native-agent/d2B2R6ProcessSupervisor.cjs');
const { writeDiagnostic } = require('../scripts/ai-experiments/api-native-agent/run-d2-b2-r6-rag-infra-diagnostic.cjs');
const { scanForSecrets } = require('../scripts/ai-experiments/api-native-agent/d2B2AcceptanceEvidence.cjs');

function manifest(directory) {
    const target = path.join(directory, 'manifest.json');
    fs.writeFileSync(target, JSON.stringify(freezeManifestData('rag-infra-test-freeze')));
    return target;
}
function database(mutations = 0) { return { beforeHash: 'before', afterHash: mutations ? 'changed' : 'before', changedTables: mutations ? ['orders'] : [], mutations }; }
function result(semanticPass = true) { return { caseId: 'RAG-01', semanticPass, safety: { wrongEntity: 0, wrongQuantity: 0, unknownAsZero: 0, partialAsComplete: 0, formalConflictSilentSelection: 0, write: 0 } }; }
function shaFile(target) { return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'); }

test('R6 launch infra: catchable JS and provider errors persist terminal FAILED_INFRA receipts', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r6-rag-infra-errors-')); const manifestPath = manifest(root);
    durable.createFreshBatch(root, { suite: 'rag', batchRunId: 'rag-errors', manifestPath });
    await assert.rejects(() => durable.runFreshCase(root, { suite: 'rag', batchRunId: 'rag-errors', caseKey: 'RAG-01', manifestPath,
        executeCase: async () => { throw Object.assign(new Error('ordinary failure'), { code: 'FIXTURE_BROKE' }); } }), /ordinary failure/);
    const attempts = path.join(root, 'M5-D2-B2-runs/rag/rag-errors/attempts');
    const jsFailure = JSON.parse(fs.readFileSync(path.join(attempts, 'RAG-01-attempt-1.failed-infra.json'), 'utf8'));
    assert.equal(jsFailure.status, 'FAILED_INFRA'); assert.equal(jsFailure.classification, 'JS_ERROR');
    await assert.rejects(() => durable.runFreshCase(root, { suite: 'rag', batchRunId: 'rag-errors', caseKey: 'RAG-01', manifestPath,
        executeCase: async () => { throw Object.assign(new Error('provider returned HTTP 503'), { code: 'AI_PROVIDER_HTTP_FAILED' }); } }), /provider returned/);
    const providerFailure = JSON.parse(fs.readFileSync(path.join(attempts, 'RAG-01-attempt-2.failed-infra.json'), 'utf8'));
    assert.equal(providerFailure.classification, 'PROVIDER_ERROR');
    assert.ok(durable.inspectFreshBatch(root, { suite: 'rag', batchRunId: 'rag-errors', manifestPath }).blockedCases.includes('RAG-01'));
});

test('R6 launch infra: successful and semantic-fail checkpoints are immutable and not infra retries', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r6-rag-infra-checkpoint-')); const manifestPath = manifest(root);
    durable.createFreshBatch(root, { suite: 'rag', batchRunId: 'rag-semantic', manifestPath });
    const checkpoint = await durable.runFreshCase(root, { suite: 'rag', batchRunId: 'rag-semantic', caseKey: 'RAG-01', manifestPath,
        executeCase: async () => ({ result: result(false), database: database(0), durationMs: 2 }) });
    assert.equal(checkpoint.semanticPass, false); assert.equal(checkpoint.database.mutations, 0);
    await assert.rejects(() => durable.runFreshCase(root, { suite: 'rag', batchRunId: 'rag-semantic', caseKey: 'RAG-01', manifestPath,
        executeCase: async () => ({ result: result(true), database: database(0) }) }), /R6_DURABLE_CASE_ALREADY_COMPLETED/);
    const inspection = durable.inspectFreshBatch(root, { suite: 'rag', batchRunId: 'rag-semantic', manifestPath });
    assert.deepEqual(inspection.failedCases, ['RAG-01']); assert.deepEqual(inspection.interruptedCases, []);
});

test('R6 launch infra: child exit, signal and outer timeout are observable with bounded sanitized output', async () => {
    const ok = await supervisor.runObservedChild({ command: process.execPath, args: ['-e', 'process.stdout.write("ok")'], timeoutMs: 1000 });
    assert.equal(ok.exitCode, 0); assert.equal(ok.classification, 'COMPLETED');
    const nonzero = await supervisor.runObservedChild({ command: process.execPath, args: ['-e', 'process.stderr.write("bad");process.exit(7)'], timeoutMs: 1000 });
    assert.equal(nonzero.exitCode, 7); assert.equal(nonzero.classification, 'CHILD_NONZERO_EXIT');
    const signal = await supervisor.runObservedChild({ command: process.execPath, args: ['-e', 'process.kill(process.pid,"SIGTERM")'], timeoutMs: 1000 });
    assert.equal(signal.signal, 'SIGTERM'); assert.equal(signal.classification, 'CHILD_SIGNAL');
    const timeout = await supervisor.runObservedChild({ command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 30 });
    assert.equal(timeout.timedOut, true); assert.equal(timeout.classification, 'TIMEOUT_ABORT');
    const secret = await supervisor.runObservedChild({ command: process.execPath, args: ['-e', 'process.stdout.write("Bearer diagnostic-secret")'], timeoutMs: 1000 });
    assert.equal(secret.stdout.includes('diagnostic-secret'), false); assert.match(secret.stdout, /REDACTED/);
});

test('R6 launch infra: supervising parent records nonzero child termination without inventing a checkpoint', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r6-rag-infra-parent-')); const manifestPath = manifest(root);
    durable.createFreshBatch(root, { suite: 'rag', batchRunId: 'rag-parent', manifestPath });
    const observed = { parentPid: 11, childPid: 22, startedAt: '2026-10-05T00:00:00.000Z', endedAt: '2026-10-05T00:00:01.000Z', durationMs: 1000,
        exitCode: 9, signal: null, timedOut: false, stdout: '', stderr: 'worker failed', classification: 'CHILD_NONZERO_EXIT' };
    await assert.rejects(() => supervisor.superviseDurableCase({ cliPath: __filename, outputDirectory: root, suite: 'rag', batchRunId: 'rag-parent', caseKey: 'RAG-01', manifestPath,
        childRunner: async () => observed }), /R6_DURABLE_CHILD_FAILED/);
    const state = durable.loadBatch(root, { suite: 'rag', batchRunId: 'rag-parent', manifestPath });
    const receipt = durable.launcherReceipts(state, 'RAG-01')[0];
    assert.equal(receipt.classification, 'CHILD_NONZERO_EXIT'); assert.equal(receipt.checkpointWritten, false); assert.equal(receipt.lastPhase, 'CHILD_NOT_STARTED');
});

test('R6 launch infra: historical C2 STARTED evidence remains byte-identical and diagnostics reject secrets', () => {
    const repository = path.resolve(__dirname, '..');
    const historical = [
        'planning/ai-native-api/M5-D2-B2-runs/rag/r6c2-rag-20261005-01/attempts/RAG-01-attempt-1.started.json',
        'planning/ai-native-api/M5-D2-B2-runs/rag/r6c2-rag-20261005-01/attempts/RAG-01-attempt-2.started.json',
        'planning/ai-native-api/M5-D2-B2-runs/rag/r6c2-rag-20261005-01/batch.json',
    ].map(relative => path.join(repository, relative));
    const before = historical.map(shaFile); const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r6-rag-infra-secret-'));
    const target = path.join(root, 'sanitized.json'); writeDiagnostic(target, { authorization: 'Bearer should-not-persist' });
    const serialized = fs.readFileSync(target, 'utf8'); assert.equal(serialized.includes('should-not-persist'), false); assert.equal(scanForSecrets(serialized).pass, true);
    assert.deepEqual(historical.map(shaFile), before);
});
