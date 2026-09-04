'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { buildToolCapabilityReverseIndex, getV5Capability } = require('../api/services/ai-v5/capabilityRegistry.cjs');
const { CASES, buildDataset } = require('../scripts/run-ai-v5e4r-v1_1-evaluation.cjs');

const root = path.resolve(__dirname, '..');
const frozen = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'ai-observability', 'data', 'p06-failure-cases.json'), 'utf8'));

function fixtureEvidence() {
    const reverse = buildToolCapabilityReverseIndex();
    const reports = new Map();
    const interpretations = new Map();
    for (const item of frozen) {
        const mapping = Object.entries(CASES).find(([, value]) => item.case_id.startsWith(value.family));
        if (!mapping) continue;
        const [caseKey, caseMapping] = mapping;
        const runtime = item.case_id.split('-').at(-1);
        const capability = getV5Capability(reverse[item.expected.primary_tool][0]);
        const inputGroup = caseMapping.sourceGroupId.startsWith('PART_INVENTORY') ? 'PART_SHARED' : caseMapping.sourceGroupId;
        const inputFingerprint = crypto.createHash('sha256').update(inputGroup).digest('hex');
        reports.set(item.case_id, { v4Result: item.result, v4Tools: [...item.safe_structural_metadata.tools] });
        interpretations.set(item.case_id, {
            caseKey,
            caseId: `${caseKey}:${runtime}`,
            sourceTraceId: item.trace_id,
            shadowTaskId: `synthetic-${item.case_id}`,
            independent: {
                interpreterStatus: 'VALID', modelCalls: 1, usage: null, completionLatencyMs: 10,
                inputFingerprint,
                domain: capability.domain, operation: capability.operation,
                entityTypes: [...capability.requiredEntityTypes], entityAnchorStatuses: ['ANCHORED'],
                capabilityOutcome: 'SELECTED', capabilityId: capability.capabilityId,
                allowedToolNames: [...capability.allowedTools], reasonCodes: ['INTERPRETATION_VALID'],
            },
        });
    }
    return { reports, interpretations };
}

test('frozen evaluator predefines path, source-group, fingerprint and R02 denominators', () => {
    const fixture = fixtureEvidence();
    const dataset = buildDataset(frozen, fixture.reports, fixture.interpretations);
    assert.equal(dataset.metrics.real_paths, 15);
    assert.equal(dataset.metrics.source_groups, 5);
    assert.equal(dataset.metrics.input_fingerprints, 4);
    assert.deepEqual(dataset.metrics.path.domain, { correct: 15, total: 15, rate: 1 });
    assert.deepEqual(dataset.metrics.source_group.capability, { correct: 5, total: 5, rate: 1 });
    assert.deepEqual(dataset.metrics.input_fingerprint.anchor, { correct: 4, total: 4, rate: 1 });
    assert.deepEqual(dataset.metrics.identical_input_consistency, { correct: 4, total: 4, rate: 1 });
    assert.deepEqual(dataset.metrics.r02_wrong_tool_exclusion, { correct: 3, total: 3, rate: 1 });
    assert.equal(dataset.metrics.v5_tool_calls, 0);
    assert.equal(dataset.metrics.v5_business_api_calls, 0);
    assert.equal(dataset.metrics.v5_writes, 0);
});

test('frozen evaluator rejects missing input fingerprints instead of fabricating them', () => {
    const fixture = fixtureEvidence();
    fixture.interpretations.values().next().value.independent.inputFingerprint = null;
    assert.throws(() => buildDataset(frozen, fixture.reports, fixture.interpretations), /fingerprint missing/);
});
