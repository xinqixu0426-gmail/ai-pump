'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ordinalDetailControl}=require('../api/services/ai-v5/collectionControlPreRouter.cjs');
const {createContinuationStore,TTL_MS}=require('../api/services/ai-v5/collectionContinuation.cjs');
const {verifiedState}=require('./helpers/collectionVerifiedState.cjs');
const A={version:1,contextKey:'a'.repeat(64),conversationId:'chat-11'},B={version:1,contextKey:'b'.repeat(64),conversationId:'chat-12'};
test('ordinal control requires certified current page, exact grammar, existing bounded row and namespace',()=>{
 const db=require('./helpers/collectionFixture.cjs').collectionFixture();let now=100;
 const store=createContinuationStore({now:()=>now}),q={resourceType:'orders',operation:'list',pageSize:2};
 try{
  assert.equal(ordinalDetailControl('看看第1个',A,store),null);
  const {result}=verifiedState(db,store,A,q);
  for(const text of ['看看第1个','看第2个','第1个的详情','第2条详情','请查看第1个。'])assert.equal(ordinalDetailControl(text,A,store).modelCalls,0);
  for(const text of ['第0个','第3个详情','第51个','第99999999个','第01个','第-1个','删除第1个','把第2个改掉','第3个价格改成10元','看看第1个并删除','看看第1个客户'])assert.equal(ordinalDetailControl(text,A,store),null);
  for(const ctx of [B,{...A,contextKey:'c'.repeat(64)},{...A,conversationId:'chat-13'},null])assert.equal(ordinalDetailControl('看看第1个',ctx,store),null);
  now+=TTL_MS;assert.equal(ordinalDetailControl('看看第1个',A,store),null);
  store.set(A,q,result.collection);assert.equal(ordinalDetailControl('看看第1个',A,store),null);
 }finally{db.close();}
});
test('actual authenticated Candidate ordinal entry skips risk/semantic models and binds each page independently',async()=>{
 const db=require('./helpers/collectionFixture.cjs').collectionFixture(),store=createContinuationStore();
 const {withConversationContext}=require('../api/services/conversationContext.cjs');
 const {runCandidateRead}=require('../api/services/ai-v5/candidateRead.cjs');
 const env={PUMP_V5_CANDIDATE_RUNTIME:'true',AI_V5_READ_CANARY_ENABLED:'true',AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED:'true'};
 let risks=0,models=0,tools=0,answers=0;const executed=[];
 const raw={goal:'fixture',mode:'command',domains:['order'],needsBusinessData:true,contextMode:'current_turn',answerShape:'list',entityScope:'collection',requiresClarification:false,ambiguities:[],confidence:'high'};
 const run=(text,ctx,authorized=true)=>withConversationContext(ctx,()=>runCandidateRead({sourceRequest:text,internalAuthorized:authorized,previewOptIn:true,collectionOnly:true,deliver:()=>{answers++;return true;}},{env,continuationStore:store,
  riskOptions:{request:async()=>{risks++;return raw;}},collectionModelRequest:()=>{models++;throw Error('UNREACHABLE');},
  collectionExecute:async(_,q)=>{tools++;executed.push(q);return {success:true,collection:require('../api/services/collectionReadService.cjs').createCollectionReadService({db}).read(q),executionEvidence:{verified:true,kind:'formal_api_query',calls:[{method:'POST',path:'/api/collections/read'}]}};}}));
 try{
  verifiedState(db,store,A,{resourceType:'orders',operation:'list',pageSize:2});
  verifiedState(db,store,B,{resourceType:'customers',operation:'list',pageSize:2});
  const expected=[store.peekCertified(A).rowIds[0],store.peekCertified(B).rowIds[1]];
  for(const [text,ctx]of [['看看第1个',A],['看第2个',B]]){const o=await run(text,ctx);assert.equal(o.delivered,true);assert.equal(o.ordinalControl,true);assert.equal(o.continuationControl,false);assert.equal(o.risk.invoked,false);assert.equal(o.semanticModelCalls,0);assert.equal(o.detailTargetBinding,'VERIFIED_CURRENT_PAGE');}
  assert.deepEqual(executed.map(q=>[q.resourceType,String(q.targetId)]),[['orders',expected[0]],['customers',expected[1]]]);
  assert.deepEqual([risks,models,tools,answers],[0,0,2,2]);
  for(const text of ['删除第1个','把第2个改掉','第3个价格改成10元','请删除一个订单'])assert.equal((await run(text,A)).delivered,false);
  assert.equal((await run('看看第1个',{...A,contextKey:'c'.repeat(64)})).delivered,false);
  assert.equal((await run('看看第1个',B,false)).delivered,false);
  assert.deepEqual([risks,models,tools,answers],[5,0,2,2]);
 }finally{db.close();}
});
