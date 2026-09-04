'use strict';

const V5_SHADOW_COMPARISON_STATUSES = Object.freeze([
    'AGREE', 'AGREE_WITH_DEFERRED_VERIFICATION', 'V5_BLOCKS_V4_FAILURE',
    'V5_FALSE_BLOCK', 'V5_INSUFFICIENT_DATA', 'NOT_COMPARABLE', 'SHADOW_ERROR',
]);
const V5_LAYER_COMPARISON_STATUSES = Object.freeze([
    'AGREE', 'V5_BLOCKS_V4_FAILURE', 'V5_FALSE_BLOCK', 'INSUFFICIENT_DATA', 'NOT_APPLICABLE',
]);

const { buildToolCapabilityReverseIndex } = require('./capabilityRegistry.cjs');
const { captureSafeV4ShadowFacts, projectSafeV4Facts } = require('./shadowProjection.cjs');

function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
}

function layer(status, reasonCode) {
    return freeze({ status, reasonCodes: reasonCode ? [reasonCode] : [] });
}

function blockedLayer(projection, reasonCode) {
    return layer(projection.expectedSuccess ? 'V5_FALSE_BLOCK' : 'V5_BLOCKS_V4_FAILURE', reasonCode);
}

function compareEntity(projection) {
    const status = projection.entityAssessment?.status;
    if (!status || status === 'UNKNOWN') return layer('INSUFFICIENT_DATA', 'ENTITY_FACTS_NOT_AVAILABLE');
    if (status === 'NOT_APPLICABLE' || status === 'NORMALIZED_ONLY') return layer('NOT_APPLICABLE');
    if (['AMBIGUOUS', 'UNRESOLVED', 'IDENTITY_NOT_PRESERVED'].includes(status)) {
        return blockedLayer(projection, status === 'IDENTITY_NOT_PRESERVED'
            ? 'ENTITY_IDENTITY_SHAPE_NOT_PRESERVED' : 'ENTITY_IDENTITY_NOT_RESOLVED');
    }
    return layer('AGREE');
}

function compareCapability(projection) {
    if (!projection.capabilityAssessment?.intendedCapabilityId) {
        return layer('INSUFFICIENT_DATA', 'INTENDED_CAPABILITY_NOT_AVAILABLE');
    }
    if (Number(projection.toolExposureAssessment?.incompatibleToolCount) > 0) {
        return blockedLayer(projection, 'ACTUAL_TOOL_OUTSIDE_INTENDED_CAPABILITY');
    }
    return layer('AGREE');
}

function compareToolExposure(projection) {
    const tools = projection.toolExposureAssessment?.tools || [];
    if (tools.length === 0) return layer('INSUFFICIENT_DATA', 'TOOL_EXECUTION_METADATA_NOT_AVAILABLE');
    if (!projection.capabilityAssessment?.toolMappingsComplete) {
        return blockedLayer(projection, 'TOOL_CAPABILITY_MAPPING_INVALID');
    }
    if (tools.some(item => item.readWriteClass !== 'READ')) {
        return blockedLayer(projection, 'NON_READ_TOOL_EXPOSURE');
    }
    return layer('AGREE');
}

function compareArgument(projection) {
    if (projection.validatedArgumentsReady === null) {
        return layer('INSUFFICIENT_DATA', 'ARGUMENT_VALIDATION_STATUS_NOT_AVAILABLE');
    }
    return projection.validatedArgumentsReady
        ? layer('AGREE') : blockedLayer(projection, 'ARGUMENTS_NOT_VALIDATED');
}

function compareState(projection) {
    if (projection.stateAssessment?.valid === null) return layer('INSUFFICIENT_DATA', 'STATE_FACTS_NOT_AVAILABLE');
    return projection.stateAssessment.valid
        ? layer('AGREE') : blockedLayer(projection, 'INVALID_TERMINAL_STATE');
}

function comparePolicy(projection) {
    if (projection.policyAssessment?.decision === 'NOT_AVAILABLE') {
        return layer('INSUFFICIENT_DATA', 'POLICY_FACTS_NOT_AVAILABLE');
    }
    return projection.policyAssessment.decision === 'READ_ONLY_CANDIDATE'
        ? layer('AGREE') : blockedLayer(projection, 'POLICY_REJECTED');
}

