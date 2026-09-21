const test = require('node:test');
const assert = require('node:assert/strict');

const { createArchitectureAcceptanceCase } = require('../api/services/aiArchitectureAcceptanceV4.cjs');
const { createFactRequirement, createInvestigationState } = require('../api/services/aiFactModelV4.cjs');
const { buildClaimsFromInvestigation } = require('../api/services/aiClaimGroundingV4.cjs');
const { buildAnswerPlan, formatAnswerPlanDeterministically } = require('../api/services/aiGroundedAnswerV4.cjs');
const { createEvidenceLedger, createObservation } = require('../api/services/aiObservationV3.cjs');
const {
    SHADOW_PATHS,
    assertReadOnlyShadowCase,
    comparisonClassification,
    envForShadowPath,
    runShadowComparisonSuite,
} = require('../api/services/aiShadowComparisonV4.cjs');

function successfulFixture(value = 137.42) {
    const initial = createFactRequirement({
        identity: {
            entityType: 'part', entityId: '42', predicate: 'currentScalar',
            temporalScope: 'current', scenario: 'catalog_current', qualifiers: {},
        },
        status: 'satisfied',
    });
    const result = {
        success: true,
        parts: [{ id: 42, model: 'R4B-REDACTED-PART', price: value }],
        executionEvidence: { verified: true, calls: [{ method: 'GET', path: '/api/parts', ok: true }] },
    };
    const observation = createObservation({
        attempted: true,
        observationId: 'O1',
        outcome: 'success_non_empty',
        capabilityName: 'search_parts',
        factKey: initial.factKey,
        verified: true,
        sourceOfTruth: 'partsService',
        result,
    });
    const ledger = createEvidenceLedger();
    const evidence = ledger.appendObservation(observation, { toolResult: { name: 'search_parts', result } });
    const requirement = createFactRequirement({ ...initial, evidenceIds: [evidence.evidenceId], observationIds: ['O1'] });
    const state = createInvestigationState({
        goalId: 'shadow-fixture', status: 'completed', requirements: [requirement],
        observations: [observation], evidenceIds: [evidence.evidenceId],
        budget: { maxCalls: 10, usedCalls: 1 },
    });
    const claims = buildClaimsFromInvestigation({ state, evidenceLedger: ledger.snapshot(), observations: [observation] });
    const answerPlan = buildAnswerPlan({ claims, requirements: state.requirements, answerShape: 'direct' });
    return { result, observation, evidenceLedger: ledger.snapshot(), requirement, state, claims, answerPlan };
}

function ambiguousFixture() {
    const requirement = createFactRequirement({
        identity: {
            entityType: 'part', entityId: null, predicate: 'currentScalar',
            temporalScope: 'current', scenario: 'catalog_current', qualifiers: {},
        },
        status: 'needs_clarification',
        observationIds: ['OA'],
    });
    const candidates = [
        { entityType: 'part', entityId: 1, canonicalName: '候选A' },
        { entityType: 'part', entityId: 2, canonicalName: '候选B' },
    ];
    const observation = createObservation({
        attempted: true,
        observationId: 'OA',
        outcome: 'ambiguous',
        capabilityName: 'search_parts',
        factKey: requirement.factKey,
        verified: false,
        sourceOfTruth: 'partsService',
        result: { resolutionReceipts: [{ entityType: 'part', candidates: candidates.map(item => ({ id: item.entityId, name: item.canonicalName })) }] },
    });
    const state = createInvestigationState({
        goalId: 'shadow-ambiguous', status: 'needs_clarification', requirements: [requirement],
        observations: [observation], budget: { maxCalls: 10, usedCalls: 1 },
    });
    const claims = buildClaimsFromInvestigation({ state, evidenceLedger: [], observations: [observation] });
    const answerPlan = buildAnswerPlan({ claims, requirements: state.requirements, answerShape: 'direct' });
    return { requirement, observation, state, claims, answerPlan, candidates };
}

