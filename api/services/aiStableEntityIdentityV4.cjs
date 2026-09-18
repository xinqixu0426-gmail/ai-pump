const ENTITY_IDENTITY_SPECS = Object.freeze({
    customer: Object.freeze({
        primaryIdFields: Object.freeze(['primaryStableId', 'id', 'customerId']),
        stableBusinessKeys: Object.freeze({ name: Object.freeze(['name', 'customerName']) }),
        canonicalNameFields: Object.freeze(['canonicalName', 'name', 'customerName']),
        validationFields: Object.freeze([]),
    }),
    order: Object.freeze({
        primaryIdFields: Object.freeze(['primaryStableId', 'id', 'orderId']),
        stableBusinessKeys: Object.freeze({ contractNo: Object.freeze(['contractNo']) }),
        canonicalNameFields: Object.freeze(['canonicalName', 'contractNo', 'customerName']),
        validationFields: Object.freeze([]),
    }),
    recipe: Object.freeze({
        primaryIdFields: Object.freeze(['primaryStableId', 'id', 'recipeId']),
        stableBusinessKeys: Object.freeze({ name: Object.freeze(['name', 'recipeName']) }),
        canonicalNameFields: Object.freeze(['canonicalName', 'name', 'recipeName']),
        validationFields: Object.freeze(['spec']),
    }),
    part: Object.freeze({
        primaryIdFields: Object.freeze(['primaryStableId', 'id', 'partId']),
        stableBusinessKeys: Object.freeze({ model: Object.freeze(['model']) }),
        canonicalNameFields: Object.freeze(['canonicalName', 'model', 'name']),
        validationFields: Object.freeze(['category', 'supplier']),
    }),
    coil: Object.freeze({
        primaryIdFields: Object.freeze(['primaryStableId', 'id', 'coilId']),
        stableBusinessKeys: Object.freeze({ schemeCode: Object.freeze(['schemeCode', 'scheme_code']) }),
        canonicalNameFields: Object.freeze(['canonicalName', 'schemeCode', 'schemeName', 'model', 'spec']),
        validationFields: Object.freeze(['spec', 'sheets', 'material', 'slotType', 'schemeFamilyCode']),
    }),
    template: Object.freeze({
        primaryIdFields: Object.freeze(['primaryStableId', 'id', 'templateId']),
        stableBusinessKeys: Object.freeze({ shellModel: Object.freeze(['shellModel', 'model']) }),
        canonicalNameFields: Object.freeze(['canonicalName', 'shellModel', 'model', 'description']),
        validationFields: Object.freeze([]),
    }),
});

function immutable(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(immutable));
    if (!value || typeof value !== 'object') return value;
    return Object.freeze(Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, immutable(nested)])
    ));
}

function present(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).normalize('NFKC').trim();
    return text || null;
}

function firstPresent(source, fields) {
    for (const field of fields || []) {
        const value = present(source?.[field]);
        if (value !== null) return value;
    }
    return null;
}

function stableBusinessKeysFrom(source, spec) {
    const supplied = source?.stableBusinessKeys && typeof source.stableBusinessKeys === 'object'
        ? source.stableBusinessKeys
        : {};
    const entries = [];
    for (const [key, fields] of Object.entries(spec.stableBusinessKeys || {})) {
        const value = present(supplied[key]) || firstPresent(source, fields);
        if (value !== null) entries.push([key, value]);
    }
    return Object.fromEntries(entries);
}

function normalizeStableEntityIdentity(input = {}) {
    const entityType = present(input.entityType);
    const spec = entityType ? ENTITY_IDENTITY_SPECS[entityType] : null;
    if (!spec) return null;
    const source = input.record && typeof input.record === 'object' ? input.record : input;
    const primaryStableId = firstPresent(source, spec.primaryIdFields);
    const stableBusinessKeys = stableBusinessKeysFrom(source, spec);
    if (primaryStableId === null && Object.keys(stableBusinessKeys).length === 0) return null;
    const validationAttributes = Object.fromEntries((spec.validationFields || [])
        .map(field => [field, present(source[field])])
        .filter(([, value]) => value !== null));
    return immutable({
        entityType,
        primaryStableId,
        stableBusinessKeys,
        canonicalName: firstPresent(source, spec.canonicalNameFields),
        validationAttributes,
    });
}

function stableEntityIdentityComparison(leftInput, rightInput) {
    const left = normalizeStableEntityIdentity(leftInput || {});
    const right = normalizeStableEntityIdentity(rightInput || {});
    if (!left || !right) return 'indeterminate';
    if (left.entityType !== right.entityType) return 'different';
    let matched = false;
    if (left.primaryStableId !== null && right.primaryStableId !== null) {
        if (left.primaryStableId !== right.primaryStableId) return 'conflict';
        matched = true;
    }
    for (const key of new Set([
        ...Object.keys(left.stableBusinessKeys),
        ...Object.keys(right.stableBusinessKeys),
    ])) {
        const leftValue = left.stableBusinessKeys[key];
        const rightValue = right.stableBusinessKeys[key];
        if (leftValue === undefined || rightValue === undefined) continue;
        if (leftValue !== rightValue) return 'conflict';
        matched = true;
    }
    return matched ? 'same' : 'indeterminate';
}

function stableEntityIdentityMatches(left, right) {
    return stableEntityIdentityComparison(left, right) === 'same';
}

function stableBusinessKeyValues(identity) {
    const normalized = normalizeStableEntityIdentity(identity || {});
    return normalized ? Object.values(normalized.stableBusinessKeys) : [];
}

module.exports = {
    ENTITY_IDENTITY_SPECS,
    normalizeStableEntityIdentity,
    stableBusinessKeyValues,
    stableEntityIdentityComparison,
    stableEntityIdentityMatches,
};
