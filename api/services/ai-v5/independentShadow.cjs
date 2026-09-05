'use strict';

const { createV5EntityReference, createV5Task } = require('./contracts.cjs');
const { transitionTask } = require('./taskState.cjs');
const { routeV5Capability } = require('./capabilityRouter.cjs');
const { getV5ToolExposure } = require('./toolExposure.cjs');
const { buildToolCapabilityReverseIndex, getV5Capability } = require('./capabilityRegistry.cjs');
const { anchorInterpretationEntities } = require('./sourceAnchoredEntity.cjs');
const { interpretCandidateSetTask } = require('./candidateSetTwoStageInterpreter.cjs');
const {
    createV5InterpreterInputEnvelope,
    validateV5InterpreterInputEnvelope,
} = require('./taskInterpreterInput.cjs');

const V5_INDEPENDENT_SHADOW_VERSION = 1;

function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
}

function extractSourceUserRequest(messages) {
    if (!Array.isArray(messages)) return null;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message?.role === 'user' && typeof message.content === 'string' && message.content.length > 0) {
            return message.content;
        }
    }
    return null;
}

function baseOutcome(input, interpretationResult, overrides = {}) {
    return freeze({
        version: V5_INDEPENDENT_SHADOW_VERSION,
        shadowTaskId: input.shadowTaskId || null,
        interpreterStatus: interpretationResult.status,
        protocolStatus: interpretationResult.protocolStatus || interpretationResult.status,
        interpreterReasonCode: interpretationResult.reasonCode,
        taskClassRef: interpretationResult.taskClassRef || null,
        sourceSpanRefs: interpretationResult.sourceSpanRefs || [],
        provider: interpretationResult.provider,
        model: interpretationResult.model,
        modelCalls: interpretationResult.modelCalls,
        usage: interpretationResult.usage,
        completionLatencyMs: interpretationResult.durationMs,
        inputFingerprint: input.interpreterEnvelope?.inputFingerprint || null,
        domain: null,
        operation: null,
        entityTypes: [],
        entityAnchorStatuses: [],
        capabilityOutcome: 'NOT_RUN',
        capabilityId: null,
        allowedToolNames: [],
        toolCount: 0,
        executionAllowed: false,
        v5ToolCalls: 0,
        v5BusinessApiCalls: interpretationResult.architectureMetadata?.businessApiCalls || 0,
        architectureMetadata: interpretationResult.architectureMetadata || null,
        v5Writes: 0,
        reasonCodes: [interpretationResult.reasonCode],
        ...overrides,
    });
}

function createRoutingTask(input, interpretation, anchors, now, resolvedIdentity = null) {
    let task = createV5Task({
        taskId: input.shadowTaskId,
        createdAt: now,
        updatedAt: now,
        intent: { domain: interpretation.domain, operation: interpretation.operation },
        entityContext: anchors.map(anchor => createV5EntityReference({
            entityType: anchor.entityType,
            rawMention: anchor.rawMention,
            normalizedMention: null,
            canonicalEntityId: resolvedIdentity?.entityType === anchor.entityType ? resolvedIdentity.canonicalId : null,
            resolutionReceiptRef: null,
            aliasSource: null,
        })),
    });
    task = transitionTask(task, 'UNDERSTANDING', { timestamp: now, reasonCode: 'INTERPRETATION_VALID' });
    task = transitionTask(task, 'RESOLVING_ENTITY', { timestamp: now, reasonCode: 'SOURCE_ANCHOR_REQUIRED' });
    return transitionTask(task, 'ROUTING', { timestamp: now, reasonCode: 'SOURCE_ANCHOR_VALID' });
}

function routeAllEntityTypes(task, interpretation) {
    const types = [...new Set(interpretation.entityCandidates.map(item => item.entityType))];
    const results = types.map(entityType => routeV5Capability(task, {
        domain: interpretation.domain,
        operation: interpretation.operation,
        entityType,
    }));
    const selectedIds = [...new Set(results
        .filter(item => item.outcome === 'SELECTED')
        .map(item => item.capabilityId))];
    if (results.some(item => item.outcome === 'INVALID')) {
        return freeze({ outcome: 'INVALID', reasonCode: 'INDEPENDENT_ROUTE_INVALID', capabilityId: null });
    }
    if (results.some(item => item.outcome === 'UNRESOLVED')) {
        return freeze({ outcome: 'UNRESOLVED', reasonCode: 'INDEPENDENT_ROUTE_UNRESOLVED', capabilityId: null });
    }
    if (results.some(item => item.outcome === 'AMBIGUOUS') || selectedIds.length !== 1) {
        return freeze({ outcome: 'AMBIGUOUS', reasonCode: 'INDEPENDENT_ROUTE_AMBIGUOUS', capabilityId: null });
    }
    return freeze({ outcome: 'SELECTED', reasonCode: 'INDEPENDENT_ROUTE_SELECTED', capabilityId: selectedIds[0] });
}

