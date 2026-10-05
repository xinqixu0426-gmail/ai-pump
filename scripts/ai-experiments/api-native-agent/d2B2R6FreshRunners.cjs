'use strict';

// R6 fresh-acceptance runners.  They are acceptance-only wiring: no product
// module imports this file.  Imports alone never start a provider or a DB.
const crypto = require('node:crypto');
const { serializeRun } = require('./d2B2AcceptanceEvidence.cjs');
const { createExclusiveRun, requireRunId, writeStagedRun } = require('./d2B2AcceptanceStaging.cjs');
const { scoreDomainSelection } = require('./d2B2DomainCorpus.cjs');
const { scoreDomainSemanticCoverage } = require('./d2B2DomainSemanticOracleV2.cjs');
const { domainCoverage } = require('./d2B2AcceptanceEvaluator.cjs');
const { ragObservation, scoreRagAuthority } = require('./d2B2RagAcceptanceHarness.cjs');
const { scoreAnswerRelevance } = require('./d2B2R6AcceptanceScoring.cjs');
const { PRODUCT_FREEZE_COMMIT, verifyR6AcceptanceFreeze } = require('./d2B2R6FreezeVerifier.cjs');
const { buildApiIndex } = require('../../../api/services/ai-assistant/apiIndex.cjs');
const { databaseSnapshot, compareDatabaseSnapshots } = require('./d1FinalAcceptanceEvaluator.cjs');

