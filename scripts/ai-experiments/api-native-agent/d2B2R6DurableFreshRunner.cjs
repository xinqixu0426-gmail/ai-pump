'use strict';

// Acceptance-only durable coordinator. A semantic result is checkpointed per
// case before its process exits; final suite publication remains compatible
// with the existing suite-level R6 assembler.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeEvidence, scanForSecrets } = require('./d2B2AcceptanceEvidence.cjs');
const { runDirectory, requireRunId, writeStagedRun } = require('./d2B2AcceptanceStaging.cjs');
const { verifyR6AcceptanceFreeze } = require('./d2B2R6FreezeVerifier.cjs');
const { DOMAIN_CORPUS } = require('./d2B2DomainCorpus.cjs');
const { RAG_FIXTURES } = require('./d2B2RagAcceptanceHarness.cjs');
const fresh = require('./d2B2R6FreshRunners.cjs');

const MAX_INFRA_ATTEMPTS = 2;
const SUITES = Object.freeze(['domain-corpus', 'rag', 'targeted', 'd1-protection']);
function stable(value) { return JSON.stringify(value, Object.keys(value || {}).sort()); }
function sha(value) { return crypto.createHash('sha256').update(stable(value)).digest('hex'); }
function atomicExclusive(target, value) {
    const content = `${JSON.stringify(sanitizeEvidence(value), null, 2)}\n`;
    if (!scanForSecrets(content).pass) throw new Error('R6_DURABLE_SECRET_SCAN_FAILED');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    try { fs.writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx' }); fs.linkSync(temp, target); }
    catch (error) { if (error?.code === 'EEXIST') throw new Error('R6_DURABLE_CHECKPOINT_EXISTS'); throw error; }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    return target;
}
function readJson(target, code) { if (!fs.existsSync(target)) throw new Error(code); return JSON.parse(fs.readFileSync(target, 'utf8')); }
function slotsFor(suite) {
    if (suite === 'domain-corpus') return DOMAIN_CORPUS.map(item => ({ caseKey: item.id, caseId: item.id, ownerInput: item.ownerInput, expectedDomains: item.expectedDomains }));
    if (suite === 'rag') return RAG_FIXTURES.map(item => ({ caseKey: item.id, caseId: item.id, ownerInput: 'ORDER-A缺什么？缺的东西有没有采购？', ragFixtureId: item.id }));
    if (suite === 'targeted') return fresh.TARGETED_CASES.map(item => ({ ...item, caseKey: `${item.caseId}-${String(item.runNumber).padStart(2, '0')}` }));
    if (suite === 'd1-protection') {
        const { CASES } = require('./run-d1-r1-controlled.cjs');
        return CASES.filter(item => fresh.D1_PROTECTION_CASE_IDS.includes(item.id)).map(item => ({ caseKey: item.id, caseId: item.id, ownerInput: item.user }));
    }
    throw new Error('R6_DURABLE_SUITE_INVALID');
}
function caseInputHash(slot) { return sha({ caseKey: slot.caseKey, caseId: slot.caseId, runNumber: slot.runNumber || null, ownerInput: slot.ownerInput, expectedDomains: slot.expectedDomains || null, ragFixtureId: slot.ragFixtureId || null }); }
function batchPath(outputDirectory, suite, batchRunId) { return runDirectory(outputDirectory, suite, batchRunId); }
function batchFile(outputDirectory, suite, batchRunId) { return path.join(batchPath(outputDirectory, suite, batchRunId), 'batch.json'); }
function createFreshBatch(outputDirectory, { suite, batchRunId, manifestPath }) {
    if (!SUITES.includes(suite)) throw new Error('R6_DURABLE_SUITE_INVALID');
    const freeze = verifyR6AcceptanceFreeze({ manifestPath }); const runId = requireRunId(batchRunId); const directory = batchPath(outputDirectory, suite, runId);
    fs.mkdirSync(path.dirname(directory), { recursive: true });
    try { fs.mkdirSync(directory); } catch (error) { if (error?.code === 'EEXIST') throw new Error('D2_B2_RUN_ALREADY_EXISTS'); throw error; }
    const slots = slotsFor(suite); const batch = Object.freeze({ suite, batchRunId: runId, productFreezeCommit: freeze.productFreezeCommit, harnessFreezeCommit: freeze.harnessFreezeCommit, apiIndexFingerprint: freeze.apiIndexFingerprint, authoritativeManifest: manifestPath, expectedCaseKeys: slots.map(item => item.caseKey), expectedCaseCount: slots.length, caseInputHashes: Object.fromEntries(slots.map(item => [item.caseKey, caseInputHash(item)])), createdAt: new Date().toISOString() });
    atomicExclusive(path.join(directory, 'batch.json'), batch);
    fs.mkdirSync(path.join(directory, 'cases')); fs.mkdirSync(path.join(directory, 'attempts'));
    return batch;
}
function loadBatch(outputDirectory, { suite, batchRunId, manifestPath }) {
    const batch = readJson(batchFile(outputDirectory, suite, batchRunId), 'R6_DURABLE_BATCH_MISSING'); const freeze = verifyR6AcceptanceFreeze({ manifestPath }); const slots = slotsFor(suite);
    const valid = batch.suite === suite && batch.batchRunId === batchRunId && batch.productFreezeCommit === freeze.productFreezeCommit && batch.harnessFreezeCommit === freeze.harnessFreezeCommit && batch.apiIndexFingerprint === freeze.apiIndexFingerprint && batch.authoritativeManifest === manifestPath && JSON.stringify(batch.expectedCaseKeys) === JSON.stringify(slots.map(item => item.caseKey)) && batch.expectedCaseCount === slots.length && slots.every(slot => batch.caseInputHashes?.[slot.caseKey] === caseInputHash(slot));
    if (!valid) throw new Error('R6_DURABLE_BATCH_IDENTITY_MISMATCH'); return Object.freeze({ batch, freeze, slots, directory: batchPath(outputDirectory, suite, batchRunId) });
}
function checkpointPath(state, caseKey) { return path.join(state.directory, 'cases', `${caseKey}.json`); }
function attemptPaths(state, caseKey) { const prefix = `${caseKey}-attempt-`; return fs.readdirSync(path.join(state.directory, 'attempts')).filter(name => name.startsWith(prefix) && name.endsWith('.started.json')).sort().map(name => path.join(state.directory, 'attempts', name)); }
function inspectFreshBatch(outputDirectory, options) {
    const state = loadBatch(outputDirectory, options); const completedCases = []; const interruptedCases = []; const blockedCases = []; const pendingCases = [];
    for (const slot of state.slots) {
        if (fs.existsSync(checkpointPath(state, slot.caseKey))) { completedCases.push(slot.caseKey); continue; }
        const attempts = attemptPaths(state, slot.caseKey).length;
        if (attempts >= MAX_INFRA_ATTEMPTS) blockedCases.push(slot.caseKey); else if (attempts) interruptedCases.push(slot.caseKey); else pendingCases.push(slot.caseKey);
    }
    return Object.freeze({ expectedCases: state.batch.expectedCaseKeys, completedCases, passedCases: completedCases.filter(key => readJson(checkpointPath(state, key), 'R6_DURABLE_CHECKPOINT_MISSING').semanticPass === true), failedCases: completedCases.filter(key => readJson(checkpointPath(state, key), 'R6_DURABLE_CHECKPOINT_MISSING').semanticPass === false), interruptedCases, pendingCases, blockedCases, complete: completedCases.length === state.slots.length, frozenOrder: state.slots.map(item => item.caseKey) });
}
async function runFreshCase(outputDirectory, { suite, batchRunId, caseKey, manifestPath, executeCase }) {
    const state = loadBatch(outputDirectory, { suite, batchRunId, manifestPath }); const slot = state.slots.find(item => item.caseKey === caseKey); if (!slot) throw new Error('R6_DURABLE_CASE_UNKNOWN');
    if (fs.existsSync(checkpointPath(state, caseKey))) throw new Error('R6_DURABLE_CASE_ALREADY_COMPLETED');
    const attempts = attemptPaths(state, caseKey).length; if (attempts >= MAX_INFRA_ATTEMPTS) throw new Error('R6_DURABLE_CASE_BLOCKED');
    const attempt = Object.freeze({ suite, batchRunId, caseKey, attemptNumber: attempts + 1, status: 'STARTED', productFreezeCommit: state.freeze.productFreezeCommit, harnessFreezeCommit: state.freeze.harnessFreezeCommit, startedAt: new Date().toISOString() });
    atomicExclusive(path.join(state.directory, 'attempts', `${caseKey}-attempt-${attempt.attemptNumber}.started.json`), attempt);
    const started = Date.now(); const execution = await executeCase(slot, state.freeze); const database = execution?.database;
    if (!database || typeof database.beforeHash !== 'string' || typeof database.afterHash !== 'string' || !Array.isArray(database.changedTables) || !Number.isInteger(database.mutations)) throw new Error('R6_DURABLE_DATABASE_RECEIPT_REQUIRED');
    const checkpoint = Object.freeze({ suite, batchRunId, caseKey, caseId: slot.caseId, runNumber: slot.runNumber || null, ownerInputHash: sha(slot.ownerInput), productFreezeCommit: state.freeze.productFreezeCommit, harnessFreezeCommit: state.freeze.harnessFreezeCommit, result: execution.result, semanticPass: execution.result?.semanticPass === true, database, durationMs: execution.durationMs ?? Date.now() - started, completedAt: new Date().toISOString(), secretScan: 'PASS' });
    atomicExclusive(checkpointPath(state, caseKey), checkpoint);
    atomicExclusive(path.join(state.directory, 'attempts', `${caseKey}-attempt-${attempt.attemptNumber}.completed.json`), { ...attempt, status: 'COMPLETED', completedAt: checkpoint.completedAt });
    return checkpoint;
}
function finalizeFreshSuite(outputDirectory, { suite, batchRunId, manifestPath }) {
    const state = loadBatch(outputDirectory, { suite, batchRunId, manifestPath }); const inspection = inspectFreshBatch(outputDirectory, { suite, batchRunId, manifestPath }); if (!inspection.complete) throw new Error('R6_DURABLE_SUITE_INCOMPLETE');
    const checkpoints = state.slots.map(slot => readJson(checkpointPath(state, slot.caseKey), 'R6_DURABLE_CHECKPOINT_MISSING')); const mutations = checkpoints.reduce((sum, item) => sum + item.database.mutations, 0); const changedTables = [...new Set(checkpoints.flatMap(item => item.database.changedTables))].sort();
    const artifact = Object.freeze({ ...state.freeze, suite, runId: batchRunId, fixtureKind: 'durable-per-case-isolated', modelCallsEnabled: true, results: checkpoints.map(item => item.result), database: { beforeHash: sha(checkpoints.map(item => item.database.beforeHash)), afterHash: sha(checkpoints.map(item => item.database.afterHash)), changedTables, mutations, caseReceipts: checkpoints.map(item => ({ caseKey: item.caseKey, ...item.database })) }, secretScan: 'PASS' });
    const target = path.join(state.directory, 'artifact.json'); if (fs.existsSync(target)) throw new Error('R6_DURABLE_SUITE_ALREADY_FINALIZED'); writeStagedRun({ kind: suite, runId: batchRunId, directory: state.directory }, artifact); return artifact;
}
function preflightDurableBatch(outputDirectory, { suite, batchRunId, manifestPath }) { const batch = createFreshBatch(outputDirectory, { suite, batchRunId, manifestPath }); return Object.freeze({ suite, batchRunId, expectedCases: batch.expectedCaseCount, modelCalls: 0, businessExecutions: 0, databaseMutations: 0, checkpointContract: 'PASS' }); }

module.exports = { MAX_INFRA_ATTEMPTS, SUITES, caseInputHash, createFreshBatch, finalizeFreshSuite, inspectFreshBatch, preflightDurableBatch, runFreshCase, slotsFor };
