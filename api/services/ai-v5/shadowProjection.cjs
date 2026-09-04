'use strict';

const { createHash, randomUUID } = require('node:crypto');
const {
    buildToolCapabilityReverseIndex,
    getV5Capability,
} = require('./capabilityRegistry.cjs');

const V5_SHADOW_PROJECTION_VERSION = 1;
const SAFE_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const SAFE_TRACE_ID_RE = /^[a-f0-9]{32}$/i;
const SAFE_LABEL_RE = /^[A-Za-z0-9._:-]{1,160}$/;

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}

function safeLabel(value, fallback = 'UNKNOWN') {
    const candidate = typeof value === 'string' ? value.trim() : '';
    return candidate && SAFE_LABEL_RE.test(candidate) ? candidate : fallback;
}

function safeCorrelation(value, pattern = SAFE_ID_RE) {
    const candidate = typeof value === 'string' ? value.trim() : '';
    return candidate && pattern.test(candidate) ? candidate : null;
}

function stableHash(value) {
    if (value === undefined || value === null || value === '') return null;
    return createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
}

function safeSourceRequestId(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    const safe = safeCorrelation(raw);
    return deepFreeze({
        value: safe,
        hash: safe || !raw ? null : stableHash(raw),
    });
}

function safeToolSteps(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 20).map(step => deepFreeze({
        toolName: safeLabel(step?.capabilityName || step?.toolName),
        success: step?.success === true,
        errorCode: safeLabel(step?.errorCode || (step?.success === false ? 'V4_TOOL_FAILED' : 'NONE')),
    }));
}

function safeObservedFacts(value) {
    const facts = value && value.version === 1 ? value : {};
    const safeItems = (items, mapper) => Array.isArray(items) ? items.slice(0, 24).map(mapper) : [];
    return deepFreeze({
        version: 1,
        entityNormalizations: safeItems(facts.entityNormalizations, item => ({
            entityType: safeLabel(item?.entityType),
            inputLength: Math.max(0, Number(item?.inputLength) || 0),
            outputLength: Math.max(0, Number(item?.outputLength) || 0),
            punctuationDelta: Number(item?.punctuationDelta) || 0,
            lengthDelta: Number(item?.lengthDelta) || 0,
            changed: item?.changed === true,
        })),
        entityResolutions: safeItems(facts.entityResolutions, item => ({
            entityType: safeLabel(item?.entityType),
            resolved: item?.resolved === true,
            matchType: safeLabel(item?.matchType),
            candidateCount: Math.max(0, Number(item?.candidateCount) || 0),
            ambiguity: item?.ambiguity === true,
            identityHash: /^[a-f0-9]{24}$/i.test(String(item?.identityHash || '')) ? item.identityHash : null,
            identityPreservationStatus: safeLabel(item?.identityPreservationStatus, 'NOT_AVAILABLE'),
        })),
        routes: safeItems(facts.routes, item => ({
            selectedToolName: item?.selectedToolName ? safeLabel(item.selectedToolName) : null,
            decision: safeLabel(item?.decision),
            availableToolCount: Math.max(0, Number(item?.availableToolCount) || 0),
            readWriteClass: safeLabel(item?.readWriteClass),
            routeSource: safeLabel(item?.routeSource),
        })),
        argumentValidations: safeItems(facts.argumentValidations, item => ({
            toolName: safeLabel(item?.toolName),
            status: ['VALIDATED', 'REJECTED'].includes(item?.status) ? item.status : 'UNKNOWN',
            validationCode: safeLabel(item?.validationCode, 'NONE'),
            keys: Array.isArray(item?.keys) ? item.keys.filter(key => SAFE_LABEL_RE.test(key)).slice(0, 32) : [],
            count: Math.max(0, Number(item?.count) || 0),
            typeSignature: Object.fromEntries(Object.entries(item?.typeSignature || {})
                .filter(([key, type]) => SAFE_LABEL_RE.test(key) && SAFE_LABEL_RE.test(String(type)))
                .slice(0, 32)),
        })),
        toolExecutions: safeItems(facts.toolExecutions, item => ({
            toolName: safeLabel(item?.toolName),
            capabilityId: safeLabel(item?.capabilityId, 'NOT_AVAILABLE'),
            readWriteClass: safeLabel(item?.readWriteClass),
            executionStatus: item?.executionStatus === 'FAILURE' ? 'FAILURE' : 'SUCCESS',
            argumentKeys: Array.isArray(item?.argumentKeys)
                ? item.argumentKeys.filter(key => SAFE_LABEL_RE.test(key)).slice(0, 32) : [],
            argumentCount: Math.max(0, Number(item?.argumentCount) || 0),
            argumentTypeSignature: Object.fromEntries(Object.entries(item?.argumentTypeSignature || {})
                .filter(([key, type]) => SAFE_LABEL_RE.test(key) && SAFE_LABEL_RE.test(String(type)))
                .slice(0, 32)),
        })),
        verifications: safeItems(facts.verifications, item => ({
            decision: item?.decision === true,
            status: safeLabel(item?.status),
            beforeAnyTool: item?.beforeAnyTool === true,
            requiredCount: Math.max(0, Number(item?.requiredCount) || 0),
            observedCount: Math.max(0, Number(item?.observedCount) || 0),
            missingCount: Math.max(0, Number(item?.missingCount) || 0),
        })),
        finalRuntimeStatus: safeLabel(facts.finalRuntimeStatus),
    });
}

