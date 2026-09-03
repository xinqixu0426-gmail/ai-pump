const INVENTORY_QUANTITY_PREDICATE = 'inventoryQuantity';
const INVENTORY_QUANTITY_CLAIM_PREDICATE = 'inventory.quantity';
const CURRENT_INVENTORY_SCENARIO = 'current_inventory';

const INVENTORY_ENTITY_CONTRACTS = Object.freeze({
    part: Object.freeze({
        fields: Object.freeze(['stock']),
        unit: '件',
        canonicalNameFields: Object.freeze(['model', 'name']),
    }),
    coil: Object.freeze({
        fields: Object.freeze(['stock']),
        unit: '套',
        canonicalNameFields: Object.freeze(['spec', 'schemeCode', 'name']),
    }),
});

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function immutable(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(immutable));
    if (!value || typeof value !== 'object') return value;
    return Object.freeze(Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, immutable(nested)])
    ));
}

function isCurrentInventoryQuantityIdentity(identity = {}) {
    return identity.predicate === INVENTORY_QUANTITY_PREDICATE
        && identity.temporalScope === 'current'
        && identity.scenario === CURRENT_INVENTORY_SCENARIO
        && Boolean(INVENTORY_ENTITY_CONTRACTS[identity.entityType]);
}

function normalizeInventoryFactIntent(input = {}) {
    if (!isCurrentInventoryQuantityIdentity(input)) return null;
    return immutable({
        entityType: input.entityType,
        predicate: INVENTORY_QUANTITY_PREDICATE,
        temporalScope: 'current',
        scenario: CURRENT_INVENTORY_SCENARIO,
        qualifiers: stableValue(input.qualifiers || {}),
    });
}

function unwrapFormalResult(evidence = {}) {
    const result = evidence.toolResult?.result || evidence.toolResult || {};
    return result?.formalResult || result;
}

function resultRows(result = {}, entityType) {
    const contractKeys = entityType === 'part' ? ['parts'] : ['coils'];
    for (const key of [...contractKeys, 'data', 'items']) {
        if (Array.isArray(result?.[key])) return result[key];
    }
    const singular = result?.[entityType];
    if (singular && typeof singular === 'object') return [singular];
    if (result?.data && typeof result.data === 'object') return [result.data];
    return [];
}

function rowEntityId(row = {}, entityType) {
    return row.id ?? row.Id ?? row[`${entityType}Id`] ?? null;
}

function exactEntityRow(result, identity) {
    if (identity.entityId === null || identity.entityId === undefined) return null;
    const matches = resultRows(result, identity.entityType).filter(row => (
        String(rowEntityId(row, identity.entityType) ?? '') === String(identity.entityId)
    ));
    return matches.length === 1 ? matches[0] : null;
}

function finiteNumericValue(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function firstPresentNumeric(row, fields) {
    for (const field of fields) {
        const numericValue = finiteNumericValue(row?.[field]);
        if (numericValue !== null) return numericValue;
    }
    return null;
}

function materializeNumericBusinessScalarFact(requirement, evidence) {
    const identity = requirement?.identity || {};
    const contract = INVENTORY_ENTITY_CONTRACTS[identity.entityType];
    if (!contract || !isCurrentInventoryQuantityIdentity(identity)) return null;
    if (evidence?.recordType !== 'evidence'
        || evidence.kind !== 'live_business'
        || evidence.factKey !== requirement.factKey
        || !evidence.evidenceId
        || (requirement.requiredSourceOfTruth
            && evidence.sourceOfTruth !== requirement.requiredSourceOfTruth)) return null;
    const result = unwrapFormalResult(evidence);
    const row = exactEntityRow(result, identity);
    if (!row) return null;
    const numericValue = firstPresentNumeric(row, contract.fields);
    if (numericValue === null) return null;
    const canonicalName = contract.canonicalNameFields
        .map(field => row[field])
        .find(value => String(value || '').trim()) || null;
    return immutable({
        recordType: 'numeric_business_scalar_fact',
        factKey: requirement.factKey,
        subject: {
            entityType: identity.entityType,
            entityId: String(identity.entityId),
            canonicalName: canonicalName === null ? null : String(canonicalName),
        },
        predicate: INVENTORY_QUANTITY_CLAIM_PREDICATE,
        numericValue,
        unit: contract.unit,
        temporalScope: 'current',
        scenario: CURRENT_INVENTORY_SCENARIO,
        qualifiers: stableValue(identity.qualifiers || {}),
        authority: {
            kind: evidence.kind,
            sourceOfTruth: evidence.sourceOfTruth,
            authorityVersion: evidence.authorityVersion ?? null,
            authorityTime: evidence.authorityTime || null,
        },
        sourceOfTruth: evidence.sourceOfTruth,
        evidenceRefs: [evidence.evidenceId],
    });
}

function hasExplicitInventoryStatus(requirement, evidence) {
    const identity = requirement?.identity || {};
    if (identity.predicate !== 'currentStatus'
        || identity.temporalScope !== 'current'
        || identity.scenario !== CURRENT_INVENTORY_SCENARIO
        || evidence?.recordType !== 'evidence'
        || evidence.kind !== 'live_business'
        || evidence.factKey !== requirement.factKey) return false;
    const row = exactEntityRow(unwrapFormalResult(evidence), identity);
    return Boolean(row && (row.inventoryStatus !== null && row.inventoryStatus !== undefined
        || row.stockStatus !== null && row.stockStatus !== undefined));
}

module.exports = {
    CURRENT_INVENTORY_SCENARIO,
    INVENTORY_ENTITY_CONTRACTS,
    INVENTORY_QUANTITY_CLAIM_PREDICATE,
    INVENTORY_QUANTITY_PREDICATE,
    hasExplicitInventoryStatus,
    isCurrentInventoryQuantityIdentity,
    materializeNumericBusinessScalarFact,
    normalizeInventoryFactIntent,
};