function acceptanceCase(caseKey, value = 137.42) {
    return createArchitectureAcceptanceCase({
        caseKey,
        domain: 'part',
        userQuestion: 'R4B secret question that must not enter report',
        mode: 'query',
        entityScope: 'single',
        setup: async () => ({ snapshotId: 'same-snapshot' }),
        oracleBuilder: async setup => ({ status: 'ready', value, snapshotId: setup.snapshotId }),
        requiredFacts: [{ entityType: 'part', predicate: 'currentScalar', temporalScope: 'current', scenario: 'catalog_current' }],
        expectedClaims: async ({ oracle }) => [{
            claimType: 'scalar_value',
            subject: { entityType: 'part', entityId: '42' },
            predicate: 'price.current',
            value: oracle.value,
            unit: 'CNY',
            temporalScope: 'current',
            scenario: 'catalog_current',
            evidenceClasses: ['live_business'],
            sourceOfTruth: 'partsService',
        }],
        allowedCapabilityClasses: ['query'],
        requiredEvidenceClasses: ['live_business'],
        terminalState: 'completed',
        semanticRequirements: { evidencePreserved: true },
        writeBoundary: 'read_only',
    });
}

function ambiguousCase(caseKey) {
    const fixture = ambiguousFixture();
    return {
        fixture,
        testCase: createArchitectureAcceptanceCase({
            caseKey,
            domain: 'part',
            userQuestion: 'ambiguous target',
            mode: 'query',
            entityScope: 'single',
            oracleBuilder: async () => ({ status: 'ready', candidates: fixture.candidates }),
            requiredFacts: [{ entityType: 'part', predicate: 'currentScalar', temporalScope: 'current', scenario: 'catalog_current' }],
            expectedClaims: async ({ oracle }) => [{
                claimType: 'ambiguous',
                subject: { entityType: 'part', entityId: null },
                predicate: 'currentScalar',
                value: oracle.candidates,
                unit: null,
                temporalScope: 'current',
                scenario: 'catalog_current',
                evidenceClasses: [],
                sourceOfTruth: 'partsService',
            }],
            allowedCapabilityClasses: ['query'],
            terminalState: 'needs_clarification',
            writeBoundary: 'read_only',
        }),
    };
}

function runtimeResult(path, fixture = successfulFixture()) {
    return {
        finalContent: formatAnswerPlanDeterministically(fixture.answerPlan, fixture.claims),
        toolResults: [{ name: 'search_parts', result: fixture.result || { success: false } }],
        behaviorEvents: [],
        observations: [fixture.observation],
        evidenceLedger: fixture.evidenceLedger || [],
        investigationState: fixture.state,
        ...(path === SHADOW_PATHS.V4_R3 ? {
            claims: fixture.claims,
            answerPlan: fixture.answerPlan,
            answerRendering: 'deterministic',
        } : {}),
        fallbackReason: null,
        intent: {
            mode: 'query', domains: ['catalog'], needsBusinessData: true,
            entityScope: 'single', answerShape: 'direct', contextMode: 'current_turn',
            steps: [{ capabilityName: 'search_parts', objective: 'query' }],
        },
        telemetry: {
            totalMs: path === SHADOW_PATHS.LEGACY ? 10 : path === SHADOW_PATHS.V4_INVESTIGATION ? 12 : 14,
            executedTools: 1,
            providerEvents: [{ provider: 'test' }],
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            toolSteps: [{ capabilityName: 'search_parts', durationMs: 1, success: true }],
            outcome: fixture.state.status,
        },
    };
}

