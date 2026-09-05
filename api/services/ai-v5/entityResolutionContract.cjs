'use strict';

const { getV5EntityType } = require('./businessOntology.cjs');

const V5_TYPE_INDEPENDENT_ENTITY_RESOLUTION_VERSION = 1;
const V5_TYPE_INDEPENDENT_ENTITY_RESOLUTION_STATUSES = Object.freeze([
    'RESOLVED',
    'AMBIGUOUS',
    'NOT_FOUND',
    'UNSUPPORTED',
    'ERROR',
]);

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}

function createTypeIndependentEntityResolution(input = {}) {
    if (typeof input.rawMention !== 'string' || input.rawMention.length === 0
        || input.rawMention.trim().length === 0) {
        throw new TypeError('rawMention must be a non-empty source-owned string');
    }
    if (!V5_TYPE_INDEPENDENT_ENTITY_RESOLUTION_STATUSES.includes(input.status)) {
        throw new TypeError(`Invalid type-independent resolution status: ${String(input.status)}`);
    }
    const candidateCount = Number(input.candidateCount);
    const candidateTypeCount = Number(input.candidateTypeCount);
    const attemptedTypeCount = Number(input.attemptedTypeCount);
    for (const [name, value] of Object.entries({ candidateCount, candidateTypeCount, attemptedTypeCount })) {
        if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative integer`);
    }
    const resolvedEntityType = input.resolvedEntityType ?? null;
    const canonicalIdentity = input.canonicalIdentity ?? null;
    if (input.status === 'RESOLVED') {
        if (!getV5EntityType(resolvedEntityType)) throw new TypeError('RESOLVED requires a known entity type');
        if (typeof canonicalIdentity !== 'string' || canonicalIdentity.length === 0) {
            throw new TypeError('RESOLVED requires canonical identity');
        }
        if (candidateCount !== 1 || candidateTypeCount !== 1) {
            throw new TypeError('RESOLVED requires exactly one complete candidate');
        }
    } else if (resolvedEntityType !== null || canonicalIdentity !== null) {
        throw new TypeError(`${input.status} cannot expose a selected canonical identity`);
    }
    const reasonCodes = Array.isArray(input.reasonCodes)
        ? input.reasonCodes.map(code => String(code)).filter(Boolean)
        : [];
    return deepFreeze({
        version: V5_TYPE_INDEPENDENT_ENTITY_RESOLUTION_VERSION,
        status: input.status,
        rawMention: input.rawMention,
        resolvedEntityType,
        canonicalIdentity,
        candidateCount,
        candidateTypeCount,
        attemptedTypeCount,
        complete: input.complete === true,
        matchKinds: Object.freeze(Array.isArray(input.matchKinds)
            ? [...new Set(input.matchKinds.map(kind => String(kind)).filter(Boolean))].sort()
            : []),
        reasonCodes: Object.freeze(reasonCodes),
    });
}

module.exports = {
    V5_TYPE_INDEPENDENT_ENTITY_RESOLUTION_STATUSES,
    V5_TYPE_INDEPENDENT_ENTITY_RESOLUTION_VERSION,
    createTypeIndependentEntityResolution,
};
