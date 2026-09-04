'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    REMAINING_FROZEN_PATH_IDS,
    buildCompleteDataset,
    canonicalHash,
    executeRunnerCases,
    planResumePaths,
    runnerDisposition,
    verifyFrozenInterpreterHashes,
} = require('../scripts/run-ai-v5e4r-protocol-v2-evaluation.cjs');
const partialDataset = require('../docs/ai-governance/data/v5-e4r-protocol-v2-evaluation.json');

const frozen = Object.freeze([
    'P06-COIL-001-LEGACY',
    'P06-COIL-001-V4I',
    'P06-COIL-001-V4R3',
    'P06-EXACT-001-LEGACY',
    'P06-EXACT-001-V4I',
    'P06-EXACT-001-V4R3',
    ...REMAINING_FROZEN_PATH_IDS,
]);
const executed = Object.freeze(frozen.slice(0, 6));

function caseReport(overrides = {}) {
    return {
        suite: 'r4b_read_shadow_comparison',
        status: 'PASS',
        rolloutReadiness: { blocker: null },
        cases: [{ comparison: 'V4_R3_EQUAL' }],
        ...overrides,
    };
}

test('B1 freeze detects the explicitly approved B2 Task Class semantic revision', () => {
    assert.throws(() => verifyFrozenInterpreterHashes(), error => (
        error?.code === 'P15R_C_FROZEN_HASH_MISMATCH'
    ));
});

test('runner status 0 records the selected case and continues', () => {
    assert.deepEqual(runnerDisposition({ status: 0 }, caseReport()), {
        action: 'RECORD_CONTINUE', reason: 'RUNNER_COMPLETED',
    });
});

test('case-level SHADOW_INCOMPARABLE status 2 records and continues', () => {
    const report = caseReport({
        status: 'INCOMPLETE',
        rolloutReadiness: { blocker: 'SHADOW_INCOMPARABLE' },
        cases: [{ comparison: 'INCOMPARABLE' }],
    });
    assert.deepEqual(runnerDisposition({ status: 2 }, report), {
        action: 'RECORD_CONTINUE', reason: 'CASE_LEVEL_SHADOW_INCOMPARABLE',
    });
});

test('status 2 caused by missing credentials remains suite-fatal', () => {
    const report = caseReport({
        status: 'INCOMPLETE',
        rolloutReadiness: { blocker: 'AI_PROVIDER_UNAVAILABLE' },
        cases: [],
    });
    assert.equal(runnerDisposition({ status: 2 }, report).action, 'FATAL');
});

test('crash, unknown status, and corrupted artifact remain suite-fatal', () => {
    assert.equal(runnerDisposition({ status: null, error: new Error('crash') }, null).action, 'FATAL');
    assert.equal(runnerDisposition({ status: 3 }, caseReport()).action, 'FATAL');
    assert.equal(runnerDisposition({ status: 0 }, null).action, 'FATAL');
});

test('a fatal case stops the suite before later cases execute', () => {
    const seen = [];
    assert.throws(() => executeRunnerCases(['case-a', 'case-b', 'case-c'], caseKey => {
        seen.push(caseKey);
        if (caseKey === 'case-b') throw new Error('fatal suite failure');
        return caseKey;
    }), /fatal suite failure/);
    assert.deepEqual(seen, ['case-a', 'case-b']);
});

test('resume plan skips every already-executed path and executes only remaining IDs', () => {
    const plan = planResumePaths({
        frozenPathIds: frozen,
        executedPathIds: executed,
        requestedPathIds: frozen,
    });
    assert.deepEqual(plan.skipped, executed);
    assert.deepEqual(plan.execute, REMAINING_FROZEN_PATH_IDS);
    assert.equal(plan.execute.some(pathId => executed.includes(pathId)), false);
});

test('explicit remaining-only plan executes all and only the frozen remaining paths', () => {
    const plan = planResumePaths({
        frozenPathIds: frozen,
        executedPathIds: executed,
        requestedPathIds: REMAINING_FROZEN_PATH_IDS,
    });
    assert.deepEqual(plan.skipped, []);
    assert.deepEqual(plan.execute, REMAINING_FROZEN_PATH_IDS);
});

test('duplicate and unknown path IDs are rejected before any execution', () => {
    assert.throws(() => planResumePaths({
        frozenPathIds: frozen,
        executedPathIds: executed,
        requestedPathIds: [REMAINING_FROZEN_PATH_IDS[0], REMAINING_FROZEN_PATH_IDS[0]],
    }), /duplicate path ID/);
    assert.throws(() => planResumePaths({
        frozenPathIds: frozen,
        executedPathIds: executed,
        requestedPathIds: ['P06-UNKNOWN-001-LEGACY'],
    }), /unknown path ID/);
});

test('canonical first-six record hash is independent of object key order', () => {
    assert.equal(canonicalHash([{ a: 1, b: 2 }]), canonicalHash([{ b: 2, a: 1 }]));
});

function resumedFixture(caseId, index) {
    return {
        case_id: caseId,
        source_group_id: caseId.startsWith('P06-FLATBLADE')
            ? 'FLAT_BLADE_PRICE' : caseId.startsWith('P06-INVENTORY') ? 'PART_INVENTORY_PRIMARY' : 'PART_INVENTORY_REPEAT',
        input_fingerprint: caseId.startsWith('P06-FLATBLADE') ? 'f'.repeat(64) : 'a'.repeat(64),
        actual: { protocolStatus: 'VALID' },
        class_match: true,
        span_selection: true,
        match: {
            domain: true, operation: true, entity_type: true, anchor: true,
            capability: true, expected_tool_exposed: true, wrong_tool_excluded: true,
        },
        wrong_tool_applicable: caseId.endsWith('V4R3'),
        overall_comparison: 'AGREE',
        safe_reason_codes: ['INTERPRETATION_VALID'],
        trace_id: String(index).padStart(32, '0'),
        shadow_task_id: `v5-shadow-fixture-${index}`,
        model_calls: 1,
        usage: null,
        completion_latency_ms: 10,
        output_signature: caseId.startsWith('P06-FLATBLADE') ? 'flat-signature' : 'part-signature',
    };
}

test('complete merge preserves the original six records byte-semantically', () => {
    const resumed = REMAINING_FROZEN_PATH_IDS.map(resumedFixture);
    const complete = buildCompleteDataset({
        partialDataset,
        resumedInternalPaths: resumed,
        allFrozenPathIds: frozen,
    });
    assert.equal(complete.paths.length, 15);
    assert.deepEqual(complete.paths.slice(0, 6), partialDataset.paths);
    assert.equal(complete.first_6_records_hash_before, complete.first_6_records_hash_after);
});

test('complete merge rejects duplicate and unknown path results', () => {
    const resumed = REMAINING_FROZEN_PATH_IDS.map(resumedFixture);
    assert.throws(() => buildCompleteDataset({
        partialDataset,
        resumedInternalPaths: [...resumed, resumed[0]],
        allFrozenPathIds: frozen,
    }), /Duplicate path result/);
    assert.throws(() => buildCompleteDataset({
        partialDataset,
        resumedInternalPaths: [...resumed.slice(0, -1), resumedFixture('P06-UNKNOWN-001-LEGACY', 99)],
        allFrozenPathIds: frozen,
    }), /Unknown path result/);
});
