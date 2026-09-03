const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getAiCapability } = require('../api/capabilities/registry.cjs');

const {
    createFactRequirement,
    createInvestigationGoal,
} = require('../api/services/aiFactModelV4.cjs');
const {
    createReadInvestigationController,
} = require('../api/services/aiReadInvestigationRuntimeV4.cjs');
const {
    requiresV3Fallback,
    runReadInvestigationDriverV4,
} = require('../api/services/aiReadInvestigationDriverV4.cjs');

function partGoal(options = {}) {
    const requirement = createFactRequirement({
        identity: {
            entityType: 'part',
            entityId: null,
            predicate: options.predicate || 'currentScalar',
            temporalScope: 'current',
            scenario: 'catalog_current',
            qualifiers: { targetMention: 'v750' },
        },
    });
    return createInvestigationGoal({
        goalId: options.goalId || 'driver-test',
        goal: '查询 V750',
        mode: 'query',
        entityScope: 'single',
        domains: ['catalog'],
        originalTarget: 'V750',
        requirements: [requirement],
    });
}

function verifiedRows(rows) {
    return {
        success: true,
        data: rows,
        count: rows.length,
        executionEvidence: {
            verified: true,
            kind: 'formal_api_query',
            calls: [{ method: 'GET', path: '/api/parts', outcome: 'success' }],
        },
    };
}

function observationOutcome(result, args = { keyword: 'V750' }) {
    return {
        kind: 'observation',
        args,
        parameterProvenance: Object.fromEntries(Object.keys(args).map(key => [key, 'original_user'])),
        result,
    };
}

test('V4 driver source 不读取 legacy recovery/correction 或兼容 toolResults', () => {
    const source = fs.readFileSync(path.join(
        __dirname,
        '..',
        'api',
        'services',
        'aiReadInvestigationDriverV4.cjs'
    ), 'utf8');
    for (const forbidden of [
        /\btoolResults\b/,
        /\brecoveryMode\b/,
        /\brecoveryRounds\b/,
        /\bacceptedVerifiedEmpty\b/,
        /\brecoveredEvidence\b/,
        /\breadCorrectionCapabilities\b/,
        /\bplanMismatchCorrections\b/,
        /\bidentifierCorrectionUsed\b/,
        /\bresponseProtocolCorrectionUsed\b/,
    ]) {
        assert.doesNotMatch(source, forbidden);
    }
    assert.match(source, /writeIntent:\s*false/);
    assert.match(source, /allowWrite:\s*false/);
});

async function runPartDriver(options = {}) {
    const controller = createReadInvestigationController({
        goal: options.goal || partGoal(options),
        planHints: options.planHints,
        budget: options.budget,
    });
    let calls = 0;
    const result = await runReadInvestigationDriverV4({
        controller,
        maxIterations: options.maxIterations || 5,
        executeDecision: async input => {
            calls += 1;
            return options.executeDecision
                ? options.executeDecision(input, calls)
                : observationOutcome(verifiedRows([{ id: 1, model: 'V750', price: 12.5 }]));
        },
        // Deliberately hostile legacy inputs: the V4 driver API ignores them.
        toolResults: options.toolResults,
        recoveryMode: options.recoveryMode,
        recoveryRounds: options.recoveryRounds,
        acceptedVerifiedEmpty: options.acceptedVerifiedEmpty,
        recoveredEvidence: options.recoveredEvidence,
        readCorrectionCapabilities: options.readCorrectionCapabilities,
        planMismatchCorrections: options.planMismatchCorrections,
        identifierCorrectionUsed: options.identifierCorrectionUsed,
        responseProtocolCorrectionUsed: options.responseProtocolCorrectionUsed,
    });
    return { result, calls };
}

test('V4 driver 与 legacy recovery/correction state 及兼容 toolResults 无关', async () => {
    const clean = await runPartDriver();
    const dirty = await runPartDriver({
        toolResults: [{ name: 'delete_part', result: { success: false } }],
        recoveryMode: true,
        recoveryRounds: 999,
        acceptedVerifiedEmpty: true,
        recoveredEvidence: true,
        readCorrectionCapabilities: new Set(['delete_part']),
        planMismatchCorrections: new Set(['search_parts']),
        identifierCorrectionUsed: true,
        responseProtocolCorrectionUsed: true,
    });

    assert.equal(clean.calls, dirty.calls);
    assert.equal(clean.result.status, 'completed');
    assert.equal(clean.result.fallbackReason, null);
    assert.equal(dirty.result.status, clean.result.status);
    assert.equal(dirty.result.fallbackReason, null);
    assert.deepEqual(dirty.result.state.requirements, clean.result.state.requirements);
    assert.deepEqual(
        dirty.result.observations.map(({ attemptedAt: _attemptedAt, ...item }) => item),
        clean.result.observations.map(({ attemptedAt: _attemptedAt, ...item }) => item)
    );
    assert.deepEqual(
        dirty.result.evidenceLedger.map(({ recordedAt: _recordedAt, ...item }) => item),
        clean.result.evidenceLedger.map(({ recordedAt: _recordedAt, ...item }) => item)
    );
});

