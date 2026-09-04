const { getAiToolDefinition } = require('./aiCapabilityCatalogV2.cjs');
const { factIdentityKey, normalizeLogicalTarget } = require('./aiFactModelV4.cjs');
const { ENTITY_DESCRIPTORS, TOOL_TARGETS } = require('./aiCapabilityGraphV3.cjs');
const {
    listReadInvestigationProfiles,
    readInvestigationProfile,
} = require('./aiReadCapabilityProfilesV4.cjs');
const { stableBusinessKeyValues } = require('./aiStableEntityIdentityV4.cjs');

const TRUSTED_PARAMETER_PROVENANCE = new Set([
    'original_user',
    'resolution_receipt',
    'prior_evidence',
    'system_default',
]);

function domainsOverlap(left = [], right = []) {
    const expected = new Set(left);
    return expected.size === 0 || right.some(item => expected.has(item));
}

function profileSupportsRequirement(profile, requirement, goal) {
    const identity = requirement.identity;
    const exactFactSupport = (profile?.factSignatures || []).some(signature => (
        signature.entityType === identity.entityType
        && signature.predicate === identity.predicate
        && signature.temporalScope === identity.temporalScope
        && signature.scenario === identity.scenario
    ));
    const legacyFactSupport = profile?.predicates.includes(identity.predicate)
        && profile.temporalScopes.includes(identity.temporalScope)
        && profile.scenarios.includes(identity.scenario);
    return Boolean(
        profile
        && profile.entityScopes.includes(goal.entityScope)
        // A structured Fact signature is the execution authority. Planner domains
        // are coarse routing output and may rank legacy profiles, but cannot veto
        // an exact entity/predicate/temporal/scenario match.
        && (identity.predicate === 'ambiguity'
            || exactFactSupport
            || domainsOverlap(goal.domains, profile.domains))
        && profile.entityTypes.includes(identity.entityType)
        && (exactFactSupport || legacyFactSupport)
        && (!requirement.requiredSourceOfTruth
            || requirement.requiredSourceOfTruth === profile.sourceOfTruth)
        && (!requirement.requiredAuthority
            || requirement.requiredAuthority === profile.dataMode)
        && (profile.operation === 'query'
            || (profile.operation === 'preview' && profile.supportsPreview))
    );
}

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function callSignature(capabilityName, args = {}) {
    return `${String(capabilityName || '')}:${JSON.stringify(stableValue(args))}`;
}

function requiredParameterGroups(capabilityName) {
    const parameters = getAiToolDefinition(capabilityName)?.function?.parameters || {};
    const groups = [];
    if (Array.isArray(parameters.required) && parameters.required.length > 0) {
        groups.push(parameters.required);
    }
    for (const option of [...(parameters.oneOf || []), ...(parameters.anyOf || [])]) {
        if (Array.isArray(option?.required) && option.required.length > 0) groups.push(option.required);
    }
    return groups;
}

function hasTrustedParameters(capabilityName, args, parameterProvenance = {}) {
    const suppliedFields = Object.entries(args || {})
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([field]) => field);
    if (suppliedFields.some(field => !TRUSTED_PARAMETER_PROVENANCE.has(parameterProvenance[field]))) {
        return false;
    }
    const groups = requiredParameterGroups(capabilityName);
    if (groups.length === 0) return true;
    return groups.some(group => group.every(field => (
        args?.[field] !== undefined
        && args?.[field] !== null
        && TRUSTED_PARAMETER_PROVENANCE.has(parameterProvenance[field])
    )));
}

function targetMatchesOriginal(args = {}, originalTarget, resolutionReceipt) {
    const target = String(originalTarget || '').trim();
    const receipt = resolutionReceipt || null;
    const targetFields = new Set([
        'keyword', 'query', 'model', 'spec', 'shellModel', 'recipeName',
        'partName', 'coilSpec', 'templateName',
    ]);
    for (const [field, value] of Object.entries(args)) {
        if (value === undefined || value === null || typeof value === 'object') continue;
        const text = String(value).trim();
        if (!text) continue;
        if (/id$/i.test(field)) {
            const selectedId = receipt?.selected?.id ?? receipt?.selectedId ?? null;
            if (selectedId === null || String(selectedId) !== text) return false;
            continue;
        }
        if (!targetFields.has(field)) continue;
        if (target && !target.includes(text) && !text.includes(target)) return false;
    }
    return true;
}

function entityTargetArguments(capabilityName, args = {}) {
    const target = TOOL_TARGETS[capabilityName];
    if (!target) return Object.freeze({});
    const fields = target.outputFields
        ? Object.keys(target.outputFields)
        : [target.outputIdField || target.outputField].filter(Boolean);
    return Object.freeze(Object.fromEntries(fields
        .filter(field => args[field] !== undefined && args[field] !== null)
        .map(field => [field, args[field]])));
}

