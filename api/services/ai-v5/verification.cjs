'use strict';

const { validateLedger } = require('./evidenceLedger.cjs');
const { hasVerifiedPriceReceipt } = require('./fieldReadEvidence.cjs');
const verifiedResults = new WeakMap();

const EXECUTION_STATUSES = Object.freeze(['COMPLETE', 'INCOMPLETE', 'FAILED', 'NOT_APPLICABLE']);
const COMPLETENESS_STATUSES = Object.freeze(['COMPLETE', 'INCOMPLETE', 'NOT_APPLICABLE']);
const VALIDITY_STATUSES = Object.freeze(['VALID', 'INVALID', 'STALE', 'UNKNOWN']);
const SUPPORTABILITY_STATUSES = Object.freeze(['SUPPORTED', 'UNSUPPORTED', 'PARTIALLY_SUPPORTED']);
const VERIFICATION_DECISIONS = Object.freeze(['VERIFIED', 'UNVERIFIED', 'FAILED_EXECUTION', 'FAILED_EVIDENCE']);
const TRUST_RANK = Object.freeze({ UNVERIFIED: 0, TEMPORARY: 1, DERIVED_FORMAL: 2, FORMAL: 3 });

function frozen(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(frozen);
    return Object.freeze(value);
}

function evaluateExecutionCompleteness(input = {}) {
    if (input.executionRequired === false) return frozen({ status: 'NOT_APPLICABLE', reasonCodes: [] });
    const results = Array.isArray(input.toolResults) ? input.toolResults : [];
    if (results.some(result => result?.status === 'failure')) return frozen({ status: 'FAILED', reasonCodes: ['TOOL_EXECUTION_FAILED'] });
    const requiredCount = Number.isInteger(input.requiredExecutionCount) ? input.requiredExecutionCount : 1;
    if (results.filter(result => result?.status === 'success').length < requiredCount || input.orchestrationComplete !== true) {
        return frozen({ status: 'INCOMPLETE', reasonCodes: ['EXECUTION_INCOMPLETE'] });
    }
    return frozen({ status: 'COMPLETE', reasonCodes: [] });
}

function requiredRequirements(requirements) {
    return (requirements || []).filter(item => item.level === 'REQUIRED');
}

function structurallyMatches(item, requirement) {
    return item.claimType === requirement.claimType && item.evidenceType === requirement.requiredEvidenceType;
}

function entityMatches(item, requirement) {
    if (requirement.entityRef) {
        return item.entityRef?.entityType === requirement.entityRef.entityType
            && item.entityRef.canonicalEntityId === requirement.entityRef.canonicalEntityId;
    }
    if (!requirement.entityType) return true;
    return item.entityRef?.entityType === requirement.entityType && item.entityRef.canonicalEntityId !== null;
}

function freshnessMatches(item, requirement) {
    return requirement.freshnessRequirement === 'ANY' || item.freshness === requirement.freshnessRequirement;
}

function trustMatches(item, requirement) {
    return TRUST_RANK[item.sourceTrust] >= TRUST_RANK[requirement.minimumSourceTrust];
}

function evaluateEvidenceCompleteness(ledgerInput, requirements = []) {
    const ledger = validateLedger(ledgerInput);
    const required = requiredRequirements(requirements);
    if (required.length === 0) return frozen({ status: 'NOT_APPLICABLE', missingRequirementIds: [] });
    const missingRequirementIds = required.filter(requirement => (
        ledger.items.filter(item => structurallyMatches(item, requirement)).length < requirement.minimumCount
    )).map(item => item.requirementId);
    return frozen({
        status: missingRequirementIds.length === 0 ? 'COMPLETE' : 'INCOMPLETE',
        missingRequirementIds,
    });
}

function evaluateEvidenceValidity(ledgerInput, requirements = []) {
    let ledger;
    try {
        ledger = validateLedger(ledgerInput);
    } catch (error) {
        return frozen({ status: 'INVALID', invalidEvidenceIds: [], staleEvidenceIds: [], unknownEvidenceIds: [], reasonCodes: [error.code || 'LEDGER_INVALID'] });
    }
    const required = requiredRequirements(requirements);
    const relevant = ledger.items.filter(item => required.some(requirement => structurallyMatches(item, requirement)));
    const invalidEvidenceIds = relevant.filter(item => {
        const matching = required.filter(requirement => structurallyMatches(item, requirement));
        return item.status === 'INVALID'
            || item.status === 'MISSING'
            || (item.sourceTrust === 'FORMAL' && !item.sourceRef)
            || matching.every(requirement => !trustMatches(item, requirement) || !entityMatches(item, requirement));
    }).map(item => item.evidenceId);
    const staleEvidenceIds = relevant.filter(item => (
        item.status === 'STALE'
        || item.freshness === 'STALE'
    )).map(item => item.evidenceId);
    const unknownEvidenceIds = relevant.filter(item => {
        const matching = required.filter(requirement => structurallyMatches(item, requirement));
        return item.status === 'UNKNOWN'
            || item.freshness === 'UNKNOWN'
            || matching.every(requirement => !freshnessMatches(item, requirement));
    }).map(item => item.evidenceId);
    let status = 'VALID';
    if (invalidEvidenceIds.length > 0) status = 'INVALID';
    else if (staleEvidenceIds.length > 0) status = 'STALE';
    else if (unknownEvidenceIds.length > 0 || relevant.some(item => item.evidenceType === 'UNVERIFIED')) status = 'UNKNOWN';
    return frozen({
        status,
        invalidEvidenceIds: [...new Set(invalidEvidenceIds)],
        staleEvidenceIds: [...new Set(staleEvidenceIds)],
        unknownEvidenceIds: [...new Set(unknownEvidenceIds)],
        reasonCodes: [],
    });
}

