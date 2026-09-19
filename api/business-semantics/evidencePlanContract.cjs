'use strict';

const { deepFreeze, EvidenceFactTypes, QuestionKinds } = require('./contract.cjs');

const BusinessEvidencePlanVersion = 1;
const EnforcementFlag = 'AI_BUSINESS_SEMANTIC_ENFORCEMENT_CANARY_ENABLED';
const MAX_SEMANTIC_EVIDENCE_CALLS = 3;
const ArgumentProvenance = Object.freeze([
    'CANONICAL_SUBJECT_ID', 'VERIFIED_PRIOR_FACT', 'USER_EXPLICIT_VALUE',
    'TRUSTED_PAGE_CONTEXT', 'FORMAL_VARIANT_CANDIDATE',
]);
const RequirementStatuses = Object.freeze(['SATISFIED', 'MISSING', 'AMBIGUOUS', 'UNAVAILABLE_CAPABILITY', 'NOT_APPLICABLE']);

const BusinessEvidencePlanV1 = deepFreeze({
    version: BusinessEvidencePlanVersion,
    enforcementFlag: EnforcementFlag,
    questionKinds: QuestionKinds.filter(kind => kind !== 'OUT_OF_SCOPE'),
    factTypes: EvidenceFactTypes,
    argumentProvenance: ArgumentProvenance,
    requirementStatuses: RequirementStatuses,
    limits: { maxCalls: MAX_SEMANTIC_EVIDENCE_CALLS, maxPayloadBytes: 16384 },
});

module.exports = { ArgumentProvenance, BusinessEvidencePlanV1, BusinessEvidencePlanVersion,
    EnforcementFlag, MAX_SEMANTIC_EVIDENCE_CALLS, RequirementStatuses };
