'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const controlled = require('../scripts/ai-experiments/api-native-agent/run-d2-b2-controlled.cjs');
const repetition = require('../scripts/ai-experiments/api-native-agent/run-d2-b2-controlled-repetition.cjs');
const { buildManifest, PRODUCT_BASELINE_COMMIT } = require('../scripts/ai-experiments/api-native-agent/d2B2AcceptanceManifest.cjs');
const real = require('../scripts/ai-experiments/api-native-agent/run-d2-b2-real-catalog.cjs');
const staging = require('../scripts/ai-experiments/api-native-agent/d2B2AcceptanceStaging.cjs');
const { assemble } = require('../scripts/ai-experiments/api-native-agent/d2B2AcceptanceAssembler.cjs');
test('D2-B2 acceptance harness has ten controlled cases and a fresh 15-run repetition plan without starting a provider', () => {
  assert.equal(controlled.CASES.length, 10); assert.equal(repetition.REPETITION_CASE_IDS.length, 5); assert.equal(repetition.plan().length, 15);
});
test('D2-B2 source manifest pins the B1 product baseline and unchanged API Index contract', () => {
  const manifest = buildManifest({ harnessCommit: 'test-harness' }); assert.equal(manifest.productBaselineCommit, PRODUCT_BASELINE_COMMIT); assert.equal(manifest.apiIndexCount, 31); assert.equal(manifest.apiIndexFingerprint, '734be7888b47f19baf76b5f55282d408e2416eec0b2924c3a91b90d197473f18'); assert.equal(typeof manifest.realRunnerHash, 'string'); assert.equal(typeof manifest.exclusiveEvidenceContractHash, 'string');
});
test('HR-01..05: semantic runs require caller IDs, are exclusive, isolated, and cannot write canonical artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-b2-harness-'));
  assert.throws(() => staging.requireRunId(''), /D2_B2_RUN_ID_REQUIRED/);
  const first = staging.createExclusiveRun(root, { kind: 'controlled', runId: 'controlled-r1' });
  staging.writeStagedRun(first, { runId: 'controlled-r1', results: [] });
  assert.throws(() => staging.createExclusiveRun(root, { kind: 'controlled', runId: 'controlled-r1' }), /D2_B2_RUN_ALREADY_EXISTS/);
  const repetitionRun = staging.createExclusiveRun(root, { kind: 'repetition', runId: 'repetition-r1' });
  staging.writeStagedRun(repetitionRun, { runId: 'repetition-r1', results: [] });
  assert.notEqual(first.directory, repetitionRun.directory);
  assert.equal(fs.existsSync(path.join(root, 'M5-D2-B2-Controlled-Smoke.json')), false);
});
test('HR-06..08: assembler has explicit run inputs and refuses an incomplete plan', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-b2-assembly-'));
  assert.throws(() => assemble(root, { controlledRunId: 'aaa', repetitionRunId: 'bbb', realRunId: 'ccc' }), /D2_B2_REQUIRED_RUN_MISSING/);
  for (const [kind, runId] of [['controlled', 'aaa'], ['repetition', 'bbb'], ['real', 'ccc']]) {
    const run = staging.createExclusiveRun(root, { kind, runId }); staging.writeStagedRun(run, { kind, runId, results: [] });
  }
  assemble(root, { controlledRunId: 'aaa', repetitionRunId: 'bbb', realRunId: 'ccc' });
  assert.equal(fs.existsSync(path.join(root, 'M5-D2-B2-Controlled-Smoke.json')), true);
});
test('RH-01..07: real runner initializes environment before delayed runtime imports and keeps source guards fail-closed', () => {
  const order = []; const sentinel = { name: '/local/pump.db' };
  const initialized = real.initializeRealHarness({
    environment: () => { order.push('environment'); return { NODE_ENV: 'development' }; },
    assertDatabaseSource: (_env, db) => { order.push(db ? 'database' : 'pre-database'); return { databaseSource: 'LOCAL_BUSINESS_DB' }; },
    requireModule: name => { order.push(`require:${name}`); return name.includes('executor') ? { executeToolCall: async () => ({ success: false }) } : { db: sentinel }; },
  });
  assert.equal(initialized.database.databaseSource, 'LOCAL_BUSINESS_DB');
  assert.deepEqual(order.slice(0, 2), ['environment', 'pre-database']);
  assert.throws(() => real.assertRealDatabaseSource({ NODE_ENV: 'test' }), /LOCAL_BUSINESS_DB/);
});
