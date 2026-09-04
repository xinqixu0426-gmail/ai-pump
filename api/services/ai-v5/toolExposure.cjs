'use strict';

const { AI_TOOLS } = require('../../routes/ai/tools.cjs');
const { getV5Capability } = require('./capabilityRegistry.cjs');

function freezeExposure(value) {
    value.allowedToolNames = Object.freeze(value.allowedToolNames);
    value.toolDefinitions = Object.freeze(value.toolDefinitions);
    return Object.freeze(value);
}

function projectAllowedToolDefinitions(capability, existingToolRegistry = AI_TOOLS) {
    if (!capability || !Array.isArray(capability.allowedTools) || !Array.isArray(existingToolRegistry)) return Object.freeze([]);
    const allowed = new Set(capability.allowedTools);
    return Object.freeze(existingToolRegistry.filter(tool => allowed.has(tool?.function?.name)));
}

function getV5ToolExposure(selection, existingToolRegistry = AI_TOOLS) {
    const outcome = typeof selection === 'string' ? 'SELECTED' : selection?.outcome;
    const capabilityId = typeof selection === 'string' ? selection : selection?.capabilityId;
    if (outcome !== 'SELECTED' || !capabilityId) {
        return freezeExposure({
            capabilityId: null,
            allowedToolNames: [],
            toolDefinitions: [],
            toolCount: 0,
            executionAllowed: false,
            reasonCode: outcome === 'AMBIGUOUS'
                ? 'AMBIGUOUS_ROUTE_NO_EXPOSURE'
                : outcome === 'UNRESOLVED'
                    ? 'UNRESOLVED_ROUTE_NO_EXPOSURE'
                    : 'INVALID_ROUTE_NO_EXPOSURE',
        });
    }
    const capability = getV5Capability(capabilityId);
    if (!capability) {
        return freezeExposure({
            capabilityId,
            allowedToolNames: [],
            toolDefinitions: [],
            toolCount: 0,
            executionAllowed: false,
            reasonCode: 'CAPABILITY_NOT_FOUND',
        });
    }
    if (!capability.exposableInV5B || capability.readWriteClass === 'WRITE') {
        return freezeExposure({
            capabilityId,
            allowedToolNames: [],
            toolDefinitions: [],
            toolCount: 0,
            executionAllowed: false,
            reasonCode: 'WRITE_DISABLED_IN_V5B',
        });
    }
    const definitions = projectAllowedToolDefinitions(capability, existingToolRegistry);
    const actualNames = definitions.map(tool => tool.function.name);
    const complete = actualNames.length === capability.allowedTools.length
        && capability.allowedTools.every(name => actualNames.includes(name));
    if (!complete) {
        return freezeExposure({
            capabilityId,
            allowedToolNames: [],
            toolDefinitions: [],
            toolCount: 0,
            executionAllowed: false,
            reasonCode: 'TOOL_REGISTRY_MISMATCH',
        });
    }
    return freezeExposure({
        capabilityId,
        allowedToolNames: [...capability.allowedTools],
        toolDefinitions: [...definitions],
        toolCount: definitions.length,
        executionAllowed: false,
        reasonCode: 'SHADOW_PROJECTION_ONLY',
    });
}

module.exports = {
    getV5ToolExposure,
    projectAllowedToolDefinitions,
};
