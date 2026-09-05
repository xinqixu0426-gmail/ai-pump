'use strict';
const { acquireCandidateUnion } = require('./candidateUnion.cjs');
const { acquireCandidateSet } = require('./candidateSet.cjs');
const { MAX_TOTAL_CANDIDATES } = require('./typeIndependentEntityResolver.cjs');
const NESTED_SPAN_REFINEMENT_VERSION = 1;
const NESTED_SPAN_STRATEGY = 'IDENTIFIER_PRIORITY';
const NESTED_K_PER_PARENT = 1;
const MAX_ENTITY_LOOKUPS_PER_PATH = 4;
const same = (a,b) => a.start===b.start && a.end===b.end;
function shouldRefine(original) {
    return original.resolverCalls===2 && original.complete===true && original.candidateCount===0 &&
        original.candidates.length===0 && original.lookupStatuses.length===2 &&
        original.lookupStatuses.every(s=>s==='NOT_FOUND') &&
        original.lookupCompleteness.length===2 && original.lookupCompleteness.every(v=>v===true);
}
function selectNestedSpans(source,catalog,parents) {
    const ids=[...source.matchAll(/(?:^|(?<=[^A-Za-z0-9_+.\/-]))[-_+.\/]*[A-Za-z0-9][A-Za-z0-9_+.\/-]*/g)].map(m=>({start:m.index,end:m.index+m[0].length}));
    const quotes=[...source.matchAll(/(["'“”‘’【】\[\]()（）])([^\r\n]{1,160}?)(["'“”‘’【】\[\]()（）])/gu)].map(m=>({start:m.index+m[1].length,end:m.index+m[1].length+m[2].length}));
    const words=[...new Intl.Segmenter('zh-CN',{granularity:'word'}).segment(source)].filter(s=>s.isWordLike).map(s=>({start:s.index,end:s.index+s.segment.length}));
    const type=s=>ids.some(r=>same(r,s))?0:quotes.some(r=>same(r,s))?1:words.some(r=>same(r,s))?3:2;
    const selected=new Map();
    for(const parent of parents) {
        const nested=catalog.spans.filter(s=>s.start>=parent.start && s.end<=parent.end && !same(s,parent) &&
            !parents.some(p=>p.spanRef===s.spanRef) && [...s.text].length<=160 && source.slice(s.start,s.end)===s.text);
        nested.sort((a,b)=>type(a)-type(b)||[...b.text].length-[...a.text].length||a.start-b.start||a.end-b.end);
        for(const span of nested.slice(0,NESTED_K_PER_PARENT)) selected.set(span.spanRef,span);
    }
    return Object.freeze([...selected.values()]);
}
function createLookupBudget() {
    let calls=0;
    return Object.freeze({consume(){if(calls>=MAX_ENTITY_LOOKUPS_PER_PATH)throw new Error('LOOKUP_BUDGET_EXCEEDED');calls++;},count:()=>calls});
}
async function acquireRefinedCandidateUnion(spans,source,catalog,options={}) {
    const budget=createLookupBudget();
    const counted={...options,onBusinessApiCall:()=>{budget.consume();options.onBusinessApiCall?.();}};
    const original=await acquireCandidateUnion(spans,counted);
    const triggered=shouldRefine(original);
    const plan=triggered?selectNestedSpans(source,catalog,spans):[];
    const metadata={refinementVersion:1,refinementTriggered:triggered,originalResolverCalls:original.resolverCalls,
        originalLookupStatuses:original.lookupStatuses,nestedParentCount:triggered?2:0,nestedSelectedCount:plan.length,
        nestedSpanRefs:Object.freeze(plan.map(s=>s.spanRef)),nestedResolverCalls:0,nestedLookupStatuses:Object.freeze([])};
    if(!triggered)return Object.freeze({...original,...metadata});
    const sets=[];
    for(const span of plan) {
        const set=await acquireCandidateSet(span.text,counted);sets.push(set);
        if(!set.complete||!['RESOLVED','AMBIGUOUS','NOT_FOUND'].includes(set.status))break;
    }
    const complete=sets.length===plan.length && sets.every(s=>s.complete && ['RESOLVED','AMBIGUOUS','NOT_FOUND'].includes(s.status));
    const candidates=new Map();let deduplications=0;
    if(complete)sets.forEach((set,i)=>set.candidates.forEach(c=>{
        const key=`${c.entityType}\0${c.canonicalId}`;
        if(!candidates.has(key))candidates.set(key,{...c,matchedSpanRefs:[]});else deduplications++;
        candidates.get(key).matchedSpanRefs.push(plan[i].spanRef);
    }));
    const bounded=candidates.size<=MAX_ENTITY_LOOKUPS_PER_PATH*MAX_TOTAL_CANDIDATES;
    const values=complete&&bounded?[...candidates.values()].map(c=>Object.freeze({...c,matchedSpanRefs:Object.freeze(c.matchedSpanRefs)})):[];
    const status=!complete||!bounded?'ERROR':values.length===0?'NOT_FOUND':values.length===1?'RESOLVED':'AMBIGUOUS';
    const errorCodes=sets.filter(s=>!s.complete||s.status==='ERROR').flatMap(s=>s.reasonCodes);
    return Object.freeze({...original,...metadata,status,complete:complete&&bounded,eligible:complete&&bounded&&values.length>0,
        resolverCalls:original.resolverCalls+sets.length,businessApiCalls:original.businessApiCalls+sets.reduce((n,s)=>n+s.businessApiCalls,0),
        nestedResolverCalls:sets.length,nestedLookupStatuses:Object.freeze(sets.map(s=>s.status)),
        candidates:Object.freeze(values),candidateCount:values.length,candidateTypeCount:new Set(values.map(c=>c.entityType)).size,deduplications,
        reasonCodes:Object.freeze(status==='ERROR'?['NESTED_LOOKUP_INCOMPLETE',...errorCodes]:[status==='NOT_FOUND'?'ENTITY_LOOKUP_NOT_FOUND':'CANDIDATE_UNION_COMPLETE'])});
}
module.exports={NESTED_SPAN_REFINEMENT_VERSION,NESTED_SPAN_STRATEGY,NESTED_K_PER_PARENT,MAX_ENTITY_LOOKUPS_PER_PATH,shouldRefine,selectNestedSpans,createLookupBudget,acquireRefinedCandidateUnion};
