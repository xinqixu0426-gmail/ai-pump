'use strict';

const C = require('./contract.cjs');

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function canonicalId(value, optional = false) {
    if (optional && value == null) return null;
    const id = String(value || '');
    if (!/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id))) fail('IMPACT_CANONICAL_ID_INVALID');
    return id;
}
function validateTrigger(trigger) {
    if (!trigger || trigger.version !== 1 || !C.TRIGGER_MODES.includes(trigger.mode)
        || !C.CHANGE_TYPES.includes(trigger.changeType) || typeof trigger.entityType !== 'string'
        || !trigger.entityType || !trigger.source || !C.AUTHORITIES.includes(trigger.source.authority)
        || !Array.isArray(trigger.source.evidence) || trigger.source.evidence.length === 0
        || trigger.source.evidence.length > 16) fail('IMPACT_TRIGGER_INVALID');
    canonicalId(trigger.canonicalId, true);
    if (trigger.mode === 'PROPOSED_CHANGE' && trigger.persisted === true) fail('IMPACT_PROPOSED_AS_PERSISTED');
    return trigger;
}
function validateImpact(impact, trigger) {
    if (!impact || typeof impact.impactType !== 'string' || !impact.impactType
        || !impact.target || typeof impact.target.entityType !== 'string'
        || !C.EFFECT_TYPES.includes(impact.effect) || !C.AUTHORITIES.includes(impact.authority)
        || !C.TEMPORAL_STATES.includes(impact.temporal) || !C.IMPACT_STATUSES.includes(impact.status)
        || !Array.isArray(impact.evidence) || impact.evidence.length === 0 || impact.evidence.length > 16) {
        fail('IMPACT_RESULT_INVALID');
    }
    canonicalId(impact.target.canonicalId, true);
    if (trigger.mode === 'PROPOSED_CHANGE' && impact.effect === 'CHANGED') fail('IMPACT_PROPOSED_AS_CHANGED');
    if (impact.target.entityType === 'order' && impact.temporal === 'SAVED_SNAPSHOT' && impact.effect === 'CHANGED') {
        fail('IMPACT_SAVED_ORDER_MUTATION_CLAIM');
    }
    if (impact.effect === 'DIFFERENCE_VERIFIED' && impact.snapshotQuality !== 'COMPLETE_SAVED_CONFIGURATION') {
        fail('IMPACT_UNVERIFIED_SNAPSHOT_DIFFERENCE');
    }
    if (['QUOTATION_STALE', 'TEST_REPORT_INVALID', 'TEST_REPORT_VALID'].includes(impact.impactType)) {
        fail('IMPACT_UNSUPPORTED_AUTHORITY');
    }
    if (impact.target.entityType === 'engineeringPrediction' || Object.hasOwn(impact, 'temperatureDelta')) {
        fail('IMPACT_ENGINEERING_SPECULATION');
    }
}
function validateImpactResult(result) {
    if (!result || result.version !== 1 || !Array.isArray(result.impacts)
        || !Array.isArray(result.unresolved) || !C.COMPLETENESS_STATES.includes(result.completeness)
        || !result.bounds || !Number.isSafeInteger(result.bounds.readCalls)
        || result.bounds.readCalls < 0 || result.bounds.readCalls > C.MAX_IMPACT_READ_CALLS
        || result.impacts.length > C.MAX_IMPACT_TARGETS) fail('IMPACT_RESULT_INVALID');
    validateTrigger(result.trigger);
    for (const impact of result.impacts) validateImpact(impact, result.trigger);
    if (result.completeness === 'COMPLETE' && result.bounds.truncated) fail('IMPACT_FALSE_COMPLETE');
    if (Buffer.byteLength(JSON.stringify(result)) > C.MAX_IMPACT_RESULT_BYTES) fail('IMPACT_RESULT_BOUND');
    return structuredClone(result);
}

module.exports = { validateImpactResult, validateTrigger };
