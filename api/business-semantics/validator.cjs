'use strict';

const { BusinessSemanticFrameV1 } = require('./contract.cjs');

function assert(condition, code) {
    if (!condition) throw Object.assign(new Error(code), { code: 'BUSINESS_SEMANTIC_FRAME_INVALID', reason: code });
}

function known(value, list, field) { assert(list.includes(value), `INVALID_${field}`); }
function stringArray(value, max, field) {
    assert(Array.isArray(value) && value.length <= max, `INVALID_${field}`);
    assert(value.every(item => typeof item === 'string'), `INVALID_${field}_ITEM`);
    assert(new Set(value).size === value.length, `DUPLICATE_${field}_ITEM`);
}

function validateBusinessSemanticFrame(frame) {
    const c = BusinessSemanticFrameV1;
    assert(frame && typeof frame === 'object' && !Array.isArray(frame), 'FRAME_REQUIRED');
    assert(frame.version === c.version, 'VERSION');
    known(frame.stage, ['PRE_EVIDENCE', 'POST_EVIDENCE'], 'STAGE');
    known(frame.question?.kind, c.questionKinds, 'QUESTION_KIND');
    assert(typeof frame.question?.operation === 'string', 'QUESTION_OPERATION');
    known(frame.subject?.requestedType, c.subjectTypes, 'REQUESTED_TYPE');
    assert(frame.subject?.canonicalType === null || c.subjectTypes.includes(frame.subject.canonicalType), 'CANONICAL_TYPE');
    assert(frame.subject?.canonicalId === null || (Number.isSafeInteger(frame.subject.canonicalId) && frame.subject.canonicalId > 0), 'CANONICAL_ID');
    known(frame.subject?.resolutionStatus, c.resolutionStatuses, 'RESOLUTION_STATUS');
    if (frame.subject.resolutionStatus === 'UNIQUE') assert(frame.subject.canonicalType && frame.subject.canonicalId, 'UNIQUE_REQUIRES_CANONICAL_ID');
    known(frame.ambiguity?.status, c.ambiguityStatuses, 'AMBIGUITY_STATUS');
    stringArray(frame.ambiguity?.dimensions, 8, 'AMBIGUITY_DIMENSIONS');
    assert(Number.isSafeInteger(frame.ambiguity?.candidateCount) && frame.ambiguity.candidateCount >= 0, 'CANDIDATE_COUNT');
    known(frame.cost?.requestedBasis, c.costBasisTypes, 'REQUESTED_COST_BASIS');
    known(frame.cost?.actualBasis, c.costBasisTypes, 'ACTUAL_COST_BASIS');
    known(frame.cost?.requestedPriceContext, c.priceContextTypes, 'REQUESTED_PRICE_CONTEXT');
    known(frame.cost?.actualPriceContext, c.priceContextTypes, 'ACTUAL_PRICE_CONTEXT');
    known(frame.cost?.calculationSupport, c.calculationSupport, 'CALCULATION_SUPPORT');
    assert(typeof frame.override?.requested === 'boolean', 'OVERRIDE_REQUESTED');
    assert(Array.isArray(frame.override?.fields) && frame.override.fields.length <= 8, 'OVERRIDE_FIELDS');
    known(frame.override?.supportStatus, c.overrideStates, 'OVERRIDE_STATUS');
    if (frame.override.supportStatus === 'AMBIGUOUS_OVERRIDE') {
        assert(frame.override.fields.every(field => field.canonicalId == null && field.selectedCanonicalId == null), 'AMBIGUOUS_OVERRIDE_SELECTED');
    }
    stringArray(frame.evidence?.requiredFacts, c.limits.maxFacts, 'REQUIRED_FACTS');
    stringArray(frame.evidence?.verifiedFacts, c.limits.maxFacts, 'VERIFIED_FACTS');
    stringArray(frame.evidence?.missingFacts, c.limits.maxFacts, 'MISSING_FACTS');
    stringArray(frame.evidence?.unsupportedFacts, c.limits.maxFacts, 'UNSUPPORTED_FACTS');
    assert(frame.evidence.requiredFacts.every(item => c.evidenceFactTypes.includes(item)), 'UNKNOWN_REQUIRED_FACT');
    assert(Array.isArray(frame.evidence?.facts) && frame.evidence.facts.length <= c.limits.maxFacts, 'FACTS');
    const facts = new Map();
    for (const fact of frame.evidence.facts) {
        assert(c.evidenceFactTypes.includes(fact?.factType), 'UNKNOWN_FACT');
        known(fact.state, c.factStates, 'FACT_STATE');
        assert(!facts.has(fact.factType), 'DUPLICATE_FACT');
        facts.set(fact.factType, fact);
        if (fact.canonicalIds != null) assert(Array.isArray(fact.canonicalIds) && fact.canonicalIds.length <= c.limits.maxCandidates
            && fact.canonicalIds.every(id => Number.isSafeInteger(id) && id > 0), 'FACT_CANONICAL_IDS');
    }
    for (const factType of frame.evidence.requiredFacts) assert(facts.has(factType), 'REQUIRED_FACT_STATE_MISSING');
    for (const factType of frame.evidence.verifiedFacts) assert(facts.get(factType)?.state === 'VERIFIED', 'VERIFIED_FACT_MISMATCH');
    for (const factType of frame.evidence.missingFacts) assert(facts.get(factType)?.state === 'MISSING', 'MISSING_FACT_MISMATCH');
    for (const factType of frame.evidence.unsupportedFacts) assert(facts.get(factType)?.state === 'UNSUPPORTED', 'UNSUPPORTED_FACT_MISMATCH');
    known(frame.completeness?.status, c.completenessStates, 'COMPLETENESS_STATUS');
    stringArray(frame.completeness?.blockers, c.limits.maxFacts, 'BLOCKERS');
    if (frame.completeness.status === 'COMPLETE') {
        assert(frame.evidence.missingFacts.length === 0, 'COMPLETE_WITH_MISSING_FACT');
        assert(frame.evidence.requiredFacts.every(item => facts.get(item)?.state === 'VERIFIED'), 'COMPLETE_WITH_UNVERIFIED_FACT');
        assert(frame.override.supportStatus !== 'AMBIGUOUS_OVERRIDE', 'COMPLETE_WITH_AMBIGUOUS_OVERRIDE');
    }
    if (frame.completeness.status === 'NOT_FOUND_VERIFIED') {
        assert(frame.subject.resolutionStatus === 'NOT_FOUND', 'NOT_FOUND_STATUS_MISMATCH');
        assert(facts.get('CROSS_CATALOG_CANDIDATES')?.state === 'VERIFIED', 'NOT_FOUND_SCOPE_UNVERIFIED');
    }
    assert(frame.obligations && typeof frame.obligations === 'object', 'OBLIGATIONS');
    for (const field of ['requiredDisclosures', 'requiredClarifications', 'forbiddenClaims']) {
        const values = frame.obligations[field];
        stringArray(values, c.answerObligations.length, `OBLIGATIONS_${field}`);
        assert(values.every(item => c.answerObligations.includes(item)), `UNKNOWN_OBLIGATION_${field}`);
    }
    assert(Array.isArray(frame.provenance?.sources) && frame.provenance.sources.length <= c.limits.maxSources, 'PROVENANCE_SOURCES');
    assert(frame.provenance.sources.every(source => typeof source?.capability === 'string' && typeof source?.method === 'string'
        && typeof source?.path === 'string' && source.path.length <= 240), 'PROVENANCE_SOURCE');
    assert(Buffer.byteLength(JSON.stringify(frame)) <= c.limits.maxPayloadBytes, 'PAYLOAD_TOO_LARGE');
    return true;
}

module.exports = { validateBusinessSemanticFrame };
