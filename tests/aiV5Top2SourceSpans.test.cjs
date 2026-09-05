'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseSpanSelection}=require('../api/services/ai-v5/sourceSpanSelectionContract.cjs');
const {createV5SourceSpanCatalog}=require('../api/services/ai-v5/sourceSpanCatalog.cjs');
const {acquireCandidateUnion}=require('../api/services/ai-v5/candidateUnion.cjs');
const {finalizeEntity}=require('../api/services/ai-v5/entityFinalization.cjs');
const catalog=createV5SourceSpanCatalog('alpha beta gamma');
const refs=catalog.spans.slice(0,3).map(s=>s.spanRef);
const parse=(spanRefs,extra={})=>parseSpanSelection(JSON.stringify({version:2,spanRefs,needsClarification:false,...extra}),catalog);
test('Top-2 strict, distinct, current-request refs; order retained',()=>{
    assert.deepEqual(parse([refs[1],refs[0]]).spanRefs,[refs[1],refs[0]]);
    for(const pair of [[refs[0]],[...refs],[refs[0],refs[0]],[refs[0],'unknown']])assert.throws(()=>parse(pair));
    for(const field of ['candidateText','canonicalId','toolName','entityType','taskClassRef'])assert.throws(()=>parse(refs.slice(0,2),{[field]:'forbidden'}));
    assert.throws(()=>parseSpanSelection('{',catalog));
    assert.deepEqual(parse([],{needsClarification:true}).spanRefs,[]);
});
const c=(entityType,id)=>({entityType,canonicalId:id,matchKind:'EXACT'});
const spans=[{spanRef:'sp_001',text:'synthetic-a'},{spanRef:'sp_002',text:'synthetic-b'}];
const response=candidates=>({version:1,status:'OK',complete:true,attemptedEntityTypes:6,candidateCount:candidates.length,candidates});
for(const [name,left,right,status,count] of [
    ['zero + unique',[],[c('part','b')],'RESOLVED',1],
    ['zero + ambiguous',[],[c('part','b'),c('template','c')],'AMBIGUOUS',2],
    ['same identity',[c('part','a')],[c('part','a')],'RESOLVED',1],
    ['different identities',[c('part','a')],[c('part','b')],'AMBIGUOUS',2],
    ['ambiguous + unique',[c('part','a'),c('template','b')],[c('part','c')],'AMBIGUOUS',3],
    ['zero + zero',[],[],'NOT_FOUND',0],
])test(name,async()=>{
    let calls=0;const set=await acquireCandidateUnion(spans,{lookupEntities:async()=>response(calls++===0?left:right)});
    assert.equal(calls,2);assert.equal(set.status,status);assert.equal(set.candidateCount,count);assert.equal(set.complete,true);
    if(name==='same identity'){assert.equal(set.deduplications,1);assert.deepEqual(set.candidates[0].matchedSpanRefs,['sp_001','sp_002']);}
    if(name==='different identities')assert.equal(finalizeEntity(set,{entityTypes:['part']}).status,'FINAL_ENTITY_AMBIGUOUS');
});
for(const failure of ['ERROR','INCOMPLETE','TIMEOUT'])for(const position of [0,1])test(`${failure} at ${position} fails closed`,async()=>{
    let calls=0;const keep=setInterval(()=>{},100);
    try {const set=await acquireCandidateUnion(spans,{lookupTimeoutMs:5,lookupEntities:async()=>{
        if(calls++!==position)return response([c('part','safe')]);
        if(failure==='ERROR')throw Error('PRIVATE');
        if(failure==='TIMEOUT')return new Promise(()=>{});
        return {...response([c('part','x')]),status:'INCOMPLETE',complete:false};
    }});assert.equal(set.status,'ERROR');assert.equal(set.complete,false);assert.equal(set.candidates.length,0);assert.ok(calls<=2);
    }finally{clearInterval(keep);}
});
test('rank never overrides class or same-type ambiguity',async()=>{
    const sets=[];
    for(const list of [[c('template','a'),c('part','b')],[c('part','b'),c('template','a')]]){
        let i=0;sets.push(await acquireCandidateUnion(spans,{lookupEntities:async()=>response([list[i++]])}));
    }
    for(const set of sets)assert.equal(finalizeEntity(set,{entityTypes:['part']}).candidate.canonicalId,'b');
});
