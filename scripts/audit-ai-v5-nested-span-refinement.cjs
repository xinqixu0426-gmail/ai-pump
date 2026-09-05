'use strict';
// Offline simulation. No model/API/resolver invocation, no artifact writes.
// Recover only frozen source fixtures through the established readonly harness.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname,'..');
const read = name => JSON.parse(fs.readFileSync(path.join(root,'docs/ai-governance/data',name+'.json'),'utf8'));
const {freezeHashes,dbSnapshot} = require('./run-ai-v5e4r-top2-evaluation.cjs');
const {createV5InterpreterInputEnvelope} = require('../api/services/ai-v5/taskInterpreterInput.cjs');
const {createV5SourceSpanCatalog} = require('../api/services/ai-v5/sourceSpanCatalog.cjs');
const inside = (s,p) => s.start>=p.start && s.end<=p.end && (s.start!==p.start||s.end!==p.end);
const same = (a,b) => a.start===b.start&&a.end===b.end;
const percentile = (xs,p) => [...xs].sort((a,b)=>a-b)[Math.ceil(p*xs.length)-1];
const cost = xs => {
    const sorted=[...xs].sort((a,b)=>a-b), middle=Math.floor(xs.length/2);
    return {median:xs.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2,p95:percentile(xs,0.95),max:Math.max(...xs)};
};
function permitted(statuses,complete,count) {
    return complete===true && count===0 && statuses.length===2 && statuses.every(s=>s==='NOT_FOUND');
}
function lexical(source) {
    const ids=[...source.matchAll(/(?:^|(?<=[^A-Za-z0-9_+.\/-]))[-_+.\/]*[A-Za-z0-9][A-Za-z0-9_+.\/-]*/g)].map(m=>({start:m.index,end:m.index+m[0].length}));
    const quotes=[...source.matchAll(/(["'“”‘’【】\[\]()（）])([^\r\n]{1,160}?)(["'“”‘’【】\[\]()（）])/gu)].map(m=>({start:m.index+m[1].length,end:m.index+m[1].length+m[2].length}));
    const words=[...new Intl.Segmenter('zh-CN',{granularity:'word'}).segment(source)].filter(s=>s.isWordLike).map(s=>({start:s.index,end:s.index+s.segment.length}));
    // Pure word spans use WORD; remaining catalog combinations use COMBINED.
    return s => ids.some(r=>same(r,s))?0:quotes.some(r=>same(r,s))?1:words.some(r=>same(r,s))?3:2;
}
function rankings(source,spans,parent,alreadySelected) {
    const nested=spans.filter(s=>inside(s,parent));
    const eligible=nested.filter(s=>!alreadySelected.includes(s.spanRef)&&[...s.text].length<=160);
    const type=lexical(source), length=s=>[...s.text].length;
    const depth=s=>nested.filter(p=>inside(s,p)).length;
    const margin=s=>Math.min(s.start,source.length-s.end);
    const offset=(a,b)=>a.start-b.start||a.end-b.end;
    const comparators={
        A:(a,b)=>depth(a)-depth(b)||length(b)-length(a)||offset(a,b),
        B:(a,b)=>type(a)-type(b)||length(b)-length(a)||offset(a,b),
        C:(a,b)=>length(a)-length(b)||margin(b)-margin(a)||offset(a,b),
        D:(a,b)=>type(a)-type(b)||depth(b)-depth(a)||length(b)-length(a)||offset(a,b),
    };
    return {nestedCount:nested.length,eligibleCount:eligible.length,lists:Object.fromEntries(Object.entries(comparators).map(([k,cmp])=>[k,[...eligible].sort(cmp)]))};
}
function audit() {
    const baseline=read('v5-e4r-top2-source-span-evaluation');
    const expected=read('v5-e4r-stage1-source-span-failure-audit');
    const prior=read('v5-e4r-model-free-span-discovery-audit');
    const before=dbSnapshot(), hashes=freezeHashes();
    assert.deepEqual(hashes,baseline.preEvalHashes); assert.deepEqual(hashes,baseline.postEvalHashes);
    const text=fs.readFileSync(path.join(__dirname,'run-ai-v5e4r-top2-evaluation.cjs'),'utf8');
    const definitions=vm.runInNewContext(`(${text.match(/const definitions=(\{[\s\S]*?\n    \});/)[1]})`,{},{timeout:100});
    const db=new (require('better-sqlite3'))(path.join(root,'pump.db'),{readonly:true,fileMustExist:true});
    const paths=[], simulations=[],sentinels=[];
    try {
        for(const [group,def] of Object.entries(definitions)) {
            const rows=baseline.paths.filter(p=>p.source_group_id===group), matches=new Set();
            for(const row of db.prepare(def.query).iterate()) {
                const source=`${row.identity}${def.suffix}`;
                if(createV5InterpreterInputEnvelope({rawUserRequest:source,pageContext:null}).inputFingerprint===rows[0].inputFingerprint)matches.add(row.identity);
            }
            assert.equal(matches.size,1,'FROZEN_SOURCE_UNAVAILABLE');
            const mention=[...matches][0],source=`${mention}${def.suffix}`; sentinels.push(mention,source);
            const catalog=createV5SourceSpanCatalog(source); assert.equal(catalog.status,'READY');
            assert.deepEqual(catalog,createV5SourceSpanCatalog(source));
            const target=catalog.spans.find(s=>s.text===mention); assert.ok(target);
            assert.equal(target.spanRef,expected.groups.find(g=>g.source_group_id===group).expectedSpanRef);
            for(const record of rows) {
                const trigger=permitted(record.lookupStatuses,record.candidateUnionComplete,record.candidateUnionCount);
                const parents=record.spanRefs.map(ref=>catalog.spans.find(s=>s.spanRef===ref));
                assert.ok(parents.every(Boolean));
                assert.equal(crypto.createHash('sha256').update(JSON.stringify([record.stage1Status,record.spanRefs])).digest('hex'),record.stage1Signature);
                const details=parents.map((parent,i)=>{
                    const ranks=rankings(source,catalog.spans,parent,record.spanRefs);
                    return {parentSpanRef:parent.spanRef,lookupStatus:record.lookupStatuses[i],nestedSpanCount:ranks.nestedCount,eligibleNestedCount:ranks.eligibleCount,expectedNested:inside(target,parent),expectedRanks:Object.fromEntries(Object.entries(ranks.lists).map(([s,l])=>[s,l.findIndex(x=>same(x,target))+1])),ranks};
                });
                paths.push({case_id:record.case_id,source_group_id:group,currentSuccess:record.finalEntityCorrect,parentSpanCount:2,perParentNotFoundTrigger:record.lookupStatuses.includes('NOT_FOUND'),refinementTrigger:trigger,successPathAffected:record.finalEntityCorrect&&trigger,parents:details.map(({ranks,...safe})=>safe)});
                for(const strategy of ['A','B','C','D']) for(const k of [1,2,3,4]) {
                    // Freeze both parent prefixes before any hypothetical reads; dedupe; never refill.
                    const refs=[...new Set(details.flatMap(d=>d.lookupStatus==='NOT_FOUND'?d.ranks.lists[strategy].slice(0,k).map(s=>s.spanRef):[]))];
                    const chosen=trigger?refs:[];
                    const evidence=prior.cases.find(p=>p.case_id===record.case_id).spanEvidence;
                    simulations.push({case_id:record.case_id,source_group_id:group,parentSpanCount:trigger?2:0,nestedSpanCount:trigger?new Set(details.flatMap(d=>d.ranks.lists[strategy].map(s=>s.spanRef))).size:0,expectedNested:trigger?details.every(d=>d.expectedNested):null,structuralStrategy:strategy,nestedK:k,expectedRecall:trigger?chosen.includes(target.spanRef):null,refinementTrigger:trigger,successPathAffected:record.finalEntityCorrect&&trigger,estimatedAdditionalLookupCount:chosen.length,unknownLookupEvidenceCount:chosen.filter(ref=>!evidence.some(e=>e.spanRef===ref&&e.status!=='UNKNOWN')).length,safeReasonCodes:trigger?['ALL_ORIGINAL_LOOKUPS_COMPLETE_NOT_FOUND','FIXED_PREFIX_PER_PARENT','DEDUPE_BEFORE_LOOKUP','SIMULATION_ONLY']:['EXISTING_AUTHORITY_PRESERVED','NO_REFINEMENT']});
                }
            }
        }
    } finally {db.close();}
    assert.equal(paths.length,15);
    assert.equal(paths.filter(p=>p.currentSuccess).length,12);
    assert.equal(paths.filter(p=>p.successPathAffected).length,0);
    // Trigger table is deliberately stronger than per-parent NOT_FOUND.
    for(const bad of ['RESOLVED','AMBIGUOUS','ERROR','INCOMPLETE','TIMEOUT','UNSUPPORTED']) {
        assert.equal(permitted(['NOT_FOUND',bad],true,0),false);
        assert.equal(permitted([bad,'NOT_FOUND'],true,0),false);
    }
    assert.equal(permitted(['NOT_FOUND','NOT_FOUND'],false,0),false);
    assert.equal(permitted(['NOT_FOUND','NOT_FOUND'],true,1),false);
    assert.equal(permitted(['NOT_FOUND','NOT_FOUND'],true,0),true);
    // Synthetic metamorphic checks: lexical ranking has no fixture-name input.
    for(const source of ['z91-alpha- next words','m42-bravo- next words']) {
        const spans=createV5SourceSpanCatalog(source).spans;
        const parent=spans.find(s=>s.start===0&&s.end===source.length);
        const ranked=rankings(source,spans,parent,[parent.spanRef]);
        for(const list of Object.values(ranked.lists)) for(const span of list) {
            assert.ok(inside(span,parent)); assert.equal(source.slice(span.start,span.end),span.text);
        }
        assert.ok(ranked.lists.B[0].text.endsWith('-'));
        assert.deepEqual(ranked,rankings(source,spans,parent,[parent.spanRef]));
    }
    const summary=Object.fromEntries(['A','B','C','D'].map(s=>[s,Object.fromEntries([1,2,3,4].map(k=>{
        const rows=simulations.filter(r=>r.structuralStrategy===s&&r.nestedK===k);
        return [k,{exactRecall:rows.filter(r=>r.expectedRecall===true).length,exactFailures:3,additionalLookups:cost(rows.map(r=>r.estimatedAdditionalLookupCount)),additionalTypedAttempts:cost(rows.map(r=>r.estimatedAdditionalLookupCount*6)),unknownLookupEvidenceCount:rows.reduce((n,r)=>n+r.unknownLookupEvidenceCount,0)}];
    }))]));
    const after=dbSnapshot(); assert.deepEqual(after,before); assert.deepEqual(freezeHashes(),hashes);
    const result={version:1,audit:'P15R-E-B2-F-A',simulationOnly:true,paths,simulations,summary,triggerAudit:{literalPerParentSuccessfulPathsTriggered:paths.filter(p=>p.currentSuccess&&p.perParentNotFoundTrigger).length,guardedSuccessfulPathsTriggered:0,guardedFailurePathsTriggered:paths.filter(p=>p.refinementTrigger).length},nestedCountsTriggeredParents:cost(paths.filter(p=>p.refinementTrigger).flatMap(p=>p.parents.map(d=>d.nestedSpanCount))),safety:{before,after,frozenHashesMatch:true,modelCalls:0,businessApiCalls:0,toolCalls:0,writes:0,privacySentinelPass:true}};
    const serialized=JSON.stringify(result);
    for(const secret of sentinels)assert.ok(!serialized.includes(secret),'PRIVATE_SOURCE_IN_DATASET');
    const report=path.join(root,'docs/ai-governance/reports/V5-E4R-E-B2-F-A-nested-span-refinement-audit.md');
    if(fs.existsSync(report))for(const secret of sentinels)assert.ok(!fs.readFileSync(report,'utf8').includes(secret),'PRIVATE_SOURCE_IN_REPORT');
    return result;
}
if(require.main===module)console.log(JSON.stringify(audit(),null,2));
module.exports={audit};
