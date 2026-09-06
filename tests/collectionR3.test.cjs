'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeCandidateRisk}=require('../api/services/candidateRiskEnvelope.cjs');
const {selectCollectionIntent,parseIntent}=require('../api/services/ai-v5/collectionIntent.cjs');
const {contextCommand}=require('../api/services/ai-v5/collectionContextCommand.cjs');
const {CATALOG}=require('../api/services/ai-v5/collectionSemanticContract.cjs');
const read={goal:'synthetic',mode:'query',domains:['order'],needsBusinessData:true,contextMode:'current_turn',answerShape:'list',entityScope:'collection',requiresClarification:false,ambiguities:[],confidence:'high'};
test('R3 closed catalog, strict intent schema and business dependency distinct from mutation safety',()=>{
    assert.equal(CATALOG.length,15);assert.equal(new Set(CATALOG.map(c=>c.resourceType)).size,5);
    for(const needsBusinessData of [true,false])assert.equal(normalizeCandidateRisk({...read,needsBusinessData}).riskClass,'READ_SAFE');
    assert.equal(normalizeCandidateRisk({...read,mode:'command'}).riskClass,'WRITE_OR_MUTATION');
    assert.equal(normalizeCandidateRisk({...read,mode:'conversation',needsBusinessData:false}).riskClass,'UNAVAILABLE_OR_UNKNOWN');
    const wire={version:1,routeRef:'orders.list',filterClass:'NONE',status:null,customerSpanRef:null,detailSpanRef:null,topN:null,confidence:'high'};
    assert.equal(parseIntent(JSON.stringify(wire),'synthetic').operation,'list');
    for(const patch of [{routeRef:'other.list'},{routeRef:'orders.delete'},{topN:51},{topN:'10'},
        {filterClass:'SQL'},{filterClass:'NONE',status:'active'},{canonicalId:'1'},{confidence:'low'}])assert.throws(()=>parseIntent(JSON.stringify({...wire,...patch}),'synthetic'));
});
test('R3 bounded context control grammar never rebuilds filters or invokes semantic model',async()=>{
    const active={resourceType:'orders',query:{status:'active',pageSize:20}};let calls=0;
    for(const source of ['请继续。','下一页','再看后20条','剩下的呢','查看第12条的详情']){
        const i=await selectCollectionIntent(source,active,{modelRequest:()=>{calls++;throw Error('UNREACHABLE');}});
        assert.equal(i.resourceType,'orders');assert.equal(i.modelCalls,0);
    }assert.equal(calls,0);
    assert.equal(contextCommand('继续并删除订单',active),null);
    assert.equal(contextCommand('请修改第3个',active),null);
    assert.throws(()=>contextCommand('继续',null));assert.throws(()=>contextCommand('再看后50条',active));
});
test('R3 write and unknown risk stop before semantic router, Tools and answers in actual Candidate entry',async()=>{
    const {runCandidateRead}=require('../api/services/ai-v5/candidateRead.cjs');
    const {withConversationContext}=require('../api/services/conversationContext.cjs');
    const env={PUMP_V5_CANDIDATE_RUNTIME:'true',AI_V5_READ_CANARY_ENABLED:'true',AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED:'true'};
    let routed=0,tools=0,answers=0;
    for(const source of ['删除订单','修改客户','更改零件','修改配方','修改线圈','查询并删除订单']){
        const o=await withConversationContext({version:1,contextKey:'a'.repeat(64),conversationId:'chat-r3'},()=>runCandidateRead({sourceRequest:source,internalAuthorized:true,previewOptIn:true,deliver:()=>{answers++;}},
            {env,riskOptions:{request:async()=>({...read,mode:'command'})},collectionModelRequest:()=>{routed++;},collectionExecute:()=>{tools++;}}));
        assert.equal(o.delivered,false);
    }assert.deepEqual([routed,tools,answers],[0,0,0]);
});
test('R3 ten overlapping semantic traces preserve task ownership and redact prompt/content',async()=>{
    const obs=require('../api/services/observability.cjs'),capture=require('./helpers/collectionTraceCapture.cjs')();
    obs.initializeObservability({env:{AI_OBSERVABILITY_ENABLED:'true'},phoenixModule:capture.phoenixModule});
    try{await Promise.all(Array.from({length:10},(_,i)=>obs.withAgentSpan({requestId:'synthetic-'+i},()=>selectCollectionIntent('synthetic-private-'+i,null,{
        observeModelCall:(m,f)=>obs.withModelSpan(m,f),modelRequest:async()=>({content:JSON.stringify({version:1,routeRef:'orders.count',filterClass:'NONE',status:null,customerSpanRef:null,detailSpanRef:null,topN:null,confidence:'high'})})}))));
        assert.equal(capture.spans.filter(s=>!s.parentId).length,10);
        assert.equal(capture.spans.filter(s=>s.parentId).length,10);
        for(const s of capture.spans.filter(s=>s.parentId)){assert.equal(s.parentId,s.rootId);assert.ok(s.ended);}
        assert.ok(!JSON.stringify(capture.spans).includes('synthetic-private'));
    }finally{await obs.resetObservabilityForTesting();}
});
