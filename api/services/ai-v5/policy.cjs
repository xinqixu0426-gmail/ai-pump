'use strict';

const { V5_TASK_STATES } = require('./contracts.cjs');
const { getV5Capability } = require('./capabilityRegistry.cjs');
const {
    V5_APPROVAL_STATES,
    V5_POLICY_VERSION,
    getRiskDefinition,
    validateRiskConsistency,
} = require('./risk.cjs');

const V5_POLICY_DECISIONS = Object.freeze(['ALLOW', 'DENY', 'APPROVAL_REQUIRED', 'SHADOW_ONLY', 'INVALID']);

function decision(input, value, reasonCodes, approvalRequired = false, executionAllowed = false) {
    return Object.freeze({
        version: V5_POLICY_VERSION,
        decision: value,
        reasonCodes: Object.freeze([...new Set(reasonCodes)]),
        riskClass: input.riskClass || null,
        capabilityId: input.capabilityId || null,
        toolName: input.toolName || null,
        approvalRequired,
        executionAllowed,
    });
}

function invalid(input, reasonCode) {
    return decision(input, 'INVALID', [reasonCode], false, false);
}

function evaluateV5Policy(input = {}, options = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid({}, 'POLICY_CONTEXT_INVALID');
    if (typeof input.taskId !== 'string' || input.taskId.length === 0 || !V5_TASK_STATES.includes(input.taskState)) {
        return invalid(input, 'POLICY_INVALID_TASK_STATE');
    }
    const risk = getRiskDefinition(input.riskClass);
    if (!risk) return invalid(input, 'POLICY_RISK_MISMATCH');
    if (!V5_APPROVAL_STATES.includes(input.approvalState)) return invalid(input, 'POLICY_APPROVAL_STATE_INVALID');

    if (input.riskClass === 'L0') {
        if (input.capabilityId || input.toolName || input.readWriteClass !== 'NONE') return invalid(input, 'POLICY_RISK_MISMATCH');
        return decision(input, 'ALLOW', ['POLICY_ALLOW_CONVERSATION'], false, false);
    }

    if (input.taskState !== 'ROUTING') return invalid(input, 'POLICY_INVALID_TASK_STATE');
    const capability = options.capability || getV5Capability(input.capabilityId);
    if (!capability || capability.capabilityId !== input.capabilityId) return invalid(input, 'POLICY_CAPABILITY_INVALID');
    if (capability.readWriteClass !== input.readWriteClass
        || capability.riskClass !== input.riskClass
        || !validateRiskConsistency(input.riskClass, input.readWriteClass)) {
        return invalid(input, 'POLICY_RISK_MISMATCH');
    }
    if (!capability.allowedTools.includes(input.toolName)) return invalid(input, 'POLICY_TOOL_NOT_IN_CAPABILITY');
    if (input.validatedArgumentsReady !== true) return invalid(input, 'POLICY_VALIDATED_ARGUMENTS_REQUIRED');
    if (!Array.isArray(input.entityTypes)
        || capability.requiredEntityTypes.some(type => !input.entityTypes.includes(type))) {
        return invalid(input, 'POLICY_ENTITY_REQUIREMENT_MISSING');
    }

    if (input.riskClass === 'L1') {
        return decision(input, 'ALLOW', ['POLICY_ALLOW_READ'], false, true);
    }
    if (input.riskClass === 'L2') {
        return decision(input, 'ALLOW', ['POLICY_ALLOW_ANALYSIS'], false, true);
    }
    if (input.riskClass === 'L3') {
        return decision(input, 'SHADOW_ONLY', ['POLICY_PROPOSAL_ONLY', 'POLICY_SHADOW_EXECUTION_DISABLED'], true, false);
    }
    if (input.riskClass === 'L4') {
        if (input.approvalState === 'APPROVED') return decision(input, 'ALLOW', ['POLICY_APPROVED_WRITE'], false, true);
        if (input.approvalState === 'REJECTED') return decision(input, 'DENY', ['POLICY_WRITE_REJECTED'], true, false);
        return decision(input, 'APPROVAL_REQUIRED', ['POLICY_APPROVAL_REQUIRED', 'POLICY_WRITE_NOT_APPROVED'], true, false);
    }
    return decision(input, 'DENY', ['POLICY_CRITICAL_DENIED'], true, false);
}

module.exports = {
    V5_POLICY_DECISIONS,
    evaluateV5Policy,
};
