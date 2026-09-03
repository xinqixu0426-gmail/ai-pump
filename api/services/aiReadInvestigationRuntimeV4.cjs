const { getAiCapability } = require('../capabilities/registry.cjs');
const { createBehaviorEvent, createEvidenceLedger, createObservation, observationFromToolResult } = require('./aiObservationV3.cjs');
const {
    createFactRequirement,
    createInvestigationGoal,
    createInvestigationState,
} = require('./aiFactModelV4.cjs');
const {
    authorizeCapabilityCall,
    authorizeResolutionCall,
    selectNextCapability,
} = require('./aiCapabilityBrokerV4.cjs');
const { ENTITY_DESCRIPTORS } = require('./aiCapabilityGraphV3.cjs');
const { resolveFormalEntityResultV3 } = require('./aiEntityResolverV3.cjs');
const {
    bindResolvedEntity,
    markBudgetExhausted,
    markCrossEntityAmbiguity,
    markOpenRequirementsUnavailable,
    recordAttempt,
    recordBehaviorEvent,
    reduceObservation,
} = require('./aiFactReducerV4.cjs');
const {
    primaryFactForCapability,
    readInvestigationProfile,
} = require('./aiReadCapabilityProfilesV4.cjs');

const DEFAULT_READ_INVESTIGATION_BUDGET = Object.freeze({ maxCalls: 10 });
const AMBIGUITY_PROBE_SCENARIOS = Object.freeze({
    part: 'catalog_current',
    coil: 'coil_current',
    template: 'template_current',
    recipe: 'recipe_current',
});

function envFlag(env, name) {
    return String(env?.[name] || '').trim().toLowerCase() === 'true';
}

function readInvestigationFlags(env = process.env) {
    return Object.freeze({
        enabled: envFlag(env, 'AI_READ_INVESTIGATION_V4_ENABLED'),
        shadow: envFlag(env, 'AI_READ_INVESTIGATION_V4_SHADOW_ENABLED'),
    });
}

function readInvestigationStateReply(state) {
    switch (state?.status) {
        case 'needs_clarification':
            return '正式查询发现同一名称可能对应不同业务对象，请确认要查询的对象类型或更具体的型号。';
        case 'failed_unverified':
            return '正式查询未能完成验证，暂时不能给出业务结论。';
        case 'budget_exhausted':
            return '本轮正式查询已达到调查上限，现有证据不足以给出业务结论。';
        default:
            return '当前正式证据尚未满足全部必要事实，暂时不能给出业务结论。';
    }
}

function inferParameterProvenance(args = {}, originalTarget = '', resolutionReceipt = null) {
    const target = String(originalTarget || '');
    const provenance = {};
    const selectedId = resolutionReceipt?.selected?.id ?? resolutionReceipt?.selectedId ?? null;
    for (const [field, value] of Object.entries(args || {})) {
        if (value === undefined || value === null || typeof value === 'object') continue;
        const text = String(value).trim();
        if (/id$/i.test(field) && selectedId !== null && String(selectedId) === text) {
            provenance[field] = 'resolution_receipt';
        } else if (text && target.includes(text)) {
            provenance[field] = 'original_user';
        } else {
            provenance[field] = 'model_proposed';
        }
    }
    return Object.freeze(provenance);
}

function eligibleReadInvestigationIntent(intent = {}) {
    return ['query', 'analysis'].includes(intent.mode)
        && intent.entityScope === 'single'
        && (
            (intent.requiredFactIntents || []).length > 0
            || (intent.steps || []).some(step => primaryFactForCapability(step.capabilityName))
        );
}

