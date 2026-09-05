'use strict';

const { getInternalApiTimeoutMs } = require('../environment.cjs');
const {
    createInternalFetch,
    lookupEntities,
} = require('../../routes/ai/internalApiClient.cjs');
const {
    ENTITY_LOOKUP_API_VERSION,
    MAX_CANDIDATES_PER_TYPE,
    MAX_ENTITY_TYPES_PER_REQUEST,
    MAX_MENTION_LENGTH,
    MAX_TOTAL_CANDIDATES,
} = require('../../services/entityLookupService.cjs');
const {
    V5_ENTITY_RESOLUTION_REGISTRY,
} = require('./entityResolutionRegistry.cjs');
const {
    createTypeIndependentEntityResolution,
} = require('./entityResolutionContract.cjs');

const DEFAULT_MATCH_POLICY = 'EXACT_OR_APPROVED_ALIAS';

function candidateKey(candidate) {
    return `${candidate.entityType}\0${candidate.canonicalId}`;
}

function validateLookupResponse(value, requestedTypeCount) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || value.version !== ENTITY_LOOKUP_API_VERSION
        || !['OK', 'INCOMPLETE'].includes(value.status)
        || typeof value.complete !== 'boolean'
        || !Number.isSafeInteger(value.attemptedEntityTypes)
        || value.attemptedEntityTypes !== requestedTypeCount
        || !Number.isSafeInteger(value.candidateCount)
        || !Array.isArray(value.candidates)
        || value.candidateCount !== value.candidates.length
        || value.candidateCount > MAX_TOTAL_CANDIDATES) {
        throw Object.assign(new Error('实体查询 API 响应契约无效'), {
            code: 'ENTITY_LOOKUP_RESPONSE_INVALID',
        });
    }
    const allowedTypes = new Set(V5_ENTITY_RESOLUTION_REGISTRY.map(entry => entry.entityType));
    const seen = new Set();
    for (const candidate of value.candidates) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
            || Object.keys(candidate).some(key => !['canonicalId', 'entityType', 'matchKind', 'bindingRefs'].includes(key))
            || !allowedTypes.has(candidate.entityType)
            || typeof candidate.canonicalId !== 'string' || candidate.canonicalId.length === 0
            || !['EXACT', 'APPROVED_ALIAS'].includes(candidate.matchKind)
            || seen.has(candidateKey(candidate))) {
            throw Object.assign(new Error('实体查询候选契约无效'), {
                code: 'ENTITY_LOOKUP_CANDIDATE_INVALID',
            });
        }
        if (candidate.bindingRefs !== undefined && (candidate.entityType !== 'coil'
            || !Array.isArray(candidate.bindingRefs) || candidate.bindingRefs.length !== 1
            || candidate.bindingRefs.some(ref => !ref || Object.keys(ref).sort().join(',') !== 'kind,value'
                || ref.kind !== 'schemeCode' || typeof ref.value !== 'string' || !ref.value.length || ref.value.length > 500))) {
            throw Object.assign(new Error('Invalid authoritative binding reference'), { code: 'ENTITY_LOOKUP_BINDING_INVALID' });
        }
        seen.add(candidateKey(candidate));
    }
    if ((value.status === 'OK') !== value.complete) {
        throw Object.assign(new Error('实体查询完整性状态不一致'), {
            code: 'ENTITY_LOOKUP_COMPLETENESS_INVALID',
        });
    }
    return value;
}

function errorResolution(rawMention, attemptedTypeCount, code) {
    return createTypeIndependentEntityResolution({
        status: 'ERROR',
        rawMention,
        resolvedEntityType: null,
        canonicalIdentity: null,
        candidateCount: 0,
        candidateTypeCount: 0,
        attemptedTypeCount,
        complete: false,
        matchKinds: [],
        reasonCodes: [code || 'ENTITY_LOOKUP_ERROR'],
    });
}

