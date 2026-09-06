'use strict';
const { mergeAuthoritativeCoilSpans } = require('./sourceSpanCatalog.cjs');
const { acquireCandidateSet } = require('./candidateSet.cjs');

// Only the governed coil supply is eligible. Catalog membership alone is not authority.
function selectExactAuthoritativeSpan(source, catalog, supply) {
    const checked = mergeAuthoritativeCoilSpans(source, catalog, supply);
    if (checked.status !== 'READY') return { status: checked.status, candidateCount: 0 };
    const unique = new Map();
    for (const candidate of supply.candidates) {
        const key = `${candidate.start}:${candidate.end}`;
        // Both approved kinds denote a complete exact identity occurrence. Equal
        // offsets imply identical source text; no distinct occurrence is collapsed.
        if (!unique.has(key)) unique.set(key, { ...candidate, kinds: [] });
        unique.get(key).kinds.push(candidate.identityKind);
    }
    if (unique.size !== 1) return { status: unique.size ? 'AUTHORITATIVE_SPAN_AMBIGUOUS' : 'NO_AUTHORITATIVE_SPAN', candidateCount: unique.size };
    const occurrence = unique.values().next().value;
    const span = checked.spans.find(s => s.start === occurrence.start && s.end === occurrence.end && s.text === source.slice(s.start, s.end));
    if (!span) return { status: 'SPAN_SUPPLY_INVALID', candidateCount: 1 };
    return { status: 'EXACT_AUTHORITATIVE_SPAN', candidateCount: 1, span,
        identityKinds: Object.freeze([...new Set(occurrence.kinds)].sort()) };
}

async function acquireExactAuthoritativeCandidateSet(span, options) {
    // Span authority never supplies canonical identity. This read is mandatory,
    // including duplicate business records and cross-type collisions.
    const result = await acquireCandidateSet(span.text, options);
    return Object.freeze({ ...result,
        candidates: Object.freeze(result.candidates.map(c => Object.freeze({ ...c, matchedSpanRefs: Object.freeze([span.spanRef]) }))),
        resolverCalls: 1, originalResolverCalls: 1, originalLookupStatuses: [result.status],
        lookupStatuses: [result.status], refinementTriggered: false, nestedParentCount: 0,
        nestedSelectedCount: 0, nestedSpanRefs: [], nestedResolverCalls: 0, nestedLookupStatuses: [], deduplications: 0 });
}
module.exports = { selectExactAuthoritativeSpan, acquireExactAuthoritativeCandidateSet };