function goalFromIntent(intent = {}, options = {}) {
    if (!eligibleReadInvestigationIntent(intent)) return null;
    const originalTarget = options.originalTarget
        || intent.targetMentions?.[0]
        || intent.goal
        || null;
    const targetMention = String(originalTarget || '').normalize('NFKC').trim().toLowerCase();
    const seen = new Set();
    const requirements = [];
    const declaredFacts = [
        ...(intent.requiredFactIntents || []).map(item => ({ ...item, optional: false })),
        ...(intent.optionalFactIntents || []).map(item => ({ ...item, optional: true })),
    ];
    for (const fact of declaredFacts) {
        const requirement = createFactRequirement({
            identity: {
                entityType: fact.entityType,
                // Planner/LLM declarations are intent only. A canonical ID may enter
                // FactIdentity later, and only through bindResolvedEntity(receipt).
                entityId: null,
                predicate: fact.predicate,
                temporalScope: fact.temporalScope || 'current',
                scenario: fact.scenario || 'default',
                qualifiers: {
                    ...(fact.qualifiers || {}),
                    ...(targetMention ? { targetMention } : {}),
                },
            },
            optional: fact.optional,
            requiredSourceOfTruth: fact.requiredSourceOfTruth || null,
            requiredAuthority: fact.requiredAuthority || null,
        });
        if (seen.has(requirement.factKey)) continue;
        seen.add(requirement.factKey);
        requirements.push(requirement);
    }
    for (const step of declaredFacts.length === 0 ? intent.steps || [] : []) {
        const identity = primaryFactForCapability(step.capabilityName);
        if (!identity) continue;
        const requirement = createFactRequirement({
            identity: {
                ...identity,
                entityId: null,
                qualifiers: {
                    ...(identity.qualifiers || {}),
                    ...(targetMention ? { targetMention } : {}),
                },
            },
            requiredSourceOfTruth: getAiCapability(step.capabilityName)?.sourceOfTruth || null,
        });
        if (seen.has(requirement.factKey)) continue;
        seen.add(requirement.factKey);
        requirements.push(requirement);
    }
    if (declaredFacts.length === 0 && requirements.length === 1) {
        const primaryEntityType = requirements[0].identity.entityType;
        for (const [entityType, scenario] of Object.entries(AMBIGUITY_PROBE_SCENARIOS)) {
            if (entityType === primaryEntityType) continue;
            const probe = createFactRequirement({
                identity: {
                    entityType,
                    entityId: null,
                    predicate: 'ambiguity',
                    temporalScope: 'current',
                    scenario,
                    qualifiers: targetMention ? { targetMention } : {},
                },
            });
            if (seen.has(probe.factKey)) continue;
            seen.add(probe.factKey);
            requirements.push(probe);
        }
    }
    return createInvestigationGoal({
        goalId: options.goalId,
        goal: intent.goal,
        mode: intent.mode,
        entityScope: intent.entityScope,
        domains: intent.domains,
        originalTarget,
        requirements,
    });
}

