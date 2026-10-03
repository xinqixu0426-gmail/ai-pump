'use strict';

const { UPSTREAM_FIXTURES } = require('./frozenUpstreamFixture.cjs');

const ROUTES = Object.freeze({ recipes: '/api/recipes', coils: '/api/coils', templates: '/api/templates', parts: '/api/parts' });
function text(value) { return String(value ?? '').trim(); }
function canonical(domain, row) {
    const id = Number(row.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`CATALOG_ID_INVALID:${domain}`);
    const name = text(domain === 'recipes' ? row.name : domain === 'coils' ? row.schemeName || row.name || row.schemeCode || row.spec : domain === 'templates' ? row.shellModel || row.name : row.model || row.name);
    if (!name) throw new Error(`CATALOG_NAME_MISSING:${domain}:${id}`);
    const commonDesignation = domain === 'coils' ? text(row.commonDesignation || (row.spec && row.sheets ? `${row.spec}-${row.sheets}` : '')) : '';
    return Object.freeze({ id, name, ...(domain === 'recipes' ? { spec: text(row.spec) } : {}), ...(domain === 'coils' ? { spec: text(row.spec), sheets: row.sheets ?? null, schemeCode: text(row.schemeCode), commonDesignation, cost: row.cost ?? null } : {}), ...(domain === 'templates' ? { description: text(row.description) } : {}), ...(domain === 'parts' ? { category: text(row.category), price: row.price ?? null } : {}), aliases: Object.freeze(Array.isArray(row.aliases) ? row.aliases.map(text).filter(Boolean) : []) });
}
function snapshotFromRows(rowsByDomain, provenance, clock = () => new Date()) {
    const domains = {};
    for (const [domain, route] of Object.entries(ROUTES)) {
        const rows = rowsByDomain[domain];
        if (!Array.isArray(rows)) throw new Error(`CATALOG_DOMAIN_MISSING:${domain}`);
        domains[domain] = Object.freeze({ source: provenance[domain] || route, count: rows.length, records: Object.freeze(rows.map(row => canonical(domain, row))) });
    }
    const snapshot = { sourceMode: provenance.sourceMode || 'OFFICIAL_GET', snapshotAt: clock().toISOString(), domains };
    const serializedChars = JSON.stringify(snapshot).length;
    return Object.freeze({ ...snapshot, serializedChars, estimatedTokens: Math.ceil(serializedChars / 4), recordCount: Object.values(domains).reduce((n, domain) => n + domain.count, 0) });
}
async function buildPlannerCatalogSnapshot({ getJson, clock } = {}) {
    if (typeof getJson !== 'function') throw new Error('CATALOG_GET_READER_REQUIRED');
    const rows = {}; const provenance = { sourceMode: 'OFFICIAL_GET' };
    for (const [domain, route] of Object.entries(ROUTES)) {
        const response = await getJson(route);
        if (response?.success !== true || !Array.isArray(response.data)) throw new Error(`CATALOG_READ_FAILED:${domain}`);
        rows[domain] = response.data;
        provenance[domain] = route;
    }
    return snapshotFromRows(rows, provenance, clock);
}
function buildFrozenFixtureCatalog(clock) {
    const rows = { recipes: new Map(), coils: new Map(), templates: new Map(), parts: new Map() };
    const domainFor = { recipe: 'recipes', coil: 'coils', template: 'templates', part: 'parts' };
    for (const fixture of Object.values(UPSTREAM_FIXTURES)) for (const target of fixture.finalGroundedTargets || []) {
        const domain = domainFor[target.entityType]; if (!domain) continue;
        for (const candidate of target.candidates || []) {
            const id = Number(candidate.canonicalId); const name = candidate.canonicalName;
            const prior = rows[domain].get(id) || { id, name, aliases: [] };
            if (target.mention && target.status === 'EXACT' && !prior.aliases.includes(target.mention)) prior.aliases.push(target.mention);
            if (domain === 'recipes') prior.spec = /^V\d+/iu.exec(name)?.[0] || '';
            if (domain === 'coils') {
                prior.schemeCode = /^\d+-\d+-[A-Z]/iu.exec(target.mention)?.[0] || /^\d+-\d+-[A-Z]/iu.exec(name)?.[0] || prior.schemeCode || '';
                prior.commonDesignation = /^\d+-\d+/u.exec(prior.schemeCode || name)?.[0] || '';
            }
            rows[domain].set(id, prior);
        }
    }
    return snapshotFromRows(Object.fromEntries(Object.entries(rows).map(([key, map]) => [key, [...map.values()]])), { sourceMode: 'FROZEN_GROUNDING_FIXTURE', recipes: 'scripts/ai-experiments/planner-v1/frozenUpstreamFixture.cjs', coils: 'scripts/ai-experiments/planner-v1/frozenUpstreamFixture.cjs', templates: 'scripts/ai-experiments/planner-v1/frozenUpstreamFixture.cjs', parts: 'EMPTY_IN_FROZEN_FIXTURE' }, clock);
}
module.exports = { ROUTES, canonical, snapshotFromRows, buildPlannerCatalogSnapshot, buildFrozenFixtureCatalog };
