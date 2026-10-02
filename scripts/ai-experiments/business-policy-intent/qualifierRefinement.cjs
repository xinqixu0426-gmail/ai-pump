'use strict';

function normalize(value) {
    return String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[\s\-－–—]/gu, '');
}

function qualifierMatchesCandidate(qualifierExpression, candidate) {
    const qualifier = normalize(qualifierExpression);
    const name = normalize(candidate?.canonicalName);
    return Boolean(qualifier && name && name.includes(qualifier));
}

function refinedTarget(base, candidate, qualifierExpression) {
    return Object.freeze({
        mention: candidate.canonicalName,
        entityType: base.entityType,
        status: 'EXACT',
        canonicalId: candidate.canonicalId,
        canonicalName: candidate.canonicalName,
        candidates: Object.freeze([candidate]),
        source: 'QUALIFIER_REFINEMENT',
        qualifier: Object.freeze({ qualifierExpression, baseMention: base.mention, candidateCanonicalId: candidate.canonicalId, candidateCanonicalName: candidate.canonicalName, matchMode: 'CONSERVATIVE_NORMALIZED_TEXT', source: 'OWNER_EXPLICIT_QUALIFIER' }),
    });
}

function refineQualifiedTargets({ supportedProbeResults, unresolvedProbeResults, qualifierCandidates, workingUtterance }) {
    const source = String(workingUtterance || '');
    const seenQualifiers = new Set();
    const unresolved = [...(unresolvedProbeResults || []), ...(qualifierCandidates || [])].filter(item => {
        const mention = String(item.mention || '');
        if (!mention || !source.includes(mention) || seenQualifiers.has(mention)) return false;
        seenQualifiers.add(mention);
        return true;
    });
    const refinements = [];
    const replacements = new Map();
    for (const base of (supportedProbeResults || []).filter(item => item.status === 'MULTIPLE' && item.candidates?.length)) {
        const matches = unresolved.map(proposal => ({ proposal, matches: base.candidates.filter(candidate => qualifierMatchesCandidate(proposal.mention, candidate)) }));
        const unique = matches.filter(item => item.matches.length === 1);
        const ambiguous = matches.filter(item => item.matches.length > 1);
        const noMatch = matches.filter(item => item.matches.length === 0);
        const selectedIds = new Set();
        const selected = unique.filter(item => {
            const candidateId = item.matches[0].canonicalId;
            if (selectedIds.has(candidateId)) return false;
            selectedIds.add(candidateId);
            return true;
        });
        const refined = selected.map(item => refinedTarget(base, item.matches[0], item.proposal.mention));
        if (refined.length && !ambiguous.length) replacements.set(base.mention, Object.freeze(refined));
        refinements.push(Object.freeze({ baseMention: base.mention, baseStatus: base.status, qualifiers: Object.freeze(matches.map(item => item.proposal.mention)), refinedTargets: Object.freeze(refined), ambiguousQualifiers: Object.freeze(ambiguous.map(item => item.proposal.mention)), noMatchQualifiers: Object.freeze(noMatch.map(item => item.proposal.mention)), applied: refined.length > 0 && !ambiguous.length }));
    }
    return Object.freeze({ refinements: Object.freeze(refinements), replacements });
}

module.exports = { normalize, qualifierMatchesCandidate, refineQualifiedTargets };