function captureSafeV4ShadowFacts(input = {}, v4Result = {}, traceContext = null, options = {}) {
    const request = safeSourceRequestId(input.requestId || v4Result?.telemetry?.requestId);
    const sourceTraceId = safeCorrelation(traceContext?.traceId, SAFE_TRACE_ID_RE);
    const structural = options.structural && typeof options.structural === 'object'
        ? options.structural
        : {};
    return deepFreeze({
        version: V5_SHADOW_PROJECTION_VERSION,
        shadowTaskId: options.shadowTaskId || `v5-shadow-${randomUUID()}`,
        sourceRequestId: request.value,
        sourceRequestIdHash: request.hash,
        sourceTraceId,
        createdAt: options.createdAt || new Date().toISOString(),
        runtimePath: 'ai_dispatcher_v3',
        requestMode: safeLabel(v4Result?.intent?.mode),
        allowWrite: input.allowWrite === true,
        finalV4Status: safeLabel(v4Result?.telemetry?.outcome),
        toolSteps: safeToolSteps(v4Result?.telemetry?.toolSteps),
        observed: safeObservedFacts(options.shadowFacts),
        structural: {
            failureClass: safeLabel(structural.failureClass, 'NONE'),
            expectedSuccess: structural.expectedSuccess === true,
            intendedCapabilityId: safeLabel(structural.intendedCapabilityId, 'UNKNOWN'),
            validatedArgumentsReady: structural.validatedArgumentsReady === true
                ? true
                : structural.validatedArgumentsReady === false ? false : null,
            stateValid: structural.stateValid === true
                ? true
                : structural.stateValid === false ? false : null,
            entityStatus: safeLabel(structural.entityStatus),
            verificationStatus: safeLabel(structural.verificationStatus),
        },
    });
}

function assessTools(toolSteps) {
    const reverse = buildToolCapabilityReverseIndex();
    const tools = toolSteps.map(step => {
        const capabilityIds = reverse[step.toolName] || [];
        const capability = capabilityIds.length === 1 ? getV5Capability(capabilityIds[0]) : null;
        return deepFreeze({
            toolName: step.toolName,
            executionStatus: step.success ? 'SUCCESS' : 'FAILURE',
            capabilityId: capability?.capabilityId || null,
            readWriteClass: capability?.readWriteClass || 'UNKNOWN',
            riskClass: capability?.riskClass || 'UNKNOWN',
            mappingStatus: capabilityIds.length === 1 ? 'UNIQUE' : capabilityIds.length > 1 ? 'AMBIGUOUS' : 'NOT_AVAILABLE',
        });
    });
    return deepFreeze(tools);
}

