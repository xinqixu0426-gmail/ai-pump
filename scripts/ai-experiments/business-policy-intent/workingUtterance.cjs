'use strict';

function occurrenceCount(text, search) {
    if (!search) return 0;
    return String(text).split(String(search)).length - 1;
}

function buildGroundingWorkingUtterance({ rawOwnerInput, reference }) {
    const raw = String(rawOwnerInput || '');
    const status = reference?.status || 'NONE';
    if (status !== 'RESOLVED') {
        return Object.freeze({
            workingUtterance: raw,
            rewrite: Object.freeze({ applied: false, sourceSurface: reference?.surface || null, replacement: null, rawOwnerInput: raw, workingUtterance: raw, source: null, failure: null }),
        });
    }

    const sourceSurface = String(reference.surface || '');
    const replacement = String(reference.resolvedLanguageReference || '');
    const count = occurrenceCount(raw, sourceSurface);
    if (!sourceSurface || !replacement || count !== 1) {
        const failure = count > 1 ? 'MULTI_REFERENCE_NOT_SUPPORTED' : 'REFERENCE_REWRITE_MISMATCH';
        return Object.freeze({
            workingUtterance: raw,
            rewrite: Object.freeze({ applied: false, sourceSurface: sourceSurface || null, replacement: replacement || null, rawOwnerInput: raw, workingUtterance: raw, source: 'RESOLVED_OWNER_LANGUAGE_REFERENCE', failure }),
        });
    }
    const workingUtterance = raw.replace(sourceSurface, replacement);
    return Object.freeze({
        workingUtterance,
        rewrite: Object.freeze({ applied: true, sourceSurface, replacement, rawOwnerInput: raw, workingUtterance, source: 'RESOLVED_OWNER_LANGUAGE_REFERENCE', failure: null }),
    });
}

function normalize(value) { return String(value || '').replace(/[，。！？、\s]/gu, ''); }

function roleExpressionInWorkingUtterance(expression, workingUtterance) {
    const candidate = normalize(expression);
    return Boolean(candidate) && normalize(workingUtterance).includes(candidate);
}

module.exports = { buildGroundingWorkingUtterance, occurrenceCount, roleExpressionInWorkingUtterance };
