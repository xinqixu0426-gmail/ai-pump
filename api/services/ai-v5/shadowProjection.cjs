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
    const toolAssessment = assessTools(Array.isArray(facts.toolSteps) ? facts.toolSteps : []);
    const intendedCapability = facts.structural?.intendedCapabilityId === 'UNKNOWN'
        ? null
        : getV5Capability(facts.structural?.intendedCapabilityId);
    const incompatibleTools = intendedCapability
        ? toolAssessment.filter(item => !intendedCapability.allowedTools.includes(item.toolName)).length
        : null;
    const unavailable = [];
    if (facts.structural?.entityStatus === 'UNKNOWN') unavailable.push('ENTITY_STRUCTURAL_METADATA_NOT_AVAILABLE');
    if (facts.structural?.validatedArgumentsReady === null) unavailable.push('ARGUMENT_VALIDATION_STATUS_NOT_AVAILABLE');
    if (!intendedCapability) unavailable.push('INTENDED_CAPABILITY_NOT_AVAILABLE');
    if (facts.structural?.verificationStatus === 'UNKNOWN') unavailable.push('VERIFICATION_CLASSIFICATION_NOT_AVAILABLE');
    if (toolAssessment.length === 0) unavailable.push('TOOL_EXECUTION_METADATA_NOT_AVAILABLE');

    return deepFreeze({
        status: unavailable.length === 0 ? 'COMPLETE' : 'INCOMPLETE',
        shadowTaskId: facts.shadowTaskId,
        sourceRequestId: facts.sourceRequestId,
        sourceRequestIdHash: facts.sourceRequestIdHash,
        sourceTraceId: facts.sourceTraceId,
        projectionStatus: unavailable.length === 0 ? 'PROJECTED' : 'PARTIAL',
        entityAssessment: {
            status: facts.structural?.entityStatus || 'UNKNOWN',
        },
        capabilityAssessment: {
            intendedCapabilityId: intendedCapability?.capabilityId || null,
            toolMappingsComplete: toolAssessment.every(item => item.mappingStatus === 'UNIQUE'),
        },
        toolExposureAssessment: {
            tools: toolAssessment,
            incompatibleToolCount: incompatibleTools,
        },
        stateAssessment: {
            valid: facts.structural?.stateValid ?? null,
            finalV4Status: facts.finalV4Status,
        },
        policyAssessment: {
            decision: toolAssessment.length > 0 && toolAssessment.every(item => item.readWriteClass === 'READ')
                ? 'READ_ONLY_CANDIDATE'
                : 'NOT_AVAILABLE',
        },
        evidenceAssessment: {
            status: facts.structural?.verificationStatus || 'UNKNOWN',
        },
        verificationAssessment: {
            status: facts.structural?.verificationStatus || 'UNKNOWN',
        },
        sourceFailureClass: facts.structural?.failureClass || 'NONE',
        expectedSuccess: facts.structural?.expectedSuccess === true,
        validatedArgumentsReady: facts.structural?.validatedArgumentsReady ?? null,
        reasonCodes: unavailable,
    });
}

module.exports = {
    V5_SHADOW_PROJECTION_VERSION,
    captureSafeV4ShadowFacts,
    projectSafeV4Facts,
};
