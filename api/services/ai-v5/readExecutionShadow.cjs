'use strict';

const { performance } = require('node:perf_hooks');
const { createV5Task, createV5ToolRequest, createV5ToolResult } = require('./contracts.cjs');
const { getV5Capability } = require('./capabilityRegistry.cjs');
const { selectReadExecution, readPolicyLock } = require('./readExecutionRegistry.cjs');
const { bindReadArguments } = require('./readArgumentBinder.cjs');
const { runV5ControlledShadowRuntime } = require('./controlledRuntime.cjs');
const { transitionTask } = require('./taskState.cjs');
const { createEvidenceLedger, addEvidence, toolResultToCandidateEvidence } = require('./evidenceLedger.cjs');
const { listEvidenceRequirements } = require('./evidenceRequirements.cjs');
const { verifyV5Task, verificationTransitionContext, composingTransitionContext } = require('./verification.cjs');

const DEFAULT_READ_EXECUTION_TIMEOUT_MS = 10000;
function executionShadowEnabled(env = process.env) {
    return env.AI_V5_SHADOW_ENABLED === 'true' && env.AI_V5_EXECUTION_SHADOW_ENABLED === 'true';
}

// Minimum existing-contract checks, not a claim that arbitrary business answers are verified.
function inspectReadResult(entry, entity, result, boundArguments = null) {
    if (result?.success !== true || result.executionEvidence?.verified !== true
        || result.executionEvidence?.kind !== 'formal_api_query'
        || !result.executionEvidence.calls?.length
        || result.executionEvidence.calls.some(call => call.method !== 'GET')) return false;
    if (entry.toolName === 'search_parts') {
        const rows = result.parts;
        if (!Array.isArray(rows) || result.truncated !== false || result.count !== rows.length) return false;
        const matches = rows.filter(row => String(row.id ?? row.Id) === String(entity.canonicalEntityId));
        return matches.length === 1 && typeof matches[0].stock === 'number' && Number.isFinite(matches[0].stock);
    }
    if (entry.toolName === 'preview_recipe_cost') {
        return String(result.data?.recipeId) === String(entity.canonicalEntityId)
            && typeof result.data?.currentTotalCost === 'number' && Number.isFinite(result.data.currentTotalCost)
            && result.data?.pricingComplete !== false;
    }
    if (entry.toolName === 'search_coils') {
        return Array.isArray(result.data) && result.count === 1 && result.data.length === 1
            && String(result.data[0].id) === String(entity.canonicalEntityId)
            && result.data[0].schemeCode === boundArguments?.schemeCode
            && typeof result.data[0].stock === 'number' && Number.isFinite(result.data[0].stock);
    }
    return false;
}