async function runV5IndependentShadow(input = {}, options = {}) {
    let interpreterEnvelope = input.interpreterEnvelope;
    try {
        if (!validateV5InterpreterInputEnvelope(interpreterEnvelope)) {
            interpreterEnvelope = createV5InterpreterInputEnvelope({
                rawUserRequest: input.sourceRequest,
                pageContext: input.pageContext ?? null,
            });
        }
    } catch {
        interpreterEnvelope = null;
    }
    const interpretedInput = { ...input, interpreterEnvelope };
    const interpretationResult = await (options.interpret || interpretCandidateSetTask)(interpreterEnvelope, {
        env: options.env,
        modelRequest: options.modelRequest,
        observeModelCall: options.observeModelCall,
        shadowTaskId: input.shadowTaskId,
        timeoutMs: options.timeoutMs,
        selected: options.selected,
        internalFetch: options.internalFetch,
        lookupEntities: options.lookupEntities,
        lookupTimeoutMs: options.lookupTimeoutMs,
        onBusinessApiCall: options.onBusinessApiCall,
    });
    if (interpretationResult.status !== 'VALID') return baseOutcome(interpretedInput, interpretationResult);
    const interpretation = interpretationResult.interpretation;
    if (interpretation.needsClarification) {
        return baseOutcome(interpretedInput, interpretationResult, {
            domain: interpretation.domain,
            operation: interpretation.operation,
            entityTypes: interpretation.entityCandidates.map(item => item.entityType),
            capabilityOutcome: 'INVALID',
            reasonCodes: ['INTERPRETATION_NEEDS_CLARIFICATION'],
        });
    }
    const anchoring = anchorInterpretationEntities(interpreterEnvelope.rawUserRequest, interpretation);
    const entityTypes = interpretation.entityCandidates.map(item => item.entityType);
    const anchorStatuses = anchoring.anchors.map(item => item.status);
    if (!anchoring.valid) {
        return baseOutcome(interpretedInput, interpretationResult, {
            interpreterStatus: 'INVALID',
            interpreterReasonCode: anchoring.status,
            domain: interpretation.domain,
            operation: interpretation.operation,
            entityTypes,
            entityAnchorStatuses: anchorStatuses,
            capabilityOutcome: 'INVALID',
            reasonCodes: [anchoring.status],
        });
    }
    let task;
    try {
        task = createRoutingTask(
            input,
            interpretation,
            anchoring.anchors,
            options.now || new Date().toISOString(),
            interpretationResult.resolvedIdentity
        );
    } catch {
        return baseOutcome(interpretedInput, interpretationResult, {
            interpreterStatus: 'INVALID',
            interpreterReasonCode: 'INDEPENDENT_TASK_INVALID',
            domain: interpretation.domain,
            operation: interpretation.operation,
            entityTypes,
            entityAnchorStatuses: anchorStatuses,
            capabilityOutcome: 'INVALID',
            reasonCodes: ['INDEPENDENT_TASK_INVALID'],
        });
    }
    const route = routeAllEntityTypes(task, interpretation);
    const exposure = route.outcome === 'SELECTED'
        ? getV5ToolExposure(route)
        : { allowedToolNames: [], toolCount: 0, executionAllowed: false, reasonCode: route.reasonCode };
    let readExecution = null;
    const { executionShadowEnabled, runReadExecutionShadow } = require('./readExecutionShadow.cjs');
    if (route.outcome === 'SELECTED' && executionShadowEnabled(options.env)
        && interpretationResult.architectureMetadata?.complete === true
        && interpretationResult.architectureMetadata?.finalEntityStatus === 'FINAL_ENTITY_RESOLVED') {
        // A request-local receipt for the completed authoritative V3 resolution;
        // never a business ID and never synthesized for unresolved interpretations.
        const receivedTask = createV5Task({ taskId: task.taskId, createdAt: task.createdAt,
            intent: task.intent, entityContext: task.entityContext.map(ref => createV5EntityReference({
                ...ref, resolutionReceiptRef: `${task.taskId}:v3-finalization`,
            })) });
        try {
            readExecution = await runReadExecutionShadow({ task: receivedTask, capabilityId: route.capabilityId,
                routeInput: { domain: interpretation.domain, operation: interpretation.operation, entityType: entityTypes[0] } },
            { env: options.env, compare: options.compareReadResult });
        } catch { readExecution = { executionStatus: 'ERROR', toolCalls: 0, reasonCodes: ['READ_SHADOW_INTERNAL_ERROR'] }; }
    }
    return baseOutcome(interpretedInput, interpretationResult, {
        domain: interpretation.domain,
        operation: interpretation.operation,
        entityTypes,
        entityAnchorStatuses: anchorStatuses,
        capabilityOutcome: route.outcome,
        capabilityId: route.capabilityId,
        allowedToolNames: [...exposure.allowedToolNames],
        toolCount: exposure.toolCount,
        executionAllowed: false,
        ...(readExecution ? { readExecution, v5ToolCalls: readExecution.toolCalls,
            v5BusinessApiCalls: (interpretationResult.architectureMetadata?.businessApiCalls || 0) + (readExecution.businessApiReadCalls || 0) } : {}),
        reasonCodes: [...new Set([
            'INTERPRETATION_VALID',
            'SOURCE_ANCHOR_VALID',
            route.reasonCode,
            exposure.reasonCode,
            ...(readExecution ? readExecution.reasonCodes : ['V5_EXECUTION_DISABLED']),
        ])],
    });
}