function createReadInvestigationController(input = {}) {
    const goal = input.goal || goalFromIntent(input.intent, input);
    if (!goal) return null;
    const ledger = input.evidenceLedger || createEvidenceLedger();
    let observationSequence = 0;
    const resolutionReceipts = [];
    let state = createInvestigationState({
        goalId: goal.goalId,
        requirements: goal.requirements,
        budget: input.budget || DEFAULT_READ_INVESTIGATION_BUDGET,
    });
    const planHints = [...new Set(input.planHints || (input.intent?.steps || [])
        .map(step => step.capabilityName)
        .filter(Boolean))];

    const next = () => {
        const decision = selectNextCapability({ goal, state, planHints });
        if (decision.status === 'budget_exhausted') state = markBudgetExhausted(state);
        if (decision.status === 'unavailable' && state.status === 'running') {
            state = markOpenRequirementsUnavailable(state, decision.reason);
        }
        return decision;
    };
    const authorize = call => authorizeCapabilityCall({ ...call, goal, state });
    const authorizeDiscovery = call => authorizeResolutionCall({ ...call, goal, state });
    const reject = (type, details = {}) => {
        state = recordBehaviorEvent(state, createBehaviorEvent(type, details));
        return state;
    };
    const observe = inputObservation => {
        const requirementBefore = state.requirements.find(item => (
            item.requirementId === inputObservation.requirementId
        ));
        const descriptor = ENTITY_DESCRIPTORS[requirementBefore?.identity.entityType];
        const inferredReceipt = !inputObservation.resolutionReceipt
            && requirementBefore?.identity.entityId === null
            && descriptor?.discoveryCapability === inputObservation.capabilityName
            ? resolveFormalEntityResultV3({
                entityType: requirementBefore.identity.entityType,
                originalMention: goal.originalTarget,
                sourceCapability: inputObservation.capabilityName,
                result: inputObservation.result,
            })
            : null;
        const effectiveReceipt = inputObservation.resolutionReceipt || inferredReceipt;
        if (effectiveReceipt?.selected) {
            state = bindResolvedEntity(
                state,
                inputObservation.requirementId,
                effectiveReceipt
            );
        }
        const decision = authorize({ ...inputObservation, resolutionReceipt: effectiveReceipt });
        if (!decision.allowed) {
            const type = decision.code === 'DUPLICATE_CALL'
                ? 'duplicate_call_suppressed'
                : decision.code === 'INVESTIGATION_BUDGET_EXCEEDED'
                    ? 'budget_exceeded'
                    : 'tool_rejected_not_allowed';
            reject(type, {
                toolName: inputObservation.capabilityName,
                code: decision.code,
            });
            if (decision.code === 'INVESTIGATION_BUDGET_EXCEEDED') {
                state = markBudgetExhausted(state);
            }
            return Object.freeze({ accepted: false, decision, state });
        }
        state = recordAttempt(state, {
            signature: decision.signature,
            capabilityName: inputObservation.capabilityName,
            requirementId: inputObservation.requirementId,
        });
        observationSequence += 1;
        const observationOptions = {
            factKey: decision.factKey,
            observationId: `${goal.goalId}:observation:${observationSequence}`,
            trace: inputObservation.trace,
            error: inputObservation.error,
            cancelled: inputObservation.cancelled,
        };
        const baseObservation = observationFromToolResult(
            inputObservation.capabilityName,
            inputObservation.args,
            inputObservation.result,
            observationOptions
        );
        const observation = effectiveReceipt?.status === 'ambiguous'
            ? createObservation({
                attempted: true,
                outcome: 'ambiguous',
                capabilityName: inputObservation.capabilityName,
                args: inputObservation.args,
                verified: false,
                sourceOfTruth: readInvestigationProfile(inputObservation.capabilityName)?.sourceOfTruth,
                result: { resolutionReceipt: effectiveReceipt },
                ...observationOptions,
            })
            : effectiveReceipt?.status === 'not_found'
                && baseObservation.outcome === 'success_non_empty'
                ? createObservation({
                    attempted: true,
                    outcome: 'resource_not_found',
                    capabilityName: inputObservation.capabilityName,
                    args: inputObservation.args,
                    verified: true,
                    sourceOfTruth: readInvestigationProfile(inputObservation.capabilityName)?.sourceOfTruth,
                    result: { formalResult: inputObservation.result, resolutionReceipt: effectiveReceipt },
                    ...observationOptions,
                })
                : baseObservation;
        const evidence = ledger.appendObservation(observation, {
            toolResult: inputObservation.toolResult || {
                name: inputObservation.capabilityName,
                result: inputObservation.result,
            },
        });
        state = reduceObservation(state, { observation, evidence });
        let crossEntityObservation = null;
        if (effectiveReceipt?.selected) {
            resolutionReceipts.push(effectiveReceipt);
            state = markCrossEntityAmbiguity(
                state,
                resolutionReceipts,
                inputObservation.requirementId
            );
            if (state.status === 'needs_clarification') {
                observationSequence += 1;
                crossEntityObservation = createObservation({
                    attempted: true,
                    outcome: 'ambiguous',
                    capabilityName: inputObservation.capabilityName,
                    factKey: state.requirements.find(item => (
                        item.requirementId === inputObservation.requirementId
                    ))?.factKey || decision.factKey,
                    args: inputObservation.args,
                    verified: false,
                    sourceOfTruth: readInvestigationProfile(inputObservation.capabilityName)?.sourceOfTruth,
                    result: { resolutionReceipts: [...resolutionReceipts] },
                    observationId: `${goal.goalId}:observation:${observationSequence}`,
                });
                state = reduceObservation(state, {
                    observation: crossEntityObservation,
                    evidence: null,
                });
            }
        }
        return Object.freeze({
            accepted: true,
            observation,
            crossEntityObservation,
            evidence,
            state,
        });
    };
    const recordDiscovery = inputObservation => {
        const decision = authorizeDiscovery(inputObservation);
        if (!decision.allowed) return Object.freeze({ accepted: false, decision, state });
        state = recordAttempt(state, {
            signature: decision.signature,
            capabilityName: inputObservation.capabilityName,
            requirementId: inputObservation.requirementId,
        });
        observationSequence += 1;
        const observation = observationFromToolResult(
            inputObservation.capabilityName,
            inputObservation.args,
            inputObservation.result,
            {
                factKey: decision.factKey,
                observationId: `${goal.goalId}:observation:${observationSequence}`,
            }
        );
        state = reduceObservation(state, { observation, evidence: null });
        return Object.freeze({ accepted: true, observation, evidence: null, state });
    };
    const recordResolutionOutcome = inputResolution => {
        if (inputResolution.receipt?.status !== 'ambiguous') return state;
        const requirement = state.requirements.find(item => (
            item.requirementId === inputResolution.requirementId && item.status === 'open'
        ));
        if (!requirement) return state;
        observationSequence += 1;
        const observation = createObservation({
            attempted: true,
            outcome: 'ambiguous',
            capabilityName: inputResolution.receipt.sourceCapability,
            factKey: requirement.factKey,
            args: { query: inputResolution.receipt.originalMention },
            verified: false,
            sourceOfTruth: readInvestigationProfile(inputResolution.receipt.sourceCapability)?.sourceOfTruth,
            result: { resolutionReceipt: inputResolution.receipt },
            observationId: `${goal.goalId}:observation:${observationSequence}`,
        });
        state = reduceObservation(state, { observation, evidence: null });
        return state;
    };
    const replay = (observation, evidence = null) => {
        state = reduceObservation(state, { observation, evidence });
        return state;
    };
    const exhaustBudget = () => {
        state = markBudgetExhausted(state);
        return state;
    };
    const failUnverified = reason => {
        state = markOpenRequirementsUnavailable(state, reason);
        return state;
    };

    return Object.freeze({
        goal,
        ledger,
        next,
        authorize,
        authorizeDiscovery,
        reject,
        observe,
        recordDiscovery,
        recordResolutionOutcome,
        replay,
        exhaustBudget,
        failUnverified,
        state: () => state,
        evidenceToolResults: () => ledger.toolResults(),
    });
}

