const {
    createFactRequirement,
    createInvestigationState,
    deriveInvestigationStatus,
} = require('./aiFactModelV4.cjs');

const TECHNICAL_FAILURES = new Set([
    'timeout',
    'transport_failure',
    'protocol_failure',
    'cancelled',
]);

function replaceRequirement(requirement, updates) {
    return createFactRequirement({
        ...requirement,
        ...updates,
        identity: requirement.identity,
    });
}

function rebuildState(state, updates = {}) {
    const requirements = updates.requirements || state.requirements;
    const next = {
        ...state,
        ...updates,
        requirements,
        status: updates.status || deriveInvestigationStatus(requirements, updates),
    };
    return createInvestigationState(next);
}

function recordBehaviorEvent(state, event) {
    if (event?.recordType !== 'behavior_event') {
        throw new TypeError('Fact Reducer 只在 behavior log 记录 BehaviorEvent');
    }
    return rebuildState(state, { behaviorEvents: [...state.behaviorEvents, event] });
}

function recordAttempt(state, input = {}) {
    return rebuildState(state, {
        attemptedCalls: [...state.attemptedCalls, {
            signature: input.signature,
            capabilityName: input.capabilityName,
            requirementId: input.requirementId,
        }],
        budget: {
            ...state.budget,
            usedCalls: state.budget.usedCalls + 1,
        },
    });
}

function bindResolvedEntity(state, requirementId, resolutionReceipt = {}) {
    const selectedId = resolutionReceipt?.selected?.id ?? resolutionReceipt?.selectedId ?? null;
    if (selectedId === null || selectedId === undefined) return state;
    const requirements = state.requirements.map(requirement => (
        requirement.requirementId === requirementId
            ? createFactRequirement({
                ...requirement,
                identity: {
                    ...requirement.identity,
                    entityId: selectedId,
                    qualifiers: Object.fromEntries(Object.entries(requirement.identity.qualifiers)
                        .filter(([key]) => key !== 'targetMention')),
                },
            })
            : requirement
    ));
    return rebuildState(state, { requirements });
}

function markCrossEntityAmbiguity(state, receipts = [], currentRequirementId = null) {
    const selected = receipts.filter(receipt => (
        receipt?.selected && receipt?.entityType && receipt?.originalMention
    ));
    const ambiguousTypes = new Set();
    for (let left = 0; left < selected.length; left += 1) {
        for (let right = left + 1; right < selected.length; right += 1) {
            const sameMention = String(selected[left].originalMention).normalize('NFKC').toLowerCase()
                === String(selected[right].originalMention).normalize('NFKC').toLowerCase();
            if (sameMention && selected[left].entityType !== selected[right].entityType) {
                ambiguousTypes.add(selected[left].entityType);
                ambiguousTypes.add(selected[right].entityType);
            }
        }
    }
    if (ambiguousTypes.size === 0) return state;
    const requirements = state.requirements.map(requirement => (
        ambiguousTypes.has(requirement.identity.entityType)
            && (requirement.status === 'open' || requirement.requirementId === currentRequirementId)
            ? replaceRequirement(requirement, {
                status: 'needs_clarification',
                reason: 'cross_entity_ambiguity',
            })
            : requirement
    ));
    return rebuildState(state, { requirements, status: 'needs_clarification' });
}

function reduceObservation(state, input = {}) {
    const observation = input.observation;
    if (observation?.recordType !== 'observation') {
        throw new TypeError('Fact Reducer 只接受 Observation');
    }
    const evidence = input.evidence || null;
    const requirements = state.requirements.map(requirement => {
        if (requirement.factKey !== observation.factKey || requirement.status !== 'open') {
            return requirement;
        }
        const observationIds = [...requirement.observationIds];
        if (observation.observationId) observationIds.push(observation.observationId);
        if (observation.outcome === 'ambiguous') {
            return replaceRequirement(requirement, {
                status: 'needs_clarification',
                observationIds,
                reason: 'ambiguous',
            });
        }
        if (TECHNICAL_FAILURES.has(observation.outcome)
            || observation.outcome === 'business_rule_rejected') {
            return replaceRequirement(requirement, {
                status: 'unavailable',
                observationIds,
                reason: observation.outcome,
            });
        }
        if (!evidence || evidence.factKey !== requirement.factKey) return requirement;
        if (!requirement.acceptedEvidenceKinds.includes(evidence.kind)) return requirement;
        const evidenceIds = [...requirement.evidenceIds, evidence.evidenceId].filter(Boolean);
        if (['success_empty', 'resource_not_found'].includes(observation.outcome)
            && evidence.kind === 'verified_negative') {
            if (!['verifiedNotFound', 'ambiguity'].includes(requirement.identity.predicate)) {
                return replaceRequirement(requirement, {
                    observationIds,
                    evidenceIds,
                    reason: observation.outcome,
                });
            }
            return replaceRequirement(requirement, {
                status: 'negative_satisfied',
                observationIds,
                evidenceIds,
                reason: observation.outcome,
            });
        }
        if (observation.outcome === 'success_non_empty') {
            return replaceRequirement(requirement, {
                status: 'satisfied',
                observationIds,
                evidenceIds,
                reason: null,
            });
        }
        return requirement;
    });
    return rebuildState(state, {
        requirements,
        observations: [...state.observations, observation],
        evidenceIds: evidence?.evidenceId
            ? [...state.evidenceIds, evidence.evidenceId]
            : state.evidenceIds,
    });
}

function markBudgetExhausted(state) {
    return rebuildState(state, { budgetExhausted: true, status: 'budget_exhausted' });
}

function markOpenRequirementsUnavailable(state, reason = 'no_authoritative_capability') {
    const requirements = state.requirements.map(requirement => (
        requirement.status === 'open' && !requirement.optional
            ? replaceRequirement(requirement, { status: 'unavailable', reason })
            : requirement
    ));
    return rebuildState(state, { requirements });
}

function skipOptionalRequirements(state) {
    const requirements = state.requirements.map(requirement => (
        requirement.optional && requirement.status === 'open'
            ? replaceRequirement(requirement, { status: 'optional_skipped' })
            : requirement
    ));
    return rebuildState(state, { requirements });
}

module.exports = {
    TECHNICAL_FAILURES,
    bindResolvedEntity,
    markBudgetExhausted,
    markCrossEntityAmbiguity,
    markOpenRequirementsUnavailable,
    recordAttempt,
    recordBehaviorEvent,
    reduceObservation,
    skipOptionalRequirements,
};
