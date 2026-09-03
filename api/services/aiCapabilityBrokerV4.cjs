const { getAiToolDefinition } = require('./aiCapabilityCatalogV2.cjs');
const { factIdentityKey } = require('./aiFactModelV4.cjs');
const { ENTITY_DESCRIPTORS, TOOL_TARGETS } = require('./aiCapabilityGraphV3.cjs');
const {
    listReadInvestigationProfiles,
    readInvestigationProfile,
} = require('./aiReadCapabilityProfilesV4.cjs');

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
    return Boolean(
        profile
        && profile.entityScopes.includes(goal.entityScope)
        && (identity.predicate === 'ambiguity' || domainsOverlap(goal.domains, profile.domains))
        && profile.entityTypes.includes(identity.entityType)
        && profile.predicates.includes(identity.predicate)
        && profile.temporalScopes.includes(identity.temporalScope)
        && profile.scenarios.includes(identity.scenario)
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
    if (input.state.attemptedCalls.some(item => item.signature === signature)) {
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
    if (input.state.attemptedCalls.some(item => item.signature === signature)) {
        return Object.freeze({ allowed: false, code: 'DUPLICATE_CALL' });
    }
    return Object.freeze({ allowed: true, signature, factKey: requirement.factKey });
}

module.exports = {
    TRUSTED_PARAMETER_PROVENANCE,
    authorizeCapabilityCall,
    authorizeResolutionCall,
    callSignature,
    hasTrustedParameters,
    profileSupportsRequirement,
    selectNextCapability,
    targetMatchesOriginal,
};
