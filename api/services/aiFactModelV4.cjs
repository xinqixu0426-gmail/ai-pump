const FACT_REQUIREMENT_STATUSES = new Set([
    'open',
    'satisfied',
    'negative_satisfied',
    'needs_clarification',
    'unavailable',
    'optional_skipped',
]);

const INVESTIGATION_STATUSES = new Set([
    'running',
    'needs_clarification',
    'completed',
    'completed_negative',
    'failed_unverified',
    'budget_exhausted',
]);

const ENTITY_BINDING_STATUSES = new Set(['resolved']);
const {
    normalizeStableEntityIdentity,
    stableEntityIdentityComparison,
} = require('./aiStableEntityIdentityV4.cjs');

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

function normalizeFactIdentity(input = {}) {
    const entityType = String(input.entityType || '').trim() || null;
    const entityId = input.entityId === undefined || input.entityId === null
        ? null
        : String(input.entityId).trim() || null;
    const predicate = String(input.predicate || '').trim();
    const temporalScope = String(input.temporalScope || 'current').trim();
    const scenario = String(input.scenario || 'default').trim();
    if (!entityType || !predicate || !temporalScope || !scenario) {
        throw new TypeError('FactIdentity 需要 entityType、predicate、temporalScope 和 scenario');
    }
    const stableEntityIdentity = input.stableEntityIdentity
        ? normalizeStableEntityIdentity(input.stableEntityIdentity)
        : null;
    if (stableEntityIdentity && stableEntityIdentity.entityType !== entityType) {
        throw new TypeError('FactIdentity stable entity type 冲突');
    }
    if (stableEntityIdentity
        && stableEntityIdentity.primaryStableId !== null
        && entityId !== null
        && stableEntityIdentity.primaryStableId !== entityId) {
        throw new TypeError('FactIdentity stable primary id 冲突');
    }
    return immutable({
        entityType,
        entityId,
        stableEntityIdentity,
        predicate,
        temporalScope,
        scenario,
        qualifiers: stableValue(input.qualifiers || {}),
    });
}

function factIdentityKey(identity) {
    const normalized = normalizeFactIdentity(identity);
    return JSON.stringify(normalized);
}

function createFactRequirement(input = {}) {
    const identity = normalizeFactIdentity(input.identity || input);
    const status = input.status || 'open';
    if (!FACT_REQUIREMENT_STATUSES.has(status)) {
        throw new TypeError(`未知 FactRequirement status: ${status}`);
    }
    const factKey = factIdentityKey(identity);
    return immutable({
        requirementId: input.requirementId || `fact:${factKey}`,
        factKey,
        identity,
        status,
        optional: Boolean(input.optional),
        acceptedEvidenceKinds: [...new Set(input.acceptedEvidenceKinds || [
            'live_business',
            'verified_negative',
        ])],
        requiredAuthority: input.requiredAuthority || null,
        requiredSourceOfTruth: input.requiredSourceOfTruth || null,
        evidenceIds: [...new Set(input.evidenceIds || [])],
        observationIds: [...new Set(input.observationIds || [])],
        reason: input.reason || null,
    });
}

function normalizeLogicalTarget(value) {
    return String(value || '').normalize('NFKC').trim().toLowerCase();
}

