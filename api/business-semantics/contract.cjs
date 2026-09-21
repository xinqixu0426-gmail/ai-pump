'use strict';

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    return value;
}

const BusinessSemanticFrameVersion = 1;
const ShadowFlag = 'AI_BUSINESS_SEMANTIC_SHADOW_ENABLED';
const QuestionKinds = ['COST_QUERY', 'INVENTORY_QUERY', 'CONFIGURATION_OVERRIDE', 'HYPOTHETICAL_COST_QUERY', 'CATALOG_LOOKUP', 'OUT_OF_SCOPE'];
const SubjectTypes = ['recipe', 'coil', 'part', 'template', 'unknown'];
const ResolutionStatuses = ['UNRESOLVED', 'UNIQUE', 'AMBIGUOUS', 'NOT_FOUND', 'CROSS_CATALOG_CANDIDATE', 'ALIAS_UNRESOLVED'];
const AmbiguityStatuses = ['NONE', 'MULTIPLE_OFFICIAL_VARIANTS', 'UNRESOLVED_IDENTITY'];
const CostBasisTypes = ['MACHINE_CURRENT_FULL_COST', 'RECIPE_SAVED_COST', 'PART_CATALOG_UNIT_COST', 'COIL_SCHEME_COST', 'UNKNOWN_COST_BASIS'];
const PriceContextTypes = ['CURRENT_FORMAL_PRICE', 'USER_HYPOTHETICAL_PRICE', 'HISTORICAL_PRICE', 'UNKNOWN'];
const CalculationSupport = ['SUPPORTED', 'UNSUPPORTED', 'UNKNOWN', 'NOT_APPLICABLE'];
const OverrideStates = ['NO_OVERRIDE', 'SUPPORTED_OVERRIDE', 'AMBIGUOUS_OVERRIDE', 'UNSUPPORTED_OVERRIDE', 'MISSING_BASE'];
const FactStates = ['VERIFIED', 'MISSING', 'UNSUPPORTED', 'AMBIGUOUS', 'NOT_APPLICABLE'];
const CompletenessStates = ['COMPLETE', 'NEEDS_EVIDENCE', 'NEEDS_CLARIFICATION', 'UNSUPPORTED_REQUEST', 'PARTIAL_VERIFIED', 'NOT_FOUND_VERIFIED'];
const EvidenceFactTypes = [
    'RECIPE_CANONICAL_IDENTITY', 'RECIPE_CURRENT_FULL_COST', 'RECIPE_BASE_CONFIGURATION',
    'COIL_CANONICAL_IDENTITY', 'COIL_OFFICIAL_VARIANT_SET', 'COIL_SCHEME_COST', 'COIL_VARIANT_INVENTORY',
    'COIL_OVERRIDE_APPLIED',
    'PART_CATALOG_IDENTITY', 'PART_CATALOG_UNIT_COST', 'CURRENT_COPPER_PRICE_BASIS', 'CROSS_CATALOG_CANDIDATES',
];
const AnswerObligations = [
    'DISCLOSE_MULTIPLE_VARIANTS', 'DISCLOSE_COST_BASIS', 'DISCLOSE_UNSUPPORTED_HYPOTHETICAL',
    'DISCLOSE_CURRENT_PRICE_BASIS', 'DISCLOSE_CROSS_CATALOG_CANDIDATE', 'DISCLOSE_INCOMPLETE_CONFIGURATION',
    'CLARIFY_VARIANT_SELECTION', 'CLARIFY_IDENTITY', 'MUST_NOT_CLAIM_COMPLETE', 'MUST_NOT_SELECT_VARIANT',
    'MUST_NOT_PRESENT_HYPOTHETICAL_AS_FORMAL', 'MUST_NOT_PRESENT_PART_PRICE_AS_MACHINE_COST', 'MUST_NOT_GUESS_PARAMETER',
];

const BusinessSemanticFrameV1 = deepFreeze({
    version: BusinessSemanticFrameVersion,
    shadowFlag: ShadowFlag,
    questionKinds: QuestionKinds,
    subjectTypes: SubjectTypes,
    resolutionStatuses: ResolutionStatuses,
    ambiguityStatuses: AmbiguityStatuses,
    costBasisTypes: CostBasisTypes,
    priceContextTypes: PriceContextTypes,
    calculationSupport: CalculationSupport,
    overrideStates: OverrideStates,
    factStates: FactStates,
    evidenceFactTypes: EvidenceFactTypes,
    completenessStates: CompletenessStates,
    answerObligations: AnswerObligations,
    limits: { maxFacts: 24, maxSources: 24, maxCandidates: 12, maxPayloadBytes: 32768 },
});

module.exports = { AnswerObligations, AmbiguityStatuses, BusinessSemanticFrameV1, BusinessSemanticFrameVersion,
    CalculationSupport, CompletenessStates, CostBasisTypes, EvidenceFactTypes, FactStates, OverrideStates,
    PriceContextTypes, QuestionKinds, ResolutionStatuses, ShadowFlag, SubjectTypes, deepFreeze };
