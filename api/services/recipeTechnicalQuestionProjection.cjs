'use strict';

// Server-owned mapping between natural-language technical questions and the
// canonical Recipe technical aggregate.  This is intentionally a projection
// layer, not a second source of technical facts.
const FACTS = Object.freeze([
    ['rotorDiameter', /转子(?:直径|多大)|转子多少/u, '转子直径'],
    ['stackOffset', /叠片(?:偏移|偏置)|stack\s*offset/iu, '叠片偏移'],
    ['oilSealDiameter', /油封(?:直径|多大)|油封多少/u, '油封直径'],
    ['impellerBoreDiameter', /叶轮(?:孔径|内孔|孔直径)/u, '叶轮孔径'],
    ['impellerSpan', /叶轮(?:跨度|间距)/u, '叶轮跨度'],
    ['impellerThickness', /叶轮(?:厚度|多厚)/u, '叶轮厚度'],
    ['threadLength', /螺纹(?:长度|多长)/u, '螺纹长度'],
    ['threadDiameter', /螺纹(?:直径|多大)/u, '螺纹直径'],
    ['barrelLength', /机筒(?:长度|多长)|桶长/u, '机筒长度'],
    ['openOffset', /开口偏移|open\s*offset/iu, '开口偏移'],
    ['bearingSpan', /开档|轴承(?:跨度|间距)/u, '开档'],
    ['upperBearing', /上轴承/u, '上轴承'],
    ['lowerBearing', /下轴承/u, '下轴承'],
    ['pieceCount', /定子(?:多少片|片数)|(?:片数|多少片)/u, '定子片数'],
    ['pumpShell', /(?:用的|用哪个|哪个|什么|对应(?:哪个|的)?)泵壳|泵壳(?:是什么|哪个)/u, '泵壳'],
    ['coil', /(?:用的|用哪个|哪个|什么|对应(?:哪个|的)?)线圈|线圈(?:是什么|哪个)/u, '线圈'],
]);

function requestedTechnicalFactKeys(text = '') {
    const source = String(text || '');
    // A configuration statement such as “V550，12-200线圈，做300台”
    // mentions a relation but is not a request to read the technical profile.
    // Keep the aggregate read capability narrowly question-oriented.
    if (!/(?:多少|什么|哪个|多大|多长|几|[？?])/u.test(source)) return [];
    return FACTS.filter(([, pattern]) => pattern.test(source)).map(([key]) => key);
}

function displayPart(reference, role) {
    if (!reference?.partId) return null;
    const name = String(reference.model || role || '轴承').trim();
    const details = [`Part #${reference.partId}`];
    if (reference.engineeringCode) details.push(`工程代码 ${reference.engineeringCode}`);
    return `${name}（${details.join('；')}）`;
}

function displayRelation(relation, fallback) {
    if (!relation?.id) return null;
    const name = String(relation.displayName || relation.model || relation.name || '').trim();
    return name ? `${name}（#${relation.id}）` : `${fallback} #${relation.id}`;
}

function technicalProjection({ profile, relations = {}, requestedKeys = [] }) {
    const requested = requestedKeys.length ? requestedKeys : FACTS.map(([key]) => key);
    const missingReason = profile?.completeness?.reasons?.[0] || 'CANONICAL_TECHNICAL_PROFILE_UNAVAILABLE';
    if (!profile?.canonicalPresent || !profile?.functional) {
        return { canonicalPresent: false, completeness: profile?.completeness || { state: 'INCOMPLETE', reasons: [missingReason] }, facts: requested.map(key => ({ key, status: 'UNAVAILABLE', reason: missingReason })) };
    }
    const functional = profile.functional;
    const scalar = key => Number.isFinite(functional[key]) ? { key, status: 'VERIFIED', value: functional[key], unit: 'mm' } : { key, status: 'UNAVAILABLE', reason: missingReason };
    const facts = requested.map(key => {
        if (['rotorDiameter', 'stackOffset', 'oilSealDiameter', 'impellerBoreDiameter', 'impellerSpan', 'impellerThickness', 'threadLength', 'threadDiameter', 'barrelLength', 'openOffset'].includes(key)) return scalar(key);
        if (key === 'bearingSpan') return Number.isFinite(functional.bearingSpan)
            ? { key, status: 'VERIFIED', value: functional.bearingSpan, unit: 'mm', source: functional.bearingSpanSource, barrelLength: functional.barrelLength, openOffset: functional.openOffset }
            : { key, status: 'UNAVAILABLE', reason: missingReason };
        if (key === 'upperBearing') {
            const value = displayPart(profile.bearingReferences?.upper, '上轴承');
            return value ? { key, status: 'VERIFIED', value, partId: profile.bearingReferences.upper.partId } : { key, status: 'UNAVAILABLE', reason: missingReason };
        }
        if (key === 'lowerBearing') {
            const value = displayPart(profile.bearingReferences?.lower, '下轴承');
            return value ? { key, status: 'VERIFIED', value, partId: profile.bearingReferences.lower.partId } : { key, status: 'UNAVAILABLE', reason: missingReason };
        }
        if (key === 'pieceCount') return Number.isFinite(relations.pieceCount)
            ? { key, status: 'VERIFIED', value: relations.pieceCount, unit: '片', source: 'DERIVED_COPY_RECIPES_COIL_SHEETS' }
            : { key, status: 'UNAVAILABLE', reason: 'RECIPES_COIL_SHEETS_UNAVAILABLE' };
        if (key === 'pumpShell') {
            const value = displayRelation(relations.pumpShell, '泵壳 Part');
            return value ? { key, status: 'VERIFIED', value, partId: relations.pumpShell.id } : { key, status: 'UNAVAILABLE', reason: 'FORMAL_PUMP_SHELL_RELATION_UNAVAILABLE' };
        }
        if (key === 'coil') {
            const value = displayRelation(relations.coil, '线圈');
            return value ? { key, status: 'VERIFIED', value, coilId: relations.coil.id } : { key, status: 'UNAVAILABLE', reason: 'FORMAL_RECIPE_COIL_RELATION_UNAVAILABLE' };
        }
        return { key, status: 'UNAVAILABLE', reason: 'TECHNICAL_FACT_NOT_SUPPORTED' };
    });
    return { canonicalPresent: true, completeness: profile.completeness, facts };
}

module.exports = { FACTS, requestedTechnicalFactKeys, technicalProjection };
