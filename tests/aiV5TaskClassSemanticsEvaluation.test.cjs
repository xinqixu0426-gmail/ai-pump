'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const frozenCases = require('../docs/ai-observability/data/p06-failure-cases.json');
const { buildToolCapabilityReverseIndex, getV5Capability } = require('../api/services/ai-v5/capabilityRegistry.cjs');
const { V5_TASK_CLASS_CATALOG } = require('../api/services/ai-v5/taskClassCatalog.cjs');
const {
    buildB2Dataset,
    computeFreezeHashes,
    verifyFreezeHashes,
} = require('../scripts/run-ai-v5e4r-task-class-semantics-v1_1-evaluation.cjs');

const FAMILY_GROUP = Object.freeze({
    'P06-COIL-001': 'COIL_INVENTORY',
    'P06-EXACT-001': 'EXACT_RECIPE_COST',
    'P06-FLATBLADE-001': 'FLAT_BLADE_PRICE',
    'P06-INVENTORY-001': 'PART_INVENTORY_PRIMARY',
    'P06-SIMPLE-001': 'PART_INVENTORY_REPEAT',
});

function familyFor(caseId) {
    return Object.keys(FAMILY_GROUP).find(family => caseId.startsWith(family));
}

function expectedCapability(authority) {
    const ids = buildToolCapabilityReverseIndex()[authority.expected.primary_tool] || [];
    assert.equal(ids.length, 1, authority.case_id);
    return getV5Capability(ids[0]);
}

function fixtureBase() {
    const selected = frozenCases.filter(item => familyFor(item.case_id));
    const fingerprintByGroup = new Map();
    return {
        paths: selected.map(authority => {
            const capability = expectedCapability(authority);
            const taskClass = V5_TASK_CLASS_CATALOG.find(item => item.domain === capability.domain
                && item.operation === capability.operation
                && JSON.stringify(item.entityTypes) === JSON.stringify([...capability.requiredEntityTypes].sort()));
            const group = FAMILY_GROUP[familyFor(authority.case_id)];
            if (!fingerprintByGroup.has(group)) {
                const sharedPart = group.startsWith('PART_INVENTORY');
                fingerprintByGroup.set(group, sharedPart ? 'd'.repeat(64) : String.fromCharCode(97 + fingerprintByGroup.size).repeat(64));
            }
            return {
                case_id: authority.case_id,
                source_group_id: group,
                input_fingerprint: fingerprintByGroup.get(group),
                v4_result: authority.case_id === 'P06-EXACT-001-V4R3' ? 'UNAVAILABLE' : authority.result,
                expected: {
                    capability: capability.capabilityId,
                    entity_types: [...capability.requiredEntityTypes],
                },
                actual: {
                    protocolStatus: 'VALID',
                    taskClassRef: taskClass.classRef,
                    sourceSpanRefs: capability.requiredEntityTypes.map((_value, index) => `sp_${index + 1}`),
                    allowedToolNames: [...capability.allowedTools],
                    domain: capability.domain,
                    operation: capability.operation,
                    entityTypes: [...capability.requiredEntityTypes],
                    capabilityId: capability.capabilityId,
                },
                match: {
                    domain: true,
                    operation: true,
                    entity_type: true,
                    anchor: true,
                    capability: true,
                    expected_tool_exposed: true,
                },
                overall_comparison: 'AGREE',
                safe_reason_codes: ['INTERPRETATION_VALID'],
                trace_id: authority.trace_id,
                shadow_task_id: `v5-shadow-b2-fixture-${authority.case_id}`,
            };
        }),
        metrics: {
            source_groups: 5,
            input_fingerprints: 4,
            interpreter_model_calls: 15,
            token_usage: {},
            shadow_completion_median_ms: 10,
            shadow_completion_p95_ms: 20,
        },
    };
}

test('all non-semantic B2 frozen surfaces remain unchanged before evaluation', () => {
    const hashes = computeFreezeHashes();
    assert.equal(verifyFreezeHashes(hashes), true);
    assert.notEqual(hashes.taskClassSemantics, 'c298bcf127030602b5f82cdcc8aed61554a789aacc1b082ade70eed1ca5d0ef9');
});

test('B2 dataset evaluates Interpreter correctness independently from V4 incomparability', () => {
    const hashes = computeFreezeHashes();
    const dataset = buildB2Dataset(fixtureBase(), frozenCases, hashes, hashes);
    assert.equal(dataset.paths.length, 15);
    assert.equal(dataset.metrics.interpreterModelCalls, 15);
    assert.deepEqual(dataset.metrics.protocolValidOutputs, { correct: 15, total: 15, rate: 1 });
    assert.deepEqual(dataset.metrics.exactEntity.taskClass, { correct: 3, total: 3, rate: 1 });
    assert.deepEqual(dataset.metrics.exactEntity.sourceSpan, { correct: 3, total: 3, rate: 1 });
    assert.equal(dataset.metrics.exactEntity.v4ComparisonIncomparable, 1);
    const unavailable = dataset.paths.find(item => item.case_id === 'P06-EXACT-001-V4R3');
    assert.equal(unavailable.protocol_status, 'VALID');
    assert.equal(unavailable.task_class_match, true);
    assert.equal(unavailable.v4_comparison_status, 'INCOMPARABLE');
});

