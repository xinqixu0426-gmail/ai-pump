'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {collectionFixture}=require('./helpers/collectionFixture.cjs');
const {runCandidateRead}=require('../api/services/ai-v5/candidateRead.cjs');
const {withConversationContext}=require('../api/services/conversationContext.cjs');
const {createContinuationStore}=require('../api/services/ai-v5/collectionContinuation.cjs');
const read={goal:'读取',mode:'query',domains:['order'],needsBusinessData:true,contextMode:'current_turn',answerShape:'list',entityScope:'collection',requiresClarification:false,ambiguities:[],confidence:'high'};
const env={PUMP_V5_CANDIDATE_RUNTIME:'true',AI_V5_READ_CANARY_ENABLED:'true',AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED:'true'};
const plan=(p={})=>({version:1,operation:'list',resourceType:'orders',pageSize:null,status:null,customerSpan:null,identitySpan:null,ordinal:null,...p});
test('real Executor/internal client/fixture API: list -> continuation -> ordinal, count, 10 isolated conversations, no writes',async()=>{
    const db=collectionFixture(),app=require('express')();app.use(require('express').json());
    let calls=0;app.use((_req,_res,next)=>{calls++;next();});app.use('/api/collections',require('../api/routes/collectionRead.cjs').createCollectionReadRouter({db}));
    const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
    const port=process.env.PORT,oldCandidate=process.env.PUMP_V5_CANDIDATE_RUNTIME;
    process.env.PORT=String(server.address().port);process.env.PUMP_V5_CANDIDATE_RUNTIME='true';
    const continuationStore=createContinuationStore();
    let interpreted=0;
    async function run(p,chat=1,risk=read){
        let text='';const context={version:1,contextKey:'a'.repeat(64),conversationId:'chat-'+chat};
        const source=p.operation==='continue'?'继续':p.operation==='ordinal'?'看看第'+p.ordinal+'个':'fixture';
        const o=await withConversationContext(context,()=>runCandidateRead({sourceRequest:source,internalAuthorized:true,previewOptIn:true,deliver:t=>{text=t;return true;}},
            {env,continuationStore,riskOptions:{request:async()=>risk},collectionModelRequest:async messages=>{
                assert.ok(!JSON.stringify(messages).includes('chat-'+chat));assert.ok(!JSON.stringify(messages).includes(context.contextKey));
                return {content:JSON.stringify(require('./helpers/collectionSemanticWire.cjs')(p))};},interpret:async()=>{interpreted++;return {status:'INVALID'};}}));
        return {o,text};
    }
    try{
        assert.equal((await run(plan())).o.delivered,true);
        assert.equal((await run(plan({operation:'continue'}),1,{...read,contextMode:'previous_turn'})).o.delivered,true);
        const detail=await run(plan({operation:'ordinal',ordinal:3}));assert.equal(detail.o.delivered,true);assert.ok(detail.text.includes('ORD-41'));
        assert.equal((await run(plan({operation:'count'}))).o.delivered,true);
        const all=await Promise.all(Array.from({length:10},(_,i)=>run(plan({resourceType:i%2?'customers':'orders'}),10+i)));
        assert.ok(all.every(x=>x.o.delivered));assert.equal(calls,14);
        assert.equal((await run(plan(),40,{...read,mode:'command'})).o.delivered,false);assert.equal(calls,14);
        await run(plan({operation:'NONE'}),50);assert.equal(interpreted,1);assert.equal(calls,14);
        assert.equal(require('../api/services/managementActionLifecycle.cjs').shouldRecheckManagementActions({method:'POST',path:'/api/collections/read',statusCode:200}),false);
    }finally{if(port===undefined)delete process.env.PORT;else process.env.PORT=port;
        if(oldCandidate===undefined)delete process.env.PUMP_V5_CANDIDATE_RUNTIME;else process.env.PUMP_V5_CANDIDATE_RUNTIME=oldCandidate;
        await new Promise(r=>server.close(r));db.close();}
});