function compareVerification(projection) {
    const status = projection.verificationAssessment?.status;
    if (!status || status === 'UNKNOWN') return layer('INSUFFICIENT_DATA', 'VERIFICATION_FACTS_NOT_AVAILABLE');
    const normalized = String(status).toLowerCase();
    if (['verified', 'completed', 'completed_negative'].includes(normalized)) return layer('AGREE');
    if (normalized === 'not_applicable') return layer('NOT_APPLICABLE');
    return blockedLayer(projection, 'VERIFICATION_REJECTED');
}

function overallFromLayers(projection, layers) {
    const values = Object.values(layers).map(item => item.status);
    if (values.includes('V5_FALSE_BLOCK')) return 'V5_FALSE_BLOCK';
    if (values.includes('V5_BLOCKS_V4_FAILURE')) return 'V5_BLOCKS_V4_FAILURE';
    const insufficientKeys = Object.entries(layers)
        .filter(([, item]) => item.status === 'INSUFFICIENT_DATA')
        .map(([key]) => key);
    if (insufficientKeys.length === 0) return 'AGREE';
    if (projection.expectedSuccess && insufficientKeys.every(key => key === 'verificationComparison')) {
        return 'AGREE_WITH_DEFERRED_VERIFICATION';
    }
    return 'V5_INSUFFICIENT_DATA';
}

function compareV4ActualToV5Shadow(projection = {}) {
    try {
        if (!projection || projection.status === 'INVALID') {
            return freeze({ comparisonStatus: 'SHADOW_ERROR', reasonCodes: projection?.reasonCodes || ['SHADOW_PROJECTION_INVALID'] });
        }
        const layers = freeze({
            entityComparison: compareEntity(projection),
            capabilityComparison: compareCapability(projection),
            toolExposureComparison: compareToolExposure(projection),
            argumentComparison: compareArgument(projection),
            stateComparison: compareState(projection),
            policyComparison: comparePolicy(projection),
            verificationComparison: compareVerification(projection),
        });
        const comparisonStatus = overallFromLayers(projection, layers);
        const reasonCodes = [...new Set(Object.values(layers).flatMap(item => item.reasonCodes))];
        return freeze({ comparisonStatus, ...layers, reasonCodes });
    } catch {
        return freeze({ comparisonStatus: 'SHADOW_ERROR', reasonCodes: ['SHADOW_COMPARISON_ERROR'] });
    }
}

