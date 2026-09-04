'use strict';

const {
    createV5Task,
    validateToolRequestForExecution,
    validateV5Task,
    validateV5ToolResult,
} = require('./contracts.cjs');
const { getV5Capability } = require('./capabilityRegistry.cjs');
const { routeV5Capability } = require('./capabilityRouter.cjs');
const { getV5ToolExposure } = require('./toolExposure.cjs');
const { getV5EntityType } = require('./businessOntology.cjs');
const { validateLedger } = require('./evidenceLedger.cjs');
const { listEvidenceRequirements } = require('./evidenceRequirements.cjs');
const { evaluateV5Policy } = require('./policy.cjs');
const { transitionTask } = require('./taskState.cjs');
const { composingTransitionContext, verificationTransitionContext, verifyV5Task } = require('./verification.cjs');

const V5_SHADOW_EXECUTION_STATUSES = Object.freeze([
    'NOT_EXECUTED_SHADOW',
    'WOULD_EXECUTE',
    'WOULD_REQUIRE_APPROVAL',
    'WOULD_DENY',
    'INVALID',
]);

function frozen(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(frozen);
    return Object.freeze(value);
}

function projection(status, reasonCode) {
    return frozen({ status, reasonCode, actualToolExecutions: 0, actualWrites: 0 });
}

function outcome(task, details = {}) {
    return frozen({
        taskId: task?.taskId || details.taskId || null,
        finalState: task?.state || 'INVALID',
        capabilityOutcome: details.capabilityOutcome || null,
        toolExposureOutcome: details.toolExposureOutcome || null,
        policyDecision: details.policyDecision || null,
        executionProjection: details.executionProjection || projection('INVALID', 'SHADOW_RUNTIME_INVALID'),
        evidenceOutcome: details.evidenceOutcome || null,
        verificationOutcome: details.verificationOutcome || null,
        reasonCodes: [...new Set(details.reasonCodes || [])],
        stateHistory: task?.stateHistory || [],
    });
}

function resolveCapability(selection, options) {
    if (Array.isArray(options.capabilities)) {
        return options.capabilities.find(item => item.capabilityId === selection.capabilityId) || null;
    }
    return getV5Capability(selection.capabilityId);
}

function validateRequiredEntities(task, capability) {
    const missing = [];
    for (const type of capability.requiredEntityTypes) {
        const ref = task.entityContext.find(item => item.entityType === type);
        const ontology = getV5EntityType(type);
        if (!ref || !ontology) {
            missing.push(type);
            continue;
        }
        if (ontology.identitySource !== 'NOT_AVAILABLE'
            && (ref.canonicalEntityId === null || !ref.resolutionReceiptRef)) {
            missing.push(type);
        }
    }
    return frozen({ valid: missing.length === 0, missingEntityTypes: missing });
}

function requestEntitiesMatchTask(request, task, capability) {
    return capability.requiredEntityTypes.every(type => {
        const taskRef = task.entityContext.find(item => item.entityType === type);
        const requestRef = request.entityRefs.find(item => item.entityType === type);
        if (!taskRef || !requestRef) return false;
        if (taskRef.canonicalEntityId !== null || requestRef.canonicalEntityId !== null) {
            return taskRef.canonicalEntityId === requestRef.canonicalEntityId
                && taskRef.resolutionReceiptRef === requestRef.resolutionReceiptRef;
        }
        return taskRef.rawMention === requestRef.rawMention;
    });
}

function exposureFor(selection, capability, options) {
    if (!capability) return frozen({ selectedToolAllowed: false, allowedToolNames: [], modelExposable: false, reasonCode: 'CAPABILITY_NOT_FOUND' });
    if (Array.isArray(options.capabilities) || capability.readWriteClass === 'WRITE') {
        return frozen({
            selectedToolAllowed: capability.allowedTools.includes(options.toolName),
            allowedToolNames: [...capability.allowedTools],
            modelExposable: false,
            reasonCode: capability.readWriteClass === 'WRITE' ? 'WRITE_DEFINITION_NOT_EXPOSED' : 'SYNTHETIC_SHADOW_CAPABILITY',
        });
    }
    const exposure = getV5ToolExposure(selection);
    return frozen({
        selectedToolAllowed: exposure.allowedToolNames.includes(options.toolName),
        allowedToolNames: [...exposure.allowedToolNames],
        modelExposable: exposure.toolCount > 0,
        reasonCode: exposure.reasonCode,
    });
}

