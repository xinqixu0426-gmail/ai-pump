'use strict';

const { projectAnswerAgainstFrame } = require('./answerProjection.cjs');

const CompletenessEnforcementPolicy = Object.freeze({
    COMPLETE: { conclusionAllowed: true, fallback: 'VERIFIED_CONCLUSION' },
    NOT_FOUND_VERIFIED: { conclusionAllowed: true, fallback: 'VERIFIED_NOT_FOUND' },
    NEEDS_CLARIFICATION: { conclusionAllowed: false, fallback: 'CLARIFICATION_REQUIRED' },
    UNSUPPORTED_REQUEST: { conclusionAllowed: false, fallback: 'UNSUPPORTED_REQUEST' },
    NEEDS_EVIDENCE: { conclusionAllowed: false, fallback: 'EVIDENCE_NEEDED' },
    PARTIAL_VERIFIED: { conclusionAllowed: false, fallback: 'PARTIAL_VERIFIED' },
});

function enforcementDecision(frame, answer) {
    const policy = CompletenessEnforcementPolicy[frame?.completeness?.status] || CompletenessEnforcementPolicy.NEEDS_EVIDENCE;
    const projection = projectAnswerAgainstFrame(frame, answer);
    return { ...policy, status: frame?.completeness?.status || 'NEEDS_EVIDENCE', violations: projection.violations,
        replace: !policy.conclusionAllowed || projection.detected };
}

module.exports = { CompletenessEnforcementPolicy, enforcementDecision };
