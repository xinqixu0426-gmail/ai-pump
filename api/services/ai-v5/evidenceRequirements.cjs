'use strict';

const { listV5Capabilities } = require('./capabilityRegistry.cjs');
const { V5_EVIDENCE_TYPES, V5_FRESHNESS, V5_SOURCE_TRUST } = require('./evidenceLedger.cjs');

const V5_EVIDENCE_REQUIREMENT_VERSION = 1;
const REQUIREMENT_LEVELS = Object.freeze(['REQUIRED', 'OPTIONAL']);
const REQUIREMENT_COVERAGE = Object.freeze(['DEFINED', 'DEFERRED', 'NOT_APPLICABLE']);

function immutable(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(immutable);
    return Object.freeze(value);
}

function requiredString(value, field) {
    if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${field} must be a non-empty string`);
    return value;
}

function createEvidenceRequirement(input = {}) {
    if ((input.version ?? 1) !== 1) throw new TypeError('Unsupported evidence requirement version');
    if (!REQUIREMENT_LEVELS.includes(input.level)) throw new TypeError('Invalid evidence requirement level');
    if (!V5_EVIDENCE_TYPES.includes(input.requiredEvidenceType)) throw new TypeError('Invalid required evidence type');
    if (!V5_SOURCE_TRUST.includes(input.minimumSourceTrust)) throw new TypeError('Invalid minimum source trust');
    if (![...V5_FRESHNESS, 'ANY'].includes(input.freshnessRequirement)) throw new TypeError('Invalid freshness requirement');
    if (!Number.isInteger(input.minimumCount) || input.minimumCount < 1) throw new TypeError('minimumCount must be a positive integer');
    let entityRef = null;
    if (input.entityRef !== null && input.entityRef !== undefined) {
        if (!input.entityRef || typeof input.entityRef !== 'object' || Array.isArray(input.entityRef)) throw new TypeError('entityRef must be an object');
        entityRef = {
            entityType: requiredString(input.entityRef.entityType, 'entityRef.entityType'),
            canonicalEntityId: input.entityRef.canonicalEntityId,
        };
        if (!['string', 'number'].includes(typeof entityRef.canonicalEntityId)) throw new TypeError('entityRef.canonicalEntityId is invalid');
    }
    return immutable({
        version: V5_EVIDENCE_REQUIREMENT_VERSION,
        capabilityId: requiredString(input.capabilityId, 'capabilityId'),
        requirementId: requiredString(input.requirementId, 'requirementId'),
        claimType: requiredString(input.claimType, 'claimType'),
        requiredEvidenceType: input.requiredEvidenceType,
        minimumSourceTrust: input.minimumSourceTrust,
        freshnessRequirement: input.freshnessRequirement,
        minimumCount: input.minimumCount,
        level: input.level,
        entityType: input.entityType ?? null,
        entityRef,
    });
}

const DEFINED = Object.freeze([
    createEvidenceRequirement({ capabilityId: 'investigation.read', requirementId: 'investigation-formal-relation', claimType: 'investigation.result', requiredEvidenceType: 'DIRECT_FACT', minimumSourceTrust: 'FORMAL', freshnessRequirement: 'CURRENT', minimumCount: 1, level: 'REQUIRED', entityType: null }),
    createEvidenceRequirement({ capabilityId: 'collection.read', requirementId: 'collection-current-formal-page', claimType: 'collection.result', requiredEvidenceType: 'DIRECT_FACT', minimumSourceTrust: 'FORMAL', freshnessRequirement: 'CURRENT', minimumCount: 1, level: 'REQUIRED', entityType: null }),
    createEvidenceRequirement({ capabilityId: 'inventory.read', requirementId: 'inventory-current-formal-fact', claimType: 'inventory.quantity', requiredEvidenceType: 'DIRECT_FACT', minimumSourceTrust: 'FORMAL', freshnessRequirement: 'CURRENT', minimumCount: 1, level: 'REQUIRED', entityType: 'part' }),
    createEvidenceRequirement({ capabilityId: 'coil.read', requirementId: 'coil-current-formal-fact', claimType: 'coil.inventory', requiredEvidenceType: 'DIRECT_FACT', minimumSourceTrust: 'FORMAL', freshnessRequirement: 'CURRENT', minimumCount: 1, level: 'REQUIRED', entityType: 'coil' }),
    createEvidenceRequirement({ capabilityId: 'recipe.cost.preview', requirementId: 'recipe-current-cost-preview', claimType: 'recipe.cost.preview', requiredEvidenceType: 'DIRECT_FACT', minimumSourceTrust: 'FORMAL', freshnessRequirement: 'CURRENT', minimumCount: 1, level: 'REQUIRED', entityType: 'recipe' }),
]);

const BY_CAPABILITY = immutable(Object.fromEntries(DEFINED.map(item => [item.capabilityId, [item]])));

function listEvidenceRequirements(capabilityId) {
    return BY_CAPABILITY[String(capabilityId || '')] || Object.freeze([]);
}

// Explicit software-owned field scope. No language/keyword inference and no expansion of
// the deferred capability requirements. Existing quantity-only callers remain unchanged.
const PRICE_REQUIREMENT = createEvidenceRequirement({ capabilityId: 'inventory.read',
    requirementId: 'part-current-price-formal-fact', claimType: 'price.current',
    requiredEvidenceType: 'DIRECT_FACT', minimumSourceTrust: 'FORMAL', freshnessRequirement: 'CURRENT',
    minimumCount: 1, level: 'REQUIRED', entityType: 'part' });
function listFieldEvidenceRequirements(capabilityId, factKeys = []) {
    if (!Array.isArray(factKeys) || new Set(factKeys).size !== factKeys.length
        || factKeys.some(key => key !== 'price.current')
        || (factKeys.length && capabilityId !== 'inventory.read')) {
        throw new TypeError('FIELD_EVIDENCE_SCOPE_UNSUPPORTED');
    }
    return Object.freeze(factKeys.length ? [PRICE_REQUIREMENT] : []);
}

function auditCapabilityRequirementCoverage(capabilities = listV5Capabilities()) {
    const rows = capabilities.map(capability => {
        const requirements = listEvidenceRequirements(capability.capabilityId);
        return immutable({
            capabilityId: capability.capabilityId,
            coverage: requirements.length > 0 ? 'DEFINED' : 'DEFERRED',
            requirementCount: requirements.length,
            reason: requirements.length > 0 ? null : 'No rigorously grounded P11 evidence contract; deferred without fabrication',
        });
    });
    const unknown = Object.keys(BY_CAPABILITY).filter(id => !capabilities.some(item => item.capabilityId === id));
    if (unknown.length > 0) throw new TypeError(`Unknown capability evidence references: ${unknown.join(', ')}`);
    return immutable({
        capabilityCount: rows.length,
        defined: rows.filter(row => row.coverage === 'DEFINED').length,
        deferred: rows.filter(row => row.coverage === 'DEFERRED').length,
        notApplicable: rows.filter(row => row.coverage === 'NOT_APPLICABLE').length,
        rows,
    });
}

module.exports = {
    REQUIREMENT_COVERAGE,
    REQUIREMENT_LEVELS,
    V5_EVIDENCE_REQUIREMENT_VERSION,
    auditCapabilityRequirementCoverage,
    createEvidenceRequirement,
    listEvidenceRequirements,
    listFieldEvidenceRequirements,
};
