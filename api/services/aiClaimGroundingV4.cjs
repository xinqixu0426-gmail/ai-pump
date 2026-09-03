const { factIdentityKey } = require('./aiFactModelV4.cjs');
const {
    isCurrentInventoryQuantityIdentity,
    materializeNumericBusinessScalarFact,
} = require('./aiNumericScalarFactsV4.cjs');

const CLAIM_TYPES = new Set([
    'entity_identity',
    'scalar_value',
    'status',
    'relationship',
    'verified_not_found',
    'ambiguous',
    'unavailable',
]);

const EVIDENCE_REQUIRED_CLAIM_TYPES = new Set([
    'entity_identity',
    'scalar_value',
    'status',
    'relationship',
    'verified_not_found',
]);

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function immutable(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(immutable));
    if (!value || typeof value !== 'object') return value;
    return Object.freeze(Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, immutable(nested)])
    ));
}

function sameValue(left, right) {
    return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function normalizeSubject(subject = {}) {
    const entityType = String(subject.entityType || '').trim();
    if (!entityType) throw new TypeError('Claim subject 需要 entityType');
    return immutable({
        entityType,
        entityId: subject.entityId === undefined || subject.entityId === null
            ? null
            : String(subject.entityId),
        canonicalName: String(subject.canonicalName || '').trim() || null,
    });
}

function claimIdentityKey(input = {}) {
    const subject = normalizeSubject(input.subject);
    return JSON.stringify(stableValue({
        subject: { entityType: subject.entityType, entityId: subject.entityId },
        predicate: String(input.predicate || '').trim(),
        temporalScope: String(input.temporalScope || '').trim(),
        scenario: String(input.scenario || '').trim(),
        qualifiers: input.qualifiers || {},
    }));
}

function createClaim(input = {}) {
    const claimType = String(input.claimType || '').trim();
    if (!CLAIM_TYPES.has(claimType)) throw new TypeError(`未知 ClaimType: ${claimType}`);
    const subject = normalizeSubject(input.subject);
    const predicate = String(input.predicate || '').trim();
    const temporalScope = String(input.temporalScope || '').trim();
    const scenario = String(input.scenario || '').trim();
    if (!predicate || !temporalScope || !scenario) {
        throw new TypeError('Claim 需要 predicate、temporalScope 和 scenario');
    }
    const claim = {
        claimId: String(input.claimId || '').trim() || null,
        claimType,
        factKey: String(input.factKey || '').trim() || null,
        subject,
        predicate,
        value: input.value === undefined ? null : input.value,
        unit: input.unit === undefined ? null : input.unit,
        temporalScope,
        scenario,
        qualifiers: stableValue(input.qualifiers || {}),
        evidenceRefs: [...new Set(input.evidenceRefs || [])],
        premiseClaimRefs: [...new Set(input.premiseClaimRefs || [])],
        observationRefs: [...new Set(input.observationRefs || [])],
        stateRef: input.stateRef || null,
        certainty: input.certainty || 'verified',
        presentationPolicy: input.presentationPolicy || 'direct',
    };
    claim.claimIdentity = claimIdentityKey(claim);
    return immutable(claim);
}

function getPath(source, path) {
    return String(path || '').split('.').filter(Boolean).reduce((value, key) => (
        value === undefined || value === null ? undefined : value[key]
    ), source);
}

function unwrapResult(evidence = {}) {
    const result = evidence.toolResult?.result || evidence.toolResult || {};
    return result?.formalResult || result;
}

function resultRows(result = {}) {
    for (const key of ['data', 'items', 'parts', 'templates', 'recipes', 'coils']) {
        if (Array.isArray(result?.[key])) return result[key];
    }
    for (const key of ['recipe', 'template', 'coil', 'part']) {
        if (result?.[key] && typeof result[key] === 'object') return [result[key]];
    }
    if (result?.data && typeof result.data === 'object') return [result.data];
    return result && typeof result === 'object' ? [result] : [];
}

function rowEntityId(row = {}) {
    return row.id ?? row.Id ?? row.partId ?? row.coilId ?? row.templateId ?? row.recipeId ?? null;
}

function selectEntityRow(result, identity = {}) {
    const rows = resultRows(result);
    if (rows.length === 0) return null;
    if (identity.entityId === null || identity.entityId === undefined) return rows[0];
    return rows.find(row => String(rowEntityId(row) ?? '') === String(identity.entityId)) || null;
}

function canonicalName(row = {}, result = {}) {
    return row.model || row.shellModel || row.name || row.recipeName || row.schemeCode
        || result.model || result.shellModel || result.name || result.recipeName
        || result.data?.model || result.data?.shellModel || result.data?.name || result.data?.recipeName
        || null;
}

function finiteValue(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function scalarFromEvidence(requirement, evidence) {
    if (isCurrentInventoryQuantityIdentity(requirement.identity)) {
        const fact = materializeNumericBusinessScalarFact(requirement, evidence);
        return fact
            ? { value: fact.numericValue, predicate: fact.predicate, unit: fact.unit }
            : { value: null, predicate: requirement.identity.predicate, unit: null };
    }
    const result = unwrapResult(evidence);
    const data = result.data && !Array.isArray(result.data) ? result.data : result;
    const row = selectEntityRow(result, requirement.identity) || data;
    const explicitPath = requirement.identity.qualifiers?.valuePath;
    if (explicitPath) {
        const value = getPath(result, explicitPath);
        return { value, predicate: requirement.identity.predicate, unit: requirement.identity.qualifiers?.unit || null };
    }
    const byScenario = {
        catalog_current: [row?.price, row?.unitPrice, row?.currentPrice],
        coil_current: [row?.stock, row?.currentStock, row?.inventory],
        current_template_cost: [data?.shellPrice, data?.costPreview?.currentTotalCost, data?.currentTotalCost],
        current_coil_cost: [data?.totalCost, data?.currentTotalCost],
        current_full_cost: [data?.costPreview?.currentTotalCost, data?.currentTotalCost, data?.totalCost],
        current_recipe_cost: [data?.currentTotalCost],
        saved_recipe_snapshot: [result?.recipe?.savedTotalCost, data?.savedTotalCost, row?.savedTotalCost],
    };
    const candidates = byScenario[requirement.identity.scenario] || [];
    const value = candidates.map(finiteValue).find(item => item !== null);
    let predicate = requirement.identity.predicate;
    if (requirement.identity.scenario === 'catalog_current') predicate = 'price.current';
    if (requirement.identity.scenario === 'coil_current') predicate = 'inventory.current';
    if (requirement.identity.scenario === 'current_recipe_cost') predicate = 'cost.current.recipe';
    if (requirement.identity.scenario === 'current_template_cost') predicate = 'cost.current.template';
    if (requirement.identity.scenario === 'current_coil_cost') predicate = 'cost.current.coil';
    if (requirement.identity.scenario === 'current_full_cost') predicate = 'cost.current.full';
    if (requirement.identity.scenario === 'saved_recipe_snapshot') predicate = 'cost.saved.snapshot';
    const monetary = /cost|price/.test(predicate);
    return {
        value,
        predicate,
        unit: requirement.identity.qualifiers?.unit || (monetary ? 'CNY' : null),
    };
}

function claimTypeForRequirement(requirement) {
    const explicit = requirement.identity.qualifiers?.claimType;
    if (CLAIM_TYPES.has(explicit)) return explicit;
    return {
        entityIdentity: 'entity_identity',
        currentScalar: 'scalar_value',
        inventoryQuantity: 'scalar_value',
        currentRecipeCost: 'scalar_value',
        savedRecipeCostSnapshot: 'scalar_value',
        unit: 'scalar_value',
        currentStatus: 'status',
        singleResourceDetail: 'relationship',
        verifiedNotFound: 'verified_not_found',
        ambiguity: 'ambiguous',
    }[requirement.identity.predicate] || null;
}

function evidenceForRequirement(requirement, evidenceLedger = []) {
    const ids = new Set(requirement.evidenceIds || []);
    return [...evidenceLedger].reverse().find(item => (
        item?.recordType === 'evidence'
        && item.factKey === requirement.factKey
        && (ids.size === 0 || ids.has(item.evidenceId))
    )) || null;
}

function ambiguityObservationsForRequirement(requirement, observations = []) {
    return observations.filter(observation => (
        observation?.outcome === 'ambiguous'
        && (
            observation.factKey === requirement.factKey
            || (observation.result?.resolutionReceipts || []).some(receipt => (
                receipt?.entityType === requirement.identity.entityType
            ))
        )
    ));
}

function candidatesForRequirement(requirement, observations = []) {
    const candidates = [];
    for (const observation of ambiguityObservationsForRequirement(requirement, observations)) {
        const receipts = [
            observation.result?.resolutionReceipt,
            ...(observation.result?.resolutionReceipts || []),
        ].filter(Boolean);
        for (const receipt of receipts) {
            for (const candidate of receipt.candidates || receipt.matches || []) {
                candidates.push({
                    entityType: candidate.entityType || receipt.entityType || requirement.identity.entityType,
                    entityId: candidate.id ?? candidate.entityId ?? null,
                    canonicalName: candidate.name || candidate.model || candidate.shellModel || null,
                });
            }
            if (receipt.selected) {
                candidates.push({
                    entityType: receipt.entityType || requirement.identity.entityType,
                    entityId: receipt.selected.id ?? null,
                    canonicalName: receipt.selected.name || receipt.selected.model || receipt.selected.shellModel || null,
                });
            }
        }
    }
    return [...new Map(candidates.map(item => [JSON.stringify(item), item])).values()];
}

function claimFromEvidence(requirement, evidence, claimId, numericFact = null) {
    const ambiguityProbeSatisfied = requirement.status === 'negative_satisfied'
        && requirement.identity.predicate === 'ambiguity';
    const claimType = ambiguityProbeSatisfied ? 'status' : claimTypeForRequirement(requirement);
    if (!claimType || !evidence) return null;
    const result = unwrapResult(evidence);
    const selectedRow = selectEntityRow(result, requirement.identity);
    if (claimType !== 'verified_not_found'
        && requirement.identity.entityId !== null
        && !selectedRow) return null;
    const row = selectedRow || {};
    const subject = {
        entityType: requirement.identity.entityType,
        entityId: requirement.identity.entityId ?? row.id ?? row.Id ?? null,
        canonicalName: canonicalName(row, result),
    };
    let value = null;
    let unit = requirement.identity.qualifiers?.unit || null;
    let predicate = requirement.identity.predicate;
    if (claimType === 'scalar_value') {
        const scalar = numericFact
            ? {
                value: numericFact.numericValue,
                predicate: numericFact.predicate,
                unit: numericFact.unit,
            }
            : scalarFromEvidence(requirement, evidence);
        if (scalar.value === null || scalar.value === undefined) return null;
        ({ value, unit, predicate } = scalar);
    } else if (claimType === 'entity_identity') {
        value = subject.canonicalName || subject.entityId;
        if (value === null) return null;
    } else if (claimType === 'status') {
        value = ambiguityProbeSatisfied
            ? 'no_competing_entity_match'
            : requirement.identity.scenario === 'current_inventory'
                ? row.inventoryStatus ?? row.stockStatus ?? null
                : getPath(result, requirement.identity.qualifiers?.valuePath)
                    ?? row.schemeStatus ?? row.status ?? row.stockStatus ?? null;
        if (value === null) return null;
    } else if (claimType === 'relationship') {
        value = getPath(result, requirement.identity.qualifiers?.valuePath) ?? row;
        if (!value || (typeof value === 'object' && Object.keys(value).length === 0)) return null;
    } else if (claimType === 'verified_not_found') {
        if (evidence.kind !== 'verified_negative') return null;
        value = true;
    }
    return createClaim({
        claimId,
        claimType,
        factKey: requirement.factKey,
        subject,
        predicate: ambiguityProbeSatisfied ? 'entity_match.disambiguated' : predicate,
        value,
        unit,
        temporalScope: requirement.identity.temporalScope,
        scenario: requirement.identity.scenario,
        qualifiers: requirement.identity.qualifiers,
        evidenceRefs: [evidence.evidenceId],
        certainty: 'verified',
        presentationPolicy: ambiguityProbeSatisfied
            ? 'internal_support'
            : claimType === 'relationship' ? 'summary_only' : 'direct',
    });
}

function buildClaimsFromInvestigation(input = {}) {
    const state = input.state || input.investigationState;
    const evidenceLedger = input.evidenceLedger || [];
    const observations = input.observations || state?.observations || [];
    if (!state) throw new TypeError('Claim Builder 需要 terminal InvestigationState');
    const terminalStateRef = `investigation:${state.goalId || 'unknown'}:${state.status}`;
    const claims = [];
    let sequence = 0;
    for (const requirement of state.requirements || []) {
        if (requirement.optional && requirement.status === 'optional_skipped') continue;
        sequence += 1;
        const claimId = `claim-${sequence}`;
        if (requirement.status === 'satisfied' || requirement.status === 'negative_satisfied') {
            const numericFact = (state.numericFacts || []).find(item => (
                item.factKey === requirement.factKey
                && item.evidenceRefs.some(ref => requirement.evidenceIds.includes(ref))
            )) || null;
            const claim = claimFromEvidence(
                requirement,
                evidenceForRequirement(requirement, evidenceLedger),
                claimId,
                numericFact
            );
            if (claim) claims.push(claim);
            continue;
        }
        if (requirement.status === 'needs_clarification') {
            const matchingObservations = ambiguityObservationsForRequirement(requirement, observations);
            claims.push(createClaim({
                claimId,
                claimType: 'ambiguous',
                factKey: requirement.factKey,
                subject: { entityType: requirement.identity.entityType, entityId: requirement.identity.entityId },
                predicate: requirement.identity.predicate,
                value: candidatesForRequirement(requirement, observations),
                temporalScope: requirement.identity.temporalScope,
                scenario: requirement.identity.scenario,
                qualifiers: requirement.identity.qualifiers,
                observationRefs: matchingObservations.map(item => item.observationId).filter(Boolean),
                certainty: 'ambiguous',
                presentationPolicy: 'clarification',
            }));
            continue;
        }
        if (requirement.status === 'unavailable'
            || (requirement.status === 'open' && ['failed_unverified', 'budget_exhausted'].includes(state.status))) {
            claims.push(createClaim({
                claimId,
                claimType: 'unavailable',
                factKey: requirement.factKey,
                subject: { entityType: requirement.identity.entityType, entityId: requirement.identity.entityId },
                predicate: requirement.identity.predicate,
                value: { reason: requirement.reason || state.status },
                temporalScope: requirement.identity.temporalScope,
                scenario: requirement.identity.scenario,
                qualifiers: requirement.identity.qualifiers,
                observationRefs: requirement.observationIds,
                stateRef: terminalStateRef,
                certainty: 'unverified',
                presentationPolicy: 'unavailable',
            }));
        }
    }
    return immutable(claims);
}

function validateClaimAgainstEvidence(claim, context = {}) {
    const requirement = (context.requirements || []).find(item => item.factKey === claim.factKey);
    if (!requirement) return { valid: false, code: 'CLAIM_FACT_UNKNOWN' };
    if (claim.claimIdentity !== claimIdentityKey(claim)) {
        return { valid: false, code: 'CLAIM_IDENTITY_MISMATCH' };
    }
    const expectedFactKey = factIdentityKey(requirement.identity);
    if (expectedFactKey !== claim.factKey) return { valid: false, code: 'CLAIM_FACT_SCOPE_MISMATCH' };
    if (claim.subject.entityType !== requirement.identity.entityType
        || (requirement.identity.entityId !== null
            && String(claim.subject.entityId) !== String(requirement.identity.entityId))
        || claim.temporalScope !== requirement.identity.temporalScope
        || claim.scenario !== requirement.identity.scenario) {
        return { valid: false, code: 'CLAIM_SCOPE_MISMATCH' };
    }
    if (!sameValue(claim.qualifiers, requirement.identity.qualifiers)) {
        return { valid: false, code: 'CLAIM_QUALIFIERS_MISMATCH' };
    }
    if (claim.claimType === 'ambiguous') {
        const observations = context.observations || context.state?.observations || [];
        const matching = observations.filter(item => (
            item?.factKey === claim.factKey
            && item.outcome === 'ambiguous'
            && claim.observationRefs.includes(item.observationId)
        ));
        const expectedCandidates = candidatesForRequirement(requirement, matching);
        if (requirement.status !== 'needs_clarification'
            || matching.length === 0
            || !sameValue(claim.value, expectedCandidates)) {
            return { valid: false, code: 'CLAIM_AMBIGUITY_PROVENANCE_MISMATCH' };
        }
        return { valid: true };
    }
    if (claim.claimType === 'unavailable') {
        const observations = context.observations || context.state?.observations || [];
        const unavailableOutcomes = new Set([
            'timeout',
            'transport_failure',
            'protocol_failure',
            'cancelled',
            'business_rule_rejected',
        ]);
        const matchingObservations = observations.filter(item => (
            item?.factKey === claim.factKey
            && claim.observationRefs.includes(item.observationId)
            && unavailableOutcomes.has(item.outcome)
        ));
        const expectedStateRef = `investigation:${context.state?.goalId || 'unknown'}:${context.state?.status}`;
        const hasStateProvenance = claim.stateRef === expectedStateRef
            && ['failed_unverified', 'budget_exhausted'].includes(context.state?.status);
        const stateAllowsUnavailable = requirement.status === 'unavailable'
            || (requirement.status === 'open'
                && ['failed_unverified', 'budget_exhausted'].includes(context.state?.status));
        const expectedReason = requirement.reason || context.state?.status;
        if (!stateAllowsUnavailable
            || claim.evidenceRefs.length > 0
            || claim.certainty !== 'unverified'
            || (matchingObservations.length === 0 && !hasStateProvenance)
            || claim.value?.reason !== expectedReason) {
            return { valid: false, code: 'CLAIM_AVAILABILITY_PROVENANCE_MISMATCH' };
        }
        return { valid: true };
    }
    if (!EVIDENCE_REQUIRED_CLAIM_TYPES.has(claim.claimType)) return { valid: false, code: 'CLAIM_TYPE_UNVALIDATED' };
    if (claim.evidenceRefs.length === 0) return { valid: false, code: 'CLAIM_EVIDENCE_REQUIRED' };
    const evidenceById = new Map((context.evidenceLedger || []).map(item => [item.evidenceId, item]));
    const evidenceRecords = claim.evidenceRefs.map(ref => evidenceById.get(ref));
    if (evidenceRecords.some(evidence => !evidence || evidence.factKey !== claim.factKey)) {
        return { valid: false, code: 'CLAIM_EVIDENCE_SCOPE_MISMATCH' };
    }
    for (const evidence of evidenceRecords) {
        const expected = claimFromEvidence(requirement, evidence, claim.claimId);
        if (!expected) return { valid: false, code: 'CLAIM_NOT_SUPPORTED_BY_EVIDENCE' };
        for (const field of ['claimType', 'subject', 'predicate', 'value', 'unit', 'temporalScope', 'scenario']) {
            if (!sameValue(claim[field], expected[field])) {
                return { valid: false, code: `CLAIM_${field.toUpperCase()}_MISMATCH` };
            }
        }
    }
    return { valid: true };
}

function validateClaims(claims, context = {}) {
    const errors = [];
    for (const claim of claims || []) {
        const result = validateClaimAgainstEvidence(claim, context);
        if (!result.valid) errors.push({ claimId: claim.claimId, ...result });
    }
    return immutable({ valid: errors.length === 0, errors });
}

function requiredFactCoverage(requirements = [], claims = []) {
    const coveredFactKeys = new Set(claims.map(claim => claim.factKey));
    const missingFactKeys = requirements
        .filter(item => !item.optional && item.status !== 'optional_skipped')
        .filter(item => !coveredFactKeys.has(item.factKey))
        .map(item => item.factKey);
    return immutable({ complete: missingFactKeys.length === 0, missingFactKeys });
}

module.exports = {
    CLAIM_TYPES,
    EVIDENCE_REQUIRED_CLAIM_TYPES,
    buildClaimsFromInvestigation,
    claimIdentityKey,
    createClaim,
    requiredFactCoverage,
    validateClaimAgainstEvidence,
    validateClaims,
};
