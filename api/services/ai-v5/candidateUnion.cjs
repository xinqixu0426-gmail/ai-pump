'use strict';
const { acquireCandidateSet } = require('./candidateSet.cjs');
const { MAX_TOTAL_CANDIDATES } = require('./typeIndependentEntityResolver.cjs');
async function acquireCandidateUnion(spans, options = {}) {
    if (!Array.isArray(spans) || spans.length !== 2 || new Set(spans.map(s=>s.spanRef)).size !== 2) throw new Error('INVALID_SPAN_PAIR');
    const sets = [];
    for (const span of spans) {
        const set = await acquireCandidateSet(span.text, options);
        sets.push(set);
        if (!set.complete || !['RESOLVED','AMBIGUOUS','NOT_FOUND'].includes(set.status)) break;
    }
    const complete = sets.length === 2 && sets.every(s=>s.complete && ['RESOLVED','AMBIGUOUS','NOT_FOUND'].includes(s.status));
    const candidates = new Map(); let deduplications = 0;
    if (complete) sets.forEach((set,i)=>set.candidates.forEach(candidate=>{
        const key = `${candidate.entityType}\0${candidate.canonicalId}`;
        if (!candidates.has(key)) candidates.set(key,{...candidate,matchedSpanRefs:[]}); else deduplications++;
        candidates.get(key).matchedSpanRefs.push(spans[i].spanRef);
    }));
    const bounded = candidates.size <= 2 * MAX_TOTAL_CANDIDATES;
    const values = complete && bounded ? [...candidates.values()].map(c=>Object.freeze({...c,matchedSpanRefs:Object.freeze(c.matchedSpanRefs)})) : [];
    const status = !complete || !bounded ? 'ERROR' : values.length===0?'NOT_FOUND':values.length===1?'RESOLVED':'AMBIGUOUS';
    return Object.freeze({status,complete:complete&&bounded,eligible:complete&&bounded&&values.length>0,
        businessApiCalls:sets.reduce((n,s)=>n+s.businessApiCalls,0),resolverCalls:sets.length,
        lookupStatuses:Object.freeze(sets.map(s=>s.status)),deduplications,
        candidateCount:values.length,candidateTypeCount:new Set(values.map(c=>c.entityType)).size,
        candidates:Object.freeze(values),reasonCodes:Object.freeze([status==='ERROR'?'CANDIDATE_UNION_INCOMPLETE':status==='NOT_FOUND'?'ENTITY_LOOKUP_NOT_FOUND':'CANDIDATE_UNION_COMPLETE'])});
}
module.exports = { acquireCandidateUnion };
