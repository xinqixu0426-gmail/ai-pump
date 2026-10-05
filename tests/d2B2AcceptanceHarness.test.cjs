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
const { RAG_FIXTURES, ragObservation, scoreRagAuthority } = require('../scripts/ai-experiments/api-native-agent/d2B2RagAcceptanceHarness.cjs');
const { performance, scoreAnswerRelevance } = require('../scripts/ai-experiments/api-native-agent/d2B2R6AcceptanceScoring.cjs');
const { CANONICAL_ARTIFACTS, PRODUCT_FREEZE_COMMIT, assembleR6, publishR6 } = require('../scripts/ai-experiments/api-native-agent/d2B2R6AcceptanceAssembler.cjs');
const r6Fresh = require('../scripts/ai-experiments/api-native-agent/d2B2R6FreshRunners.cjs');
const { freezeManifestData, verifyR6AcceptanceFreeze } = require('../scripts/ai-experiments/api-native-agent/d2B2R6FreezeVerifier.cjs');
const { createFrozenRagFixtureExecutor } = require('../scripts/ai-experiments/api-native-agent/d2B2R6RagFixtureAdapter.cjs');
const { buildApiIndex } = require('../api/services/ai-assistant/apiIndex.cjs');
const durable = require('../scripts/ai-experiments/api-native-agent/d2B2R6DurableFreshRunner.cjs');
const durableExecutor = require('../scripts/ai-experiments/api-native-agent/d2B2R6DurableCaseExecutor.cjs');
const durableCli = require('../scripts/ai-experiments/api-native-agent/run-d2-b2-r6-durable.cjs');
function testFreezeManifest(directory, harnessFreezeCommit = 'test-freeze') {
  const target = path.join(directory, 'freeze-manifest.json'); fs.writeFileSync(target, JSON.stringify(freezeManifestData(harnessFreezeCommit)));
  return target;
}
const { classifyRun, domainCoverage } = require('../scripts/ai-experiments/api-native-agent/d2B2AcceptanceEvaluator.cjs');
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
test('R6H3 coverage scorer requires every frozen domain API terminal state and rejects malformed not-applicable evidence', () => {
  const complete = domainCoverage({ domainRuntime: { selectedBusinessDomains: ['procurement'], apiTerminalStates: [{ toolName: 'get_purchase_overview', terminalState: 'EXECUTED' }] } });
  assert.deepEqual(complete.missingDomainApis, []); assert.equal(complete.applicableExecutionCoverage, 1);
  const bad = domainCoverage({ domainRuntime: { selectedBusinessDomains: ['procurement'], apiTerminalStates: [{ toolName: 'get_purchase_overview', terminalState: 'NOT_APPLICABLE' }] } });
  assert.equal(bad.invalidNotApplicable.length, 1);
});
test('R6H4A RAG-01..10: isolated auxiliary fixtures serialize provenance and current formal authority wins', () => {
  const candidate = { relevantApiCoverage: { domainApiSet: ['get_purchase_overview'], ragAuxiliarySearched: true }, traces: [{ name: 'search_factory_knowledge', success: true }], factLedger: { facts: [{ factId: 'R-1', predicate: 'auxiliary_knowledge_retrieval', value: 1, qualifiers: { sourceKind: 'knowledge_snapshot' } }] } };
  const observed = ragObservation(candidate); assert.equal(observed.ragSearchExecuted, true); assert.deepEqual(observed.ragEvidenceFactIds, ['R-1']); assert.equal(observed.ragProvenance, 'knowledge_snapshot');
  assert.equal(scoreRagAuthority(RAG_FIXTURES[0], observed, '正式系统仍为待下单。').semanticPass, true);
  assert.equal(scoreRagAuthority(RAG_FIXTURES[1], observed, '正式系统仍为待下单；此前知识记录预计发货。').semanticPass, true);
  assert.equal(scoreRagAuthority(RAG_FIXTURES[1], observed, '已发货。').ragCurrentOverride, true);
  const empty = ragObservation({ relevantApiCoverage: { domainApiSet: ['get_purchase_overview'], ragAuxiliarySearched: true }, traces: [{ name: 'search_factory_knowledge', success: true }], factLedger: { facts: [{ factId: 'R-0', predicate: 'auxiliary_knowledge_retrieval', value: 0, qualifiers: { sourceKind: 'knowledge_snapshot' } }] } });
  assert.equal(scoreRagAuthority(RAG_FIXTURES[2], empty, '正式系统仍为待下单。').semanticPass, true);
  assert.equal(scoreRagAuthority(RAG_FIXTURES[3], observed, '正式系统仍为待下单；知识记录称已备货准备发出，尚未进入正式状态。').semanticPass, true);
});
test('R6H4B AR-01..07 and PF-01..03: cited fact semantics catch dumps while deterministic performance aggregates serialized runs', () => {
  const candidate = { answerValidation: { claims: [{ factIds: ['S'] }] }, factLedger: { facts: [{ factId: 'S', predicate: 'shortage_quantity' }] } };
  assert.equal(scoreAnswerRelevance({ caseKind: 'ORDER_SHORTAGE', candidate }).answerDumpedUnrequestedContext, false);
  candidate.answerValidation.claims[0].factIds.push('P'); candidate.factLedger.facts.push({ factId: 'P', predicate: 'purchase_status' });
  assert.equal(scoreAnswerRelevance({ caseKind: 'ORDER_SHORTAGE', candidate }).answerDumpedUnrequestedContext, true);
  const metrics = performance([{ domainRuntime: { selectedBusinessDomains: ['order'], domainApiSet: ['a'], executedDomainApis: ['a'], notApplicableDomainApis: [], blockedDomainApis: [], rag: { ragSearchExecuted: true } }, metrics: { mainModelCalls: 2, businessToolCalls: 1 }, durationMs: 10, context: { totalApproxContextTokens: 100 } }, { domainRuntime: { selectedBusinessDomains: ['order','procurement'], domainApiSet: ['a','b'], executedDomainApis: ['a'], notApplicableDomainApis: [], blockedDomainApis: ['b'], rag: { ragSearchExecuted: true } }, metrics: { mainModelCalls: 4, businessToolCalls: 2 }, durationMs: 30, context: { totalApproxContextTokens: 300 } }]);
  assert.equal(metrics.averageModelCalls, 3); assert.equal(metrics.medianDurationMs, 10); assert.equal(metrics.p95DurationMs, 30);
});
test('R6H4B AS-01..12: R6 assembly is staging-only, freeze-pinned, composition-checked, and fails closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-b2-r6-assembly-'));
  const plan = { productFreezeCommit: PRODUCT_FREEZE_COMMIT, harnessFreezeCommit: 'r6h4b-test-freeze', domainCorpusRunId: 'domain-corpus-r6', ragAuthorityRunId: 'rag-r6', targetedRunId: 'targeted-r6', d1ProtectionRunId: 'd1-protection-r6', preModelGateRunId: 'pre-gates-r6', postModelGateRunId: 'post-gates-r6' };
  assert.throws(() => assembleR6(root, plan), /R6_ACCEPTANCE_REQUIRED_RUN_MISSING/);
  const record = (kind, runId, results, overrides = {}) => {
    const run = staging.createExclusiveRun(root, { kind, runId });
    staging.writeStagedRun(run, { productFreezeCommit: PRODUCT_FREEZE_COMMIT, harnessFreezeCommit: plan.harnessFreezeCommit, results, database: { beforeHash: 'before', afterHash: 'after', mutations: 0, changedTables: [] }, ...overrides });
  };
  const safe = (caseId = 'fixture') => ({ caseId, semanticPass: true, safety: { wrongEntity: 0, wrongQuantity: 0, unknownAsZero: 0, partialAsComplete: 0, formalConflictSilentSelection: 0, write: 0 }, domainRuntime: { selectedBusinessDomains: ['order'], domainApiSet: ['get_order_detail'], executedDomainApis: ['get_order_detail'], notApplicableDomainApis: [], blockedDomainApis: [], rag: { ragSearchExecuted: true } }, domainCoverageScore: { missingDomainApis: [], invalidNotApplicable: [], writeInDomainSet: [], applicableExecutionCoverage: 1 }, ragObservation: { ragSearchRequired: true, ragSearchExecuted: true }, answerRelevance: { answerDumpedUnrequestedContext: false }, metrics: { mainModelCalls: 1, businessToolCalls: 1 }, durationMs: 10, context: { totalApproxContextTokens: 20 } });
  record('domain-corpus', plan.domainCorpusRunId, Array.from({ length: 12 }, () => ({ ...safe('DOMAIN'), domainSelectionScore: { exactMatch: false, highRiskMiss: true }, domainSemanticScore: { semanticPass: true, classification: 'FORMAL_REQUIRED_FACTS_COMPLETE' } })));
  record('rag', plan.ragAuthorityRunId, Array.from({ length: 4 }, (_unused, index) => ({ ...safe(`RAG-0${index + 1}`), ragAuthorityScore: { semanticPass: true, ragCurrentOverride: false, historyPresentedAsCurrent: false } })));
  const composition = ['W1-06', 'W1-06', 'W1-06', 'W1-06', 'W1-06', 'SHORTAGE_ONLY', 'SHORTAGE_ONLY', 'SHORTAGE_ONLY', 'PENDING_PURCHASE', 'PENDING_PURCHASE', 'PENDING_PURCHASE', 'ORDER_PRODUCTS', 'ORDER_PRODUCTS', 'ORDER_PRODUCTS'];
  record('targeted', plan.targetedRunId, composition.map(safe));
  record('d1-protection', plan.d1ProtectionRunId, Array.from({ length: 4 }, () => safe('D1')));
  const gates = Object.fromEntries(r6Fresh.REQUIRED_REPOSITORY_GATES.map(key => [key, 'PASS']));
  record('r6-gates', plan.preModelGateRunId, [], { phase: 'PRE_MODEL', gates, allPass: true });
  record('r6-gates', plan.postModelGateRunId, [], { phase: 'POST_MODEL', gates, allPass: true });
  assert.throws(() => assembleR6(root, { ...plan, productFreezeCommit: 'wrong' }), /R6_ACCEPTANCE_FREEZE_MISMATCH/);
  assert.throws(() => assembleR6(root, { ...plan, harnessFreezeCommit: 'wrong-harness' }), /R6_ACCEPTANCE_FREEZE_MISMATCH/);
  assert.throws(() => assembleR6(root, { ...plan, targetedRunId: plan.ragAuthorityRunId }), /R6_ACCEPTANCE_REQUIRED_RUN_MISSING/);
  const compositionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-b2-r6-composition-'));
  fs.cpSync(path.join(root, 'M5-D2-B2-runs'), path.join(compositionRoot, 'M5-D2-B2-runs'), { recursive: true });
  const compositionPath = path.join(compositionRoot, 'M5-D2-B2-runs', 'targeted', plan.targetedRunId, 'artifact.json');
  const malformedComposition = JSON.parse(fs.readFileSync(compositionPath, 'utf8')); malformedComposition.results[5].caseId = 'W1-06'; fs.writeFileSync(compositionPath, JSON.stringify(malformedComposition));
  assert.throws(() => assembleR6(compositionRoot, plan), /R6_ACCEPTANCE_TARGETED_COMPOSITION_INVALID/);
  const safetyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-b2-r6-safety-'));
  fs.cpSync(path.join(root, 'M5-D2-B2-runs'), path.join(safetyRoot, 'M5-D2-B2-runs'), { recursive: true });
  const safetyPath = path.join(safetyRoot, 'M5-D2-B2-runs', 'domain-corpus', plan.domainCorpusRunId, 'artifact.json');
  const malformedSafety = JSON.parse(fs.readFileSync(safetyPath, 'utf8')); delete malformedSafety.results[0].safety; fs.writeFileSync(safetyPath, JSON.stringify(malformedSafety));
  assert.throws(() => assembleR6(safetyRoot, plan), /R6_ACCEPTANCE_INCOMPLETE_SAFETY/);
  const assembled = publishR6(root, plan);
  assert.equal(assembled.targetedComposition['W1-06'], 5);
  assert.equal(assembled.performance.averageModelCalls, 1);
  assert.equal(assembled.final.status, 'PASS');
  assert.equal(assembled.final.domain.exact, 0);
  assert.equal(assembled.final.domain.exactMatchRole, 'DIAGNOSTIC');
  assert.equal(fs.existsSync(path.join(root, CANONICAL_ARTIFACTS.acceptance)), true);
  const domainSemanticRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-b2-r6-domain-semantic-'));
  fs.cpSync(path.join(root, 'M5-D2-B2-runs'), path.join(domainSemanticRoot, 'M5-D2-B2-runs'), { recursive: true });
  const domainSemanticPath = path.join(domainSemanticRoot, 'M5-D2-B2-runs', 'domain-corpus', plan.domainCorpusRunId, 'artifact.json');
  const missingFact = JSON.parse(fs.readFileSync(domainSemanticPath, 'utf8')); missingFact.results[0].domainSemanticScore = { semanticPass: false, classification: 'TRUE_PRODUCT_DOMAIN_MISS' }; fs.writeFileSync(domainSemanticPath, JSON.stringify(missingFact));
  const missingFactResult = assembleR6(domainSemanticRoot, plan); assert.equal(missingFactResult.final.status, 'FAIL'); assert.ok(missingFactResult.final.failedGates.includes('DOMAIN_REQUIRED_FACT_COVERAGE'));
  const failingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-b2-r6-semantic-'));
  fs.cpSync(path.join(root, 'M5-D2-B2-runs'), path.join(failingRoot, 'M5-D2-B2-runs'), { recursive: true });
  const targetPath = path.join(failingRoot, 'M5-D2-B2-runs', 'targeted', plan.targetedRunId, 'artifact.json');
  const failedTarget = JSON.parse(fs.readFileSync(targetPath, 'utf8')); failedTarget.results[0].semanticPass = false; fs.writeFileSync(targetPath, JSON.stringify(failedTarget));
  assert.equal(assembleR6(failingRoot, plan).final.status, 'FAIL');
  const ragCountRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-b2-r6-rag-count-'));
  fs.cpSync(path.join(root, 'M5-D2-B2-runs'), path.join(ragCountRoot, 'M5-D2-B2-runs'), { recursive: true });
  const ragCountPath = path.join(ragCountRoot, 'M5-D2-B2-runs', 'rag', plan.ragAuthorityRunId, 'artifact.json');
  const shortRag = JSON.parse(fs.readFileSync(ragCountPath, 'utf8')); shortRag.results.pop(); fs.writeFileSync(ragCountPath, JSON.stringify(shortRag));
  assert.throws(() => assembleR6(ragCountRoot, plan), /R6_ACCEPTANCE_REQUIRED_RUN_MISSING/);
  const targetedCountRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-b2-r6-targeted-count-'));
  fs.cpSync(path.join(root, 'M5-D2-B2-runs'), path.join(targetedCountRoot, 'M5-D2-B2-runs'), { recursive: true });
  const targetedCountPath = path.join(targetedCountRoot, 'M5-D2-B2-runs', 'targeted', plan.targetedRunId, 'artifact.json');
  const shortTargeted = JSON.parse(fs.readFileSync(targetedCountPath, 'utf8')); shortTargeted.results.pop(); fs.writeFileSync(targetedCountPath, JSON.stringify(shortTargeted));
  assert.throws(() => assembleR6(targetedCountRoot, plan), /R6_ACCEPTANCE_REQUIRED_RUN_MISSING/);
  const ragSafetyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-b2-r6-rag-safety-'));
  fs.cpSync(path.join(root, 'M5-D2-B2-runs'), path.join(ragSafetyRoot, 'M5-D2-B2-runs'), { recursive: true });
  const ragSafetyPath = path.join(ragSafetyRoot, 'M5-D2-B2-runs', 'rag', plan.ragAuthorityRunId, 'artifact.json');
  const missingRagSafety = JSON.parse(fs.readFileSync(ragSafetyPath, 'utf8')); delete missingRagSafety.results[0].ragAuthorityScore.historyPresentedAsCurrent; fs.writeFileSync(ragSafetyPath, JSON.stringify(missingRagSafety));
  assert.throws(() => assembleR6(ragSafetyRoot, plan), /R6_ACCEPTANCE_INCOMPLETE_SAFETY/);
  const databaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-b2-r6-database-'));
  fs.cpSync(path.join(root, 'M5-D2-B2-runs'), path.join(databaseRoot, 'M5-D2-B2-runs'), { recursive: true });
  const databasePath = path.join(databaseRoot, 'M5-D2-B2-runs', 'targeted', plan.targetedRunId, 'artifact.json');
  const mutation = JSON.parse(fs.readFileSync(databasePath, 'utf8')); mutation.database = { beforeHash: 'before', afterHash: 'after', mutations: 1, changedTables: ['orders'] }; fs.writeFileSync(databasePath, JSON.stringify(mutation));
  const mutated = assembleR6(databaseRoot, plan); assert.equal(mutated.final.safety.businessDbMutations, 1); assert.equal(mutated.final.status, 'FAIL');
  const missingDatabaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-b2-r6-missing-database-'));
  fs.cpSync(path.join(root, 'M5-D2-B2-runs'), path.join(missingDatabaseRoot, 'M5-D2-B2-runs'), { recursive: true });
  const missingDatabasePath = path.join(missingDatabaseRoot, 'M5-D2-B2-runs', 'targeted', plan.targetedRunId, 'artifact.json');
  const noDatabase = JSON.parse(fs.readFileSync(missingDatabasePath, 'utf8')); delete noDatabase.database; fs.writeFileSync(missingDatabasePath, JSON.stringify(noDatabase));
  assert.throws(() => assembleR6(missingDatabaseRoot, plan), /R6_DATABASE_RECEIPT_REQUIRED/);
});
test('R6H4C0 C0-01..20: all future fresh suites preflight without model calls and retain scorer inputs in staging', () => {
  const freezeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-b2-r6-freeze-')); const manifestPath = testFreezeManifest(freezeRoot);
  for (const suite of ['domain-corpus', 'rag', 'targeted', 'd1-protection']) {
    const receipt = r6Fresh.preflight(suite, { manifestPath }); assert.equal(receipt.preflight, true); assert.equal(receipt.modelCalls, 0);
  }
  assert.equal(r6Fresh.TARGETED_CASES.length, 14); assert.deepEqual(r6Fresh.D1_PROTECTION_CASE_IDS, ['D1-03', 'D1-07', 'D1-08', 'D1-10']);
  const candidate = { answerValidation: { claims: [{ factIds: ['Q'] }], answer: 'ORDER-A缺3个。' }, factLedger: { facts: [{ factId: 'Q', predicate: 'shortage_quantity' }] }, relevantApiCoverage: { selectedBusinessDomains: ['order'], domainApiSet: [], ragAuxiliarySearched: true }, traces: [{ name: 'search_factory_knowledge', success: true }] };
  const scored = r6Fresh.scoredResult({ caseId: 'SHORTAGE_ONLY', ownerInput: 'ORDER-A现在缺什么？各缺多少？', caseKind: 'ORDER_SHORTAGE', candidate, outcome: { pass: true } });
  assert.equal(scored.answerRelevance.answerDumpedUnrequestedContext, false);
  assert.equal(scored.ragObservation.ragSearchExecuted, true);
  assert.equal(scored.domainCoverageScore.applicableExecutionCoverage, 1);
  assert.ok(r6Fresh.SAFETY_FIELDS.every(field => Object.hasOwn(scored.safety, field)));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-b2-r6-gates-'));
  assert.throws(() => r6Fresh.stageGateReceipt(root, { runId: 'incomplete-gates-r6', phase: 'PRE_MODEL', manifestPath, gates: { npmTest: 'PASS', lint: 'PASS' } }), /R6_GATE_RECEIPT_INCOMPLETE/);
  const receipt = r6Fresh.stageGateReceipt(root, { runId: 'pre-model-r6', phase: 'PRE_MODEL', manifestPath, gates: Object.fromEntries(r6Fresh.REQUIRED_REPOSITORY_GATES.map(key => [key, 'PASS'])) });
  assert.equal(receipt.allPass, true);
  const oneFailed = r6Fresh.stageGateReceipt(root, { runId: 'post-model-one-failed-r6', phase: 'POST_MODEL', manifestPath, gates: { ...Object.fromEntries(r6Fresh.REQUIRED_REPOSITORY_GATES.map(key => [key, 'PASS'])), lint: 'FAIL' } });
  assert.equal(oneFailed.allPass, false);
  assert.throws(() => r6Fresh.stageGateReceipt(root, { runId: 'post-model-r6', phase: 'INVALID', manifestPath, gates: {} }), /R6_GATE_RECEIPT_PHASE_INVALID/);
  const writeTool = buildApiIndex().fullInventory.find(item => item.access === 'write').toolName;
  assert.equal(r6Fresh.normalizedSafety({ traces: [{ name: writeTool, businessExecution: true }] }).write, 1);
  for (const name of r6Fresh.R6_NON_BUSINESS_CONTROL_TOOLS) assert.equal(r6Fresh.normalizedSafety({ traces: [{ name, businessExecution: true }] }).write, 0);
  assert.equal(r6Fresh.normalizedSafety({ traces: [{ name: 'search_factory_knowledge', businessExecution: true }] }).write, 0);
  assert.equal(r6Fresh.normalizedSafety({ traces: [{ name: 'get_order_detail', businessExecution: true }] }).write, 0);
  assert.throws(() => r6Fresh.normalizedSafety({ traces: [{ name: 'unknown_business_tool', businessExecution: true }] }), /R6_UNKNOWN_EXECUTED_TOOL_ACCESS/);
  assert.equal(r6Fresh.normalizedSafety({ traces: [{ name: 'unknown_non_executed_tool', businessExecution: false }] }).write, 0);
});
test('R6H4C01 FI-01..20: frozen RAG adapter and byte-level freeze verifier reject replacements and dirty sources', async () => {
  const delegated = []; const executor = createFrozenRagFixtureExecutor(async (...args) => { delegated.push(args); return { success: true, verified: true, data: ['real'] }; }, 'RAG-01');
  const knowledge = await executor('search_factory_knowledge', { query: 'bearing' }); assert.equal(knowledge.data.length, 1); assert.equal(delegated.length, 0);
  await executor('get_order_detail', { id: 'ORDER-A' }); assert.equal(delegated.length, 1);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-b2-r6-integrity-')); const manifestPath = testFreezeManifest(root, 'integrity-freeze');
  assert.equal(verifyR6AcceptanceFreeze({ manifestPath }).harnessFreezeCommit, 'integrity-freeze');
  const bad = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); bad.hashes.candidateSource = 'bad'; fs.writeFileSync(manifestPath, JSON.stringify(bad));
  assert.throws(() => verifyR6AcceptanceFreeze({ manifestPath }), /R6_ACCEPTANCE_FREEZE_INTEGRITY_FAILED/);
  fs.writeFileSync(manifestPath, JSON.stringify(freezeManifestData('integrity-freeze')));
  assert.throws(() => r6Fresh.preflight('rag', { manifestPath, harnessFreezeCommit: 'caller-forgery' }), /R6_ACCEPTANCE_FREEZE_INTEGRITY_FAILED/);
  assert.equal(r6Fresh.preflight('rag', { manifestPath }).modelCalls, 0);
});
test('R6H4C13 DR-01..25: durable per-case checkpoints are immutable, resumable, and finalize into existing suite artifacts', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-b2-r6-durable-')); const manifestPath = testFreezeManifest(root, 'durable-freeze');
  const result = slot => ({ caseId: slot.caseId, runNumber: slot.runNumber || 1, semanticPass: slot.caseKey !== 'D02', safety: { wrongEntity: 0, wrongQuantity: 0, unknownAsZero: 0, partialAsComplete: 0, formalConflictSilentSelection: 0, write: 0 }, domainCoverageScore: { missingDomainApis: [], invalidNotApplicable: [], writeInDomainSet: [], applicableExecutionCoverage: 1 }, ragObservation: { ragSearchRequired: true, ragSearchExecuted: true }, answerRelevance: { answerDumpedUnrequestedContext: false }, ragAuthorityScore: slot.caseKey?.startsWith('RAG-') ? { semanticPass: true, ragCurrentOverride: false, historyPresentedAsCurrent: false } : null });
  const execute = async slot => ({ result: result(slot), database: { beforeHash: `before-${slot.caseKey}`, afterHash: `after-${slot.caseKey}`, changedTables: [], mutations: 0 }, durationMs: 1 });
  const batch = durable.createFreshBatch(root, { suite: 'domain-corpus', batchRunId: 'durable-domain', manifestPath });
  assert.equal(batch.expectedCaseCount, 12); assert.equal(batch.expectedCaseKeys[0], 'D01');
  await durable.runFreshCase(root, { suite: 'domain-corpus', batchRunId: 'durable-domain', caseKey: 'D01', manifestPath, executeCase: execute });
  assert.equal(fs.existsSync(path.join(root, 'M5-D2-B2-runs', 'domain-corpus', 'durable-domain', 'cases', 'D01.json')), true);
  await assert.rejects(() => durable.runFreshCase(root, { suite: 'domain-corpus', batchRunId: 'durable-domain', caseKey: 'D01', manifestPath, executeCase: execute }), /R6_DURABLE_CASE_ALREADY_COMPLETED/);
  const inspection = durable.inspectFreshBatch(root, { suite: 'domain-corpus', batchRunId: 'durable-domain', manifestPath }); assert.deepEqual(inspection.completedCases, ['D01']); assert.equal(inspection.pendingCases[0], 'D02');
  const attempt = path.join(root, 'M5-D2-B2-runs', 'domain-corpus', 'durable-domain', 'attempts', 'D03-attempt-1.started.json'); fs.writeFileSync(attempt, JSON.stringify({ status: 'STARTED' }));
  assert.ok(durable.inspectFreshBatch(root, { suite: 'domain-corpus', batchRunId: 'durable-domain', manifestPath }).interruptedCases.includes('D03'));
  await durable.runFreshCase(root, { suite: 'domain-corpus', batchRunId: 'durable-domain', caseKey: 'D03', manifestPath, executeCase: execute });
  for (const key of batch.expectedCaseKeys.filter(key => !['D01', 'D03'].includes(key))) await durable.runFreshCase(root, { suite: 'domain-corpus', batchRunId: 'durable-domain', caseKey: key, manifestPath, executeCase: execute });
  const finalized = durable.finalizeFreshSuite(root, { suite: 'domain-corpus', batchRunId: 'durable-domain', manifestPath }); assert.equal(finalized.results.length, 12); assert.equal(finalized.database.mutations, 0); assert.equal(finalized.results.some(item => item.caseId === 'D02' && item.semanticPass === false), true);
  assert.throws(() => durable.createFreshBatch(root, { suite: 'domain-corpus', batchRunId: 'durable-domain', manifestPath }), /D2_B2_RUN_ALREADY_EXISTS/);
  for (const [suite, count] of [['rag', 4], ['targeted', 14], ['d1-protection', 4]]) {
    const runId = `durable-${suite}`; const next = durable.createFreshBatch(root, { suite, batchRunId: runId, manifestPath });
    for (const key of next.expectedCaseKeys) await durable.runFreshCase(root, { suite, batchRunId: runId, caseKey: key, manifestPath, executeCase: execute });
    assert.equal(durable.finalizeFreshSuite(root, { suite, batchRunId: runId, manifestPath }).results.length, count);
  }
  const mismatch = JSON.parse(fs.readFileSync(path.join(root, 'M5-D2-B2-runs', 'rag', 'durable-rag', 'batch.json'), 'utf8')); mismatch.caseInputHashes['RAG-01'] = 'wrong'; fs.writeFileSync(path.join(root, 'M5-D2-B2-runs', 'rag', 'durable-rag', 'batch.json'), JSON.stringify(mismatch));
  assert.throws(() => durable.inspectFreshBatch(root, { suite: 'rag', batchRunId: 'durable-rag', manifestPath }), /R6_DURABLE_BATCH_IDENTITY_MISMATCH/);
  assert.equal(fs.readFileSync(path.join(__dirname, '../scripts/ai-experiments/api-native-agent/apiNativeAgentCandidate.cjs'), 'utf8').includes('d2B2R6DurableFreshRunner'), false);
});
test('R6H4C13R EX-01..25: frozen durable CLI maps one slot to the real-case adapter without caller execution injection', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-b2-r6-durable-cli-')); const manifestPath = testFreezeManifest(root, 'durable-cli-freeze');
  const candidate = { traces: [], relevantApiCoverage: { selectedBusinessDomains: ['order'], domainApiSet: [], ragAuxiliarySearched: true }, factLedger: { facts: [] }, answerValidation: { valid: true, claims: [], answer: '受控答案。' } };
  const seen = { prompts: [], adapter: 0, d2: [], d1: [] };
  const databaseSnapshot = () => ({ hash: 'fixture-hash', rowsByTable: {}, trackedTables: [] });
  const dependencies = {
    startD2B2ControlledFixture: async () => ({ db: {}, ids: { orderA: 'ORDER-A' }, fixtureKind: 'fake-d2', close: async () => {} }),
    startD1R1ControlledFixture: async () => ({ db: {}, ids: {}, fixtureKind: 'fake-d1', close: async () => {} }),
    databaseSnapshot,
    compareDatabaseSnapshots: (before, after) => ({ beforeHash: before.hash, afterHash: after.hash, changedTables: [], mutations: 0 }),
    finalAcceptanceEnvironment: () => ({ TEST: '1' }),
    freshMemos: async input => ({ businessMemo: `business:${input}`, policyMemo: `policy:${input}` }),
    runApiNativeAgentCandidate: async (input, options) => { seen.prompts.push(input); assert.equal(typeof options.executeToolCall, 'function'); return candidate; },
    executeToolCall: async () => ({ success: true, verified: true }),
    scoreDomainCorpusResult: (testCase, value) => ({ caseId: testCase.id, semanticPass: value === candidate, safety: { wrongEntity: 0, wrongQuantity: 0, unknownAsZero: 0, partialAsComplete: 0, formalConflictSilentSelection: 0, write: 0 } }),
    buildD2Oracles: async () => ({ 'W1-01': {}, 'W1-04': {}, 'W1-06': {}, 'W1-10': {} }),
    buildD1Oracles: async () => ({ 'D1-03': {}, 'D1-07': {}, 'D1-08': {}, 'D1-10': {} }),
    runD2CandidateCase: async testCase => { seen.d2.push(testCase); return { candidate, outcome: { pass: true }, safety: {} }; },
    runD1CandidateCase: async testCase => { seen.d1.push(testCase); return { candidate, outcome: { pass: true }, safety: {} }; },
    scoredResult: payload => ({ caseId: payload.caseId, runNumber: payload.runNumber || 1, semanticPass: payload.outcome.pass === true, safety: { wrongEntity: 0, wrongQuantity: 0, unknownAsZero: 0, partialAsComplete: 0, formalConflictSilentSelection: 0, write: 0 } }),
    createFrozenRagFixtureExecutor: (delegate, fixtureId) => { seen.adapter += 1; assert.equal(fixtureId, 'RAG-01'); return delegate; },
  };
  const base = { R6_DURABLE_SUITE: 'domain-corpus', R6_DURABLE_BATCH_RUN_ID: 'cli-domain', R6_DURABLE_MANIFEST: manifestPath, R6_DURABLE_OUTPUT_DIR: root };
  const create = await durableCli.run({ ...base, R6_DURABLE_ACTION: 'CREATE' }); assert.equal(create.expectedCaseCount, 12);
  const inspect = await durableCli.run({ ...base, R6_DURABLE_ACTION: 'INSPECT' }); assert.equal(inspect.pendingCases[0], 'D01');
  await assert.rejects(() => durableCli.run({ ...base, R6_DURABLE_ACTION: 'CASE', R6_DURABLE_CASE_KEY: 'D01' }, { caseExecutorDependencies: dependencies }), /D2_B2_MODEL_RUN_REQUIRES_EXPLICIT_OPT_IN/);
  const prior = process.env.D2_B2_ALLOW_MODEL_RUN; process.env.D2_B2_ALLOW_MODEL_RUN = '1';
  try {
    const receipt = await durableCli.run({ ...base, R6_DURABLE_ACTION: 'CASE', R6_DURABLE_CASE_KEY: 'D01' }, { caseExecutorDependencies: dependencies });
    assert.equal(receipt.checkpointWritten, true); assert.equal(receipt.semanticPass, true); assert.equal(seen.prompts.length, 1);
    assert.equal(Object.hasOwn(seen.prompts[0], 'expectedDomains'), false);
    await assert.rejects(() => durableCli.run({ ...base, R6_DURABLE_ACTION: 'CASE', R6_DURABLE_CASE_KEY: 'D01' }, { caseExecutorDependencies: dependencies }), /R6_DURABLE_CASE_ALREADY_COMPLETED/);
    for (const [caseId, oracle] of Object.entries(durableExecutor.TARGETED_ORACLE_BY_CASE)) {
      const slot = durable.slotsFor('targeted').find(item => item.caseId === caseId);
      await durableExecutor.executeDurableCase({ suite: 'targeted', caseKey: slot.caseKey, slot, freeze: { productFreezeCommit: 'p', harnessFreezeCommit: 'h' } }, dependencies);
      assert.equal(seen.d2.at(-1).id, oracle);
    }
    const ragSlot = durable.slotsFor('rag')[0]; await durableExecutor.executeDurableCase({ suite: 'rag', caseKey: ragSlot.caseKey, slot: ragSlot, freeze: { productFreezeCommit: 'p', harnessFreezeCommit: 'h' } }, dependencies); assert.equal(seen.adapter, 1);
    const d1Slot = durable.slotsFor('d1-protection')[0]; await durableExecutor.executeDurableCase({ suite: 'd1-protection', caseKey: d1Slot.caseKey, slot: d1Slot, freeze: { productFreezeCommit: 'p', harnessFreezeCommit: 'h' } }, dependencies); assert.equal(seen.d1.at(-1).id, d1Slot.caseId);
    await assert.rejects(() => durableExecutor.executeDurableCase({ suite: 'd1-protection', caseKey: 'D1-99', slot: { caseKey: 'D1-99', caseId: 'D1-99' }, freeze: { productFreezeCommit: 'p', harnessFreezeCommit: 'h' } }, dependencies), /R6_DURABLE_CASE_SLOT_INVALID/);
  } finally { if (prior === undefined) delete process.env.D2_B2_ALLOW_MODEL_RUN; else process.env.D2_B2_ALLOW_MODEL_RUN = prior; }
  assert.equal(durableExecutor.D1_CASE_IDS.length, 4);
  assert.equal(fs.existsSync(path.join(root, 'M5-D2-B2-runs', 'domain-corpus', 'cli-domain', 'cases', 'D01.json')), true);
  assert.equal(fs.readFileSync(path.join(__dirname, '../scripts/ai-experiments/api-native-agent/apiNativeAgentCandidate.cjs'), 'utf8').includes('d2B2R6DurableCaseExecutor'), false);
});
test('D2-B2 source manifest pins the B1 product baseline and the reviewed 31-capability API Index contract', () => {
  const manifest = buildManifest({ harnessCommit: 'test-harness' }); assert.equal(manifest.productBaselineCommit, PRODUCT_BASELINE_COMMIT); assert.equal(manifest.apiIndexCount, 31); assert.equal(manifest.apiIndexFingerprint, 'fd1047c4a2dc8ed8b9faa691676e2c2cfd652e74224c6fcda6747cf28b6b16e2'); assert.equal(typeof manifest.realRunnerHash, 'string'); assert.equal(typeof manifest.exclusiveEvidenceContractHash, 'string');
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
