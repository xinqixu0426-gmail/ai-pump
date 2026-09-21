'use strict';

const { validateImpactResult } = require('./validator.cjs');
const { deepFreeze } = require('./contract.cjs');
const E = require('./enforcementContract.cjs');

function displayTarget(db, target) {
    const id = Number(target?.canonicalId);
    if (!Number.isSafeInteger(id) || id < 1) return { ...target, displayName: null };
    let row = null;
    if (target.entityType === 'recipe' || target.entityType === 'recipeCost') {
        row = db.prepare('SELECT name displayName FROM recipes WHERE id=? AND deleted_at IS NULL').get(id);
    } else if (target.entityType === 'order') {
        row = db.prepare('SELECT contract_no displayName FROM orders WHERE id=? AND deleted_at IS NULL').get(id);
    } else if (target.entityType === 'part') {
        row = db.prepare('SELECT model displayName FROM parts WHERE id=? AND deleted_at IS NULL').get(id);
    } else if (target.entityType === 'template') {
        row = db.prepare('SELECT model displayName FROM pump_shell_templates WHERE id=?').get(id);
    }
    return { entityType: target.entityType, canonicalId: String(target.canonicalId),
        displayName: String(row?.displayName || `${target.entityType}#${target.canonicalId}`).slice(0, 160) };
}

function obligations(result) {
    const values = [];
    if (result.trigger.mode === 'PROPOSED_CHANGE') values.push('DISCLOSE_PROPOSED_NOT_ACTUAL');
    if (result.impacts.some(item => item.impactType === 'CURRENT_RECIPE_CONFIGURATION_AFFECTED')) values.push('DISCLOSE_CURRENT_RECIPE_AFFECTED');
    if (result.impacts.some(item => item.effect === 'RECALCULATION_REQUIRED')) values.push('DISCLOSE_COST_RECALCULATION_REQUIRED');
    if (result.impacts.some(item => item.temporal === 'SAVED_SNAPSHOT')) values.push('DISCLOSE_SAVED_ORDER_NOT_MUTATED');
    if (result.impacts.some(item => item.effect === 'REVIEW_REQUIRED')) values.push('DISCLOSE_SAVED_ORDER_REVIEW_REQUIRED');
    if (result.impacts.some(item => item.effect === 'DIFFERENCE_VERIFIED')) values.push('DISCLOSE_VERIFIED_ORDER_DIFFERENCE');
    if (result.impacts.some(item => item.effect === 'READINESS_RECOMPUTE_REQUIRED')) values.push('DISCLOSE_READINESS_RECOMPUTE_REQUIRED');
    if (result.trigger.changeType === 'TEMPLATE_CHANGE' || result.trigger.changeType === 'PART_PRICE_CHANGE') values.push('DISCLOSE_AFFECTED_RECIPE_SET');
    if (result.completeness === 'PARTIAL') values.push('DISCLOSE_INCOMPLETE_IMPACT_SCOPE');
    if (result.trigger.changeType === 'ENGINEERING_PREDICTION') values.push('DISCLOSE_ENGINEERING_UNKNOWN');
    if (result.trigger.changeType === 'QUOTATION_FRESHNESS') values.push('DISCLOSE_QUOTATION_FRESHNESS_UNKNOWN');
    if (result.trigger.changeType === 'TEST_REPORT_VALIDITY') values.push('DISCLOSE_REPORT_APPLICABILITY_UNKNOWN');
    return [...new Set(values)];
}

function forbiddenClaims(result) {
    const values = [];
    if (result.trigger.mode === 'PROPOSED_CHANGE') values.push('MUST_NOT_CLAIM_PROPOSED_CHANGE_OCCURRED');
    if (result.impacts.some(item => item.temporal === 'SAVED_SNAPSHOT')) values.push('MUST_NOT_CLAIM_SAVED_ORDER_CHANGED');
    if (result.impacts.some(item => item.effect === 'RECALCULATION_REQUIRED')) values.push('MUST_NOT_CLAIM_RECIPE_COST_ALREADY_CHANGED');
    if (result.trigger.changeType === 'QUOTATION_FRESHNESS') values.push('MUST_NOT_CLAIM_QUOTATION_STALE', 'MUST_NOT_CLAIM_QUOTATION_CURRENT');
    if (result.trigger.changeType === 'TEST_REPORT_VALIDITY') values.push('MUST_NOT_CLAIM_TEST_REPORT_VALID', 'MUST_NOT_CLAIM_TEST_REPORT_INVALID');
    if (result.trigger.changeType === 'ENGINEERING_PREDICTION') values.push('MUST_NOT_PREDICT_ENGINEERING_NUMBER', 'MUST_NOT_PREDICT_ENGINEERING_DIRECTION_AS_FACTORY_FACT');
    return [...new Set(values)];
}