function evaluateSupportability(ledgerInput, requirements = []) {
    const ledger = validateLedger(ledgerInput);
    const required = requiredRequirements(requirements);
    if (required.length === 0) return frozen({ status: 'SUPPORTED', supportedRequirementIds: [] });
    const supportedRequirementIds = required.filter(requirement => {
        const matching = ledger.items.filter(item => (
            structurallyMatches(item, requirement)
            && item.status === 'VALID'
            && !['ASSUMPTION', 'UNVERIFIED'].includes(item.evidenceType)
            && trustMatches(item, requirement)
            && freshnessMatches(item, requirement)
            && entityMatches(item, requirement)
        ));
        return matching.length >= requirement.minimumCount;
    }).map(item => item.requirementId);
    return frozen({
        status: supportedRequirementIds.length === required.length
            ? 'SUPPORTED'
            : supportedRequirementIds.length > 0 ? 'PARTIALLY_SUPPORTED' : 'UNSUPPORTED',
        supportedRequirementIds,
    });
}

function decisionFromLayerResults(executionStatus, evidenceCompleteness, evidenceValidity, supportability) {
    if (!EXECUTION_STATUSES.includes(executionStatus) || !COMPLETENESS_STATUSES.includes(evidenceCompleteness)
        || !VALIDITY_STATUSES.includes(evidenceValidity) || !SUPPORTABILITY_STATUSES.includes(supportability)) {
        throw new TypeError('Invalid verification layer status');
    }
    if (['FAILED', 'INCOMPLETE'].includes(executionStatus)) return 'FAILED_EXECUTION';
    if (['INVALID', 'STALE'].includes(evidenceValidity)) return 'FAILED_EVIDENCE';
    if (evidenceCompleteness === 'INCOMPLETE' || evidenceValidity === 'UNKNOWN' || supportability !== 'SUPPORTED') return 'UNVERIFIED';
    return 'VERIFIED';
}

function verifyV5Task(input = {}) {
    const execution = evaluateExecutionCompleteness(input.execution || {});
    const completeness = evaluateEvidenceCompleteness(input.ledger, input.requirements);
    const validity = evaluateEvidenceValidity(input.ledger, input.requirements);
    const supportability = evaluateSupportability(input.ledger, input.requirements);
    const priceRequired = requiredRequirements(input.requirements).some(r => r.claimType === 'price.current');
    const priceVerified = !priceRequired || hasVerifiedPriceReceipt(input.ledger, input.priceEvidenceReceipt);
    const decision = priceVerified
        ? decisionFromLayerResults(execution.status, completeness.status, validity.status, supportability.status)
        : 'FAILED_EVIDENCE';
    const ledger = validateLedger(input.ledger);
    const reasonCodes = [...new Set([
        ...execution.reasonCodes,
        ...(!priceVerified ? ['PRICE_FIELD_NOT_VERIFIED'] : []),
        ...(completeness.status === 'INCOMPLETE' ? ['REQUIRED_EVIDENCE_MISSING'] : []),
        ...(validity.status === 'INVALID' ? ['EVIDENCE_INVALID'] : []),
        ...(validity.status === 'STALE' ? ['EVIDENCE_STALE'] : []),
        ...(validity.status === 'UNKNOWN' ? ['EVIDENCE_UNKNOWN'] : []),
        ...(supportability.status !== 'SUPPORTED' ? ['CLAIM_UNSUPPORTED'] : []),
    ])];
    const result = frozen({
        taskId: ledger.taskId,
        executionStatus: execution.status,
        evidenceCompleteness: completeness.status,
        evidenceValidity: validity.status,
        supportability: supportability.status,
        missingRequirements: completeness.missingRequirementIds,
        invalidEvidenceIds: validity.invalidEvidenceIds,
        staleEvidenceIds: validity.staleEvidenceIds,
        assumptionEvidenceIds: ledger.items.filter(item => item.evidenceType === 'ASSUMPTION').map(item => item.evidenceId),
        decision,
        reasonCodes,
    });
    if (decision === 'VERIFIED') verifiedResults.set(result, JSON.stringify(ledger));
    return result;
}

function isVerifiedTaskResult(ledger, result) {
    return result?.decision === 'VERIFIED' && verifiedResults.get(result) === JSON.stringify(ledger);
}

function verificationTransitionContext(ledger, executionCompleted, evidenceFree = false) {
    const checked = evidenceFree ? ledger : validateLedger(ledger);
    return frozen({ executionCompleted: executionCompleted === true, evidenceFree: evidenceFree === true, evidenceLedger: checked });
}

function composingTransitionContext(result) {
    return frozen({ verificationCompleted: true, verificationDecision: result?.decision || null });
}

module.exports = {
    COMPLETENESS_STATUSES,
    EXECUTION_STATUSES,
    SUPPORTABILITY_STATUSES,
    VALIDITY_STATUSES,
    VERIFICATION_DECISIONS,
    composingTransitionContext,
    decisionFromLayerResults,
    evaluateEvidenceCompleteness,
    evaluateEvidenceValidity,
    evaluateExecutionCompleteness,
    evaluateSupportability,
    verificationTransitionContext,
    verifyV5Task,
    isVerifiedTaskResult,
};
