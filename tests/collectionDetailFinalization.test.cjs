'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {bindCollectionDetail,ENTITY_TYPES}=require('../api/services/ai-v5/collectionDetailTarget.cjs');
const candidate=(entityType,canonicalId)=>({entityType,canonicalId,matchKind:'EXACT'});
async function bind(resourceType,candidates,extra={}){
 return bindCollectionDetail({operation:'detail',resourceType,identity:'exact-fixture'},{lookupEntities:async()=>({
 version:1,status:'OK',complete:true,attemptedEntityTypes:6,candidateCount:candidates.length,candidates,...extra})});
}
test('same governed cross-domain ambiguity finalizes by frozen semantic type, independent of candidate order',async()=>{
 for(const reverse of [false,true]){
  const cs=[candidate('customer','7'),candidate('order','9')];if(reverse)cs.reverse();const before=JSON.stringify(cs);
  assert.equal((await bind('customers',cs)).canonicalEntityRef,'7');
  assert.equal((await bind('orders',cs)).canonicalEntityRef,'9');assert.equal(JSON.stringify(cs),before);
 }
});
test('same-type ambiguity, wrong-type-only and empty candidates fail closed with distinct outcomes',async()=>{
 await assert.rejects(bind('customers',[candidate('order','1'),candidate('customer','2'),candidate('customer','3')]),/COLLECTION_TARGET_AMBIGUOUS/);
 await assert.rejects(bind('customers',[candidate('order','1')]),/COLLECTION_TARGET_NOT_FOUND/);
 await assert.rejects(bind('customers',[]),/COLLECTION_TARGET_NOT_FOUND/);
 assert.equal((await bind('customers',[candidate('customer','2')])).canonicalEntityRef,'2');
});
test('same mechanism for all five resources, incomplete/malformed/fuzzy results never become targets',async()=>{
 for(const [resource,type]of Object.entries(ENTITY_TYPES)){
  assert.equal((await bind(resource,[candidate('template','80'),candidate(type,'21')])).canonicalEntityRef,'21');
  await assert.rejects(bind(resource,[candidate(type,'21')],{complete:false,status:'INCOMPLETE'}),/COLLECTION_TARGET_UNAVAILABLE/);
  await assert.rejects(bind(resource,[{...candidate(type,'21'),matchKind:'FUZZY'}]),/COLLECTION_TARGET_UNAVAILABLE/);
  await assert.rejects(bind(resource,[candidate(type,'21'),candidate(type,'21')]),/COLLECTION_TARGET_UNAVAILABLE/);
  await assert.rejects(bind(resource,[candidate(type,'wrong')]),/COLLECTION_TARGET_INVALID/);
 }
});
test('real governed Business source preserves customer/order ambiguity while both detail targets verify',async()=>{
 const db=require('./helpers/collectionFixture.cjs').collectionFixture();
 try{
  db.prepare('UPDATE orders SET customer_name=? WHERE id=63').run('客户-63');
  const lookup=require('../api/services/entityLookupService.cjs').createEntityLookupService({db});
  const service=require('../api/services/collectionReadService.cjs').createCollectionReadService({db});
  const options={lookupEntities:async(_f,q)=>{const r=lookup.lookupEntities(q);assert.equal(r.candidateCount,2);return r;}};
  for(const resourceType of ['customers','orders']){
   const target=await bindCollectionDetail({operation:'detail',resourceType,identity:'客户-63'},options);
   const request={resourceType,operation:'detail',targetId:Number(target.canonicalEntityRef)},page=service.read(request);
   const scope={taskId:'cross-domain-'+resourceType,contextKey:'fixture-context'};
   const h=require('../api/services/ai-v5/collectionEvidence.cjs').verifyCollectionExecution({...scope,request,result:{success:true,collection:page,
    executionEvidence:{verified:true,kind:'formal_api_query',calls:[{method:'POST',path:'/api/collections/read'}]}}});
   const answer=require('../api/services/ai-v5/collectionAnswer.cjs').composeCollectionAnswer(h,scope);
   assert.ok(answer.answerText.includes(resourceType==='customers'?'客户-63':'ORD-63'));
  }
 }finally{db.close();}
});