function createEntityBinding(input = {}) {
    const investigationId = String(input.investigationId || '').trim();
    const entityType = String(input.entityType || '').trim();
    const entityId = input.entityId === undefined || input.entityId === null
        ? ''
        : String(input.entityId).trim();
    const logicalTarget = normalizeLogicalTarget(input.logicalTarget);
    const status = String(input.status || 'resolved').trim();
    if (!investigationId || !entityType || !entityId || !logicalTarget) {
        throw new TypeError('EntityBinding 需要 investigationId、entityType、entityId 和 logicalTarget');
    }
    if (!ENTITY_BINDING_STATUSES.has(status)) {
        throw new TypeError(`未知 EntityBinding status: ${status}`);
    }
    const stableEntityIdentity = normalizeStableEntityIdentity(input.stableEntityIdentity || {
        entityType,
        primaryStableId: entityId,
        canonicalName: input.canonicalName,
    });
    if (!stableEntityIdentity
        || stableEntityIdentity.entityType !== entityType
        || stableEntityIdentityComparison(stableEntityIdentity, {
            entityType,
            primaryStableId: entityId,
        }) !== 'same') {
        throw new TypeError('EntityBinding stable identity 与 entityId 冲突');
    }
    return immutable({
        bindingId: input.bindingId
            || `binding:${investigationId}:${entityType}:${logicalTarget}`,
        investigationId,
        entityType,
        entityId,
        stableEntityIdentity,
        canonicalName: String(input.canonicalName || '').trim() || null,
        logicalTarget,
        originalMention: String(input.originalMention || '').trim() || null,
        status,
        resolutionStatus: input.resolutionStatus || null,
        resolutionReceipt: input.resolutionReceipt || null,
        sourceCapability: input.sourceCapability || null,
        sourceEvidence: input.sourceEvidence || [],
        targetArguments: stableValue(input.targetArguments || {}),
    });
}

function deriveInvestigationStatus(requirements, options = {}) {
    if (options.budgetExhausted && requirements.some(item => item.status === 'open')) {
        return 'budget_exhausted';
    }
    if (requirements.some(item => item.status === 'needs_clarification')) {
        return 'needs_clarification';
    }
    const required = requirements.filter(item => !item.optional);
    if (required.some(item => item.status === 'unavailable')) return 'failed_unverified';
    if (required.some(item => item.status === 'open')) return 'running';
    if (required.length > 0 && required.every(item => item.status === 'negative_satisfied')) {
        return 'completed_negative';
    }
    if (required.every(item => ['satisfied', 'negative_satisfied'].includes(item.status))) {
        return 'completed';
    }
    return 'running';
}

function createInvestigationState(input = {}) {
    const requirements = (input.requirements || []).map(createFactRequirement);
    const status = input.status || deriveInvestigationStatus(requirements, input);
    if (!INVESTIGATION_STATUSES.has(status)) {
        throw new TypeError(`未知 InvestigationState status: ${status}`);
    }
    return immutable({
        goalId: input.goalId || null,
        status,
        requirements,
        entityBindings: (input.entityBindings || []).map(createEntityBinding),
        attemptedCalls: [...(input.attemptedCalls || [])],
        behaviorEvents: [...(input.behaviorEvents || [])],
        observations: [...(input.observations || [])],
        evidenceIds: [...(input.evidenceIds || [])],
        numericFacts: [...(input.numericFacts || [])],
        budget: {
            maxCalls: Number(input.budget?.maxCalls) || 10,
            usedCalls: Number(input.budget?.usedCalls) || 0,
        },
    });
}

function createInvestigationGoal(input = {}) {
    const mode = String(input.mode || '').trim();
    const entityScope = String(input.entityScope || '').trim();
    if (!['query', 'analysis'].includes(mode) || entityScope !== 'single') {
        throw new TypeError('R2 InvestigationGoal 仅支持 query/analysis + single');
    }
    const requirements = (input.requirements || []).map(createFactRequirement);
    if (requirements.length === 0) throw new TypeError('InvestigationGoal 至少需要一个 FactRequirement');
    return immutable({
        goalId: input.goalId || `investigation:${Date.now()}`,
        goal: String(input.goal || '').trim(),
        mode,
        entityScope,
        domains: [...new Set(input.domains || [])],
        originalTarget: input.originalTarget || null,
        requirements,
    });
}

module.exports = {
    ENTITY_BINDING_STATUSES,
    FACT_REQUIREMENT_STATUSES,
    INVESTIGATION_STATUSES,
    createEntityBinding,
    createFactRequirement,
    createInvestigationGoal,
    createInvestigationState,
    deriveInvestigationStatus,
    factIdentityKey,
    normalizeLogicalTarget,
    normalizeFactIdentity,
};
