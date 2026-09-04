'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const { createHash } = require('node:crypto');

const V5_SHADOW_FACTS_VERSION = 1;
const MAX_FACT_ITEMS = 24;
const SAFE_KEY_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/;
const storage = new AsyncLocalStorage();

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}

function safeLabel(value, fallback = 'UNKNOWN') {
    const text = typeof value === 'string' ? value.trim() : '';
    return text && /^[A-Za-z0-9._:-]{1,160}$/.test(text) ? text : fallback;
}

function stableIdentityHash(value) {
    if (value === undefined || value === null || value === '') return null;
    try {
        return createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
    } catch {
        return null;
    }
}

function valueType(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (Buffer.isBuffer(value)) return 'buffer';
    const type = typeof value;
    return ['string', 'number', 'boolean', 'object'].includes(type) ? type : 'unsupported';
}

function argumentShape(args) {
    try {
        if (!args || typeof args !== 'object' || Array.isArray(args)) {
            return deepFreeze({ keys: [], count: 0, typeSignature: {} });
        }
        const keys = Object.keys(args).filter(key => SAFE_KEY_RE.test(key)).sort().slice(0, 32);
        return deepFreeze({
            keys,
            count: keys.length,
            typeSignature: Object.fromEntries(keys.map(key => [key, valueType(args[key])])),
        });
    } catch {
        return deepFreeze({ keys: [], count: 0, typeSignature: {} });
    }
}

function createStore() {
    return {
        entityNormalizations: [],
        entityResolutions: [],
        routes: [],
        argumentValidations: [],
        toolExecutions: [],
        verifications: [],
        finalRuntimeStatus: 'UNKNOWN',
    };
}

function append(kind, fact) {
    try {
        const store = storage.getStore();
        if (!store || !Array.isArray(store[kind]) || store[kind].length >= MAX_FACT_ITEMS) return;
        store[kind].push(deepFreeze(fact));
    } catch {
        // Structural observation is always fail-open.
    }
}

function recordEntityNormalizationFact(metadata = {}, output) {
    const inputText = String(metadata.input || '');
    const outputText = String(output || '');
    const punctuationCount = text => [...text].filter(character => /\p{P}/u.test(character)).length;
    append('entityNormalizations', {
        entityType: safeLabel(metadata.entityType),
        inputLength: [...inputText].length,
        outputLength: [...outputText].length,
        punctuationDelta: punctuationCount(outputText) - punctuationCount(inputText),
        lengthDelta: [...outputText].length - [...inputText].length,
        changed: inputText !== outputText,
    });
}

function recordEntityResolutionFact(metadata = {}, result = {}) {
    const receipt = result?.receipt || null;
    const selectedId = receipt?.selected?.stableIdentity?.primaryStableId
        ?? receipt?.selected?.id
        ?? null;
    append('entityResolutions', {
        entityType: safeLabel(metadata.entityType),
        resolved: Boolean(receipt?.selected),
        matchType: safeLabel(receipt?.selected?.matchKind || result?.status),
        candidateCount: Array.isArray(receipt?.candidates) ? receipt.candidates.length : 0,
        ambiguity: result?.status === 'ambiguous' || receipt?.status === 'ambiguous',
        identityHash: stableIdentityHash(selectedId),
        identityPreservationStatus: selectedId === null ? 'NOT_AVAILABLE' : 'CANONICAL_ID_HASHED',
    });
}

function recordRoutingFact(metadata = {}, result = {}) {
    append('routes', {
        selectedToolName: result?.status === 'selected' ? safeLabel(result.capabilityName) : null,
        decision: safeLabel(result?.status),
        availableToolCount: Math.max(0, Number(metadata.availableToolCount) || 0),
        readWriteClass: safeLabel(metadata.access, 'UNKNOWN').toUpperCase(),
        routeSource: safeLabel(metadata.routeSource),
    });
}

function recordArgumentValidationFact(input = {}) {
    const shape = argumentShape(input.args);
    append('argumentValidations', {
        toolName: safeLabel(input.toolName),
        status: input.status === 'validated' ? 'VALIDATED'
            : input.status === 'rejected' ? 'REJECTED' : 'UNKNOWN',
        validationCode: safeLabel(input.validationCode, 'NONE'),
        keys: shape.keys,
        count: shape.count,
        typeSignature: shape.typeSignature,
    });
}

function recordToolExecutionFact(metadata = {}, result = {}, failedByThrow = false) {
    const shape = argumentShape(metadata.args);
    append('toolExecutions', {
        toolName: safeLabel(metadata.toolName),
        capabilityId: safeLabel(metadata.capability, 'NOT_AVAILABLE'),
        readWriteClass: safeLabel(metadata.access, 'UNKNOWN').toUpperCase(),
        executionStatus: failedByThrow || result?.success === false ? 'FAILURE' : 'SUCCESS',
        argumentKeys: shape.keys,
        argumentCount: shape.count,
        argumentTypeSignature: shape.typeSignature,
    });
}

function recordVerificationFact(metadata = {}, decision) {
    const toolExecutionCount = Math.max(0, Number(metadata.toolExecutionCount) || 0);
    append('verifications', {
        decision: metadata.decision === undefined ? Boolean(decision) : Boolean(metadata.decision),
        status: safeLabel(metadata.status || (decision ? 'verified' : 'unverified')),
        beforeAnyTool: toolExecutionCount === 0,
        requiredCount: Math.max(0, Number(metadata.requiredCount) || 0),
        observedCount: Math.max(0, Number(metadata.observedCount) || 0),
        missingCount: Math.max(0, Number(metadata.missingCount) || 0),
    });
}

function snapshotStore(store) {
    return deepFreeze({
        version: V5_SHADOW_FACTS_VERSION,
        entityNormalizations: [...store.entityNormalizations],
        entityResolutions: [...store.entityResolutions],
        routes: [...store.routes],
        argumentValidations: [...store.argumentValidations],
        toolExecutions: [...store.toolExecutions],
        verifications: [...store.verifications],
        finalRuntimeStatus: store.finalRuntimeStatus,
    });
}

async function collectV5ShadowFacts(operation) {
    if (typeof operation !== 'function') throw new TypeError('V5 shadow fact operation is required');
    const store = createStore();
    return storage.run(store, async () => {
        const result = await operation();
        store.finalRuntimeStatus = safeLabel(result?.telemetry?.outcome);
        return deepFreeze({ result, shadowFacts: snapshotStore(store) });
    });
}

module.exports = {
    V5_SHADOW_FACTS_VERSION,
    argumentShape,
    collectV5ShadowFacts,
    recordArgumentValidationFact,
    recordEntityNormalizationFact,
    recordEntityResolutionFact,
    recordRoutingFact,
    recordToolExecutionFact,
    recordVerificationFact,
    stableIdentityHash,
};
