'use strict';

const V5_SOURCE_SPAN_CATALOG_VERSION = 1;
const MAX_SOURCE_SPANS = 128;
const MAX_SEGMENT_COMBINATION = 6;

function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
}

function addSpan(target, source, start, end) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > source.length) return;
    let left = start;
    let right = end;
    while (left < right && /\s/u.test(source[left])) left += 1;
    while (right > left && /\s/u.test(source[right - 1])) right -= 1;
    if (right <= left) return;
    const key = `${left}:${right}`;
    if (!target.has(key)) target.set(key, { start: left, end: right });
}

function lexicalSegments(source) {
    const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
    return [...segmenter.segment(source)].map(item => ({
        start: item.index,
        end: item.index + item.segment.length,
        text: item.segment,
        wordLike: item.isWordLike === true,
    }));
}

function createV5SourceSpanCatalog(rawUserRequest) {
    if (typeof rawUserRequest !== 'string' || rawUserRequest.length === 0) {
        return freeze({ version: V5_SOURCE_SPAN_CATALOG_VERSION, status: 'INVALID_SOURCE', spans: [] });
    }
    const candidates = new Map();
    const segments = lexicalSegments(rawUserRequest);
    const identifierRanges = [];
    const asciiIdentifier = /(?:^|(?<=[^A-Za-z0-9_+.\/-]))[-_+.\/]*[A-Za-z0-9][A-Za-z0-9_+.\/-]*/g;
    for (const match of rawUserRequest.matchAll(asciiIdentifier)) {
        identifierRanges.push({ start: match.index, end: match.index + match[0].length });
    }
    const strictlyInsideIdentifier = (start, end) => identifierRanges.some(range => (
        range.start <= start && end <= range.end && (range.start !== start || range.end !== end)
    ));

    for (const segment of segments) {
        if (segment.wordLike && !strictlyInsideIdentifier(segment.start, segment.end)) {
            addSpan(candidates, rawUserRequest, segment.start, segment.end);
        }
    }

    for (let startIndex = 0; startIndex < segments.length; startIndex += 1) {
        if (!segments[startIndex].wordLike) continue;
        let wordCount = 0;
        for (let endIndex = startIndex; endIndex < segments.length; endIndex += 1) {
            const segment = segments[endIndex];
            if (segment.wordLike) wordCount += 1;
            if (wordCount > MAX_SEGMENT_COMBINATION) break;
            if (/\s/u.test(segment.text) && !segment.wordLike) break;
            if (segment.wordLike && !strictlyInsideIdentifier(segments[startIndex].start, segment.end)) {
                addSpan(candidates, rawUserRequest, segments[startIndex].start, segment.end);
            }
        }
    }

    for (const range of identifierRanges) addSpan(candidates, rawUserRequest, range.start, range.end);

    const quoted = /(["'“”‘’【】\[\]()（）])([^\r\n]{1,160}?)(["'“”‘’【】\[\]()（）])/gu;
    for (const match of rawUserRequest.matchAll(quoted)) {
        const start = match.index + match[1].length;
        addSpan(candidates, rawUserRequest, start, start + match[2].length);
    }

    addSpan(candidates, rawUserRequest, 0, rawUserRequest.length);
    const ordered = [...candidates.values()].sort((left, right) => (
        left.start - right.start || (right.end - right.start) - (left.end - left.start)
    ));
    if (ordered.length > MAX_SOURCE_SPANS) {
        return freeze({ version: V5_SOURCE_SPAN_CATALOG_VERSION, status: 'SPAN_CATALOG_LIMIT', spans: [] });
    }
    return freeze({
        version: V5_SOURCE_SPAN_CATALOG_VERSION,
        status: 'READY',
        spans: ordered.map((span, index) => ({
            spanRef: `sp_${String(index + 1).padStart(3, '0')}`,
            start: span.start,
            end: span.end,
            text: rawUserRequest.slice(span.start, span.end),
        })),
    });
}

function sourceSpanModelView(catalog) {
    if (!catalog || catalog.status !== 'READY') return freeze([]);
    return freeze(catalog.spans.map(span => ({ spanRef: span.spanRef, text: span.text })));
}

function mergeAuthoritativeCoilSpans(source, catalog, supply) {
    const invalid = () => freeze({ version: V5_SOURCE_SPAN_CATALOG_VERSION, status: 'SPAN_SUPPLY_INVALID', spans: [] });
    if (catalog.status !== 'READY' || supply?.version !== 1 || supply.status !== 'OK' || supply.complete !== true
        || !Number.isInteger(supply.identityScanCount) || supply.identityScanCount < 0 || supply.identityScanCount > 512
        || !Array.isArray(supply.candidates) || supply.candidates.length > 8
        || supply.candidateCount !== supply.candidates.length) return invalid();
    const spans = catalog.spans.map(s => ({ ...s })), seen = new Set(spans.map(s => `${s.start}:${s.end}`));
    for (const candidate of supply.candidates) {
        if (!candidate || Object.keys(candidate).some(k => !['start', 'end', 'entityType', 'identityKind'].includes(k))
            || candidate.entityType !== 'coil' || !['schemeName', 'schemeCode'].includes(candidate.identityKind)
            || !Number.isInteger(candidate.start) || !Number.isInteger(candidate.end)
            || candidate.start < 0 || candidate.end <= candidate.start || candidate.end > source.length) return invalid();
        const key = `${candidate.start}:${candidate.end}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (spans.length >= MAX_SOURCE_SPANS) return freeze({ version: V5_SOURCE_SPAN_CATALOG_VERSION, status: 'SPAN_CATALOG_LIMIT', spans: [] });
        // Append: preserve every original ref/offset. Do not expose authority or IDs to the model.
        spans.push({ spanRef: `sp_${String(spans.length + 1).padStart(3, '0')}`,
            start: candidate.start, end: candidate.end, text: source.slice(candidate.start, candidate.end) });
    }
    return freeze({ version: V5_SOURCE_SPAN_CATALOG_VERSION, status: 'READY', spans });
}

function getSourceSpan(catalog, spanRef) {
    return catalog?.status === 'READY'
        ? catalog.spans.find(span => span.spanRef === spanRef) || null
        : null;
}

function validateSourceSpanCatalog(source, catalog, authoritativeSupply) {
    if (typeof source !== 'string' || !catalog || catalog.status !== 'READY') return false;
    const refs = new Set();
    for (const span of catalog.spans) {
        if (!/^sp_\d{3}$/.test(span.spanRef) || refs.has(span.spanRef)) return false;
        refs.add(span.spanRef);
        if (source.slice(span.start, span.end) !== span.text) return false;
    }
    const structural = createV5SourceSpanCatalog(source);
    const expected = authoritativeSupply ? mergeAuthoritativeCoilSpans(source, structural, authoritativeSupply) : structural;
    return JSON.stringify(catalog) === JSON.stringify(expected);
}

module.exports = {
    MAX_SEGMENT_COMBINATION,
    MAX_SOURCE_SPANS,
    V5_SOURCE_SPAN_CATALOG_VERSION,
    createV5SourceSpanCatalog,
    mergeAuthoritativeCoilSpans,
    getSourceSpan,
    sourceSpanModelView,
    validateSourceSpanCatalog,
};
