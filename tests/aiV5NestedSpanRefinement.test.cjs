'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createV5SourceSpanCatalog}=require('../api/services/ai-v5/sourceSpanCatalog.cjs');
const {shouldRefine,selectNestedSpans,createLookupBudget,acquireRefinedCandidateUnion}=require('../api/services/ai-v5/nestedSpanRefinement.cjs');
const {finalizeEntity}=require('../api/services/ai-v5/entityFinalization.cjs');
const response=candidates=>({version:1,status:'OK',complete:true,attemptedEntityTypes:6,candidateCount:candidates.length,candidates});
const candidate=id=>({entityType:'part',canonicalId:id,matchKind:'EXACT'});
const source='z91-alpha-更多信息';
const catalog=createV5SourceSpanCatalog(source);
const parents=catalog.spans.filter(s=>s.start===0&&s.text!=='z91-alpha-').slice(0,2);
test('strict two complete empty NOT_FOUND gate and mixed hits',()=>{
    const input={resolverCalls:2,complete:true,candidateCount:0,candidates:[],lookupStatuses:['NOT_FOUND','NOT_FOUND'],lookupCompleteness:[true,true]};
    assert.equal(shouldRefine(input),true);
    for(const s of ['RESOLVED','AMBIGUOUS','ERROR','TIMEOUT','INCOMPLETE']) for(const i of [0,1]) {
        const statuses=[...input.lookupStatuses];statuses[i]=s;assert.equal(shouldRefine({...input,lookupStatuses:statuses}),false);
    }
    for(const bad of [{resolverCalls:1},{candidateCount:1},{candidates:[candidate('x')]},{complete:false},{lookupCompleteness:[true,false]}])assert.equal(shouldRefine({...input,...bad}),false);
});
test('audit Strategy B exact parity, generic ordering and no generated spans',()=>{
    const fs=require('node:fs'),vm=require('node:vm');
    const code=fs.readFileSync(require.resolve('../scripts/audit-ai-v5-nested-span-refinement.cjs'),'utf8');
    const pure=code.slice(code.indexOf('function lexical('),code.indexOf('function audit()'));
    const reference=vm.runInNewContext(`const same=(a,b)=>a.start===b.start&&a.end===b.end;const inside=(s,p)=>s.start>=p.start&&s.end<=p.end&&!same(s,p);${pure}; rankings`,{Intl});
    for(const text of [source,'q42-beta-更多信息','a/b更多信息','800更多信息','plain words extended','"generic" extra words']){
        const cat=createV5SourceSpanCatalog(text),p=cat.spans.slice(0,2);
        const expected=[...new Set(p.flatMap(parent=>reference(text,cat.spans,parent,p.map(s=>s.spanRef)).lists.B.slice(0,1).map(s=>s.spanRef)))];
        const actual=selectNestedSpans(text,cat,p);
        assert.deepEqual(actual.map(s=>s.spanRef),expected);assert.deepEqual(actual,selectNestedSpans(text,cat,p));
        assert.ok(actual.length<=2);assert.ok(actual.every(s=>cat.spans.includes(s)&&text.slice(s.start,s.end)===s.text));
    }
});
test('same nested ref deduped before reads; complete NOT_FOUND terminates without refill',async()=>{
    for(const hit of [true,false]){
        let calls=0;const set=await acquireRefinedCandidateUnion(parents,source,catalog,{lookupEntities:async()=>response(++calls>2&&hit?[candidate('private')]:[])});
        assert.equal(calls,3);assert.equal(set.nestedSelectedCount,1);assert.equal(set.nestedResolverCalls,1);
        assert.equal(set.status,hit?'RESOLVED':'NOT_FOUND');
        if(hit)assert.equal(finalizeEntity(set,{entityTypes:['part']}).candidate.canonicalId,'private');
    }
});
test('two distinct nested refs reach four reads; fifth budget reservation rejected',async()=>{
    const text='aa11-extra! cc22-other!';
    // Synthetic catalog with independently bounded parents and identifier children.
    const spans=[{spanRef:'p1',start:0,end:11,text:text.slice(0,11)},{spanRef:'p2',start:12,end:text.length,text:text.slice(12)}];
    const children=[{spanRef:'c1',start:0,end:10,text:text.slice(0,10)},{spanRef:'c2',start:12,end:text.length-1,text:text.slice(12,-1)}];
    let calls=0;const set=await acquireRefinedCandidateUnion(spans,text,{spans:[...spans,...children]},{lookupEntities:async()=>response(++calls>2?[candidate(String(calls))]:[])});
    assert.equal(calls,4);assert.equal(set.status,'AMBIGUOUS');assert.equal(finalizeEntity(set,{entityTypes:['part']}).status,'FINAL_ENTITY_AMBIGUOUS');
    const budget=createLookupBudget();for(let i=0;i<4;i++)budget.consume();assert.throws(()=>budget.consume(),/LOOKUP_BUDGET_EXCEEDED/);assert.equal(budget.count(),4);
});
for(const kind of ['ERROR','INCOMPLETE','TIMEOUT'])test(`nested ${kind} is fail closed`,async()=>{
    let calls=0;const keep=setInterval(()=>{},100);
    try{
        const set=await acquireRefinedCandidateUnion(parents,source,catalog,{lookupTimeoutMs:5,lookupEntities:async()=>{
            if(++calls<=2)return response([]);
            if(kind==='ERROR')throw Error('PRIVATE_ERROR');
            if(kind==='TIMEOUT')return new Promise(()=>{});
            return {...response([candidate('hidden')]),status:'INCOMPLETE',complete:false};
        }});
        assert.equal(set.status,'ERROR');assert.equal(set.complete,false);assert.deepEqual(set.candidates,[]);assert.ok(!JSON.stringify(set).includes('PRIVATE_ERROR'));
    }finally{clearInterval(keep);}
});
test('authoritative mixed hit and ambiguity never refine',async()=>{
    for(const values of [[candidate('one')],[candidate('one'),{entityType:'template',canonicalId:'two',matchKind:'EXACT'}]]){
        let calls=0;const set=await acquireRefinedCandidateUnion(parents,source,catalog,{lookupEntities:async()=>response(++calls===1?values:[])});
        assert.equal(calls,2);assert.equal(set.refinementTriggered,false);assert.equal(set.candidateCount,values.length);
    }
});
test('ten concurrent nested unions, source witnesses and finalization remain isolated',async()=>{
    const results=await Promise.all(Array.from({length:10},async(_,i)=>{
        const text=`syn${i}-alpha-更多信息`,cat=createV5SourceSpanCatalog(text),p=cat.spans.filter(s=>s.start===0&&s.text!==`syn${i}-alpha-`).slice(0,2);
        let calls=0;const set=await acquireRefinedCandidateUnion(p,text,cat,{lookupEntities:async(_,input)=>{
            await new Promise(r=>setTimeout(r,i%3));
            if(++calls<=2)return response([]);
            assert.equal(input.mention,`syn${i}-alpha-`);return response([candidate(`private-${i}`)]);
        }});
        assert.equal(finalizeEntity(set,{entityTypes:['part']}).candidate.canonicalId,`private-${i}`);assert.equal(calls,3);return set;
    }));
    assert.equal(results.length,10);
});
test('ten full interpreter requests preserve nested witnesses, shadow tasks and model budget',async()=>{
    const {interpretCandidateSetTask}=require('../api/services/ai-v5/candidateSetTwoStageInterpreter.cjs');
    const {createV5InterpreterInputEnvelope}=require('../api/services/ai-v5/taskInterpreterInput.cjs');
    await Promise.all(Array.from({length:10},async(_,i)=>{
        const text=`req${i}-alpha-更多信息`,cat=createV5SourceSpanCatalog(text),p=cat.spans.filter(s=>s.start===0&&s.text!==`req${i}-alpha-`).slice(0,2);
        let reads=0,models=0;const task=`nested-task-${i}`;
        const result=await interpretCandidateSetTask(createV5InterpreterInputEnvelope({rawUserRequest:text,pageContext:null}),{
            shadowTaskId:task,observeModelCall:async(meta,fn)=>{assert.equal(meta.shadowTaskId,task);return fn();},
            modelRequest:async()=>({content:JSON.stringify(++models===1?{version:2,spanRefs:p.map(s=>s.spanRef),needsClarification:false}:{version:1,localTaskClassRef:'tc_024'})}),
            lookupEntities:async(_,input)=>{if(++reads<=2)return response([]);assert.equal(input.mention,`req${i}-alpha-`);return response([{entityType:'recipe',canonicalId:`private-${i}`,matchKind:'EXACT'}]);}
        });
        assert.equal(result.status,'VALID');assert.equal(result.resolvedIdentity.canonicalId,`private-${i}`);
        assert.equal(result.interpretation.entityCandidates[0].candidateText,`req${i}-alpha-`);
        assert.equal(models,2);assert.equal(reads,3);assert.equal(result.architectureMetadata.refinementTriggered,true);
    }));
});