function replayReadInvestigationShadow(input = {}) {
    const controller = createReadInvestigationController(input);
    if (!controller) return null;
    for (const observation of input.observations || []) {
        const profile = readInvestigationProfile(observation.capabilityName);
        const compatible = controller.state().requirements.filter(item => (
            item.status === 'open'
            && profile?.entityTypes.includes(item.identity.entityType)
            && profile.predicates.includes(item.identity.predicate)
            && profile.temporalScopes.includes(item.identity.temporalScope)
            && profile.scenarios.includes(item.identity.scenario)
        ));
        if (compatible.length !== 1) continue;
        const requirement = compatible[0];
        const evidence = (input.evidenceRecords || []).find(item => (
            (observation.observationId && item.observationId === observation.observationId)
            || (!observation.observationId && item.capabilityName === observation.capabilityName)
        ));
        if (evidence && evidence.factKey !== observation.factKey) continue;
        controller.replay(
            { ...observation, factKey: requirement.factKey },
            evidence ? { ...evidence, factKey: requirement.factKey } : null
        );
    }
    return controller.state();
}

module.exports = {
    DEFAULT_READ_INVESTIGATION_BUDGET,
    createReadInvestigationController,
    eligibleReadInvestigationIntent,
    goalFromIntent,
    inferParameterProvenance,
    readInvestigationFlags,
    readInvestigationStateReply,
    replayReadInvestigationShadow,
};