function expectedCapabilityFromOracle(expected = {}) {
    const reverse = buildToolCapabilityReverseIndex();
    const ids = reverse[expected.primaryTool || expected.primary_tool] || [];
    return ids.length === 1 ? getV5Capability(ids[0]) : null;
}

function evaluateIndependentShadow(outcome, oracle = {}, actual = {}) {
    const expectedCapability = expectedCapabilityFromOracle(oracle);
    const expectedTool = oracle.primaryTool || oracle.primary_tool || null;
    const expectedEntityTypes = expectedCapability?.requiredEntityTypes || [];
    const actualTools = Array.isArray(actual.toolNames) ? actual.toolNames : [];
    const oracleAllowed = new Set(oracle.allowedTools || oracle.allowed_tools || (expectedTool ? [expectedTool] : []));
    const wrongActualTools = actualTools.filter(name => !oracleAllowed.has(name));
    const valid = outcome?.interpreterStatus === 'VALID';
    const domainMatch = valid && Boolean(expectedCapability) && outcome.domain === expectedCapability.domain;
    const operationMatch = valid && Boolean(expectedCapability) && outcome.operation === expectedCapability.operation;
    const entityTypeMatch = valid && expectedEntityTypes.length > 0
        && expectedEntityTypes.every(type => outcome.entityTypes.includes(type));
    const entityAnchorMatch = valid && outcome.entityAnchorStatuses.length > 0
        && outcome.entityAnchorStatuses.every(status => status === 'ANCHORED');
    const capabilityMatch = valid && Boolean(expectedCapability)
        && outcome.capabilityOutcome === 'SELECTED'
        && outcome.capabilityId === expectedCapability.capabilityId;
    const expectedToolExposed = capabilityMatch && outcome.allowedToolNames.includes(expectedTool);
    const wrongToolExcluded = wrongActualTools.every(name => !outcome.allowedToolNames.includes(name));
    const allCorrect = domainMatch && operationMatch && entityTypeMatch
        && entityAnchorMatch && capabilityMatch && expectedToolExposed && wrongToolExcluded;
    let overallComparison = 'V5_INSUFFICIENT_DATA';
    const anchorRejected = outcome?.interpreterStatus === 'INVALID'
        && outcome?.reasonCodes?.includes('INVALID_ENTITY_REFERENCE');
    if (actual.v4Result === 'PASS') overallComparison = allCorrect ? 'AGREE' : 'V5_FALSE_BLOCK';
    else if (anchorRejected && actual.rootCauseClass === 'A01') {
        overallComparison = 'V5_BLOCKS_V4_FAILURE';
    } else if (allCorrect && (actual.rootCauseClass === 'R02' || wrongActualTools.length > 0)) {
        overallComparison = 'V5_BLOCKS_V4_FAILURE';
    } else if (allCorrect) overallComparison = 'AGREE';
    return freeze({
        interpreterStatus: outcome?.interpreterStatus || 'ERROR',
        domainMatch,
        operationMatch,
        entityTypeMatch,
        entityAnchorStatus: entityAnchorMatch ? 'ANCHORED' : 'INVALID',
        capabilityOutcome: outcome?.capabilityOutcome || 'NOT_RUN',
        capabilityMatch,
        expectedToolExposed,
        wrongToolExcluded,
        overallComparison,
        reasonCodes: [...new Set([
            ...(outcome?.reasonCodes || []),
            ...(allCorrect ? ['INDEPENDENT_ORACLE_MATCH'] : ['INDEPENDENT_ORACLE_MISMATCH']),
        ])],
    });
}

module.exports = {
    V5_INDEPENDENT_SHADOW_VERSION,
    evaluateIndependentShadow,
    expectedCapabilityFromOracle,
    extractSourceUserRequest,
    runV5IndependentShadow,
};
