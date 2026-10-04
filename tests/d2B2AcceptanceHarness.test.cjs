'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const controlled = require('../scripts/ai-experiments/api-native-agent/run-d2-b2-controlled.cjs');
const repetition = require('../scripts/ai-experiments/api-native-agent/run-d2-b2-controlled-repetition.cjs');
const { buildManifest, PRODUCT_BASELINE_COMMIT } = require('../scripts/ai-experiments/api-native-agent/d2B2AcceptanceManifest.cjs');
test('D2-B2 acceptance harness has ten controlled cases and a fresh 15-run repetition plan without starting a provider', () => {
  assert.equal(controlled.CASES.length, 10); assert.equal(repetition.REPETITION_CASE_IDS.length, 5); assert.equal(repetition.plan().length, 15);
});
test('D2-B2 source manifest pins the B1 product baseline and unchanged API Index contract', () => {
  const manifest = buildManifest({ harnessCommit: 'test-harness' }); assert.equal(manifest.productBaselineCommit, PRODUCT_BASELINE_COMMIT); assert.equal(manifest.apiIndexCount, 31); assert.equal(manifest.apiIndexFingerprint, '734be7888b47f19baf76b5f55282d408e2416eec0b2924c3a91b90d197473f18');
});
