'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    QUALITY_STATUS,
    REQUIRED_NATIVE_QUALITY_CRITERIA,
    evaluateNativeQualityEvidence,
    ownerTrialReadiness,
} = require('../api/services/aiNativeQualityGate.cjs');

function evidence(status = QUALITY_STATUS.PASS) {
    return Object.fromEntries(REQUIRED_NATIVE_QUALITY_CRITERIA.map(key => [key, { status, evidence: `test:${key}` }]));
}
function readyInput(overrides = {}) {
    return {
        config: { mode: 'off', modeValid: true, writeEnabled: false, writeValid: true },
        quality: evaluateNativeQualityEvidence({ sourceRevision: 'a', currentRevision: 'a', criteria: evidence() }),
        rollback: QUALITY_STATUS.PASS,
        ownerAuth: QUALITY_STATUS.PASS,
        productionConfigUnchanged: true,
        regressions: { n4: 'PASS', n5_1a: 'PASS', n5_1b: 'PASS', n5_2: 'PASS', n6_1: 'PASS', n6_2: 'PASS' },
        ...overrides,
    };
}

test('N7.1 quality summary accepts only complete current PASS evidence', () => {
    const quality = evaluateNativeQualityEvidence({ sourceRevision: 'current', currentRevision: 'current', criteria: evidence() });
    assert.equal(quality.status, 'PASS');
    assert.equal(quality.stale, false);
    assert.deepEqual(quality.missingCriteria, []);
    assert.deepEqual(quality.failedCriteria, []);
});

test('N7.1 hard quality gate rejects missing, failed, and stale evidence', () => {
    const missing = evidence(); delete missing.restartRecovery;
    assert.equal(evaluateNativeQualityEvidence({ sourceRevision: 'same', currentRevision: 'same', criteria: missing }).status, 'FAIL');
    const failed = evidence(); failed.commandIdempotency.status = 'FAIL';
    const failedResult = evaluateNativeQualityEvidence({ sourceRevision: 'same', currentRevision: 'same', criteria: failed });
    assert.equal(failedResult.status, 'FAIL');
    assert.deepEqual(failedResult.failedCriteria, ['commandIdempotency']);
    const stale = evaluateNativeQualityEvidence({ sourceRevision: 'old', currentRevision: 'new', criteria: evidence() });
    assert.equal(stale.status, 'FAIL');
    assert.equal(stale.stale, true);
});

test('N7.1 readiness requires default-off, write false, current quality, rollback, auth and every regression', () => {
    const ready = ownerTrialReadiness(readyInput());
    assert.equal(ready.ready, true);
    assert.equal(ready.status, 'READY_FOR_OWNER_TRIAL');
    assert.equal(ready.ownerTrialActuallyStarted, false);
    assert.equal(ownerTrialReadiness(readyInput({ config: { mode: 'owner', modeValid: true, writeEnabled: false, writeValid: true } })).ready, false);
    assert.equal(ownerTrialReadiness(readyInput({ quality: evaluateNativeQualityEvidence({ sourceRevision: 'old', currentRevision: 'new', criteria: evidence() }) })).ready, false);
    assert.equal(ownerTrialReadiness(readyInput({ regressions: { n4: 'PASS' } })).ready, false);
});