async function resolveEntityTypeIndependent(rawMention, options = {}) {
    if (typeof rawMention !== 'string' || rawMention.length === 0 || rawMention.trim().length === 0) {
        throw new TypeError('rawMention must be a non-empty source-owned string');
    }
    if ([...rawMention].length > MAX_MENTION_LENGTH) {
        return errorResolution(rawMention, 0, 'ENTITY_LOOKUP_INPUT_INVALID');
    }
    const entityTypes = V5_ENTITY_RESOLUTION_REGISTRY.map(entry => entry.entityType);
    if (entityTypes.length === 0 || entityTypes.length > MAX_ENTITY_TYPES_PER_REQUEST) {
        return createTypeIndependentEntityResolution({
            status: 'UNSUPPORTED', rawMention, resolvedEntityType: null, canonicalIdentity: null,
            candidateCount: 0, candidateTypeCount: 0, attemptedTypeCount: 0, complete: false,
            matchKinds: [], reasonCodes: ['ENTITY_LOOKUP_REGISTRY_UNSUPPORTED'],
        });
    }

    const timeoutMs = Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0
        ? options.timeoutMs
        : getInternalApiTimeoutMs();
    const controller = new AbortController();
    const internalFetch = options.internalFetch || createInternalFetch({ signal: controller.signal });
    const lookup = options.lookupEntities || lookupEntities;
    let timeout;
    try {
        const timeoutPromise = new Promise((resolve, reject) => {
            timeout = setTimeout(() => {
                controller.abort();
                reject(Object.assign(new Error('实体查询超时'), { code: 'ENTITY_LOOKUP_TIMEOUT' }));
            }, timeoutMs);
            timeout.unref?.();
        });
        const response = await Promise.race([
            Promise.resolve().then(() => lookup(internalFetch, {
                version: ENTITY_LOOKUP_API_VERSION,
                mention: rawMention,
                entityTypes,
                matchPolicy: DEFAULT_MATCH_POLICY,
            })),
            timeoutPromise,
        ]);
        const value = validateLookupResponse(response, entityTypes.length);
        const candidateTypeCount = new Set(value.candidates.map(candidate => candidate.entityType)).size;
        const common = {
            rawMention,
            candidateCount: value.candidateCount,
            candidateTypeCount,
            attemptedTypeCount: value.attemptedEntityTypes,
            complete: value.complete,
            matchKinds: value.candidates.map(candidate => candidate.matchKind),
        };
        if (!value.complete) {
            return createTypeIndependentEntityResolution({
                ...common, status: 'ERROR', resolvedEntityType: null, canonicalIdentity: null,
                reasonCodes: ['ENTITY_LOOKUP_INCOMPLETE'],
            });
        }
        if (value.candidateCount === 0) {
            return createTypeIndependentEntityResolution({
                ...common, status: 'NOT_FOUND', resolvedEntityType: null, canonicalIdentity: null,
                reasonCodes: ['ENTITY_LOOKUP_NOT_FOUND'],
            });
        }
        if (value.candidateCount > 1) {
            return createTypeIndependentEntityResolution({
                ...common, status: 'AMBIGUOUS', resolvedEntityType: null, canonicalIdentity: null,
                reasonCodes: [candidateTypeCount > 1 ? 'ENTITY_LOOKUP_CROSS_TYPE_AMBIGUOUS' : 'ENTITY_LOOKUP_SAME_TYPE_AMBIGUOUS'],
            });
        }
        const selected = value.candidates[0];
        return createTypeIndependentEntityResolution({
            ...common,
            status: 'RESOLVED',
            resolvedEntityType: selected.entityType,
            canonicalIdentity: selected.canonicalId,
            reasonCodes: ['ENTITY_LOOKUP_UNIQUE_AUTHORITATIVE'],
        });
    } catch (error) {
        return errorResolution(rawMention, entityTypes.length, error?.code || 'ENTITY_LOOKUP_ERROR');
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

module.exports = {
    DEFAULT_MATCH_POLICY,
    MAX_CANDIDATES_PER_TYPE,
    MAX_ENTITY_TYPES_PER_REQUEST,
    MAX_TOTAL_CANDIDATES,
    resolveEntityTypeIndependent,
    validateLookupResponse,
};