test('错误 planner initial hint 不替代 open Fact 的 Broker 选择', async () => {
    const selected = [];
    const { result } = await runPartDriver({
        planHints: ['delete_part', 'unknown_capability'],
        executeDecision: async ({ decision }) => {
            selected.push(decision.capabilityName);
            return observationOutcome(verifiedRows([{ id: 1, model: 'V750', price: 12.5 }]));
        },
    });
    assert.deepEqual(selected, ['search_parts']);
    assert.equal(selected.some(name => getAiCapability(name)?.access === 'write'), false);
    assert.equal(result.status, 'completed');
    assert.equal(result.fallbackReason, null);
    assert.equal(result.behaviorEvents.some(item => item.type === 'plan_drift'), false);
});

test('completed_negative 是 driver 终态，不执行后续 capability', async () => {
    const { result, calls } = await runPartDriver({
        predicate: 'verifiedNotFound',
        executeDecision: async () => observationOutcome(verifiedRows([])),
    });
    assert.equal(result.status, 'completed_negative');
    assert.equal(result.fallbackReason, null);
    assert.equal(calls, 1);
});

test('needs_clarification 是 driver 终态，不自动选择候选', async () => {
    const { result, calls } = await runPartDriver({
        executeDecision: async ({ decision }) => ({
            kind: 'resolution',
            receipt: {
                entityType: 'part',
                originalMention: 'V750',
                status: 'ambiguous',
                selected: null,
                candidates: [{ id: 1, name: 'V750-A' }, { id: 2, name: 'V750-B' }],
                sourceCapability: decision.capabilityName,
            },
        }),
    });
    assert.equal(result.status, 'needs_clarification');
    assert.equal(result.fallbackReason, null);
    assert.equal(calls, 1);
    assert.equal(result.state.requirements[0].status, 'needs_clarification');
});

for (const [label, code] of [
    ['timeout', 'AI_TOOL_TIMEOUT'],
    ['protocol_failure', 'AI_PROTOCOL_FAILURE'],
    ['transport_failure', 'AI_TRANSPORT_FAILURE'],
]) {
    test(`${label} 是 failed_unverified 终态且不进入 legacy recovery`, async () => {
        const { result, calls } = await runPartDriver({
            executeDecision: async () => observationOutcome({
                success: false,
                code,
                error: label,
                executionEvidence: { verified: false },
            }),
        });
        assert.equal(result.status, 'failed_unverified');
        assert.equal(result.fallbackReason, null);
        assert.equal(calls, 1);
        assert.notEqual(result.status, 'completed_negative');
    });
}

test('未满足 Fact 在正式调用预算耗尽后保持 budget_exhausted', async () => {
    const { result, calls } = await runPartDriver({
        budget: { maxCalls: 1 },
        executeDecision: async () => observationOutcome(verifiedRows([])),
    });
    assert.equal(calls, 1);
    assert.equal(result.status, 'budget_exhausted');
    assert.equal(result.fallbackReason, null);
});

test('未知 fallback reason fail closed，只有 v4_internal_failure 允许回退 V3', () => {
    assert.equal(requiresV3Fallback(null), false);
    assert.equal(requiresV3Fallback('v4_internal_failure'), true);
    assert.throws(
        () => requiresV3Fallback('provider_timeout'),
        error => error?.code === 'AI_V4_UNKNOWN_FALLBACK_REASON'
    );
});

test('implementation-level exception 使用结构化 v4_internal_failure', async () => {
    const { result } = await runPartDriver({
        executeDecision: async () => {
            throw new Error('adapter defect');
        },
    });
    assert.equal(result.status, 'internal_failure');
    assert.equal(result.fallbackReason, 'v4_internal_failure');
    assert.deepEqual(result.compatibilityToolResults, []);
});