function validateImpactEvidenceBundle(bundle, impactResult) {
    const result = validateImpactResult(impactResult);
    if (!bundle || bundle.version !== E.IMPACT_EVIDENCE_BUNDLE_VERSION
        || bundle.completeness !== result.completeness || !Array.isArray(bundle.verifiedImpacts)
        || !Array.isArray(bundle.unresolved) || !Array.isArray(bundle.answerObligations)
        || !Array.isArray(bundle.forbiddenClaims)
        || bundle.verifiedImpacts.length !== result.impacts.length
        || bundle.answerObligations.some(value => !E.OBLIGATIONS.includes(value))
        || bundle.forbiddenClaims.some(value => !E.FORBIDDEN_CLAIMS.includes(value))) {
        throw Object.assign(new Error('IMPACT_EVIDENCE_BUNDLE_INVALID'), { code: 'IMPACT_EVIDENCE_BUNDLE_INVALID' });
    }
    for (let index = 0; index < result.impacts.length; index += 1) {
        const source = result.impacts[index]; const projected = bundle.verifiedImpacts[index];
        if (projected.effect !== source.effect || projected.authority !== source.authority
            || projected.temporal !== source.temporal || projected.status !== source.status
            || String(projected.target?.canonicalId) !== String(source.target?.canonicalId)
            || projected.target?.entityType !== source.target?.entityType) {
            throw Object.assign(new Error('IMPACT_EVIDENCE_BUNDLE_ELEVATION'), { code: 'IMPACT_EVIDENCE_BUNDLE_ELEVATION' });
        }
    }
    if (JSON.stringify(bundle.unresolved) !== JSON.stringify(result.unresolved)
        || Buffer.byteLength(JSON.stringify(bundle)) > E.MAX_IMPACT_EVIDENCE_BUNDLE_BYTES) {
        throw Object.assign(new Error('IMPACT_EVIDENCE_BUNDLE_BOUND'), { code: 'IMPACT_EVIDENCE_BUNDLE_BOUND' });
    }
    return structuredClone(bundle);
}

function buildImpactEvidenceBundle({ db, impactResult, impactEligibility } = {}) {
    const result = validateImpactResult(impactResult);
    const bundle = {
        version: E.IMPACT_EVIDENCE_BUNDLE_VERSION,
        triggerSummary: { mode: result.trigger.mode, entityType: result.trigger.entityType,
            canonicalId: result.trigger.canonicalId, changeType: result.trigger.changeType,
            slice: impactEligibility?.slice || null, unsupportedDomain: impactEligibility?.unsupportedDomain || null },
        verifiedImpacts: result.impacts.map(item => ({ impactType: item.impactType,
            target: displayTarget(db, item.target), effect: item.effect, authority: item.authority,
            temporal: item.temporal, status: item.status, evidenceSummary: item.evidence.slice(0, 8),
            ...(item.snapshotQuality ? { snapshotQuality: item.snapshotQuality } : {}),
            ...(item.verifiedReadiness ? { verifiedReadiness: item.verifiedReadiness } : {}) })),
        unresolved: result.unresolved.slice(), completeness: result.completeness,
        answerObligations: obligations(result), forbiddenClaims: forbiddenClaims(result),
    };
    return deepFreeze(validateImpactEvidenceBundle(bundle, result));
}

function modelImpactEvidenceMessage(bundle) {
    return `本轮已取得只读确定性 ImpactEvidenceBundleV1。它在影响结论上高于通用推断；只可说明其中已验证的对象、effect、temporal 和 completeness，不得把建议变更说成已发生，不得补写工程数值或未验证下游关系。\n${JSON.stringify(bundle)}`;
}

module.exports = { buildImpactEvidenceBundle, validateImpactEvidenceBundle,
    modelImpactEvidenceMessage, obligations, forbiddenClaims };
