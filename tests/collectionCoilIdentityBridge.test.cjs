'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {bindCollectionDetailFromSource}=require('../api/services/ai-v5/collectionDetailTarget.cjs');
test('existing authoritative supply bridges exact name/code to same governed coil; partial, absent and ambiguous fail closed',async()=>{
 const db=require('./helpers/collectionFixture.cjs').collectionFixture();
 try{
  db.prepare('UPDATE coils SET scheme_name=?, scheme_code=? WHERE id=63').run('fixture-coil-closed','fixture-code-closed');
  const supply=require('../api/services/entitySpanCandidates.cjs').createEntitySpanCandidateService({db});
  const lookup=require('../api/services/entityLookupService.cjs').createEntityLookupService({db});
  let calls=0;
  const options={supplySpanCandidates:async sourceText=>supply.supply({version:1,sourceText,entityScope:'coil'}),lookupEntities:async(_f,q)=>{calls++;return lookup.lookupEntities(q);}};
  // A deliberately wrong generic model span cannot override authoritative source identity.
  const intent={operation:'detail',resourceType:'coils',identity:'wrong-fragment'};
  const name=await bindCollectionDetailFromSource(intent,'看看线圈 fixture-coil-closed 的详细信息',options);
  const code=await bindCollectionDetailFromSource(intent,'看看线圈 fixture-code-closed 的详细信息',options);
  assert.equal(name.canonicalEntityRef,'63');assert.equal(code.canonicalEntityRef,name.canonicalEntityRef);assert.equal(calls,2);
  for(const raw of ['看看线圈 不存在 的详细信息','看看线圈 线圈- 的详细信息'])await assert.rejects(bindCollectionDetailFromSource(intent,raw,options),/COLLECTION_TARGET_NOT_FOUND/);
  assert.equal(calls,2);
  await assert.rejects(bindCollectionDetailFromSource(intent,'看看线圈 fixture-coil-closed 和线圈-62 的详细信息',options),/AUTHORITATIVE_SPAN_AMBIGUOUS/);assert.equal(calls,2);
  const wire=(cs)=>({version:1,status:'OK',complete:true,attemptedEntityTypes:6,candidateCount:cs.length,candidates:cs});
  await assert.rejects(bindCollectionDetailFromSource(intent,'fixture-coil-closed',{...options,lookupEntities:async()=>wire([{entityType:'coil',canonicalId:'1',matchKind:'EXACT'},{entityType:'coil',canonicalId:'2',matchKind:'EXACT'}])}),/COLLECTION_TARGET_AMBIGUOUS/);
  await assert.rejects(bindCollectionDetailFromSource(intent,'fixture-coil-closed',{...options,lookupEntities:async()=>wire([{entityType:'part',canonicalId:'1',matchKind:'EXACT'}])}),/COLLECTION_TARGET_NOT_FOUND/);
  await assert.rejects(bindCollectionDetailFromSource(intent,'线圈-63',{...options,supplySpanCandidates:async()=>({version:1,status:'IDENTITY_SCAN_BUDGET_EXCEEDED',complete:false,candidateCount:0,candidates:[],identityScanCount:513})}),/SPAN_SUPPLY_INVALID/);
 }finally{db.close();}
});
test('non-coil direct details retain governed scoped binder without coil supply',async()=>{
 for(const [resourceType,entityType]of [['orders','order'],['customers','customer'],['parts','part'],['recipes','recipe']]){
  const t=await bindCollectionDetailFromSource({operation:'detail',resourceType,identity:'fixture'},'fixture',{supplySpanCandidates:async()=>{assert.fail('non-coil supply');},lookupEntities:async()=>({version:1,status:'OK',complete:true,attemptedEntityTypes:6,candidateCount:1,candidates:[{entityType,canonicalId:'1',matchKind:'EXACT'}]})});
  assert.equal(t.canonicalEntityRef,'1');
 }
});
