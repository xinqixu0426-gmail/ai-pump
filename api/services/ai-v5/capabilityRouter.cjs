'use strict';

const { createV5Task, validateV5Task } = require('./contracts.cjs');
const { getV5Capability, listV5Capabilities } = require('./capabilityRegistry.cjs');

const V5_CAPABILITY_ROUTE_OUTCOMES = Object.freeze(['SELECTED', 'AMBIGUOUS', 'UNRESOLVED', 'INVALID']);

function result(outcome, reasonCode, candidates = [], shadowTask = null) {
    return Object.freeze({
        outcome,
        reasonCode,
        capabilityId: outcome === 'SELECTED' ? candidates[0].capabilityId : null,
        candidateCount: candidates.length,
        candidateCapabilityIds: Object.freeze(candidates.map(item => item.capabilityId).sort()),
        shadowTask,
    });
}

function isStructuredRouteInput(input) {
    return input
        && typeof input === 'object'
        && !Array.isArray(input)
        && typeof input.domain === 'string'
        && input.domain.length > 0
        && typeof input.operation === 'string'
        && input.operation.length > 0
        && typeof input.entityType === 'string'
        && input.entityType.length > 0
        && (input.explicitCapability === undefined
            || input.explicitCapability === null
            || (typeof input.explicitCapability === 'string' && input.explicitCapability.length > 0));
}

function compatible(capability, input) {
    return capability.domain === input.domain
        && capability.operation === input.operation
        && capability.requiredEntityTypes.includes(input.entityType);
}

function routeV5Capability(inputTask, structuredInput, options = {}) {
    let task;
    try {
        task = validateV5Task(inputTask);
    } catch (_error) {
        return result('INVALID', 'INVALID_TASK');
    }
    if (task.state !== 'ROUTING') return result('INVALID', 'TASK_NOT_IN_ROUTING_STATE');
    if (!isStructuredRouteInput(structuredInput)) return result('INVALID', 'INVALID_STRUCTURED_INPUT');

    const capabilities = options.capabilities || listV5Capabilities();
    const explicit = structuredInput.explicitCapability || task.requestedCapability;
    if (explicit) {
        const capability = options.capabilities
            ? capabilities.find(item => item.capabilityId === explicit) || null
            : getV5Capability(explicit);
        if (!capability) return result('INVALID', 'EXPLICIT_CAPABILITY_NOT_FOUND');
        if (!compatible(capability, structuredInput)) return result('INVALID', 'EXPLICIT_CAPABILITY_INCOMPATIBLE', [capability]);
        const shadowTask = createV5Task({ ...task, requestedCapability: capability.capabilityId });
        return result('SELECTED', 'EXPLICIT_CAPABILITY_VALIDATED', [capability], shadowTask);
    }

    const candidates = capabilities.filter(capability => compatible(capability, structuredInput));
    if (candidates.length === 0) return result('UNRESOLVED', 'NO_COMPATIBLE_CAPABILITY');
    if (candidates.length > 1) return result('AMBIGUOUS', 'MULTIPLE_COMPATIBLE_CAPABILITIES', candidates);
    const shadowTask = createV5Task({ ...task, requestedCapability: candidates[0].capabilityId });
    return result('SELECTED', 'UNIQUE_STRUCTURED_MATCH', candidates, shadowTask);
}

module.exports = {
    V5_CAPABILITY_ROUTE_OUTCOMES,
    isStructuredRouteInput,
    routeV5Capability,
};