test('shadow path flags are isolated and never enable online shadow', () => {
    assert.deepEqual(envForShadowPath(SHADOW_PATHS.LEGACY), {
        AI_READ_INVESTIGATION_V4_ENABLED: 'false',
        AI_CLAIM_GROUNDING_V4_ENABLED: 'false',
        AI_READ_INVESTIGATION_V4_SHADOW_ENABLED: 'false',
    });
    assert.equal(envForShadowPath(SHADOW_PATHS.V4_INVESTIGATION).AI_READ_INVESTIGATION_V4_ENABLED, 'true');
    assert.equal(envForShadowPath(SHADOW_PATHS.V4_INVESTIGATION).AI_CLAIM_GROUNDING_V4_ENABLED, 'false');
    assert.equal(envForShadowPath(SHADOW_PATHS.V4_R3).AI_CLAIM_GROUNDING_V4_ENABLED, 'true');
});

test('shadow case contract rejects command, write class, and write allowlist', () => {
    const base = acceptanceCase('read-only');
    assert.equal(assertReadOnlyShadowCase(base), true);
    assert.throws(() => assertReadOnlyShadowCase({ ...base, mode: 'command' }), /query\/analysis/);
    assert.throws(() => assertReadOnlyShadowCase({ ...base, allowedCapabilityClasses: ['command'] }), /Query/);
    assert.throws(() => assertReadOnlyShadowCase({ ...base, optionalAllowedCapabilities: ['create_part'] }), /写能力/);
});

test('comparison classifications are deterministic', () => {
    assert.equal(comparisonClassification('FAIL', 'PASS'), 'V4_R3_BETTER');
    assert.equal(comparisonClassification('PASS', 'PASS'), 'V4_R3_EQUAL');
    assert.equal(comparisonClassification('PASS', 'FAIL'), 'V4_R3_WORSE');
    assert.equal(comparisonClassification('FAIL', 'FAIL'), 'BOTH_FAIL');
    assert.equal(comparisonClassification('UNAVAILABLE', 'PASS'), 'INCOMPARABLE');
    assert.equal(comparisonClassification('NEEDS_CLARIFICATION', 'NEEDS_CLARIFICATION'), 'V4_R3_EQUAL');
});

test('same oracle and snapshot feed three isolated paths; one path failure does not abort others', async () => {
    const calls = [];
    const suite = await runShadowComparisonSuite({
        cases: [{ testCase: acceptanceCase('isolated-paths'), shadow: { tags: ['current_saved', 'flat_knife_800'] } }],
        executePath: async input => {
            calls.push({ path: input.path, snapshotId: input.setup.snapshotId, oracle: input.oracle.value, env: input.env });
            if (input.path === SHADOW_PATHS.V4_INVESTIGATION) {
                const error = new Error('provider down'); error.code = 'PROVIDER_UNAVAILABLE'; throw error;
            }
            return runtimeResult(input.path);
        },
    });
    assert.equal(calls.length, 3);
    assert.deepEqual(new Set(calls.map(item => item.snapshotId)), new Set(['same-snapshot']));
    assert.deepEqual(new Set(calls.map(item => item.oracle)), new Set([137.42]));
    assert.equal(suite.cases[0].paths.legacy_v3.classification, 'PASS');
    assert.equal(suite.cases[0].paths.v4_investigation.classification, 'UNAVAILABLE');
    assert.equal(suite.cases[0].paths.v4_r3.classification, 'PASS');
});

test('shadow executor write exposure and confirmation state fail closed', async () => {
    for (const mutation of [
        result => ({ ...result, toolResults: [{ name: 'create_part', result: { success: false } }], telemetry: { ...result.telemetry, toolSteps: [{ capabilityName: 'create_part' }] } }),
        result => ({ ...result, telemetry: { ...result.telemetry, outcome: 'confirmation' } }),
    ]) {
        const suite = await runShadowComparisonSuite({
            cases: [{ testCase: acceptanceCase(`write-${Math.random()}`), shadow: { tags: ['current_saved', 'flat_knife_800'] } }],
            executePath: async ({ path }) => mutation(runtimeResult(path)),
        });
        assert.equal(suite.status, 'INCOMPLETE');
        assert.equal(suite.rolloutReadiness.ready, false);
        assert.match(suite.cases[0].paths.v4_r3.failureCode, /^SHADOW_(WRITE_EXPOSURE|CONFIRMATION_STATE)$/);
    }
});

