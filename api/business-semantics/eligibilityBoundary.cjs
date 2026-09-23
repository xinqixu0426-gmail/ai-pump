'use strict';

const { deepFreeze } = require('./contract.cjs');
const { classifyQuestion } = require('./questionSemantics.cjs');

const SemanticEligibilityBoundaryV1 = deepFreeze({
    version: 1,
    authorities: ['BUSINESS_SEMANTIC_V1', 'LEGACY'],
    decisions: ['ELIGIBLE_SUPPORTED_BUSINESS_REQUEST', 'OUT_OF_SCOPE'],
    supportedKinds: ['COST_QUERY', 'INVENTORY_QUERY', 'CONFIGURATION_OVERRIDE', 'HYPOTHETICAL_COST_QUERY', 'CATALOG_LOOKUP'],
    reasonCodes: [
        'SUPPORTED_COST_INTENT', 'SUPPORTED_INVENTORY_INTENT', 'SUPPORTED_CONFIGURATION_OVERRIDE',
        'SUPPORTED_HYPOTHETICAL_COST', 'SUPPORTED_CATALOG_LOOKUP', 'TRUSTED_SUPPORTED_PAGE_CONTEXT',
        'PROTECTED_WRITE_ROUTE', 'NO_SUPPORTED_BUSINESS_SIGNAL',
    ],
    limits: { maxSignals: 8, maxReasonLength: 64 },
});

const REASONS = Object.freeze({
    COST_QUERY: 'SUPPORTED_COST_INTENT',
    INVENTORY_QUERY: 'SUPPORTED_INVENTORY_INTENT',
    CONFIGURATION_OVERRIDE: 'SUPPORTED_CONFIGURATION_OVERRIDE',
    HYPOTHETICAL_COST_QUERY: 'SUPPORTED_HYPOTHETICAL_COST',
    CATALOG_LOOKUP: 'SUPPORTED_CATALOG_LOOKUP',
});
const SUPPORTED_TRUSTED_CONTEXT_TYPES = new Set(['recipe', 'coil', 'part', 'template']);

function supportedTrustedPageContext(value) {
    return Boolean(value?.trusted === true
        && SUPPORTED_TRUSTED_CONTEXT_TYPES.has(value.resourceType)
        && Number.isSafeInteger(Number(value.resourceId))
        && Number(value.resourceId) > 0);
}

function semanticEligibility(input = {}) {
    if (input.protectedWriteRoute === true) return deepFreeze({
        version: 1, eligible: false, kind: 'OUT_OF_SCOPE', reason: 'PROTECTED_WRITE_ROUTE', signals: [], authority: 'LEGACY',
    });
    const trustedContext = supportedTrustedPageContext(input.trustedPageContext);
    const semantics = classifyQuestion(input.userText, { admittedCatalogLookup: trustedContext });
    if (semantics.kind === 'OUT_OF_SCOPE') return deepFreeze({
        version: 1, eligible: false, kind: 'OUT_OF_SCOPE', reason: 'NO_SUPPORTED_BUSINESS_SIGNAL',
        signals: semantics.admissionSignals.slice(0, SemanticEligibilityBoundaryV1.limits.maxSignals), authority: 'LEGACY',
    });
    return deepFreeze({
        version: 1, eligible: true, kind: semantics.kind, operation: semantics.operation,
        reason: trustedContext && semantics.admissionSignals.length === 0 ? 'TRUSTED_SUPPORTED_PAGE_CONTEXT' : REASONS[semantics.kind],
        signals: [...semantics.admissionSignals, ...(trustedContext ? ['TRUSTED_SUPPORTED_PAGE_CONTEXT'] : [])]
            .slice(0, SemanticEligibilityBoundaryV1.limits.maxSignals),
        authority: 'BUSINESS_SEMANTIC_V1',
    });
}

module.exports = { SemanticEligibilityBoundaryV1, semanticEligibility, supportedTrustedPageContext };
