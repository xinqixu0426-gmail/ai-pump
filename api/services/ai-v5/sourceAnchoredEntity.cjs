'use strict';

const V5_SOURCE_ANCHOR_STATUSES = Object.freeze([
    'ANCHORED',
    'INVALID_ENTITY_REFERENCE',
    'AMBIGUOUS_ENTITY_REFERENCE',
]);

function isEntityContinuation(source, candidate, index) {
    const before = index > 0 ? source[index - 1] : '';
    const after = source[index + candidate.length] || '';
    const first = candidate[0] || '';
    const last = candidate.at(-1) || '';
    const asciiEntity = /[A-Za-z0-9._+\/-]/;
    if (/[A-Za-z0-9]/.test(first) && asciiEntity.test(before)) return true;
    if (/[A-Za-z0-9]/.test(last) && asciiEntity.test(after)) return true;
    if (/^\d+$/.test(candidate) && /[\p{L}\p{N}]/u.test(after)) return true;
    return false;
}

function occurrenceIndexes(source, candidate) {
    const indexes = [];
    let offset = 0;
    while (offset <= source.length - candidate.length) {
        const index = source.indexOf(candidate, offset);
        if (index < 0) break;
        if (!isEntityContinuation(source, candidate, index)) indexes.push(index);
        offset = index + 1;
    }
    return indexes;
}

function anchorEntityCandidate(sourceRequest, candidate = {}) {
    if (typeof sourceRequest !== 'string'
        || typeof candidate.candidateText !== 'string'
        || candidate.candidateText.length === 0
        || typeof candidate.entityType !== 'string') {
        return Object.freeze({
            status: 'INVALID_ENTITY_REFERENCE', entityType: null, matchCount: 0, rawMention: null,
        });
    }
    const indexes = occurrenceIndexes(sourceRequest, candidate.candidateText);
    if (indexes.length === 0) {
        return Object.freeze({
            status: 'INVALID_ENTITY_REFERENCE', entityType: candidate.entityType, matchCount: 0, rawMention: null,
        });
    }
    if (indexes.length > 1) {
        return Object.freeze({
            status: 'AMBIGUOUS_ENTITY_REFERENCE', entityType: candidate.entityType,
            matchCount: indexes.length, rawMention: null,
        });
    }
    const start = indexes[0];
    return Object.freeze({
        status: 'ANCHORED',
        entityType: candidate.entityType,
        matchCount: 1,
        rawMention: sourceRequest.slice(start, start + candidate.candidateText.length),
    });
}

function anchorInterpretationEntities(sourceRequest, interpretation) {
    const anchors = (interpretation?.entityCandidates || [])
        .map(candidate => anchorEntityCandidate(sourceRequest, candidate));
    const failure = anchors.find(item => item.status !== 'ANCHORED');
    return Object.freeze({
        valid: !failure,
        status: failure?.status || 'ANCHORED',
        anchors: Object.freeze(anchors),
    });
}

module.exports = {
    V5_SOURCE_ANCHOR_STATUSES,
    anchorEntityCandidate,
    anchorInterpretationEntities,
};