function projectSafeV4Facts(facts = {}) {
    if (!facts || facts.version !== V5_SHADOW_PROJECTION_VERSION || !facts.shadowTaskId) {
        return deepFreeze({ status: 'INVALID', reasonCodes: ['SHADOW_PROJECTION_INVALID'] });
    }
    const observed = safeObservedFacts(facts.observed);
    const observedToolSteps = observed.toolExecutions.map(item => ({
        toolName: item.toolName,
        success: item.executionStatus === 'SUCCESS',
    }));
    const toolAssessment = assessTools(observedToolSteps.length > 0
        ? observedToolSteps
        : Array.isArray(facts.toolSteps) ? facts.toolSteps : []);
    const intendedCapability = facts.structural?.intendedCapabilityId === 'UNKNOWN'
        ? null
        : getV5Capability(facts.structural?.intendedCapabilityId);
    const incompatibleTools = intendedCapability
        ? toolAssessment.filter(item => !intendedCapability.allowedTools.includes(item.toolName)).length
        : null;
    const latestValidationByTool = new Map();
    for (const validation of observed.argumentValidations) {
        latestValidationByTool.set(validation.toolName, validation);
    }
    const executionToolNames = new Set(toolAssessment.map(item => item.toolName));
    const relevantValidations = [...latestValidationByTool.values()].filter(item => (
        executionToolNames.size === 0 || executionToolNames.has(item.toolName)
    ));
    const observedValidatedArguments = relevantValidations.length === 0
        ? null
        : relevantValidations.every(item => item.status === 'VALIDATED');
    const validatedArgumentsReady = facts.structural?.validatedArgumentsReady ?? observedValidatedArguments;
    const latestResolution = observed.entityResolutions.at(-1) || null;
    const latestNormalization = observed.entityNormalizations.at(-1) || null;
    const latestVerification = observed.verifications.at(-1) || null;
    const finalRuntimeStatus = facts.finalV4Status !== 'UNKNOWN'
        ? facts.finalV4Status : observed.finalRuntimeStatus;
    const inferredStateValid = !['UNKNOWN', 'running', 'budget_exhausted'].includes(finalRuntimeStatus)
        ? true : finalRuntimeStatus === 'UNKNOWN' ? null : false;
    const stateValid = facts.structural?.stateValid ?? inferredStateValid;
    const entityStatus = facts.structural?.entityStatus !== 'UNKNOWN'
        ? facts.structural.entityStatus
        : latestResolution ? (latestResolution.resolved ? 'RESOLVED' : latestResolution.ambiguity ? 'AMBIGUOUS' : 'UNRESOLVED')
            : latestNormalization ? 'NORMALIZED_ONLY' : 'UNKNOWN';
    const verificationStatus = facts.structural?.verificationStatus !== 'UNKNOWN'
        ? facts.structural.verificationStatus
        : latestVerification?.status || 'UNKNOWN';
    const unavailable = [];
    if (entityStatus === 'UNKNOWN') unavailable.push('ENTITY_STRUCTURAL_METADATA_NOT_AVAILABLE');
    if (validatedArgumentsReady === null) unavailable.push('ARGUMENT_VALIDATION_STATUS_NOT_AVAILABLE');
    if (!intendedCapability) unavailable.push('INTENDED_CAPABILITY_NOT_AVAILABLE');
    if (verificationStatus === 'UNKNOWN') unavailable.push('VERIFICATION_CLASSIFICATION_NOT_AVAILABLE');
    if (toolAssessment.length === 0) unavailable.push('TOOL_EXECUTION_METADATA_NOT_AVAILABLE');
    if (stateValid === null) unavailable.push('STATE_STRUCTURAL_METADATA_NOT_AVAILABLE');

    return deepFreeze({
        status: unavailable.length === 0 ? 'COMPLETE' : 'INCOMPLETE',
        shadowTaskId: facts.shadowTaskId,
        sourceRequestId: facts.sourceRequestId,
        sourceRequestIdHash: facts.sourceRequestIdHash,
        sourceTraceId: facts.sourceTraceId,
        projectionStatus: unavailable.length === 0 ? 'PROJECTED' : 'PARTIAL',
        entityAssessment: {
            status: entityStatus,
            entityType: latestResolution?.entityType || latestNormalization?.entityType || 'UNKNOWN',
            resolved: latestResolution?.resolved ?? null,
            matchType: latestResolution?.matchType || 'UNKNOWN',
            candidateCount: latestResolution?.candidateCount ?? null,
            identityHash: latestResolution?.identityHash || null,
            identityPreservationStatus: latestResolution?.identityPreservationStatus || 'NOT_AVAILABLE',
            normalizationChanged: latestNormalization?.changed ?? null,
            punctuationDelta: latestNormalization?.punctuationDelta ?? null,
            lengthDelta: latestNormalization?.lengthDelta ?? null,
        },
        capabilityAssessment: {
            intendedCapabilityId: intendedCapability?.capabilityId || null,
            actualCapabilityIds: [...new Set(toolAssessment.map(item => item.capabilityId).filter(Boolean))],
            toolMappingsComplete: toolAssessment.every(item => item.mappingStatus === 'UNIQUE'),
        },
        toolExposureAssessment: {
            tools: toolAssessment,
            incompatibleToolCount: incompatibleTools,
        },
        stateAssessment: {
            valid: stateValid,
            finalV4Status: finalRuntimeStatus,
        },
        policyAssessment: {
            decision: toolAssessment.length > 0 && toolAssessment.every(item => item.readWriteClass === 'READ')
                ? 'READ_ONLY_CANDIDATE'
                : 'NOT_AVAILABLE',
        },
        evidenceAssessment: {
            status: verificationStatus,
            requiredCount: latestVerification?.requiredCount ?? null,
            observedCount: latestVerification?.observedCount ?? null,
            missingCount: latestVerification?.missingCount ?? null,
        },
        verificationAssessment: {
            status: verificationStatus,
            decision: latestVerification?.decision ?? null,
            beforeAnyTool: latestVerification?.beforeAnyTool ?? null,
        },
        argumentAssessment: {
            status: validatedArgumentsReady === true ? 'VALIDATED'
                : validatedArgumentsReady === false ? 'REJECTED' : 'UNKNOWN',
            validations: relevantValidations,
        },
        availability: {
            entityFactsAvailable: entityStatus !== 'UNKNOWN',
            capabilityFactsAvailable: toolAssessment.length > 0 && toolAssessment.every(item => item.mappingStatus === 'UNIQUE'),
            argumentFactsAvailable: validatedArgumentsReady !== null,
            stateFactsAvailable: stateValid !== null,
            verificationFactsAvailable: verificationStatus !== 'UNKNOWN',
        },
        sourceFailureClass: facts.structural?.failureClass || 'NONE',
        expectedSuccess: facts.structural?.expectedSuccess === true,
        validatedArgumentsReady,
        reasonCodes: unavailable,
    });
}

module.exports = {
    V5_SHADOW_PROJECTION_VERSION,
    captureSafeV4ShadowFacts,
    projectSafeV4Facts,
};
