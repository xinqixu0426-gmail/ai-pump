'use strict';

const { isOwnerOntologyRelationCanaryRequest } = require('./ontologyRelationCanaryEligibility.cjs');

const AI_NATIVE_MODES = Object.freeze(['off', 'shadow', 'owner']);
const OFF_MODE = 'off';

function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function readAiNativeRolloutConfig(env = process.env) {
    const rawMode = own(env, 'AI_NATIVE_MODE') ? String(env.AI_NATIVE_MODE || '').trim().toLowerCase() : '';
    const modeConfigured = rawMode.length > 0;
    const modeValid = !modeConfigured || AI_NATIVE_MODES.includes(rawMode);
    const rawWrite = own(env, 'AI_NATIVE_WRITE_ENABLED') ? String(env.AI_NATIVE_WRITE_ENABLED || '').trim().toLowerCase() : '';
    const writeConfigured = rawWrite.length > 0;
    const writeValid = !writeConfigured || rawWrite === 'true' || rawWrite === 'false';
    return Object.freeze({
        mode: modeValid && modeConfigured ? rawMode : OFF_MODE,
        modeValid,
        modeSource: modeConfigured ? 'environment' : 'default',
        writeEnabled: writeValid && rawWrite === 'true',
        writeValid,
        writeSource: writeConfigured ? 'environment' : 'default',
    });
}

function isAuthenticatedOwnerRequest(request = {}, env = process.env) {
    return isOwnerOntologyRelationCanaryRequest(request, env);
}

// Snapshot at the start of a request. Request input cannot alter this object.
function resolveAiNativeRollout({ request = {}, env = process.env, isOwner = isAuthenticatedOwnerRequest } = {}) {
    const config = readAiNativeRolloutConfig(env);
    const ownerAuthenticated = Boolean(isOwner(request, env));
    const ownerEligible = config.modeValid && config.mode === 'owner' && ownerAuthenticated;
    const nativeWriteAllowed = ownerEligible && config.writeValid && config.writeEnabled;
    const responsibility = ownerEligible ? 'NATIVE_OWNER' : 'LEGACY';
    const shadow = config.modeValid && config.mode === 'shadow';
    return Object.freeze({
        config,
        ownerAuthenticated,
        ownerEligible,
        nativeTaskDelegation: ownerEligible,
        nativeWriteAllowed,
        responsibility,
        shadow,
        reason: !config.modeValid
            ? 'AI_NATIVE_MODE_INVALID'
            : config.mode === 'owner' && !ownerAuthenticated
                ? 'AI_NATIVE_OWNER_REQUIRED'
                : config.mode === 'shadow'
                    ? 'AI_NATIVE_SHADOW_LEGACY_AUTHORITATIVE'
                    : 'AI_NATIVE_OFF_LEGACY_AUTHORITATIVE',
    });
}

function startupAiNativeRolloutSummary(env = process.env) {
    const config = readAiNativeRolloutConfig(env);
    return Object.freeze({
        mode: config.mode,
        modeValid: config.modeValid,
        writeEnabled: config.writeEnabled,
        writeValid: config.writeValid,
        authority: config.mode === 'owner' && config.modeValid ? 'owner-scoped-native' : 'legacy',
    });
}

module.exports = {
    AI_NATIVE_MODES,
    readAiNativeRolloutConfig,
    isAuthenticatedOwnerRequest,
    resolveAiNativeRollout,
    startupAiNativeRolloutSummary,
};