function evaluateP06ProductionShadowControls(cases = [], options = {}) {
    const reverse = buildToolCapabilityReverseIndex();
    const frozenById = new Map((options.frozenCases || []).map(item => [item.case_id, item]));
    const paths = [];
    for (const item of Array.isArray(cases) ? cases : []) {
        if (item?.result === 'TRACE_INVALID') continue;
        const frozen = frozenById.get(item.case_id) || item;
        const rootCauseGroup = typeof frozen?.failure_class === 'string' ? frozen.failure_class : 'NONE';
        const actualFailureClass = typeof item?.failure_class === 'string' ? item.failure_class : 'NONE';
        const isSuccessControl = item?.result === 'PASS';
        const expectedTool = frozen?.expected?.primary_tool || item?.expected?.primary_tool;
        const capabilityIds = reverse[expectedTool] || [];
        const tools = Array.isArray(item?.safe_structural_metadata?.tools)
            ? item.safe_structural_metadata.tools : [];
        const intendedCapabilityId = capabilityIds.length === 1 ? capabilityIds[0] : 'UNKNOWN';
        const resolutions = item?.safe_structural_metadata?.entity_resolutions || [];
        const hasEntityResolution = resolutions.some(resolution => resolution?.resolved === true);
        const hasTypedUnresolvedEntity = resolutions.some(resolution => (
            resolution?.type && resolution.type !== 'unknown' && resolution?.resolved === false
        ));
        const identityNotPreserved = (item?.secondary_classes || []).includes('E04')
            || item?.failure_class === 'A01' && item?.suite?.includes('Exact Entity Identity');
        const verification = (item?.safe_structural_metadata?.verifications || []).at(-1);
        const actualProjection = item?.safe_structural_metadata?.shadow_projection;
        const validationStatus = actualProjection?.argument_validation_status;
        const facts = captureSafeV4ShadowFacts({ requestId: `p14-${item.case_id}` }, {
            intent: { mode: 'query' },
            telemetry: {
                outcome: item?.safe_structural_metadata?.terminal_state,
                toolSteps: tools.map(toolName => ({ capabilityName: toolName, success: true })),
            },
        }, null, {
            createdAt: options.createdAt || '1970-01-01T00:00:00.000Z',
            shadowTaskId: `v5-shadow-${item.case_id}`,
            structural: {
                failureClass: actualFailureClass,
                expectedSuccess: isSuccessControl,
                intendedCapabilityId,
                validatedArgumentsReady: validationStatus === 'VALIDATED' ? true
                    : validationStatus === 'REJECTED' ? false : null,
                stateValid: item?.result === 'PASS',
                entityStatus: identityNotPreserved ? 'IDENTITY_NOT_PRESERVED'
                    : hasEntityResolution ? 'RESOLVED'
                        : hasTypedUnresolvedEntity ? 'UNRESOLVED' : 'NOT_APPLICABLE',
                verificationStatus: verification?.status || 'NOT_APPLICABLE',
            },
        });
        const projection = projectSafeV4Facts(facts);
        const comparison = compareV4ActualToV5Shadow(projection);
        paths.push(freeze({
            caseId: item.case_id,
            sourceSuite: item.suite,
            v4Result: item.result,
            rootCauseClass: rootCauseGroup,
            actualFailureClass,
            traceId: item.trace_id || null,
            shadowTaskId: facts.shadowTaskId,
            layerComparisons: Object.fromEntries(Object.entries(comparison)
                .filter(([key]) => key.endsWith('Comparison'))
                .map(([key, value]) => [key, value.status])),
            overallComparison: comparison.comparisonStatus,
            reasonCodes: comparison.reasonCodes,
            availability: actualProjection ? {
                entityFactsAvailable: actualProjection.entity_facts_available === true,
                capabilityFactsAvailable: actualProjection.capability_facts_available === true,
                argumentFactsAvailable: actualProjection.argument_facts_available === true,
                stateFactsAvailable: actualProjection.state_facts_available === true,
                verificationFactsAvailable: actualProjection.verification_facts_available === true,
            } : projection.availability,
        }));
    }
    const comparableStatuses = new Set(['AGREE', 'AGREE_WITH_DEFERRED_VERIFICATION', 'V5_BLOCKS_V4_FAILURE', 'V5_FALSE_BLOCK']);
    const metrics = {
        attempted: paths.length,
        valid: paths.length,
        failedPaths: paths.filter(item => item.v4Result === 'FAIL').length,
        successControls: paths.filter(item => item.v4Result === 'PASS').length,
        comparable: paths.filter(item => comparableStatuses.has(item.overallComparison)).length,
        falseBlocks: paths.filter(item => item.overallComparison === 'V5_FALSE_BLOCK').length,
        blockedFailures: paths.filter(item => item.overallComparison === 'V5_BLOCKS_V4_FAILURE').length,
        agree: paths.filter(item => item.overallComparison === 'AGREE').length,
        agreeDeferred: paths.filter(item => item.overallComparison === 'AGREE_WITH_DEFERRED_VERIFICATION').length,
        insufficient: paths.filter(item => item.overallComparison === 'V5_INSUFFICIENT_DATA').length,
        notComparable: paths.filter(item => item.overallComparison === 'NOT_COMPARABLE').length,
        shadowError: paths.filter(item => item.overallComparison === 'SHADOW_ERROR').length,
    };
    for (const failureClass of ['C02', 'R02', 'A01']) {
        const selected = paths.filter(item => item.rootCauseClass === failureClass);
        metrics[`${failureClass.toLowerCase()}Total`] = selected.length;
        metrics[`${failureClass.toLowerCase()}Comparable`] = selected
            .filter(item => comparableStatuses.has(item.overallComparison)).length;
    }
    metrics.overallComparableRate = metrics.attempted === 0 ? 0 : metrics.comparable / metrics.attempted;
    return freeze({ paths, metrics });
}

module.exports = {
    V5_LAYER_COMPARISON_STATUSES,
    V5_SHADOW_COMPARISON_STATUSES,
    compareV4ActualToV5Shadow,
    evaluateP06ProductionShadowControls,
};
