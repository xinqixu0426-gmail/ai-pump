'use strict';

const { getV5EntityType } = require('./businessOntology.cjs');

const V5_ENTITY_IDENTITY_VERSION = 1;
const V5_RESOLUTION_STATUSES = Object.freeze(['UNRESOLVED', 'RESOLVED', 'AMBIGUOUS', 'NOT_FOUND', 'INVALID']);
const V5_MATCH_TYPES = Object.freeze(['EXACT', 'FUZZY_UNIQUE', 'AMBIGUOUS', 'NOT_FOUND', 'NOT_RESOLVED']);
const V5_IDENTITY_PRESERVATION_STATUSES = Object.freeze(['PRESERVED', 'TRANSFORMED_TRACKED', 'TRANSFORMED_UNTRACKED', 'UNKNOWN']);
const TRUSTED_CANONICAL_SOURCES = Object.freeze(['FORMAL_BUSINESS_SOURCE', 'EXISTING_RESOLVER_V3']);

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}

function clone(value) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
    if (Array.isArray(value)) return value.map(clone);
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('Identity values must be plain serializable data');
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

function optionalString(value, name) {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string or null`);
    return value;
}

function canonicalId(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' && value.length > 0) return value;
    if (Number.isSafeInteger(value) && value > 0) return value;
    throw new TypeError('canonicalEntityId must be a non-empty string, positive safe integer, or null');
}

function canonicalBusinessKey(value) {
    if (value === null || value === undefined) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('canonicalBusinessKey must be an object or null');
    if (typeof value.name !== 'string' || value.name.length === 0 || typeof value.value !== 'string' || value.value.length === 0) {
        throw new TypeError('canonicalBusinessKey requires non-empty name and value');
    }
    return { name: value.name, value: value.value };
}

function preservationStatus(rawMention, normalizedMention) {
    if (normalizedMention === null || normalizedMention === rawMention) return 'PRESERVED';
    return 'TRANSFORMED_TRACKED';
}

function createV5EntityIdentity(input = {}) {
    if (input.version !== undefined && input.version !== V5_ENTITY_IDENTITY_VERSION) throw new TypeError(`Unsupported entity identity version: ${input.version}`);
    if (typeof input.entityType !== 'string' || !getV5EntityType(input.entityType)) throw new TypeError(`Unknown entityType: ${String(input.entityType)}`);
    if (typeof input.rawMention !== 'string' || input.rawMention.length === 0 || input.rawMention.trim().length === 0) {
        throw new TypeError('rawMention must be a non-empty string and is never coerced');
    }
    const normalizedMention = optionalString(input.normalizedMention, 'normalizedMention');
    const stableCanonicalId = canonicalId(input.canonicalEntityId);
    const stableBusinessKey = canonicalBusinessKey(input.canonicalBusinessKey);
    const resolutionStatus = input.resolutionStatus || 'UNRESOLVED';
    const matchType = input.matchType || 'NOT_RESOLVED';
    const source = input.source || 'TASK_BOUNDARY';
    if (!V5_RESOLUTION_STATUSES.includes(resolutionStatus)) throw new TypeError(`Invalid resolutionStatus: ${resolutionStatus}`);
    if (!V5_MATCH_TYPES.includes(matchType)) throw new TypeError(`Invalid matchType: ${matchType}`);
    const allowedMatchTypes = {
        UNRESOLVED: ['NOT_RESOLVED'],
        RESOLVED: ['EXACT', 'FUZZY_UNIQUE'],
        AMBIGUOUS: ['AMBIGUOUS'],
        NOT_FOUND: ['NOT_FOUND'],
        INVALID: ['NOT_RESOLVED'],
    };
    if (!allowedMatchTypes[resolutionStatus].includes(matchType)) {
        throw new TypeError(`matchType ${matchType} is incompatible with ${resolutionStatus}`);
    }
    if (['UNRESOLVED', 'AMBIGUOUS', 'NOT_FOUND', 'INVALID'].includes(resolutionStatus)
        && (stableCanonicalId !== null || stableBusinessKey !== null)) {
        throw new TypeError(`${resolutionStatus} identity cannot contain a fabricated canonical identity`);
    }
    if (resolutionStatus === 'RESOLVED') {
        if (stableCanonicalId === null && stableBusinessKey === null) throw new TypeError('RESOLVED identity requires canonical identity');
        if (!TRUSTED_CANONICAL_SOURCES.includes(source)) throw new TypeError('Canonical identity requires a trusted formal source');
        if (!input.resolverPath) throw new TypeError('Canonical identity requires resolverPath provenance');
    }
    const value = {
        version: V5_ENTITY_IDENTITY_VERSION,
        entityType: input.entityType,
        rawMention: input.rawMention,
        normalizedMention,
        canonicalEntityId: stableCanonicalId,
        canonicalBusinessKey: stableBusinessKey,
        resolutionStatus,
        matchType,
        source,
        resolverPath: optionalString(input.resolverPath, 'resolverPath'),
        resolverInputField: optionalString(input.resolverInputField, 'resolverInputField'),
        normalizationPolicyId: input.normalizationPolicyId || getV5EntityType(input.entityType).normalizationPolicyId,
        identityPreservationStatus: preservationStatus(input.rawMention, normalizedMention),
        displayName: optionalString(input.displayName, 'displayName'),
    };
    return deepFreeze(clone(value));
}

function validateV5EntityIdentity(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('V5EntityIdentity must be an object');
    if (value.version !== V5_ENTITY_IDENTITY_VERSION) throw new TypeError(`Unsupported entity identity version: ${value.version}`);
    return createV5EntityIdentity(value);
}

function countPunctuation(value) {
    return [...String(value)].filter(char => /[^\p{Letter}\p{Number}\s]/u.test(char)).length;
}

function countDigits(value) {
    return [...String(value)].filter(char => /\p{Number}/u.test(char)).length;
}

function detectIdentityTransformation(before, after) {
    if (typeof before !== 'string' || typeof after !== 'string') {
        return deepFreeze({
            lengthDelta: null,
            punctuationDelta: null,
            digitDelta: null,
            caseChanged: null,
            whitespaceChanged: null,
            contentChanged: null,
        });
    }
    return deepFreeze({
        lengthDelta: [...after].length - [...before].length,
        punctuationDelta: countPunctuation(after) - countPunctuation(before),
        digitDelta: countDigits(after) - countDigits(before),
        caseChanged: before !== after && before.toLocaleLowerCase('zh-CN') === after.toLocaleLowerCase('zh-CN'),
        whitespaceChanged: before.replace(/\s/gu, '') === after.replace(/\s/gu, '') && before !== after,
        contentChanged: before !== after,
    });
}

function shapeOf(value) {
    if (typeof value !== 'string') return null;
    return deepFreeze({
        length: [...value].length,
        punctuationCount: countPunctuation(value),
        digitCount: countDigits(value),
    });
}

function detectUntrackedIdentityLoss(expectedShape, observedShape) {
    if (!expectedShape || !observedShape) return deepFreeze({ status: 'UNKNOWN', mismatch: false });
    const mismatch = expectedShape.length !== observedShape.length
        || expectedShape.punctuationCount !== observedShape.punctuationCount
        || (expectedShape.digitCount !== undefined
            && observedShape.digitCount !== undefined
            && expectedShape.digitCount !== observedShape.digitCount);
    return deepFreeze({
        status: mismatch ? 'TRANSFORMED_UNTRACKED' : 'PRESERVED',
        mismatch,
        lengthDelta: observedShape.length - expectedShape.length,
        punctuationDelta: observedShape.punctuationCount - expectedShape.punctuationCount,
        digitDelta: expectedShape.digitCount === undefined || observedShape.digitCount === undefined
            ? null
            : observedShape.digitCount - expectedShape.digitCount,
    });
}

function validateResolverInputIdentity(identityInput, resolverInput) {
    const identity = validateV5EntityIdentity(identityInput);
    if (typeof resolverInput !== 'string') return deepFreeze({ valid: false, code: 'V5_RESOLVER_INPUT_INVALID' });
    if (resolverInput !== identity.rawMention) {
        return deepFreeze({
            valid: false,
            code: 'V5_IDENTITY_INPUT_MISMATCH',
            damage: detectIdentityTransformation(identity.rawMention, resolverInput),
        });
    }
    return deepFreeze({ valid: true, code: null, damage: detectIdentityTransformation(identity.rawMention, resolverInput) });
}

module.exports = {
    TRUSTED_CANONICAL_SOURCES,
    V5_ENTITY_IDENTITY_VERSION,
    V5_IDENTITY_PRESERVATION_STATUSES,
    V5_MATCH_TYPES,
    V5_RESOLUTION_STATUSES,
    createV5EntityIdentity,
    detectIdentityTransformation,
    detectUntrackedIdentityLoss,
    shapeOf,
    validateResolverInputIdentity,
    validateV5EntityIdentity,
};