test('six critical repeat groups require five stable V4+R3 runs and emit redacted report', async () => {
    const cases = [];
    const groups = ['simple_current', 'ambiguous', 'current_cost', 'current_saved', 'complex_renderer', 'flat_knife_800'];
    const ambiguous = ambiguousCase('ambiguous-base');
    for (const group of groups) {
        for (let run = 1; run <= 5; run += 1) {
            const isAmbiguous = group === 'ambiguous';
            cases.push({
                testCase: isAmbiguous ? { ...ambiguous.testCase, caseKey: `${group}-${run}` } : acceptanceCase(`${group}-${run}`),
                shadow: { repeatGroup: group, tags: [group] },
            });
        }
    }
    const suite = await runShadowComparisonSuite({
        cases,
        generatedAt: '2026-09-03T00:00:00.000Z',
        gitCommit: 'abc123',
        realProvider: true,
        databaseSnapshot: 'sha256:redacted',
        executePath: async ({ path, testCase }) => (
            testCase.caseKey.startsWith('ambiguous')
                ? runtimeResult(path, ambiguous.fixture)
                : runtimeResult(path)
        ),
    });
    assert.equal(suite.status, 'PASS', JSON.stringify(suite.rolloutReadiness));
    assert.equal(suite.rolloutReadiness.ready, true);
    assert.equal(suite.metrics.repeatStability.groups.length, 6);
    assert.ok(suite.metrics.repeatStability.groups.every(item => item.passCount === 5 && item.runCount === 5));
    assert.equal(suite.metrics.safety.unsupportedClaimRate.rate, 0);
    assert.equal(suite.metrics.safety.falseNotFoundRate.rate, 0);
    assert.equal(suite.metrics.safety.ambiguityAutoResolutionRate.rate, 0);
    assert.equal(suite.metrics.safety.writeExposureRate.rate, 0);
    assert.equal(suite.metrics.safety.evidencePreservationRate.rate, 1);
    assert.equal(suite.metrics.safety.requiredClaimCoverageRate.rate, 1);
    assert.equal(suite.metrics.comparisons.V4_R3_WORSE, 0);
    assert.equal(suite.metrics.rendering.v4InternalFailureCount, 0);
    assert.equal(suite.metrics.paths.v4_r3.runtime.usage.source, 'provider_reported_only');
    const serialized = JSON.stringify(suite);
    assert.doesNotMatch(serialized, /secret question|137\.42|R4B-REDACTED-PART|entityId/);
});

test('missing provider usage stays unavailable and is never estimated', async () => {
    const suite = await runShadowComparisonSuite({
        cases: [{ testCase: acceptanceCase('usage-unavailable'), shadow: { tags: ['current_saved', 'flat_knife_800'] } }],
        executePath: async ({ path }) => {
            const result = runtimeResult(path);
            return { ...result, telemetry: { ...result.telemetry, usage: null } };
        },
    });
    assert.deepEqual(suite.metrics.paths.legacy_v3.runtime.usage, { available: false });
    assert.deepEqual(suite.metrics.paths.v4_r3.runtime.usage, { available: false });
});

test('provider or oracle prerequisites make the gate INCOMPLETE, never PASS', async () => {
    const base = acceptanceCase('missing-oracle');
    const missing = { ...base, oracleBuilder: async () => ({ status: 'prerequisite_missing' }) };
    const suite = await runShadowComparisonSuite({
        cases: [{ testCase: missing, shadow: { tags: ['current_saved', 'flat_knife_800'] } }],
        executePath: async ({ path }) => runtimeResult(path),
    });
    assert.equal(suite.status, 'INCOMPLETE');
    assert.equal(suite.rolloutReadiness.ready, false);
    assert.equal(suite.metrics.comparisons.INCOMPARABLE, 1);
});