async function runReadExecutionShadow(input, options = {}) {
    const started = performance.now();
    const safe = { toolSelectionStatus: 'NOT_RUN', argumentValidation: 'NOT_RUN', argumentKeySignature: [],
        argumentTypeSignature: [], executionStatus: 'NOT_RUN', resultComparison: 'NOT_COMPARABLE',
        evidenceStatus: 'NOT_RUN', verificationStatus: 'NOT_RUN', evidenceCount: 0, toolCalls: 0,
        writes: 0, businessApiReadCalls: 0, writeBlocked: false, reasonCodes: [], stateHistory: [] };
    const finish = reason => Object.freeze({ ...safe, reasonCodes: [reason], durationMs: performance.now() - started });
    if (!executionShadowEnabled(options.env)) return finish('V5_EXECUTION_DISABLED');
    const selected = selectReadExecution(input.capabilityId);
    safe.toolSelectionStatus = selected.status;
    if (selected.status !== 'UNIQUE') return finish(selected.status);
    const { entry } = selected;
    const capability = getV5Capability(input.capabilityId);
    // Independent formal Tool metadata + risk lock, checked again at execution boundary.
    if (!readPolicyLock(capability, entry)) { safe.writeBlocked = true; return finish('WRITE_BLOCKED'); }
    safe.toolName = entry.toolName;
    const entity = input.task?.entityContext?.length === 1 ? input.task.entityContext[0] : null;
    const bound = bindReadArguments(entry, entity, input.authoritativeCandidate);
    safe.argumentValidation = bound.status;
    if (bound.status !== 'VALIDATED') return finish(bound.status);
    safe.argumentKeySignature = Object.keys(bound.arguments);
    safe.argumentTypeSignature = Object.values(bound.arguments).map(value => typeof value);
    const request = createV5ToolRequest({ taskId: input.task.taskId, toolName: entry.toolName,
        capability: capability.capabilityId, riskClass: capability.riskClass,
        rawArguments: bound.arguments, validatedArguments: bound.arguments, entityRefs: [entity] });
    const gate = runV5ControlledShadowRuntime({ task: input.task, routeInput: input.routeInput,
        toolRequest: request, approvalState: 'NOT_REQUIRED' });
    if (gate.executionProjection.status !== 'WOULD_EXECUTE' || gate.policyDecision?.decision !== 'ALLOW') {
        return finish('CONTROLLED_RUNTIME_DENIED');
    }
    // Continue the very same routed task with the existing legal transition, not a direct executor call.
    let task = createV5Task({ ...gate.capabilityOutcome.shadowTask, execution: { toolRequest: request } });
    task = transitionTask(task, 'EXECUTING', { policyDecision: gate.policyDecision.decision, reasonCode: 'READ_EXECUTION_ALLOWED' });
    const controller = new AbortController();
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? Math.min(options.timeoutMs, DEFAULT_READ_EXECUTION_TIMEOUT_MS) : DEFAULT_READ_EXECUTION_TIMEOUT_MS;
    let timer;
    let result;
    safe.toolCalls = 1;
    try {
        const execute = options.execute || require('../../routes/ai/executor.cjs').executeToolCall;
        result = await Promise.race([
            Promise.resolve().then(() => execute(entry.toolName, bound.arguments, {
                allowWrite: false, operationId: task.taskId, signal: controller.signal,
            })),
            new Promise((_, reject) => { timer = setTimeout(() => {
                controller.abort(); reject(Object.assign(new Error('Read timeout'), { code: 'TOOL_EXECUTION_TIMEOUT' }));
            }, timeoutMs); }),
        ]);
        if (result?.success !== true) throw Object.assign(new Error('Read failed'), { code: 'TOOL_EXECUTION_ERROR' });
    } catch (error) {
        safe.executionStatus = error.code === 'TOOL_EXECUTION_TIMEOUT' ? 'TIMEOUT' : 'ERROR';
        task = transitionTask(task, 'FAILED_TOOL', { reasonCode: 'READ_EXECUTION_FAILED' });
        safe.stateHistory = task.stateHistory.map(step => step.to);
        return finish(safe.executionStatus === 'TIMEOUT' ? 'TOOL_EXECUTION_TIMEOUT' : 'TOOL_EXECUTION_ERROR');
    } finally { clearTimeout(timer); }
    safe.executionStatus = 'SUCCESS';
    safe.businessApiReadCalls = result.executionEvidence?.calls?.filter(call => call.method === 'GET').length || 0;
    const toolResult = createV5ToolResult({ taskId: task.taskId, toolName: entry.toolName, status: 'success', data: null });
    task = createV5Task({ ...task, execution: { toolRequest: request, toolResult } });
    task = transitionTask(task, 'COLLECTING_EVIDENCE', { reasonCode: 'READ_RESULT_RECEIVED' });
    const valid = inspectReadResult(entry, entity, result, bound.arguments);
    const requirements = listEvidenceRequirements(capability.capabilityId);
    let ledger = createEvidenceLedger(task.taskId);
    if (requirements.length) {
        ledger = addEvidence(ledger, toolResultToCandidateEvidence(toolResult, {
            evidenceId: `${task.taskId}:read`, claimType: requirements[0].claimType,
            capabilityId: capability.capabilityId, createdAt: new Date().toISOString(),
            formalSourceValidated: valid, freshness: valid ? 'CURRENT' : 'UNKNOWN',
            entityConsistent: valid, entityRef: entity, sourceRef: `${task.taskId}:tool`,
        }));
    }
    safe.evidenceCount = ledger.items.length;
    safe.evidenceStatus = valid && ledger.items.length ? 'VALID' : 'UNKNOWN';
    task = transitionTask(task, 'VERIFYING', { ...verificationTransitionContext(ledger, true), reasonCode: 'READ_VERIFY' });
    const verification = verifyV5Task({ ledger, requirements,
        execution: { toolResults: [toolResult], executionRequired: true, orchestrationComplete: true } });
    safe.verificationStatus = !requirements.length ? 'VERIFICATION_REQUIREMENT_DEFERRED'
        : valid && verification.decision === 'VERIFIED' ? 'PASS' : 'FAIL';
    if (safe.verificationStatus === 'PASS') {
        task = transitionTask(task, 'COMPOSING', { ...composingTransitionContext(verification), reasonCode: 'READ_VERIFIED_NO_ANSWER' });
        // No Answer Composer or user response; existing terminal transition only.
        task = transitionTask(task, 'COMPLETED', { answerSupported: true, reasonCode: 'READ_SHADOW_COMPLETE' });
    } else task = transitionTask(task, 'FAILED_EVIDENCE', { reasonCode: 'READ_EVIDENCE_UNSUPPORTED' });
    if (typeof options.compare === 'function') {
        try { const comparison = options.compare(result); safe.resultComparison = ['MATCH', 'MISMATCH'].includes(comparison) ? comparison : 'NOT_COMPARABLE'; }
        catch { safe.resultComparison = 'NOT_COMPARABLE'; }
    }
    safe.stateHistory = task.stateHistory.map(step => step.to);
    return finish(safe.verificationStatus === 'PASS' ? 'READ_EXECUTION_VERIFIED' : safe.verificationStatus);
}

module.exports = { DEFAULT_READ_EXECUTION_TIMEOUT_MS, executionShadowEnabled, inspectReadResult, runReadExecutionShadow };
