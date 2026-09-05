'use strict';

const { getAiCapability } = require('../../capabilities/registry.cjs');
const { getV5Capability } = require('./capabilityRegistry.cjs');
const { getV5ToolExposure } = require('./toolExposure.cjs');
const { validateRiskConsistency } = require('./risk.cjs');

const V5_READ_EXECUTION_REGISTRY_VERSION = 1;
// Deliberately narrow, contract-reviewed adapters, not a case-to-tool map.
const READ_EXECUTION_REGISTRY = Object.freeze([
    Object.freeze({ toolName: 'search_parts', capabilityId: 'inventory.read', riskLevel: 'L1', readOnly: true,
        argumentContract: 'SOURCE_EXACT_PART_KEYWORD', entityType: 'part' }),
    Object.freeze({ toolName: 'preview_recipe_cost', capabilityId: 'recipe.cost.preview', riskLevel: 'L1', readOnly: true,
        argumentContract: 'CANONICAL_RECIPE_ID_NO_OVERRIDES', entityType: 'recipe' }),
    Object.freeze({ toolName: 'search_coils', capabilityId: 'coil.read', riskLevel: 'L1', readOnly: true,
        argumentContract: 'AUTHORITATIVE_SCHEME_CODE', entityType: 'coil' }),
]);

function readPolicyLock(capability, entry) {
    const formal = getAiCapability(entry?.toolName);
    return Boolean(capability && entry?.readOnly === true && formal?.access === 'read'
        && capability.readWriteClass === 'READ' && ['L1', 'L2'].includes(capability.riskClass)
        && validateRiskConsistency(capability.riskClass, capability.readWriteClass)
        && entry.capabilityId === capability.capabilityId && entry.riskLevel === capability.riskClass
        && capability.allowedTools.includes(entry.toolName));
}

function selectReadExecution(capabilityId, registry = READ_EXECUTION_REGISTRY) {
    const capability = getV5Capability(capabilityId);
    if (!capability || capability.readWriteClass !== 'READ' || !['L1', 'L2'].includes(capability.riskClass)) {
        return { status: 'NOT_EXECUTABLE', entry: null };
    }
    const exposure = getV5ToolExposure({ outcome: 'SELECTED', capabilityId });
    const candidates = registry.filter(entry => entry.capabilityId === capabilityId
        && exposure.allowedToolNames.includes(entry.toolName));
    if (candidates.some(entry => !readPolicyLock(capability, entry))) return { status: 'WRITE_BLOCKED', entry: null };
    if (candidates.length !== 1) return { status: candidates.length ? 'TOOL_SELECTION_AMBIGUOUS' : 'NOT_EXECUTABLE', entry: null };
    return { status: 'UNIQUE', entry: candidates[0] };
}

module.exports = { V5_READ_EXECUTION_REGISTRY_VERSION, READ_EXECUTION_REGISTRY, readPolicyLock, selectReadExecution };
