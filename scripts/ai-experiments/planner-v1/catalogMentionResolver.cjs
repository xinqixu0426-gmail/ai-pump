'use strict';

const TYPE_BY_DOMAIN = Object.freeze({ recipes: 'recipe', coils: 'coil', templates: 'template', parts: 'part' });
function normalized(value) { return String(value || '').normalize('NFKC').replace(/\s+/gu, '').toLowerCase(); }
function identityTerms(record) { return [record.name, record.spec, record.schemeCode, record.commonDesignation, ...(record.aliases || [])].filter(Boolean).map(normalized); }
function resolveCatalogMentions(mentions, catalog) {
    return Object.freeze((mentions || []).map(mention => {
        const matches = [];
        for (const [domain, group] of Object.entries(catalog.domains || {})) {
            for (const record of group.records || []) if (identityTerms(record).includes(normalized(mention))) matches.push(Object.freeze({ entityType: TYPE_BY_DOMAIN[domain], canonicalId: record.id, canonicalName: record.name, source: group.source }));
        }
        const typeCount = new Set(matches.map(match => match.entityType)).size;
        const status = !matches.length ? 'NOT_FOUND' : typeCount > 1 ? 'MULTIPLE_TYPE' : matches.length > 1 ? 'MULTIPLE' : 'EXACT';
        return Object.freeze({ mention, status, matches: Object.freeze(matches), catalogExhaustive: catalog.sourceMode === 'OFFICIAL_GET' || catalog.sourceMode === 'FROZEN_GROUNDING_FIXTURE' });
    }));
}
module.exports = { TYPE_BY_DOMAIN, normalized, identityTerms, resolveCatalogMentions };