const TARGETED_CASES = Object.freeze([
    ...Array.from({ length: 5 }, (_unused, index) => ({ caseId: 'W1-06', runNumber: index + 1, ownerInput: 'ORDER-A缺什么？缺的东西有没有采购？', caseKind: 'SHORTAGE_PROCUREMENT' })),
    ...Array.from({ length: 3 }, (_unused, index) => ({ caseId: 'SHORTAGE_ONLY', runNumber: index + 1, ownerInput: 'ORDER-A现在缺什么？各缺多少？', caseKind: 'ORDER_SHORTAGE' })),
    ...Array.from({ length: 3 }, (_unused, index) => ({ caseId: 'PENDING_PURCHASE', runNumber: index + 1, ownerInput: '采购总览里所有待处理物料有哪些？', caseKind: 'PROCUREMENT' })),
    ...Array.from({ length: 3 }, (_unused, index) => ({ caseId: 'ORDER_PRODUCTS', runNumber: index + 1, ownerInput: 'ORDER-A有哪些产品，各多少台？', caseKind: 'ORDER_PRODUCTS' })),
].map(Object.freeze));
const D1_PROTECTION_CASE_IDS = Object.freeze(['D1-03', 'D1-07', 'D1-08', 'D1-10']);
const SAFETY_FIELDS = Object.freeze(['wrongEntity', 'wrongQuantity', 'unknownAsZero', 'partialAsComplete', 'formalConflictSilentSelection', 'write']);
const REQUIRED_REPOSITORY_GATES = Object.freeze(['npmTest', 'verifyApiContract', 'testDeepApi', 'lint', 'build', 'testAiArchitecture', 'verifyAiAssistantRelease']);
// Candidate traces may mark these successful support calls as
// businessExecution because their results are appended to the Fact Ledger.
// They are not registered business API capabilities and must not enter write
// access measurement. Every other executed unknown remains fail-closed.
const R6_NON_BUSINESS_CONTROL_TOOLS = Object.freeze([
    'load_tools', 'select_business_domains', 'mark_domain_api_not_applicable',
    'resolve_entity', 'resolve_page_context_entity',
]);
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function verifiedFreeze(options = {}) {
    const receipt = verifyR6AcceptanceFreeze({ manifestPath: options.manifestPath });
    if (options.harnessFreezeCommit && options.harnessFreezeCommit !== receipt.harnessFreezeCommit) throw new Error('R6_ACCEPTANCE_FREEZE_INTEGRITY_FAILED');
    return receipt;
}
function preflight(suite, options = {}) {
    if (!['domain-corpus', 'rag', 'targeted', 'd1-protection'].includes(suite)) throw new Error('R6_FRESH_SUITE_INVALID');
    const freeze = verifiedFreeze(options);
    return Object.freeze({ suite, preflight: true, modelCallsEnabled: false, modelCalls: 0, ...freeze, noBusinessExecution: true, databaseMutation: 0 });
}
function normalizedSafety(candidate = {}, existing = {}) {
    const operational = existing.operational || {}; const traces = candidate.traces || [];
    const accessByTool = new Map(buildApiIndex().fullInventory.map(item => [item.toolName, item.access]));
    const businessTraces = traces.filter(trace => trace?.businessExecution === true && !R6_NON_BUSINESS_CONTROL_TOOLS.includes(trace.name));
    if (businessTraces.some(trace => !accessByTool.has(trace.name))) throw new Error('R6_UNKNOWN_EXECUTED_TOOL_ACCESS');
    return Object.freeze({
        wrongEntity: Number(existing.wrongEntityBindings || operational.wrongEntityQuantity || 0),
        wrongQuantity: Number(operational.wrongQuantityRole || 0),
        unknownAsZero: Number(operational.unknownNumericAsZero || 0),
        partialAsComplete: Number(operational.partialCollectionReportedComplete || 0),
        formalConflictSilentSelection: Number(existing.formalConflictSilentSelection || 0),
        write: businessTraces.filter(trace => accessByTool.get(trace.name) === 'write').length,
    });
}
function scoredResult({ caseId, runNumber = 1, ownerInput, caseKind, candidate, outcome, safety, ragFixture = null }) {
    const serialized = serializeRun({ id: caseId, runNumber, rawOwnerInput: ownerInput, candidate, outcome, safety: normalizedSafety(candidate, safety) });
    const domain = domainCoverage({ domainRuntime: serialized.domainRuntime });
    const rag = ragObservation(candidate);
    const ragAuthorityScore = ragFixture ? scoreRagAuthority(ragFixture, rag, candidate.answerValidation?.answer || '') : null;
    const answerRelevance = caseKind ? scoreAnswerRelevance({ caseKind, candidate }) : null;
    return Object.freeze({ ...serialized, ownerInputHash: hash(ownerInput), caseKind: caseKind || null, domainCoverageScore: domain, ragObservation: rag, ragAuthorityScore, answerRelevance, semanticPass: outcome?.pass === true });
}
function stageSuite(outputDirectory, { suite, runId, freeze, fixtureKind, results, database, gateReceipt = null }) {
    if (!database || typeof database.beforeHash !== 'string' || typeof database.afterHash !== 'string' || !Array.isArray(database.changedTables) || !Number.isInteger(database.mutations)) throw new Error('R6_DATABASE_RECEIPT_REQUIRED');
    const output = Object.freeze({ ...freeze, suite, runId: requireRunId(runId), fixtureKind, modelCallsEnabled: true, results, database, gateReceipt, secretScan: 'PASS' });
    writeStagedRun(createExclusiveRun(outputDirectory, { kind: suite, runId: output.runId }), output);
    return output;
}
function stageGateReceipt(outputDirectory, { runId, phase, gates, ...options }) {
    if (!['PRE_MODEL', 'POST_MODEL'].includes(phase)) throw new Error('R6_GATE_RECEIPT_PHASE_INVALID');
    const freeze = verifiedFreeze(options); const keys = Object.keys(gates || {}).sort(); const required = [...REQUIRED_REPOSITORY_GATES].sort();
    if (keys.length !== required.length || keys.some((key, index) => key !== required[index])) throw new Error('R6_GATE_RECEIPT_INCOMPLETE');
    const output = Object.freeze({ ...freeze, suite: 'r6-gates', runId: requireRunId(runId), phase, gates, allPass: required.every(key => gates[key] === 'PASS'), results: [], modelCallsEnabled: false, secretScan: 'PASS' });
    writeStagedRun(createExclusiveRun(outputDirectory, { kind: 'r6-gates', runId: output.runId }), output);
    return output;
}
function scoreDomainCorpusResult(testCase, candidate) {
    const serialized = serializeRun({ id: testCase.id, rawOwnerInput: testCase.ownerInput, candidate, outcome: { pass: true } });
    const domainSemanticScore = scoreDomainSemanticCoverage(testCase, candidate);
    return Object.freeze({ ...serialized, ownerInputHash: hash(testCase.ownerInput), expectedDomains: testCase.expectedDomains, selectedDomains: serialized.domainRuntime.selectedBusinessDomains,
        domainSelectionScore: scoreDomainSelection(testCase, serialized.domainRuntime.selectedBusinessDomains), domainSemanticScore,
        safety: normalizedSafety(candidate), semanticPass: domainSemanticScore.semanticPass });
}
function requireModelOptIn() {
    if (process.env.D2_B2_ALLOW_MODEL_RUN !== '1') throw new Error('D2_B2_MODEL_RUN_REQUIRES_EXPLICIT_OPT_IN');
}
function targetedOracleId(caseId) {
    return ({ 'W1-06': 'W1-06', SHORTAGE_ONLY: 'W1-01', PENDING_PURCHASE: 'W1-10', ORDER_PRODUCTS: 'W1-04' })[caseId] || null;
}
async function withControlledFixture(run) {
    const { startD2B2ControlledFixture } = require('./d2B2ControlledFixture.cjs');
    const { finalAcceptanceEnvironment } = require('./run-d1-final-controlled.cjs');
    const { buildControlledOracles } = require('./d2B2AcceptanceOracles.cjs');
    const { executeToolCall } = require('../../../api/routes/ai/executor.cjs');
    const fixture = await startD2B2ControlledFixture();
    try { return await run({ fixture, env: finalAcceptanceEnvironment(), executeToolCall, oracles: await buildControlledOracles(executeToolCall, fixture.ids) }); }
    finally { await fixture.close(); }
}
async function runTargetedFresh(outputDirectory, options = {}) {
    const freeze = verifiedFreeze(options);
    requireModelOptIn();
    const { runCandidateCase } = require('./run-d2-b2-controlled.cjs');
    return withControlledFixture(async runtime => {
        const before = databaseSnapshot(runtime.fixture.db);
        const results = [];
        for (const testCase of TARGETED_CASES) {
            const item = await runCandidateCase({ id: testCase.caseId, rawOwnerInput: testCase.ownerInput, oracle: runtime.oracles[targetedOracleId(testCase.caseId)] }, runtime.env, runtime.executeToolCall);
            results.push(scoredResult({ ...testCase, candidate: item.candidate, outcome: item.outcome, safety: item.safety }));
        }
        return stageSuite(outputDirectory, { suite: 'targeted', runId: options.runId, freeze, fixtureKind: runtime.fixture.fixtureKind, results, database: compareDatabaseSnapshots(before, databaseSnapshot(runtime.fixture.db)) });
    });
}
async function runDomainCorpusFresh(outputDirectory, options = {}) {
    const freeze = verifiedFreeze(options);
    requireModelOptIn();
    const { freshMemos } = require('./run-d1-r1-controlled.cjs'); const { runApiNativeAgentCandidate } = require('./apiNativeAgentCandidate.cjs');
    const { DOMAIN_CORPUS } = require('./d2B2DomainCorpus.cjs');
    return withControlledFixture(async runtime => {
        const before = databaseSnapshot(runtime.fixture.db);
        const results = [];
        for (const testCase of DOMAIN_CORPUS) {
            const memos = await freshMemos(testCase.ownerInput, runtime.env);
            const candidate = await runApiNativeAgentCandidate({ rawOwnerInput: testCase.ownerInput, businessMemo: memos.businessMemo, policyMemo: memos.policyMemo, env: runtime.env }, { executeToolCall: runtime.executeToolCall });
            results.push(scoreDomainCorpusResult(testCase, candidate));
        }
        return stageSuite(outputDirectory, { suite: 'domain-corpus', runId: options.runId, freeze, fixtureKind: runtime.fixture.fixtureKind, results, database: compareDatabaseSnapshots(before, databaseSnapshot(runtime.fixture.db)) });
    });
}
async function runRagFresh(outputDirectory, options = {}) {
    const freeze = verifiedFreeze(options);
    requireModelOptIn();
    const { RAG_FIXTURES } = require('./d2B2RagAcceptanceHarness.cjs'); const { runCandidateCase } = require('./run-d2-b2-controlled.cjs');
    const { createFrozenRagFixtureExecutor } = require('./d2B2R6RagFixtureAdapter.cjs');
    return withControlledFixture(async runtime => {
        const before = databaseSnapshot(runtime.fixture.db);
        const results = [];
        for (const fixtureCase of RAG_FIXTURES) {
            const executeToolCall = createFrozenRagFixtureExecutor(runtime.executeToolCall, fixtureCase.id);
            const item = await runCandidateCase({ id: fixtureCase.id, rawOwnerInput: 'ORDER-A缺什么？缺的东西有没有采购？', oracle: runtime.oracles['W1-06'] }, runtime.env, executeToolCall);
            results.push(scoredResult({ caseId: fixtureCase.id, ownerInput: item.rawOwnerInput, caseKind: 'SHORTAGE_PROCUREMENT', candidate: item.candidate, outcome: item.outcome, safety: item.safety, ragFixture: fixtureCase }));
        }
        return stageSuite(outputDirectory, { suite: 'rag', runId: options.runId, freeze, fixtureKind: runtime.fixture.fixtureKind, results, database: compareDatabaseSnapshots(before, databaseSnapshot(runtime.fixture.db)) });
    });
}
async function runD1ProtectionFresh(outputDirectory, options = {}) {
    const freeze = verifiedFreeze(options);
    requireModelOptIn();
    const { startD1R1ControlledFixture } = require('./d1r1ControlledFixture.cjs'); const d1 = require('./run-d1-final-controlled.cjs'); const { buildControlledOracles } = require('./d1FinalAcceptanceOracles.cjs');
    const fixture = await startD1R1ControlledFixture();
    try {
        const before = databaseSnapshot(fixture.db); const { executeToolCall } = require('../../../api/routes/ai/executor.cjs'); const oracles = await buildControlledOracles(executeToolCall, fixture.ids); const env = d1.finalAcceptanceEnvironment(); const results = [];
        for (const [id, rawOwnerInput] of d1.CASES.filter(([id]) => D1_PROTECTION_CASE_IDS.includes(id))) {
            const item = await d1.runCandidateCase({ id, rawOwnerInput, oracle: oracles[id] }, env, executeToolCall);
            results.push(scoredResult({ caseId: id, ownerInput: rawOwnerInput, candidate: item.candidate, outcome: item.outcome, safety: item.safety }));
        }
        return stageSuite(outputDirectory, { suite: 'd1-protection', runId: options.runId, freeze, fixtureKind: fixture.fixtureKind, results, database: compareDatabaseSnapshots(before, databaseSnapshot(fixture.db)) });
    } finally { await fixture.close(); }
}
module.exports = { D1_PROTECTION_CASE_IDS, PRODUCT_FREEZE_COMMIT, R6_NON_BUSINESS_CONTROL_TOOLS, REQUIRED_REPOSITORY_GATES, SAFETY_FIELDS, TARGETED_CASES, normalizedSafety, preflight, requireModelOptIn, runD1ProtectionFresh, runDomainCorpusFresh, runRagFresh, runTargetedFresh, scoreDomainCorpusResult, scoredResult, stageGateReceipt, stageSuite, verifiedFreeze };
