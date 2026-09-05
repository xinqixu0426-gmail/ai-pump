'use strict';

const { getV5EntityType } = require('./businessOntology.cjs');
const { SUPPORTED_ENTITY_TYPES } = require('../entityLookupService.cjs');

const V5_ENTITY_RESOLUTION_REGISTRY_VERSION = 1;
const AUTHORITY_CLASS = 'GOVERNED_BUSINESS_API_EXACT_LOOKUP';

const V5_ENTITY_RESOLUTION_REGISTRY = Object.freeze(
    SUPPORTED_ENTITY_TYPES.map(entityType => Object.freeze({
        version: V5_ENTITY_RESOLUTION_REGISTRY_VERSION,
        entityType,
        authorityClass: AUTHORITY_CLASS,
        readOnly: true,
        providerRef: 'POST /api/entity-lookup',
    }))
);

function validateEntityResolutionRegistry(registry = V5_ENTITY_RESOLUTION_REGISTRY) {
    if (!Array.isArray(registry) || registry.length === 0) {
        throw new TypeError('V5 entity resolution registry must be non-empty');
    }
    const types = new Set();
    for (const entry of registry) {
        if (!entry || entry.version !== V5_ENTITY_RESOLUTION_REGISTRY_VERSION) {
            throw new TypeError('V5 entity resolution registry version is invalid');
        }
        if (!getV5EntityType(entry.entityType) || types.has(entry.entityType)) {
            throw new TypeError(`V5 entity resolution type is stale or duplicate: ${String(entry.entityType)}`);
        }
        if (entry.authorityClass !== AUTHORITY_CLASS || entry.readOnly !== true
            || entry.providerRef !== 'POST /api/entity-lookup') {
            throw new TypeError(`V5 entity resolution authority is invalid: ${entry.entityType}`);
        }
        types.add(entry.entityType);
    }
    if (JSON.stringify([...types].sort()) !== JSON.stringify([...SUPPORTED_ENTITY_TYPES].sort())) {
        throw new TypeError('V5 entity resolution registry differs from the Business API allowlist');
    }
    return true;
}

validateEntityResolutionRegistry();

module.exports = {
    AUTHORITY_CLASS,
    V5_ENTITY_RESOLUTION_REGISTRY,
    V5_ENTITY_RESOLUTION_REGISTRY_VERSION,
    validateEntityResolutionRegistry,
};