function bindingTargetForCapability(capabilityName, binding) {
    const configured = TOOL_TARGETS[capabilityName];
    if (configured) return configured;
    const descriptorEntry = Object.entries(ENTITY_DESCRIPTORS).find(([, descriptor]) => (
        descriptor.discoveryCapability === capabilityName
    ));
    if (!descriptorEntry || descriptorEntry[0] !== binding.entityType) return null;
    const properties = getAiToolDefinition(capabilityName)?.function?.parameters?.properties || {};
    const businessKeys = binding.stableEntityIdentity?.stableBusinessKeys || {};
    const stableBusinessKey = Object.keys(businessKeys).find(key => Object.hasOwn(properties, key));
    if (stableBusinessKey) {
        return Object.freeze({
            entityType: binding.entityType,
            inputField: stableBusinessKey,
            outputField: stableBusinessKey,
            stableBusinessKey,
        });
    }
    const discoveryField = descriptorEntry[1].discoveryArgs?.find(field => field && Object.hasOwn(properties, field));
    return discoveryField ? Object.freeze({
        entityType: binding.entityType,
        inputField: discoveryField,
        outputField: discoveryField,
    }) : null;
}

function explicitTargetMatchesBinding(target, args, binding) {
    const inputFields = Array.isArray(target.inputFields)
        ? target.inputFields
        : [target.inputField].filter(Boolean);
    const acceptedText = [
        binding.canonicalName,
        binding.originalMention,
        ...stableBusinessKeyValues(binding.stableEntityIdentity),
    ]
        .map(normalizeLogicalTarget)
        .filter(Boolean);
    for (const field of inputFields) {
        const value = args?.[field];
        if (value === undefined || value === null || value === '') continue;
        const text = normalizeLogicalTarget(value);
        if (!acceptedText.includes(text)) {
            return false;
        }
    }
    for (const [field, value] of Object.entries(args || {})) {
        if (!/id$/i.test(field) || value === undefined || value === null) continue;
        if (String(value) !== binding.entityId) return false;
    }
    return true;
}

function applyEntityBinding(capabilityName, args, binding) {
    const target = bindingTargetForCapability(capabilityName, binding);
    if (!target || target.entityType !== binding.entityType) return null;
    const next = { ...(args || {}) };
    const inputFields = Array.isArray(target.inputFields)
        ? target.inputFields
        : [target.inputField].filter(Boolean);
    if (target.stableBusinessKey) {
        const value = binding.stableEntityIdentity?.stableBusinessKeys?.[target.stableBusinessKey];
        if (!value) return null;
        next[target.outputField] = value;
        inputFields.filter(field => field !== target.outputField).forEach(field => delete next[field]);
    } else if (target.outputFields) {
        for (const field of Object.keys(target.outputFields)) {
            if (binding.targetArguments[field] === undefined) return null;
            next[field] = binding.targetArguments[field];
        }
    } else if (target.outputIdField) {
        next[target.outputIdField] = Number.isSafeInteger(Number(binding.entityId))
            ? Number(binding.entityId)
            : binding.entityId;
        inputFields.forEach(field => delete next[field]);
    } else if (target.outputField) {
        if (!binding.canonicalName) return null;
        next[target.outputField] = binding.canonicalName;
    } else {
        return null;
    }
    return Object.freeze(next);
}

function reuseEntityBinding(input = {}) {
    const requirement = input.state?.requirements.find(item => (
        item.requirementId === input.requirementId && item.status === 'open'
    ));
    const candidateBindings = input.state?.entityBindings || [];
    const provisionalBinding = candidateBindings.find(item => (
        item.investigationId === input.goal?.goalId
        && item.status === 'resolved'
        && item.entityType === requirement?.identity.entityType
    ));
    const target = provisionalBinding
        ? bindingTargetForCapability(input.capabilityName, provisionalBinding)
        : TOOL_TARGETS[input.capabilityName];
    if (!requirement || !target || target.entityType !== requirement.identity.entityType) return null;
    const logicalTarget = normalizeLogicalTarget(
        requirement.identity.qualifiers?.targetMention || input.goal?.originalTarget
    );
    if (!logicalTarget) return null;
    const binding = candidateBindings.find(item => (
        item.investigationId === input.goal?.goalId
        && item.status === 'resolved'
        && item.entityType === requirement.identity.entityType
        && item.logicalTarget === logicalTarget
        && (!requirement.identity.entityId || item.entityId === requirement.identity.entityId)
    ));
    if (!binding || !explicitTargetMatchesBinding(target, input.args, binding)) return null;
    const args = applyEntityBinding(input.capabilityName, input.args, binding);
    if (!args) return null;
    return Object.freeze({ binding, args, resolutionReceipt: binding.resolutionReceipt });
}

function openRequirements(state) {
    return state.requirements.filter(item => item.status === 'open');
}

