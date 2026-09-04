'use strict';

const V5_SHADOW_COMPARISON_STATUSES = Object.freeze([
    'AGREE',
    'V5_BLOCKS_V4_FAILURE',
    'V5_FALSE_BLOCK',
    'V5_INSUFFICIENT_DATA',
    'NOT_COMPARABLE',
    'SHADOW_ERROR',
]);

const { buildToolCapabilityReverseIndex } = require('./capabilityRegistry.cjs');
const { captureSafeV4ShadowFacts, projectSafeV4Facts } = require('./shadowProjection.cjs');

function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
}

function result(status, reasons = []) {
    return freeze({ comparisonStatus: status, reasonCodes: [...new Set(reasons)] });
}

function compareV4ActualToV5Shadow(projection = {}) {
    try {
        if (!projection || projection.status === 'INVALID') {
            return result('SHADOW_ERROR', projection?.reasonCodes || ['SHADOW_PROJECTION_INVALID']);
        }
        const failureClass = projection.sourceFailureClass;
        if (failureClass === 'C02' && projection.stateAssessment?.valid === false) {
            return result('V5_BLOCKS_V4_FAILURE', ['V5_STATE_GATE_BLOCKS_C02']);
        }
        if (failureClass === 'R02'
            && Number(projection.toolExposureAssessment?.incompatibleToolCount) > 0) {
            return result('V5_BLOCKS_V4_FAILURE', ['V5_TOOL_EXPOSURE_BLOCKS_R02']);
        }
        if (failureClass === 'A01' && projection.validatedArgumentsReady === false) {
            return result('V5_BLOCKS_V4_FAILURE', ['V5_ARGUMENT_GATE_BLOCKS_A01']);
        }
        const explicitBlock = projection.stateAssessment?.valid === false
            || Number(projection.toolExposureAssessment?.incompatibleToolCount) > 0
            || projection.validatedArgumentsReady === false;
        if (projection.expectedSuccess && explicitBlock) {
            return result('V5_FALSE_BLOCK', ['V5_BLOCKS_SUCCESS_CONTROL']);
        }
        if (projection.status === 'INCOMPLETE') {
            return result('V5_INSUFFICIENT_DATA', projection.reasonCodes);
        }
        if (projection.expectedSuccess) return result('AGREE', ['V4_SUCCESS_V5_GATES_AGREE']);
        if (failureClass !== 'NONE') return result('NOT_COMPARABLE', ['FAILURE_CLASS_NOT_DETERMINISTICALLY_BLOCKED']);
        return result('AGREE', ['STRUCTURAL_OUTCOMES_AGREE']);
    } catch {
        return result('SHADOW_ERROR', ['SHADOW_COMPARISON_ERROR']);
    }
}

function evaluateP06ProductionShadowControls(cases = [], options = {}) {
    const reverse = buildToolCapabilityReverseIndex();
    const paths = [];
    for (const item of Array.isArray(cases) ? cases : []) {
        const failureClass = typeof item?.failure_class === 'string' ? item.failure_class : 'NONE';
        const isFailureControl = ['C02', 'R02', 'A01'].includes(failureClass);
        const isSuccessControl = item?.result === 'PASS';
        if (!isFailureControl && !isSuccessControl) continue;
        const expectedTool = item?.expected?.primary_tool;
        const capabilityIds = reverse[expectedTool] || [];
        const tools = Array.isArray(item?.safe_structural_metadata?.tools)
            ? item.safe_structural_metadata.tools
            : [];
        const intendedCapabilityId = isFailureControl && capabilityIds.length === 1
            ? capabilityIds[0]
            : 'UNKNOWN';
        const facts = captureSafeV4ShadowFacts({
            requestId: `p13-${item.case_id}`,
        }, {
            intent: { mode: 'query' },
            telemetry: {
                outcome: item?.safe_structural_metadata?.terminal_state,
                toolSteps: tools.map(toolName => ({ capabilityName: toolName, success: true })),
            },
        }, null, {
            createdAt: options.createdAt || '1970-01-01T00:00:00.000Z',
            shadowTaskId: `v5-shadow-${item.case_id}`,
            structural: {
                failureClass,
                expectedSuccess: isSuccessControl,
                intendedCapabilityId,
                validatedArgumentsReady: failureClass === 'A01' ? false : true,
                stateValid: failureClass === 'C02' ? false : true,
                entityStatus: 'UNKNOWN',
                verificationStatus: 'UNKNOWN',
            },
        });
        const projection = projectSafeV4Facts(facts);
        const comparison = compareV4ActualToV5Shadow(projection);
        paths.push(freeze({
            caseId: item.case_id,
            failureClass,
            result: item.result,
            comparisonStatus: comparison.comparisonStatus,
        }));
    }
    return freeze({
        paths,
        metrics: {
            c02Analyzed: paths.filter(item => item.failureClass === 'C02').length,
            c02Blocked: paths.filter(item => item.failureClass === 'C02' && item.comparisonStatus === 'V5_BLOCKS_V4_FAILURE').length,
            r02Analyzed: paths.filter(item => item.failureClass === 'R02').length,
            r02Blocked: paths.filter(item => item.failureClass === 'R02' && item.comparisonStatus === 'V5_BLOCKS_V4_FAILURE').length,
            a01Analyzed: paths.filter(item => item.failureClass === 'A01').length,
            a01Blocked: paths.filter(item => item.failureClass === 'A01' && item.comparisonStatus === 'V5_BLOCKS_V4_FAILURE').length,
            successControls: paths.filter(item => item.result === 'PASS').length,
            successFalseBlocks: paths.filter(item => item.result === 'PASS' && item.comparisonStatus === 'V5_FALSE_BLOCK').length,
        },
    });
}

module.exports = {
    V5_SHADOW_COMPARISON_STATUSES,
    compareV4ActualToV5Shadow,
    evaluateP06ProductionShadowControls,
};
