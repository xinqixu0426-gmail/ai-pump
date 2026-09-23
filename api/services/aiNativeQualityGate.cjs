'use strict';

const QUALITY_STATUS = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', MISSING: 'MISSING', NOT_RUN: 'NOT_RUN' });
const REQUIRED_NATIVE_QUALITY_CRITERIA = Object.freeze([
    'contracts',
    'surfaceSafety',
    'durableTasks',
    'leaseFencing',
    'retryDeadline',
    'restartRecovery',
    'confirmationIntegrity',
    'commandIdempotency',
    'reconciliation',
    'regressionGates',
    'deepApiDeterminism',
    'rolloutSafety',
]);

function normalizedStatus(value) {
    return Object.values(QUALITY_STATUS).includes(value) ? value : QUALITY_STATUS.MISSING;
}

function evaluateNativeQualityEvidence({ sourceRevision, currentRevision, criteria = {} } = {}) {
    const stale = typeof sourceRevision !== 'string' || !sourceRevision || sourceRevision !== currentRevision;
    const checks = REQUIRED_NATIVE_QUALITY_CRITERIA.map(requirement => ({
        requirement,
        status: normalizedStatus(criteria?.[requirement]?.status),
        evidence: criteria?.[requirement]?.evidence || null,
    }));
    const missing = checks.filter(check => [QUALITY_STATUS.MISSING, QUALITY_STATUS.NOT_RUN].includes(check.status));
    const failed = checks.filter(check => check.status === QUALITY_STATUS.FAIL);
    const status = stale || missing.length || failed.length ? QUALITY_STATUS.FAIL : QUALITY_STATUS.PASS;
    return Object.freeze({
        version: 1,
        sourceRevision: sourceRevision || null,
        currentRevision: currentRevision || null,
        stale,
        status,
        checks,
        missingCriteria: missing.map(check => check.requirement),
        failedCriteria: failed.map(check => check.requirement),
    });
}

function ownerTrialReadiness({ config, quality, rollback, ownerAuth, productionConfigUnchanged, regressions = {} } = {}) {
    const mandatoryRegressions = ['n4', 'n5_1a', 'n5_1b', 'n5_2', 'n6_1', 'n6_2'];
    const missingRegression = mandatoryRegressions.filter(key => regressions[key] !== QUALITY_STATUS.PASS);
    const ready = config?.mode === 'off'
        && config?.modeValid === true
        && config?.writeEnabled === false
        && config?.writeValid === true
        && quality?.status === QUALITY_STATUS.PASS
        && quality?.stale === false
        && rollback === QUALITY_STATUS.PASS
        && ownerAuth === QUALITY_STATUS.PASS
        && productionConfigUnchanged === true
        && missingRegression.length === 0;
    return Object.freeze({
        status: ready ? 'READY_FOR_OWNER_TRIAL' : 'NOT_READY',
        ready,
        ownerTrialActuallyStarted: false,
        missingRegression,
    });
}

module.exports = { QUALITY_STATUS, REQUIRED_NATIVE_QUALITY_CRITERIA, evaluateNativeQualityEvidence, ownerTrialReadiness };
