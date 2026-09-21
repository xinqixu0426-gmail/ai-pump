'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const corpus = require('./fixtures/legacy-witness-corpus-v1.json');
const matrix = require('../docs/legacy-redundancy-matrix-v1.json');
const { runLegacyWitness } = require('./helpers/legacyRedundancyHarness.cjs');

const root = path.resolve(__dirname, '..');
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');

test('LegacyWitnessCorpusV1 and LegacyRedundancyMatrixV1 are versioned, complete, and hashable', () => {
    assert.equal(corpus.version, 'LegacyWitnessCorpusV1');
    assert.deepEqual(corpus.cases.map(item => item.caseKey), ['LW-01', 'LW-02', 'LW-03', 'LW-04', 'LW-05', 'LW-06']);
    assert.equal(matrix.version, 'LegacyRedundancyMatrixV1');
    assert.equal(matrix.productionBehaviorChanged, false);
    assert.equal(matrix.legacyComponentsRemoved, 0);
    assert.equal(matrix.components.length, 5);
    assert.match(sha256('tests/fixtures/legacy-witness-corpus-v1.json'), /^[a-f0-9]{64}$/u);
    assert.match(sha256('docs/legacy-redundancy-matrix-v1.json'), /^[a-f0-9]{64}$/u);
});

test('every historical component has a witness that actually activates it', () => {
    for (const definition of corpus.cases) {
        const outcome = runLegacyWitness(definition.caseKey);
        assert.equal(outcome.legacy.triggered, true, definition.caseKey);
        assert.equal(outcome.legacy.trigger, definition.expectedLegacyTrigger, definition.caseKey);
        assert.equal(outcome.semantic.status, definition.expectedSemanticStatus, definition.caseKey);
    }
});

test('one-at-a-time bypass removes only the selected Legacy protection while Semantic stays authoritative', () => {
    for (const definition of corpus.cases) {
        const baseline = runLegacyWitness(definition.caseKey);
        const bypass = runLegacyWitness(definition.caseKey, { bypass: true });
        assert.equal(baseline.legacy.triggered, true, definition.caseKey);
        assert.equal(bypass.legacy.triggered, false, definition.caseKey);
        assert.equal(bypass.legacy.answer, bypass.input.answer, definition.caseKey);
        assert.equal(bypass.semantic.status, baseline.semantic.status, definition.caseKey);
        assert.equal(bypass.semantic.answer, baseline.semantic.answer, definition.caseKey);
    }
});

test('LW-01 proves Money Guard numeric provenance remains independently safety-relevant', () => {
    const outcome = runLegacyWitness('LW-01');
    assert.doesNotMatch(outcome.legacy.answer, /999/u);
    assert.match(outcome.legacy.answer, /201/u);
    assert.doesNotMatch(outcome.semantic.answer, /999/u);
    assert.match(outcome.semantic.answer, /201\.00/u);
});

test('LW-02 and LW-03 prove semantic cross-catalog and official-variant replacements', () => {
    const crossCatalog = runLegacyWitness('LW-02');
    assert.match(crossCatalog.legacy.answer, /泵壳-V800-平刀/u);
    assert.match(crossCatalog.semantic.answer, /零件目录/u);
    assert.match(crossCatalog.semantic.answer, /18\.50 元/u);
    const variants = runLegacyWitness('LW-03');
    assert.match(variants.legacy.answer, /共有 2 套方案/u);
    assert.match(variants.semantic.answer, /钢带\/小眼/u);
    assert.match(variants.semantic.answer, /冷轧\/国标眼/u);
});

test('LW-04 and LW-05 prove Semantic rejects wrong cost basis and unsupported hypothetical price', () => {
    const costBasis = runLegacyWitness('LW-04');
    assert.match(costBasis.legacy.answer, /线圈方案成本/u);
    assert.equal(costBasis.semantic.status, 'PARTIAL_VERIFIED');
    assert.doesNotMatch(costBasis.semantic.answer, /整机成本是 102/u);
    const hypothetical = runLegacyWitness('LW-05');
    assert.match(hypothetical.legacy.answer, /不是.*按你假设的价格/su);
    assert.equal(hypothetical.semantic.status, 'UNSUPPORTED_REQUEST');
    assert.doesNotMatch(hypothetical.semantic.answer, /按铜价95计算/u);
    assert.match(hypothetical.semantic.answer, /不是按铜价 95 计算/u);
});

test('LW-06 proves bounded Legacy repair and FORMAL_RELATION_RESULT are independent paths', () => {
    const outcome = runLegacyWitness('LW-06');
    assert.equal(outcome.legacy.triggered, true);
    assert.equal(outcome.semantic.status, 'COMPLETE');
    assert.ok(outcome.semantic.verifiedFacts.includes('FORMAL_RELATION_RESULT'));
    assert.match(outcome.semantic.answer, /配方-V550经典款/u);
});

test('matrix classifications use only allowed outcomes and require concrete witness evidence', () => {
    const allowed = new Set(['REQUIRED_SAFETY', 'REQUIRED_UNIQUE_BEHAVIOR', 'PARTIALLY_REDUNDANT',
        'REDUNDANT_UNDER_SEMANTIC', 'OUT_OF_SCOPE / DEFER']);
    for (const component of matrix.components) {
        assert.ok(allowed.has(component.classification), component.component);
        for (const field of ['historicalResponsibility', 'triggerCondition', 'factsConsumed', 'claimsProtected',
            'semanticEquivalent', 'overlap', 'uniqueRemainingResponsibility', 'failureIfRemoved', 'witness', 'bypassResult']) {
            assert.ok(component[field] && component[field].length !== 0, `${component.component}:${field}`);
        }
    }
    assert.deepEqual(matrix.summary.REDUNDANT_UNDER_SEMANTIC, []);
});
