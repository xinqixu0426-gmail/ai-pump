'use strict';

const ACTIVE_SCHEME_STATUSES = new Set(['official', 'testing']);

function schemeStatusOf(row) {
    return String(row?.schemeStatus ?? row?.scheme_status ?? 'official').trim() || 'official';
}

function positiveId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function authoritativeCoilCandidateScope(rows, semantics = {}) {
    const requestedScope = semantics.requestedVariantScope || 'OFFICIAL';
    const targetSpec = String(semantics.requestedIdentity?.spec ?? '').trim();
    const targetSheets = Number(semantics.requestedIdentity?.sheets);
    const scoped = (Array.isArray(rows) ? rows : []).filter(row => {
        const status = schemeStatusOf(row);
        if (requestedScope === 'OFFICIAL' && status !== 'official') return false;
        if (requestedScope === 'TESTING' && status !== 'testing') return false;
        if (requestedScope === 'ALL_ACTIVE' && !ACTIVE_SCHEME_STATUSES.has(status)) return false;
        if (targetSpec && String(row?.spec ?? '').trim() !== targetSpec) return false;
        if (Number.isFinite(targetSheets) && targetSheets > 0 && Number(row?.sheets) !== targetSheets) return false;
        return true;
    });
    const deduplicated = new Map();
    for (const row of scoped) {
        const id = positiveId(row?.id ?? row?.Id);
        const key = id ? `id:${id}` : JSON.stringify([
            row?.spec, row?.sheets, row?.material, row?.slotType ?? row?.slot_type, row?.schemeCode ?? row?.scheme_code,
        ]);
        deduplicated.set(key, row);
    }
    return { scope: requestedScope, rows: [...deduplicated.values()] };
}

module.exports = { authoritativeCoilCandidateScope, schemeStatusOf };
