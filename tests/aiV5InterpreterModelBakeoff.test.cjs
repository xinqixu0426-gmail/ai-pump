'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const baselineDataset = require('../docs/ai-governance/data/v5-e4r-task-class-semantics-v1_1-evaluation.json');
const {
    BASELINE_MODEL,
    baselineSummary,
    candidateEnvironment,
    discoverConfiguredModels,
    modelEligibility,
    promotionGate,
    rootCauseDecision,
    safeModelId,
    selectAlternateModels,
} = require('../scripts/run-ai-v5e4r-model-bakeoff.cjs');

function ratio(correct, total = 15) {
    return { correct, total, rate: total ? correct / total : null };
}

function metrics(overrides = {}) {
    const full = ratio(15);
    const special = {
        taskClass: ratio(3, 3), sourceSpan: ratio(3, 3), anchor: ratio(3, 3),
        identityPreservation: ratio(3, 3), capability: ratio(3, 3), expectedToolExposure: ratio(3, 3),
    };
    return {
        protocolValidOutputs: full,
        modelNoncomplianceCount: 0,
        taskClassMatch: full,
        projectedDomainMatch: full,
        projectedOperationMatch: full,
        projectedEntityTypeMatch: full,
        sourceSpanMatch: full,
        anchorMatch: full,
        capabilityMatch: full,
        expectedToolExposed: full,
        exactEntity: special,
        flatBlade: special,
        r02WrongToolExclusion: ratio(3, 3),
        identicalInputConsistency: ratio(4, 4),
        v5FalseBlockCount: 0,
        ...overrides,
    };
}

test('candidate discovery is secret-safe, excludes baseline, deduplicates, and caps alternatives', async () => {
    const inventory = await discoverConfiguredModels({
        env: { DEEPSEEK_API_KEY: 'test-only', DEEPSEEK_BASE_URL: 'https://example.invalid' },
        fetchImpl: async (_url, request) => {
            assert.match(request.headers.Authorization, /^Bearer /);
            return { ok: true, json: async () => ({ data: [
                { id: BASELINE_MODEL }, { id: 'candidate-vision-exp' }, { id: 'candidate-pro' },
                { id: 'candidate-pro' }, { id: 'candidate-lite' }, { id: 'candidate-fourth' },
            ] }) };
        },
    });
    assert.equal(inventory.configured, true);
    assert.equal(inventory.candidates.length, 3);
    assert.equal(inventory.candidates.includes(BASELINE_MODEL), false);
    assert.equal(JSON.stringify(inventory).includes('test-only'), false);
});

test('unconfigured provider discovers no alternate candidates without making a request', async () => {
    const inventory = await discoverConfiguredModels({
        env: {},
        fetchImpl: async () => { throw new Error('must not call'); },
    });
    assert.deepEqual(inventory.candidates, []);
});

test('candidate environment changes only provider/model selectors', () => {
    const source = { DEEPSEEK_API_KEY: 'secret', KEEP: 'value' };
    const selected = candidateEnvironment('candidate-pro', source);
    assert.equal(selected.AI_PROVIDER, 'deepseek');
    assert.equal(selected.DEEPSEEK_MODEL, 'candidate-pro');
    assert.equal(selected.KEEP, 'value');
    assert.equal(source.DEEPSEEK_MODEL, undefined);
});

test('baseline artifact is reused and explicitly never rerun', () => {
    const baseline = baselineSummary(baselineDataset);
    assert.equal(baseline.model, BASELINE_MODEL);
    assert.equal(baseline.rerun, false);
    assert.deepEqual(baseline.taskClassAccuracy, { correct: 9, total: 15, rate: 0.6 });
});

test('eligibility requires protocol, compliance, anchoring, and exact identity', () => {
    assert.equal(modelEligibility(metrics()), true);
    assert.equal(modelEligibility(metrics({ protocolValidOutputs: ratio(14) })), false);
    assert.equal(modelEligibility(metrics({ modelNoncomplianceCount: 1 })), false);
    assert.equal(modelEligibility(metrics({ anchorMatch: ratio(14) })), false);
});

test('promotion gate rejects a relative winner below absolute semantic accuracy', () => {
    assert.equal(promotionGate(metrics()), true);
    assert.equal(promotionGate(metrics({ taskClassMatch: ratio(14) })), false);
    assert.equal(promotionGate(metrics({ capabilityMatch: ratio(14) })), false);
    assert.equal(promotionGate(metrics({ v5FalseBlockCount: 1 })), false);
});

test('root-cause decision distinguishes confirmed, partial, rejected, and inconclusive', () => {
    const baseline = { taskClassAccuracy: ratio(9) };
    assert.equal(rootCauseDecision([{ metrics: { ...metrics(), promotionGate: true, modelEligible: true } }], baseline), 'CONFIRMED');
    assert.equal(rootCauseDecision([{ metrics: { ...metrics({ taskClassMatch: ratio(12) }), promotionGate: false, modelEligible: true } }], baseline), 'PARTIAL');
    assert.equal(rootCauseDecision([{ metrics: { ...metrics({ taskClassMatch: ratio(9) }), promotionGate: false, modelEligible: true } }], baseline), 'REJECTED');
    assert.equal(rootCauseDecision([{ metrics: { ...metrics(), promotionGate: false, modelEligible: false } }], baseline), 'INCONCLUSIVE');
});

test('safe model ids cannot create paths or persist arbitrary text', () => {
    assert.equal(safeModelId('../provider/model name'), '..-provider-model-name');
    assert.deepEqual(selectAlternateModels([BASELINE_MODEL, 'b', 'a', 'a']), ['a', 'b']);
});

test('bake-off source preserves one-shot, exact corpus, isolation, and privacy invariants', () => {
    const source = require('node:fs').readFileSync(require.resolve('../scripts/run-ai-v5e4r-model-bakeoff.cjs'), 'utf8');
    assert.match(source, /formal-model-evaluation-started\.json/);
    assert.match(source, /base\.metrics\.interpreter_model_calls !== 15/);
    assert.match(source, /for \(const caseKey of prior\.caseKeys\)/);
    assert.match(source, /fs\.mkdtempSync/);
    assert.match(source, /baselineDataset\.formal_real_evaluation_runs !== 1/);
    assert.match(source, /protocolInvalidCount:/);
    assert.match(source, /crossRequestContaminationCount: 0/);
    assert.doesNotMatch(source, /contaminationCount: outcomes\.filter/);
    assert.doesNotMatch(source, /raw_prompt|raw_entity|source_span_text|model_raw_output/i);
});
