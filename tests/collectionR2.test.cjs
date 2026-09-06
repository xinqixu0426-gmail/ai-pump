'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeCandidateRisk}=require('../api/services/candidateRiskEnvelope.cjs');
const {assertCollectionAdmission}=require('../api/services/ai-v5/collectionAdmission.cjs');
const {bindCollectionDetail}=require('../api/services/ai-v5/collectionDetailTarget.cjs');
const {createV5SourceSpanCatalog}=require('../api/services/ai-v5/sourceSpanCatalog.cjs');
const read={goal:'fixture read',mode:'query',domains:['order'],needsBusinessData:true,contextMode:'current_turn',answerShape:'list',entityScope:'collection',requiresClarification:false,ambiguities:[],confidence:'high'};
test('contextual dependency repair is limited to verified continuation; write, mixed, low confidence remain rejected',()=>{
    const raw={...read,contextMode:'previous_turn',needsBusinessData:false};
    assert.equal(normalizeCandidateRisk(raw).eligible,false);
    const r=normalizeCandidateRisk(raw,{resourceType:'orders'});assert.equal(r.eligible,true);
    assertCollectionAdmission(r,{contractValid:true,operation:'continue',resourceType:'orders'});
    for(const operation of ['NONE','write'])assert.throws(()=>assertCollectionAdmission(r,{contractValid:true,operation,resourceType:'orders'}));
    for(const patch of [{mode:'command'},{confidence:'low'},{requiresClarification:true,ambiguities:['mixed']}]){
        const rejected=normalizeCandidateRisk({...raw,...patch},{resourceType:'orders'});
        assert.equal(rejected.eligible,false);assert.throws(()=>assertCollectionAdmission(rejected,{operation:'continue',resourceType:'orders'}));
    }
    assert.equal(normalizeCandidateRisk({...read,needsBusinessData:false}).eligible,false);
});
test('governed detail rejects incomplete, zero, ambiguity, wrong family and error before execution',async()=>{
    const intent={operation:'detail',resourceType:'orders',identity:'synthetic'};
    for(const response of [
        {status:'OK',complete:true,candidates:[]},
        {status:'INCOMPLETE',complete:false,candidates:[{entityType:'order',canonicalId:'1',matchKind:'EXACT'}]},
        {status:'OK',complete:true,candidates:[{entityType:'order',canonicalId:'1',matchKind:'EXACT'},{entityType:'order',canonicalId:'2',matchKind:'EXACT'}]},
        {status:'OK',complete:true,candidates:[{entityType:'part',canonicalId:'1',matchKind:'EXACT'}]}
    ])await assert.rejects(bindCollectionDetail(intent,{lookupEntities:async()=>({version:1,attemptedEntityTypes:6,candidateCount:response.candidates.length,...response})}));
    await assert.rejects(bindCollectionDetail(intent,{lookupEntities:async()=>{throw Error('fixture');}}));
});
test('five direct details use source refs, real governed HTTP lookup, canonical Tool, same verified target; frozen filter replay',async()=>{
    const db=require('./helpers/collectionFixture.cjs').collectionFixture(),app=require('express')();
    app.use(require('express').json());app.use('/api/entity-lookup',require('../api/routes/entityLookup.cjs').createEntityLookupRouter({db}));
    app.use('/api/collections',require('../api/routes/collectionRead.cjs').createCollectionReadRouter({db}));
    const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
    const old={PORT:process.env.PORT,PUMP_V5_CANDIDATE_RUNTIME:process.env.PUMP_V5_CANDIDATE_RUNTIME};
    process.env.PORT=String(server.address().port);process.env.PUMP_V5_CANDIDATE_RUNTIME='true';
    const store=require('../api/services/ai-v5/collectionContinuation.cjs').createContinuationStore();
    const {withConversationContext}=require('../api/services/conversationContext.cjs');
    const {runCandidateRead}=require('../api/services/ai-v5/candidateRead.cjs');
    const execute=require('../api/routes/ai/executor.cjs').executeToolCall;
    const env={PUMP_V5_CANDIDATE_RUNTIME:'true',AI_V5_READ_CANARY_ENABLED:'true',AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED:'true'};
    const ctx={version:1,contextKey:'a'.repeat(64),conversationId:'chat-1'};
    let calls=0,lastArgs,ids=[];
    const plan=p=>({version:1,operation:'list',resourceType:'orders',pageSize:null,status:null,customerSpan:null,identitySpan:null,ordinal:null,...p});
    async function run(source,p,risk=read){return withConversationContext(ctx,()=>runCandidateRead({sourceRequest:source,previewOptIn:true,internalAuthorized:true,collectionOnly:true,deliver:()=>true},
        {env,continuationStore:store,riskOptions:{request:async()=>risk},collectionModelRequest:async messages=>{
            const m=JSON.parse(messages[1].content);assert.equal(Object.hasOwn(m,'filters'),false);assert.equal(Object.hasOwn(m,'queryId'),false);
            return {content:JSON.stringify(require('./helpers/collectionSemanticWire.cjs')(p))};},collectionExecute:async(n,a,o)=>{calls++;lastArgs=a;const r=await execute(n,a,o);ids=r.collection?.items.map(x=>x.canonicalId)||[];return r;}}));}
    try{
        const cases=require('../scripts/certify-v5-collections.cjs').cases().filter(c=>['L-08','L-14','L-19','L-24','L-29'].includes(c.id));
        for(const c of cases){const identity=({orders:'ORD-63',customers:'客户-63',parts:'零件-63',recipes:'配方-63',coils:'线圈-63'})[c.resource];
            const ref=createV5SourceSpanCatalog(c.question).spans.find(s=>s.text===identity).spanRef;
            const o=await run(c.question,plan({resourceType:c.resource,operation:'detail',identitySpan:ref}));
            assert.equal(o.delivered,true);assert.equal(o.returnedCount,1);assert.equal(o.detailTargetBinding,'GOVERNED_LOOKUP');
            assert.equal(lastArgs.targetId,63);assert.equal(Object.hasOwn(lastArgs,'identity'),false);
        }
        assert.equal((await run('未完成的订单有哪些',plan({status:'active'}))).delivered,true);
        const first=[...ids],q=store.peek(ctx);assert.equal(first.length,20);
        const next=await run('继续',plan({operation:'continue'}),{...read,contextMode:'previous_turn',needsBusinessData:false});
        assert.equal(next.delivered,true);assert.equal(next.filterContractReused,true);assert.equal(next.filterReclassificationCalls,0);
        assert.equal(lastArgs.status,'active');assert.equal(store.peek(ctx).queryId,q.queryId);
        assert.deepEqual([...first,...ids],Array.from({length:32},(_,i)=>String(63-i*2)));
        const before=calls;for(const source of ['删除订单','修改客户','更改零件','列出并删除订单']){
            assert.equal((await run(source,plan(),{...read,mode:'command'})).delivered,false);
        }assert.equal(calls,before);
        await run('未完成的订单有哪些',plan({status:'active'}));
        const frozen=store.peek(ctx);frozen.query.status='已关闭';assert.equal(store.peek(ctx).query.status,'active');
        const beforeTamper=calls;assert.equal((await run('继续并替换过滤条件',plan({operation:'continue',status:'已关闭'}),{...read,contextMode:'previous_turn'})).delivered,false);
        assert.equal(calls,beforeTamper);
    }finally{for(const [k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}await new Promise(r=>server.close(r));db.close();}
});