function selectNextCapability(input = {}) {
    const { goal, state } = input;
    if (!goal || !state || state.status !== 'running') {
        return Object.freeze({ status: 'unavailable', reason: 'investigation_not_running' });
    }
    if (state.budget.usedCalls >= state.budget.maxCalls) {
        return Object.freeze({ status: 'budget_exhausted', reason: 'call_budget_exhausted' });
    }
    const hints = [...new Set(input.planHints || [])];
    const profiles = listReadInvestigationProfiles();
    for (const requirement of openRequirements(state)) {
        const candidates = profiles
            .filter(profile => profileSupportsRequirement(profile, requirement, goal))
            .sort((left, right) => {
                const leftHint = hints.indexOf(left.capabilityName);
                const rightHint = hints.indexOf(right.capabilityName);
                return (leftHint < 0 ? Number.MAX_SAFE_INTEGER : leftHint)
                    - (rightHint < 0 ? Number.MAX_SAFE_INTEGER : rightHint);
            });
        if (candidates.length > 0) {
            return Object.freeze({
                status: 'selected',
                capabilityName: candidates[0].capabilityName,
                requirementId: requirement.requirementId,
                factKey: requirement.factKey,
            });
        }
    }
    return Object.freeze({ status: 'unavailable', reason: 'no_authoritative_capability' });
}

function authorizeCapabilityCall(input = {}) {
    const profile = readInvestigationProfile(input.capabilityName);
    const requirement = input.state?.requirements.find(item => (
        item.requirementId === input.requirementId
    ));
    if (!profile || !requirement || requirement.status !== 'open') {
        return Object.freeze({ allowed: false, code: 'FACT_REQUIREMENT_NOT_OPEN' });
    }
    if (!profileSupportsRequirement(profile, requirement, input.goal)) {
        return Object.freeze({ allowed: false, code: 'CAPABILITY_FACT_MISMATCH' });
    }
    if (input.state.budget.usedCalls >= input.state.budget.maxCalls) {
        return Object.freeze({ allowed: false, code: 'INVESTIGATION_BUDGET_EXCEEDED' });
    }
    if (!hasTrustedParameters(input.capabilityName, input.args, input.parameterProvenance)) {
        return Object.freeze({ allowed: false, code: 'UNTRUSTED_PARAMETER_PROVENANCE' });
    }
    if (!targetMatchesOriginal(input.args, input.goal.originalTarget, input.resolutionReceipt)) {
        return Object.freeze({ allowed: false, code: 'ORIGINAL_TARGET_MISMATCH' });
    }
    const signature = callSignature(input.capabilityName, input.args);
    if (input.state.attemptedCalls.some(item => (
        item.signature === signature
        && (!item.requirementId || item.requirementId === input.requirementId)
    ))) {
        return Object.freeze({ allowed: false, code: 'DUPLICATE_CALL' });
    }
    return Object.freeze({
        allowed: true,
        signature,
        factKey: factIdentityKey(requirement.identity),
    });
}

function authorizeResolutionCall(input = {}) {
    const requirement = input.state?.requirements.find(item => (
        item.requirementId === input.requirementId
    ));
    const parentTarget = TOOL_TARGETS[input.parentCapabilityName];
    const descriptor = parentTarget && ENTITY_DESCRIPTORS[parentTarget.entityType];
    const discovery = getAiToolDefinition(input.capabilityName);
    const discoveryCapability = readInvestigationProfile(input.capabilityName);
    if (!requirement || requirement.status !== 'open') {
        return Object.freeze({ allowed: false, code: 'FACT_REQUIREMENT_NOT_OPEN' });
    }
    if (!parentTarget
        || parentTarget.entityType !== requirement.identity.entityType
        || descriptor?.discoveryCapability !== input.capabilityName
        || !discovery
        || !discoveryCapability
        || discoveryCapability.operation !== 'query') {
        return Object.freeze({ allowed: false, code: 'RESOLUTION_CAPABILITY_MISMATCH' });
    }
    if (input.state.budget.usedCalls >= input.state.budget.maxCalls) {
        return Object.freeze({ allowed: false, code: 'INVESTIGATION_BUDGET_EXCEEDED' });
    }
    if (!hasTrustedParameters(input.capabilityName, input.args, input.parameterProvenance)) {
        return Object.freeze({ allowed: false, code: 'UNTRUSTED_PARAMETER_PROVENANCE' });
    }
    if (!targetMatchesOriginal(input.args, input.goal.originalTarget, null)) {
        return Object.freeze({ allowed: false, code: 'ORIGINAL_TARGET_MISMATCH' });
    }
    const signature = callSignature(input.capabilityName, input.args);
    if (input.state.attemptedCalls.some(item => (
        item.signature === signature
        && (!item.requirementId || item.requirementId === input.requirementId)
    ))) {
        return Object.freeze({ allowed: false, code: 'DUPLICATE_CALL' });
    }
    return Object.freeze({ allowed: true, signature, factKey: requirement.factKey });
}

module.exports = {
    TRUSTED_PARAMETER_PROVENANCE,
    authorizeCapabilityCall,
    authorizeResolutionCall,
    entityTargetArguments,
    callSignature,
    hasTrustedParameters,
    profileSupportsRequirement,
    reuseEntityBinding,
    selectNextCapability,
    targetMatchesOriginal,
};
