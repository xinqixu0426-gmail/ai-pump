'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const controlled = require('../scripts/ai-experiments/api-native-agent/run-d2-b2-controlled.cjs');
const repetition = require('../scripts/ai-experiments/api-native-agent/run-d2-b2-controlled-repetition.cjs');
const { buildManifest, PRODUCT_BASELINE_COMMIT } = require('../scripts/ai-experiments/api-native-agent/d2B2AcceptanceManifest.cjs');
const real = require('../scripts/ai-experiments/api-native-agent/run-d2-b2-real-catalog.cjs');
const staging = require('../scripts/ai-experiments/api-native-agent/d2B2AcceptanceStaging.cjs');
const { assemble } = require('../scripts/ai-experiments/api-native-agent/d2B2AcceptanceAssembler.cjs');
const { domainRuntimeState } = require('../scripts/ai-experiments/api-native-agent/d2B2AcceptanceEvidence.cjs');
const { DOMAIN_CORPUS, scoreDomainSelection } = require('../scripts/ai-experiments/api-native-agent/d2B2DomainCorpus.cjs');
const { classifyRun } = require('../scripts/ai-experiments/api-native-agent/d2B2AcceptanceEvaluator.cjs');
test('D2-B2 acceptance harness has ten controlled cases and a fresh 15-run repetition plan without starting a provider', () => {
  assert.equal(controlled.CASES.length, 10); assert.equal(repetition.REPETITION_CASE_IDS.length, 5); assert.equal(repetition.plan().length, 15);
});
test('R6H serializer preserves selected domains, every terminal domain API state, and auxiliary RAG state without reconstructing business facts', () => {
  const state = domainRuntimeState({ relevantApiCoverage: { selectedBusinessDomains: ['order', 'procurement'], domainApiSet: ['check_order_readiness', 'get_purchase_overview'], executedRelevantTools: ['check_order_readiness'], failedRelevantTools: ['get_purchase_overview'], blockedRelevantTools: ['get_purchase_overview'], finalRelevantCoverage: true, ragAuxiliarySearched: true } });
  assert.deepEqual(state.selectedBusinessDomains, ['order', 'procurement']);
  assert.deepEqual(state.apiTerminalStates.map(item => [item.toolName, item.terminalState]), [['check_order_readiness', 'EXECUTED'], ['get_purchase_overview', 'BLOCKED']]);
  assert.equal(state.missingDomainApis.length, 0); assert.equal(state.rag.ragSearchExecuted, true);
});
test('R6H2 domain corpus is acceptance-only and scores exact sets without becoming a router', () => {
  assert.equal(DOMAIN_CORPUS.length, 12);
  const cross = DOMAIN_CORPUS.find(item => item.id === 'D08');
  assert.deepEqual(scoreDomainSelection(cross, ['procurement', 'order']).missingDomains, []);
  assert.equal(scoreDomainSelection(cross, ['order']).highRiskMiss, true);
});
test('D2-B2 source manifest pins the B1 product baseline and the reviewed 31-capability API Index contract', () => {
  const manifest = buildManifest({ harnessCommit: 'test-harness' }); assert.equal(manifest.productBaselineCommit, PRODUCT_BASELINE_COMMIT); assert.equal(manifest.apiIndexCount, 31); assert.equal(manifest.apiIndexFingerprint, '10bee9d8a065ea2322fcaf14bdf21cee949d0f57da8c3d5133448c1ee7d09c61'); assert.equal(typeof manifest.realRunnerHash, 'string'); assert.equal(typeof manifest.exclusiveEvidenceContractHash, 'string');
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

test('W1-10 oracle accepts complete verified pending-only or disclosed partial results, never unfiltered completeness as pending completeness', () => {
  const candidate = ({ answer, status = 'COMPLETED', completeness, factIds = ['C-1', 'P-1'] }) => ({
    relevantApiCoverage: { requiredRelevantTools: ['get_purchase_overview'], executedRelevantTools: ['get_purchase_overview'], failedRelevantTools: [], blockedRelevantTools: [], missingRelevantTools: [], finalRelevantCoverage: true },
    answerValidation: { valid: true, answer, claims: [{ text: answer, factIds }], goals: [{ questionIndex: 0, status, factIds }] },
    factLedger: { facts: [
      { factId: 'C-1', predicate: 'collection_completeness', value: completeness, qualifiers: { collectionRef: 'purchase_tasks', returnedCount: completeness === 'COMPLETE' ? 1 : 1, totalCount: completeness === 'COMPLETE' ? 1 : 2 } },
      { factId: 'P-1', predicate: 'purchase_status', value: '已下单', entity: { canonicalName: 'D1-R1轴承-202' } },
    ] },
  });
  const oracle = { kind: 'PENDING_PURCHASE_COLLECTION' };
  assert.equal(classifyRun({ oracle, formalCalls: [{ name: 'get_purchase_overview', args: { pendingOnly: true }, success: true, verified: true }] }, candidate({ answer: '当前待处理物料为D1-R1轴承-202。', completeness: 'COMPLETE' })).outcome.pass, true);
  assert.equal(classifyRun({ oracle, formalCalls: [{ name: 'get_purchase_overview', args: { limit: 1 }, success: true, verified: true }] }, candidate({ answer: '当前仅返回部分采购记录，正式结果显示还有更多记录。', status: 'PARTIAL', completeness: 'PARTIAL' })).outcome.pass, true);
  assert.equal(classifyRun({ oracle, formalCalls: [{ name: 'get_purchase_overview', args: {}, success: true, verified: true }] }, candidate({ answer: '当前待处理物料为D1-R1轴承-202。', completeness: 'COMPLETE' })).outcome.pass, false);
});

test('R5 coverage evaluator rejects declared-but-unexecuted tools and unrelated calls only when the case defines a narrow relevance boundary', () => {
  const candidate = { relevantApiCoverage: { requiredRelevantTools: ['get_order_detail', 'check_order_readiness'], executedRelevantTools: ['get_order_detail'], missingRelevantTools: ['check_order_readiness'], finalRelevantCoverage: false }, traces: [] };
  const result = classifyRun({ oracle: { kind: 'ORDER_DETAIL', snapshotRecipe: '历史快照配方', qty: 2 } }, candidate);
  assert.equal(result.outcome.reason, 'RELEVANT_API_COVERAGE_INCOMPLETE');
  const narrow = { answerValidation: { valid: true, answer: '历史快照配方共2台。', claims: [{ text: '历史快照配方共2台。', factIds: ['R', 'Q'] }], goals: [{ questionIndex: 0, status: 'COMPLETED', factIds: ['R', 'Q'] }] },
    relevantApiCoverage: { requiredRelevantTools: ['get_order_detail', 'get_purchase_overview'], executedRelevantTools: ['get_order_detail', 'get_purchase_overview'], missingRelevantTools: [], finalRelevantCoverage: true },
    traces: [{ name: 'get_order_detail', declaredRelevant: true }, { name: 'get_purchase_overview', declaredRelevant: true }],
    factLedger: { facts: [{ factId: 'R', predicate: 'order_snapshot_recipe', value: '历史快照配方' }, { factId: 'Q', predicate: 'order_line_quantity', value: 2 }] } };
  assert.equal(classifyRun({ oracle: { kind: 'ORDER_DETAIL', snapshotRecipe: '历史快照配方', qty: 2 }, allowedRelevantTools: ['get_order_detail'] }, narrow).outcome.reason, 'UNRELATED_API_CALLS');
});
