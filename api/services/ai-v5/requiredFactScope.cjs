'use strict';

const { getV5TaskClass } = require('./taskClassCatalog.cjs');
const REQUIRED_FACT_SCOPES = Object.freeze({
    tc_002: Object.freeze({ factKey: 'inventory.quantity', capabilityId: 'inventory.read',
        domain: 'catalog', operation: 'read_inventory', entityType: 'part' }),
    tc_028: Object.freeze({ factKey: 'price.current', capabilityId: 'inventory.read',
        domain: 'catalog', operation: 'read_inventory', entityType: 'part' }),
    tc_004: Object.freeze({ factKey: 'coil.inventory', capabilityId: 'coil.read',
        domain: 'coil', operation: 'read', entityType: 'coil' }),
    tc_024: Object.freeze({ factKey: 'recipe.cost.preview', capabilityId: 'recipe.cost.preview',
        domain: 'recipe', operation: 'preview_cost', entityType: 'recipe' }),
});

function deriveRequiredFactKey(interpreted) {
    const scope = REQUIRED_FACT_SCOPES[interpreted?.taskClassRef];
    const taskClass = getV5TaskClass(interpreted?.taskClassRef);
    if (!scope || !taskClass || interpreted.status !== 'VALID'
        || interpreted.interpretation?.needsClarification !== false
        || interpreted.resolvedIdentity?.entityType !== scope.entityType
        || taskClass.entityTypes.length !== 1 || taskClass.entityTypes[0] !== scope.entityType
        || ['domain', 'operation'].some(k => scope[k] !== taskClass[k] || scope[k] !== interpreted.interpretation?.[k])) {
        return null;
    }
    return scope.factKey;
}

function assertRequiredFactHeader(derivedFact, header) {
    if (!derivedFact) return 'UNAVAILABLE';
    return header === undefined ? 'ABSENT' : header === derivedFact ? 'MATCH' : 'MISMATCH';
}

module.exports = { REQUIRED_FACT_SCOPES, deriveRequiredFactKey, assertRequiredFactHeader };
