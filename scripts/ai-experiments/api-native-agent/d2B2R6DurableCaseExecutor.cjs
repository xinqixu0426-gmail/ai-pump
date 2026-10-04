'use strict';

// Frozen, acceptance-only bridge from one durable case slot to the real
// controlled runtime.  This module is deliberately not imported by product
// code.  The exported dependency hook exists only for deterministic tests;
// the authoritative CLI never exposes it to a caller.
const durable = require('./d2B2R6DurableFreshRunner.cjs');
const fresh = require('./d2B2R6FreshRunners.cjs');
const { DOMAIN_CORPUS } = require('./d2B2DomainCorpus.cjs');
const { RAG_FIXTURES } = require('./d2B2RagAcceptanceHarness.cjs');
const { databaseSnapshot, compareDatabaseSnapshots } = require('./d1FinalAcceptanceEvaluator.cjs');

const TARGETED_ORACLE_BY_CASE = Object.freeze({
    'W1-06': 'W1-06',
    SHORTAGE_ONLY: 'W1-01',
    PENDING_PURCHASE: 'W1-10',
    ORDER_PRODUCTS: 'W1-04',
});
const D1_CASE_IDS = Object.freeze(['D1-03', 'D1-07', 'D1-08', 'D1-10']);

function requireSlot(suite, caseKey, slot) {
    const frozen = durable.slotsFor(suite).find(item => item.caseKey === caseKey);
    if (!frozen || !slot || slot.caseKey !== frozen.caseKey || slot.caseId !== frozen.caseId) throw new Error('R6_DURABLE_CASE_SLOT_INVALID');
    return frozen;
}
function defaultDependencies() {
    return {
        startD2B2ControlledFixture: () => require('./d2B2ControlledFixture.cjs').startD2B2ControlledFixture(),
        startD1R1ControlledFixture: () => require('./d1r1ControlledFixture.cjs').startD1R1ControlledFixture(),
        executeToolCall: (...args) => require('../../../api/routes/ai/executor.cjs').executeToolCall(...args),
        finalAcceptanceEnvironment: () => require('./run-d1-final-controlled.cjs').finalAcceptanceEnvironment(),
        freshMemos: (...args) => require('./run-d1-r1-controlled.cjs').freshMemos(...args),
        runApiNativeAgentCandidate: (...args) => require('./apiNativeAgentCandidate.cjs').runApiNativeAgentCandidate(...args),
        runD2CandidateCase: (...args) => require('./run-d2-b2-controlled.cjs').runCandidateCase(...args),
        buildD2Oracles: (...args) => require('./d2B2AcceptanceOracles.cjs').buildControlledOracles(...args),
        runD1CandidateCase: (...args) => require('./run-d1-final-controlled.cjs').runCandidateCase(...args),
        buildD1Oracles: (...args) => require('./d1FinalAcceptanceOracles.cjs').buildControlledOracles(...args),
        createFrozenRagFixtureExecutor: (...args) => require('./d2B2R6RagFixtureAdapter.cjs').createFrozenRagFixtureExecutor(...args),
        databaseSnapshot,
        compareDatabaseSnapshots,
        scoreDomainCorpusResult: fresh.scoreDomainCorpusResult,
        scoredResult: fresh.scoredResult,
    };
}
function dependenciesFor(overrides = {}) { return { ...defaultDependencies(), ...overrides }; }
async function withFixture(startFixture, dependencies, execute) {
    const fixture = await startFixture();
    try {
        const before = dependencies.databaseSnapshot(fixture.db);
        const started = Date.now();
        const result = await execute(fixture);
        const database = dependencies.compareDatabaseSnapshots(before, dependencies.databaseSnapshot(fixture.db));
        if (!database || typeof database.beforeHash !== 'string' || typeof database.afterHash !== 'string' || !Array.isArray(database.changedTables) || !Number.isInteger(database.mutations)) throw new Error('R6_DURABLE_DATABASE_RECEIPT_REQUIRED');
        return Object.freeze({ result, database, durationMs: Date.now() - started });
    } finally { await fixture.close(); }
}
async function executeDomain(slot, dependencies) {
    const testCase = DOMAIN_CORPUS.find(item => item.id === slot.caseId);
    if (!testCase) throw new Error('R6_DURABLE_DOMAIN_CASE_UNKNOWN');
    return withFixture(dependencies.startD2B2ControlledFixture, dependencies, async _fixture => {
        const env = dependencies.finalAcceptanceEnvironment();
        const memos = await dependencies.freshMemos(testCase.ownerInput, env);
        // expectedDomains stays in the acceptance oracle and is not given to the candidate.
        const candidate = await dependencies.runApiNativeAgentCandidate({
            rawOwnerInput: testCase.ownerInput,
            businessMemo: memos.businessMemo,
            policyMemo: memos.policyMemo,
            env,
        }, { executeToolCall: dependencies.executeToolCall });
        return dependencies.scoreDomainCorpusResult(testCase, candidate);
    });
}
async function d2Oracles(fixture, dependencies) { return dependencies.buildD2Oracles(dependencies.executeToolCall, fixture.ids); }
async function executeTargeted(slot, dependencies) {
    const oracleId = TARGETED_ORACLE_BY_CASE[slot.caseId];
    if (!oracleId) throw new Error('R6_DURABLE_TARGETED_CASE_UNKNOWN');
    return withFixture(dependencies.startD2B2ControlledFixture, dependencies, async fixture => {
        const env = dependencies.finalAcceptanceEnvironment(); const oracles = await d2Oracles(fixture, dependencies);
        const item = await dependencies.runD2CandidateCase({ id: oracleId, rawOwnerInput: slot.ownerInput, oracle: oracles[oracleId] }, env, dependencies.executeToolCall);
        return dependencies.scoredResult({ ...slot, candidate: item.candidate, outcome: item.outcome, safety: item.safety });
    });
}
async function executeRag(slot, dependencies) {
    const ragFixture = RAG_FIXTURES.find(item => item.id === slot.ragFixtureId);
    if (!ragFixture) throw new Error('R6_DURABLE_RAG_CASE_UNKNOWN');
    return withFixture(dependencies.startD2B2ControlledFixture, dependencies, async fixture => {
        const env = dependencies.finalAcceptanceEnvironment(); const oracles = await d2Oracles(fixture, dependencies);
        // The adapter is frozen here.  No caller-supplied wrapper is accepted.
        const executeToolCall = dependencies.createFrozenRagFixtureExecutor(dependencies.executeToolCall, ragFixture.id);
        const item = await dependencies.runD2CandidateCase({ id: ragFixture.id, rawOwnerInput: slot.ownerInput, oracle: oracles['W1-06'] }, env, executeToolCall);
        return dependencies.scoredResult({ caseId: ragFixture.id, ownerInput: slot.ownerInput, caseKind: 'SHORTAGE_PROCUREMENT', candidate: item.candidate, outcome: item.outcome, safety: item.safety, ragFixture });
    });
}
async function executeD1(slot, dependencies) {
    if (!D1_CASE_IDS.includes(slot.caseId)) throw new Error('R6_DURABLE_D1_CASE_UNKNOWN');
    return withFixture(dependencies.startD1R1ControlledFixture, dependencies, async fixture => {
        const env = dependencies.finalAcceptanceEnvironment();
        const oracles = await dependencies.buildD1Oracles(dependencies.executeToolCall, fixture.ids);
        const item = await dependencies.runD1CandidateCase({ id: slot.caseId, rawOwnerInput: slot.ownerInput, oracle: oracles[slot.caseId] }, env, dependencies.executeToolCall);
        return dependencies.scoredResult({ caseId: slot.caseId, ownerInput: slot.ownerInput, candidate: item.candidate, outcome: item.outcome, safety: item.safety });
    });
}
async function executeDurableCase({ suite, caseKey, slot, freeze }, testDependencies = null) {
    fresh.requireModelOptIn();
    if (!freeze?.productFreezeCommit || !freeze?.harnessFreezeCommit) throw new Error('R6_DURABLE_FREEZE_RECEIPT_REQUIRED');
    const frozenSlot = requireSlot(suite, caseKey, slot);
    const dependencies = dependenciesFor(testDependencies || {});
    if (suite === 'domain-corpus') return executeDomain(frozenSlot, dependencies);
    if (suite === 'targeted') return executeTargeted(frozenSlot, dependencies);
    if (suite === 'rag') return executeRag(frozenSlot, dependencies);
    if (suite === 'd1-protection') return executeD1(frozenSlot, dependencies);
    throw new Error('R6_DURABLE_SUITE_INVALID');
}

module.exports = { D1_CASE_IDS, TARGETED_ORACLE_BY_CASE, defaultDependencies, executeDurableCase, requireSlot };
