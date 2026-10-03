'use strict';

const TYPE_DOMAIN = Object.freeze({ recipe: 'recipes', coil: 'coils', template: 'templates', part: 'parts' });
function norm(value) { return String(value || '').normalize('NFKC').replace(/\s+/gu, '').toLowerCase(); }
function identityTerms(record) { return [record.name, record.spec, record.schemeCode, record.commonDesignation, ...(record.aliases || [])].filter(Boolean).map(norm); }
function matchesQuery(record, query) { return identityTerms(record).includes(norm(query)); }
function findMatches(catalog, query) {
    const found = [];
    for (const [domain, group] of Object.entries(catalog.domains || {})) for (const record of group.records || []) if (matchesQuery(record, query)) found.push({ domain, record });
    return found;
}
function validatePlannerReference({ selectedReferences, referenceQuery, requestedResult, rawOwnerInput, catalog }) {
    const query = String(referenceQuery || '').trim();
    const selected = selectedReferences || [];
    const violations = [];
    if (query && !norm(rawOwnerInput).includes(norm(query))) violations.push('REFERENCE_QUERY_NOT_IN_OWNER_WORDING');
    const matches = query ? findMatches(catalog, query) : [];
    const validated = [];
    for (const reference of selected) {
        const domain = TYPE_DOMAIN[reference.entityType];
        const record = domain && catalog.domains?.[domain]?.records.find(row => row.id === Number(reference.id));
        if (!record) { violations.push('REFERENCE_NOT_FOUND'); continue; }
        if (norm(record.name) !== norm(reference.canonicalName)) { violations.push('REFERENCE_ID_NAME_MISMATCH'); continue; }
        if (!identityTerms(record).some(term => norm(rawOwnerInput).includes(term))) violations.push('REFERENCE_NOT_IN_OWNER_WORDING');
        validated.push(Object.freeze({ ...reference, canonicalId: record.id, canonicalName: record.name, source: catalog.domains[domain].source }));
    }
    const selectedKeys = new Set(validated.map(item => `${item.entityType}:${item.canonicalId}`));
    if (selectedKeys.size !== validated.length) violations.push('REFERENCE_DUPLICATE');
    if (matches.length > 1 && selected.length === 1) violations.push('SILENT_AMBIGUITY_SELECTION');
    if (selected.length && query && matches.length && validated.some(item => !matches.some(match => match.record.id === item.canonicalId && TYPE_DOMAIN[item.entityType] === match.domain))) violations.push('REFERENCE_QUERY_MISMATCH');
    if (query && matches.length === 1 && selected.length === 0 && requestedResult !== 'COUNT') violations.push('REFERENCE_SELECTION_MISSING');
    const status = violations.some(code => code === 'SILENT_AMBIGUITY_SELECTION') || matches.length > 1 && selected.length === 0 ? 'AMBIGUOUS' : violations.some(code => code.includes('MISMATCH')) ? 'MISMATCH' : violations.length ? 'NOT_FOUND' : selected.length || requestedResult === 'COUNT' && matches.length ? 'VALID' : query && !matches.length ? 'NOT_FOUND' : 'VALID';
    const candidateSet = matches.map(item => Object.freeze({ entityType: Object.keys(TYPE_DOMAIN).find(key => TYPE_DOMAIN[key] === item.domain), canonicalId: item.record.id, canonicalName: item.record.name }));
    return Object.freeze({ status, violations: Object.freeze([...new Set(violations)]), validatedReferences: Object.freeze(validated), candidateSet: Object.freeze(candidateSet), query, snapshotAt: catalog.snapshotAt });
}
module.exports = { TYPE_DOMAIN, findMatches, validatePlannerReference };
