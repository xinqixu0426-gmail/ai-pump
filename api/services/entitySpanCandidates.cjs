'use strict';

const VERSION = 1;
const MAX_CANDIDATES = 8;
const MAX_IDENTITIES = 512;
const MAX_SOURCE_LENGTH = 4096; // UTF-16 offsets, same convention as Source Span Catalog.
const FIELDS = new Set(['version', 'sourceText', 'entityScope']);
function invalid() { return Object.assign(new Error('Invalid span candidate request'), { code: 'SPAN_REQUEST_INVALID', statusCode: 400 }); }
function validateRequest(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some(k => !FIELDS.has(k)) || input.version !== VERSION
        || input.entityScope !== 'coil' || typeof input.sourceText !== 'string'
        || !input.sourceText.trim() || input.sourceText.length > MAX_SOURCE_LENGTH) throw invalid();
    return input.sourceText;
}
function result(status, count, candidates = []) {
    return { version: VERSION, status, complete: status === 'OK', identityScanCount: count,
        candidateCount: candidates.length, candidates };
}
function createEntitySpanCandidateService({ db }) {
    // One bounded statement/snapshot. Count field records conservatively, including
    // duplicate values and non-active rows, exactly as existing governed lookup does.
    const statement = db.prepare(`
        SELECT scheme_name AS identity, 'schemeName' AS identityKind FROM coils
        WHERE scheme_name IS NOT NULL AND scheme_name <> ''
        UNION ALL
        SELECT scheme_code AS identity, 'schemeCode' AS identityKind FROM coils
        WHERE scheme_code IS NOT NULL AND scheme_code <> ''
        LIMIT ?
    `);
    return { supply(input) {
        const source = validateRequest(input);
        const identities = statement.all(MAX_IDENTITIES + 1);
        if (identities.length > MAX_IDENTITIES) return result('IDENTITY_SCAN_BUDGET_EXCEEDED', identities.length);
        const candidates = [], seen = new Set();
        for (const { identity, identityKind } of identities) {
            if (typeof identity !== 'string' || !identity.length) return result('IDENTITY_SOURCE_INVALID', identities.length);
            // Exact complete identity occurrences only; no case folding or normalization.
            for (let start = source.indexOf(identity); start !== -1; start = source.indexOf(identity, start + 1)) {
                const end = start + identity.length, key = `${start}:${end}:${identityKind}`;
                if (seen.has(key)) continue;
                seen.add(key);
                candidates.push({ start, end, entityType: 'coil', identityKind });
                if (candidates.length > MAX_CANDIDATES) return result('SPAN_CANDIDATE_BUDGET_EXCEEDED', identities.length);
            }
        }
        candidates.sort((a, b) => a.start - b.start || a.end - b.end || a.identityKind.localeCompare(b.identityKind));
        return result('OK', identities.length, candidates);
    } };
}
module.exports = { VERSION, MAX_CANDIDATES, MAX_IDENTITIES, MAX_SOURCE_LENGTH, validateRequest, createEntitySpanCandidateService };
