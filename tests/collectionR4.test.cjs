'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createContinuationStore,TTL_MS}=require('../api/services/ai-v5/collectionContinuation.cjs');
const {continuationControl}=require('../api/services/ai-v5/collectionControlPreRouter.cjs');
const {verifiedState}=require('./helpers/collectionVerifiedState.cjs');
const ctx={version:1,contextKey:'a'.repeat(64),conversationId:'chat-1'};
const query={resourceType:'orders',operation:'list',pageSize:20,status:'active'};
test('R4 control bypass requires private verified receipt, exact conversation, principal, TTL and pure grammar',()=>{
    const db=require('./helpers/collectionFixture.cjs').collectionFixture();let time=1000;
    const store=createContinuationStore({now:()=>time});
    try{
        assert.equal(continuationControl('继续',ctx,store),null);
        const {result,handle,scope}=verifiedState(db,store,ctx,query);
        for(const text of ['继续','请继续。','下一页','再看后20条','剩下的呢']){
            const i=continuationControl(text,ctx,store);assert.equal(i.operation,'continue');assert.equal(i.modelCalls,0);
        }
        for(const text of ['继续并删除第三个','继续，修改线圈','下一页客户','再看后50条','查看第3个'])assert.equal(continuationControl(text,ctx,store),null);
        for(const wrong of [{...ctx,conversationId:'chat-2'},{...ctx,contextKey:'b'.repeat(64)},{...ctx,conversationId:'invalid'},null])assert.equal(continuationControl('继续',wrong,store),null);
        const exposed=store.peek(ctx);exposed.query.status='已关闭';exposed.resourceType='customers';
        assert.equal(store.peekCertified(ctx).query.status,'active');assert.equal(store.peekCertified(ctx).resourceType,'orders');
        assert.throws(()=>store.read(ctx,'tampered',exposed.queryId));assert.throws(()=>store.read(ctx,exposed.token,'tampered'));
        assert.throws(()=>store.setVerified(ctx,{...query,status:'已关闭'},handle,scope));
        assert.throws(()=>store.setVerified(ctx,query,{...handle},scope));
        time+=TTL_MS;assert.equal(continuationControl('继续',ctx,store),null);
        store.set(ctx,query,result.collection);assert.equal(continuationControl('继续',ctx,store),null);
    }finally{db.close();}
});
test('R4 actual Candidate entry skips both models only for certified continuation; negative control uses risk',async()=>{
    const db=require('./helpers/collectionFixture.cjs').collectionFixture();let time=1000;
    const store=createContinuationStore({now:()=>time});
    const {withConversationContext}=require('../api/services/conversationContext.cjs');
    const {runCandidateRead}=require('../api/services/ai-v5/candidateRead.cjs');
    const env={PUMP_V5_CANDIDATE_RUNTIME:'true',AI_V5_READ_CANARY_ENABLED:'true',AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED:'true'};
    let risks=0,models=0,tools=0,answers=0;
    const raw={goal:'synthetic',mode:'command',domains:['order'],needsBusinessData:true,contextMode:'current_turn',answerShape:'list',entityScope:'collection',requiresClarification:false,ambiguities:[],confidence:'high'};
    async function run(text,context=ctx,authorized=true){return withConversationContext(context,()=>runCandidateRead({sourceRequest:text,internalAuthorized:authorized,previewOptIn:true,collectionOnly:true,deliver:()=>{answers++;return true;}},{env,continuationStore:store,
        riskOptions:{request:async()=>{risks++;return raw;}},collectionModelRequest:()=>{models++;throw Error('UNREACHABLE');},collectionExecute:async(name,q)=>{
            tools++;assert.equal(q.status,'active');assert.equal(q.afterId,25);
            const collection=require('../api/services/collectionReadService.cjs').createCollectionReadService({db}).read(q);
            return {success:true,collection,executionEvidence:{verified:true,kind:'formal_api_query',calls:[{method:'POST',path:'/api/collections/read'}]}};
        }}));}
    try{
        verifiedState(db,store,ctx,query);const o=await run('继续');
        assert.equal(o.delivered,true);assert.equal(o.continuationControl,true);assert.equal(o.risk.invoked,false);
        assert.equal(o.semanticModelCalls,0);assert.equal(o.filterReclassificationCalls,0);assert.deepEqual([risks,models,tools,answers],[0,0,1,1]);
        const negative=['删除订单','修改客户','更改零件','修改配方','修改线圈','继续并删除第三个'];
        for(const text of negative){verifiedState(db,store,ctx,query);assert.equal((await run(text)).delivered,false);}
        for(const context of [{...ctx,conversationId:'chat-2'},{...ctx,contextKey:'b'.repeat(64)}]){verifiedState(db,store,ctx,query);assert.equal((await run('继续',context)).delivered,false);}
        store.clear(ctx);assert.equal((await run('继续')).delivered,false);
        verifiedState(db,store,ctx,query);time+=TTL_MS;assert.equal((await run('继续')).delivered,false);
        verifiedState(db,store,ctx,query);assert.equal((await run('继续',ctx,false)).delivered,false);
        assert.deepEqual([risks,models,tools,answers],[10,0,1,1]);
    }finally{db.close();}
});
test('R4 generic customer-filter role remains strict for every resource detail',()=>{
    const {parseIntent}=require('../api/services/ai-v5/collectionIntent.cjs');
    const source='synthetic-target',span=require('../api/services/ai-v5/sourceSpanCatalog.cjs').createV5SourceSpanCatalog(source).spans.find(x=>x.text===source).spanRef;
    for(const resource of ['orders','customers','parts','recipes','coils']){
        const wire={version:1,routeRef:resource+'.detail',filterClass:'NONE',status:null,customerSpanRef:null,detailSpanRef:span,topN:null,confidence:'high'};
        assert.equal(parseIntent(JSON.stringify(wire),source).operation,'detail');
        assert.throws(()=>parseIntent(JSON.stringify({...wire,customerSpanRef:span}),source));
    }
});