function stopAtPolicy(task, base, policyDecision) {
    let stopped = task;
    try {
        stopped = transitionTask(task, 'BLOCKED_POLICY', { reasonCode: policyDecision.reasonCodes[0] || 'POLICY_BLOCKED' });
    } catch {
        // The original valid state remains authoritative when no blocked transition exists.
    }
    const status = policyDecision.decision === 'APPROVAL_REQUIRED' || policyDecision.decision === 'SHADOW_ONLY'
        ? 'WOULD_REQUIRE_APPROVAL'
        : policyDecision.decision === 'INVALID' ? 'INVALID' : 'WOULD_DENY';
    return outcome(stopped, {
        ...base,
        policyDecision,
        executionProjection: projection(status, 'POLICY_SHADOW_EXECUTION_DISABLED'),
        reasonCodes: [...base.reasonCodes, ...policyDecision.reasonCodes, 'POLICY_SHADOW_EXECUTION_DISABLED'],
    });
}

function runV5ControlledShadowRuntime(input = {}, options = {}) {
    let task;
    const reasons = [];
    try {
        task = validateV5Task(input.task);
        if (task.state !== 'RECEIVED') return outcome(task, { executionProjection: projection('INVALID', 'STATE_REJECTED'), reasonCodes: ['STATE_REJECTED'] });
        task = transitionTask(task, 'UNDERSTANDING', { timestamp: options.timestamp, reasonCode: 'SHADOW_UNDERSTANDING' });
        if (task.entityContext.length > 0) {
            task = transitionTask(task, 'RESOLVING_ENTITY', { timestamp: options.timestamp, reasonCode: 'SHADOW_ENTITY_VALIDATION' });
            task = transitionTask(task, 'ROUTING', { timestamp: options.timestamp, reasonCode: 'SHADOW_ENTITY_READY' });
        } else {
            task = transitionTask(task, 'ROUTING', { timestamp: options.timestamp, reasonCode: 'SHADOW_NO_ENTITY_CONTEXT' });
        }
    } catch (error) {
        return outcome(task, { taskId: input.task?.taskId, executionProjection: projection('INVALID', 'STATE_REJECTED'), reasonCodes: [error.code || 'STATE_REJECTED'] });
    }

    const route = routeV5Capability(task, input.routeInput, { capabilities: options.capabilities });
    if (route.outcome !== 'SELECTED') {
        return outcome(task, { capabilityOutcome: route, executionProjection: projection('INVALID', route.reasonCode), reasonCodes: [route.reasonCode] });
    }
    task = route.shadowTask;
    const capability = resolveCapability(route, options);
    const entityGate = validateRequiredEntities(task, capability);
    if (!entityGate.valid) {
        return outcome(task, { capabilityOutcome: route, evidenceOutcome: entityGate, executionProjection: projection('INVALID', 'ENTITY_GATE_REJECTED'), reasonCodes: ['ENTITY_GATE_REJECTED'] });
    }

    const checkedRequest = validateToolRequestForExecution(input.toolRequest);
    if (!checkedRequest.valid
        || checkedRequest.request.taskId !== task.taskId
        || checkedRequest.request.capability !== capability.capabilityId
        || checkedRequest.request.riskClass !== capability.riskClass
        || !requestEntitiesMatchTask(checkedRequest.request, task, capability)) {
        return outcome(task, { capabilityOutcome: route, executionProjection: projection('INVALID', 'VALIDATED_ARGUMENTS_GATE_REJECTED'), reasonCodes: ['VALIDATED_ARGUMENTS_GATE_REJECTED'] });
    }
    const toolName = checkedRequest.request.toolName;
    const exposure = exposureFor(route, capability, { capabilities: options.capabilities, toolName });
    if (!exposure.selectedToolAllowed) {
        return outcome(task, { capabilityOutcome: route, toolExposureOutcome: exposure, executionProjection: projection('INVALID', 'TOOL_EXPOSURE_REJECTED'), reasonCodes: ['TOOL_EXPOSURE_REJECTED'] });
    }

    const policy = evaluateV5Policy({
        taskId: task.taskId,
        taskState: task.state,
        capabilityId: capability.capabilityId,
        readWriteClass: capability.readWriteClass,
        riskClass: capability.riskClass,
        toolName,
        entityTypes: task.entityContext.map(item => item.entityType),
        validatedArgumentsReady: checkedRequest.request.executionReady,
        approvalState: input.approvalState,
    }, { capability });
    const base = { capabilityOutcome: route, toolExposureOutcome: exposure, reasonCodes: reasons };
    if (policy.decision !== 'ALLOW' || policy.executionAllowed !== true) return stopAtPolicy(task, base, policy);

    task = createV5Task({ ...task, execution: { toolRequest: checkedRequest.request, toolResult: null } });
    try {
        task = transitionTask(task, 'EXECUTING', { timestamp: options.timestamp, reasonCode: 'SHADOW_POLICY_ALLOWED', policyDecision: policy.decision });
    } catch (error) {
        return outcome(task, { ...base, policyDecision: policy, executionProjection: projection('INVALID', 'STATE_REJECTED'), reasonCodes: [error.code || 'STATE_REJECTED'] });
    }
    if (!input.shadowToolResult) {
        return outcome(task, { ...base, policyDecision: policy, executionProjection: projection('WOULD_EXECUTE', 'POLICY_ALLOWED_SHADOW_ONLY'), reasonCodes: ['POLICY_SHADOW_EXECUTION_DISABLED'] });
    }

    let toolResult;
    try {
        toolResult = validateV5ToolResult(input.shadowToolResult);
        if (toolResult.taskId !== task.taskId || toolResult.toolName !== toolName) throw new TypeError('Shadow ToolResult does not match request');
        task = createV5Task({ ...task, execution: { toolRequest: checkedRequest.request, toolResult } });
    } catch {
        return outcome(task, { ...base, policyDecision: policy, executionProjection: projection('INVALID', 'SHADOW_TOOL_RESULT_INVALID'), reasonCodes: ['SHADOW_TOOL_RESULT_INVALID'] });
    }
    if (toolResult.status === 'failure') {
        task = transitionTask(task, 'FAILED_TOOL', { timestamp: options.timestamp, reasonCode: 'SHADOW_TOOL_FAILURE' });
        return outcome(task, { ...base, policyDecision: policy, executionProjection: projection('NOT_EXECUTED_SHADOW', 'EXTERNAL_SHADOW_RESULT_FAILURE'), verificationOutcome: frozen({ decision: 'FAILED_EXECUTION' }), reasonCodes: ['SHADOW_TOOL_FAILURE'] });
    }

    task = transitionTask(task, 'COLLECTING_EVIDENCE', { timestamp: options.timestamp, reasonCode: 'SHADOW_RESULT_SUPPLIED' });
    const requirements = listEvidenceRequirements(capability.capabilityId);
    if (requirements.length === 0) {
        return outcome(task, { ...base, policyDecision: policy, executionProjection: projection('NOT_EXECUTED_SHADOW', 'EXTERNAL_SHADOW_RESULT_SUPPLIED'), evidenceOutcome: frozen({ status: 'DEFERRED_REQUIREMENT' }), verificationOutcome: frozen({ status: 'DEFERRED_REQUIREMENT' }), reasonCodes: ['EVIDENCE_REQUIREMENT_DEFERRED'] });
    }
    if (!input.evidenceLedger) {
        return outcome(task, { ...base, policyDecision: policy, executionProjection: projection('NOT_EXECUTED_SHADOW', 'EXTERNAL_SHADOW_RESULT_SUPPLIED'), evidenceOutcome: frozen({ status: 'MISSING' }), verificationOutcome: frozen({ status: 'NOT_RUN_MISSING_EVIDENCE' }), reasonCodes: ['SHADOW_EVIDENCE_NOT_SUPPLIED'] });
    }

    let ledger;
    try {
        ledger = validateLedger(input.evidenceLedger);
        if (ledger.taskId !== task.taskId) throw new TypeError('Ledger task mismatch');
        task = transitionTask(task, 'VERIFYING', { ...verificationTransitionContext(ledger, true), timestamp: options.timestamp, reasonCode: 'SHADOW_EVIDENCE_READY' });
    } catch {
        return outcome(task, { ...base, policyDecision: policy, executionProjection: projection('NOT_EXECUTED_SHADOW', 'EXTERNAL_SHADOW_RESULT_SUPPLIED'), evidenceOutcome: frozen({ status: 'INVALID' }), verificationOutcome: frozen({ status: 'NOT_RUN_INVALID_LEDGER' }), reasonCodes: ['SHADOW_EVIDENCE_INVALID'] });
    }
    const verification = verifyV5Task({ ledger, requirements, execution: { toolResults: [toolResult], requiredExecutionCount: 1, orchestrationComplete: true } });
    if (verification.decision === 'VERIFIED') {
        task = transitionTask(task, 'COMPOSING', { ...composingTransitionContext(verification), timestamp: options.timestamp, reasonCode: 'SHADOW_VERIFIED' });
        task = transitionTask(task, 'COMPLETED', { timestamp: options.timestamp, reasonCode: 'SHADOW_SUPPORTED', answerSupported: true });
    } else {
        task = transitionTask(task, 'FAILED_EVIDENCE', { timestamp: options.timestamp, reasonCode: verification.decision });
    }
    return outcome(task, {
        ...base,
        policyDecision: policy,
        executionProjection: projection('NOT_EXECUTED_SHADOW', 'EXTERNAL_SHADOW_RESULT_SUPPLIED'),
        evidenceOutcome: frozen({ status: verification.evidenceValidity, itemCount: ledger.items.length }),
        verificationOutcome: verification,
        reasonCodes: verification.reasonCodes,
    });
}

module.exports = {
    V5_SHADOW_EXECUTION_STATUSES,
    runV5ControlledShadowRuntime,
};
