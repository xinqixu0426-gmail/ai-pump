'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {collectionFixture}=require('./helpers/collectionFixture.cjs');
const {createPlan}=require('../api/services/ai-v5/investigationPlan.cjs');
const {executeInvestigation}=require('../api/services/ai-v5/investigationExecution.cjs');
const {getVerifiedRelation}=require('../api/services/ai-v5/investigationEvidence.cjs');
const {composeInvestigationAnswer}=require('../api/services/ai-v5/investigationAnswer.cjs');
function fixture(){
 const db=collectionFixture();db.prepare('UPDATE customers SET name=? WHERE id=1').run('客户甲');
 db.prepare('UPDATE recipes SET parts_json=?').run(JSON.stringify([{model:'零件-1'}]));
 const collections=require('../api/services/collectionReadService.cjs').createCollectionReadService({db});
 const relations=require('../api/services/relationReadService.cjs').createRelationReadService({db});
 const calls=[];
 const execute=async(tool,args)=>{calls.push({tool,args});const collection=tool==='read_collection',path=collection?'/api/collections/read':'/api/relations/read';
  return {success:true,[collection?'collection':'relation']:(collection?collections:relations).read(args),executionEvidence:{verified:true,kind:'formal_api_query',calls:[{method:'POST',path}]}};};
 return {db,execute,calls};
}
const scope={taskId:'fixture-investigation',contextKey:'a'.repeat(64)};

test('verified BOM answer discloses missing supplier references without substituting a canonical entity',async()=>{
 const f=fixture();try{
  f.db.prepare('UPDATE parts SET supplier=? WHERE id=1').run('B厂');
  f.db.prepare('UPDATE recipes SET parts_json=? WHERE id=1').run(JSON.stringify([{model:'零件-1',supplier:'A厂'},{model:'零件-2'}]));
  const result=await executeInvestigation(createPlan({version:1,relation:'recipe.parts',rootId:1}),{...scope,execute:f.execute});
  const p=getVerifiedRelation(result.handle,scope).page,answer=composeInvestigationAnswer(result.handle,scope).answerText;
  assert.deepEqual(p.items.map(i=>i.canonicalId),['2']);assert.equal(p.referenceResolution.missing[0].supplier,'A厂');
  assert.match(answer,/已核实1种零件/);assert.match(answer,/零件-1（供应商：A厂）：当前零件目录未找到对应记录/);
  assert.match(answer,/未自动替换/);assert.doesNotMatch(answer,/B厂|目录单价|库存：/);
  const store=require('../api/services/ai-v5/collectionContinuation.cjs').createContinuationStore();
  const context={version:1,contextKey:scope.contextKey,conversationId:'chat-871'};
  store.setVerifiedRelation(context,{version:1,relation:'recipe.parts',rootId:1},result.handle,scope);
  assert.deepEqual(store.peek(context).rowIds,['2']);
  f.db.prepare('UPDATE recipes SET parts_json=? WHERE id=1').run(JSON.stringify([{model:'零件-1',supplier:'A厂'}]));
  const allMissing=await executeInvestigation(createPlan({version:1,relation:'recipe.parts',rootId:1}),{...scope,execute:f.execute});
  const missingAnswer=composeInvestigationAnswer(allMissing.handle,scope).answerText;
  assert.match(missingAnswer,/已核实0种零件/);assert.match(missingAnswer,/另有1项原配方引用未找到/);
  assert.doesNotMatch(missingAnswer,/没有符合条件的记录|没有零件|B厂/);
 }finally{f.db.close();}
});
test('semantic choices bind filter and source fields; unsupported combinations and executable args cannot be emitted',()=>{
 const {semanticChoices,parseIntent}=require('../api/services/ai-v5/investigationIntent.cjs');
 const s='客户「客户-1」有哪些订单？',catalog=semanticChoices(s);
 const choice=catalog.choices.find(c=>c.relation==='customer.orders');
 const payload={version:6,choiceRef:choice.choiceRef,topN:null,confidence:'high'};
 assert.equal(parseIntent(JSON.stringify(payload),s,catalog).identity,'客户-1');
 assert.throws(()=>parseIntent(JSON.stringify({...payload,rootId:1}),s,catalog),/SEMANTIC_INVALID/);
 assert.throws(()=>parseIntent(JSON.stringify({...payload,topN:51}),s,catalog),/SEMANTIC_INVALID/);
 assert.throws(()=>parseIntent(JSON.stringify(payload),'客户「甲」和客户「乙」的订单'),/ROOT_AMBIGUOUS/);
 for(const c of catalog.choices.filter(c=>c.relation==='parts.stock'))assert.equal(c.rootType,null);
 assert.equal(semanticChoices('哪些零件的库存大于0但不超过5？').choices.length,29);
});
test('closed plans: all relation types execute within two reads and verified dependency scope',async()=>{
 const f=fixture();try{
  for(const relation of Object.keys(require('../api/services/relationReadContract.cjs').RELATIONS)){
   const query={version:1,relation,...(relation==='parts.stock'?{stockStatus:'attention'}:{rootId:1})};
   const plan=createPlan(query),r=await executeInvestigation(plan,{...scope,execute:f.execute});
   assert.ok(r.toolCalls<=2);assert.equal(r.toolCalls,plan.steps.length);
   assert.equal(getVerifiedRelation(r.handle,scope).page.relation,relation);
   assert.ok(composeInvestigationAnswer(r.handle,scope).answerText.length>0);
   assert.throws(()=>getVerifiedRelation(r.handle,{...scope,taskId:'another'}),/UNAVAILABLE/);
   assert.throws(()=>getVerifiedRelation(r.handle,{...scope,contextKey:'b'.repeat(64)}),/UNAVAILABLE/);
  }
 }finally{f.db.close();}
});
test('plan tampering rejects before any execution; no arbitrary tools, cycles or argument extensions',async()=>{
 const f=fixture();try{
  const base=createPlan({version:1,relation:'customer.orders',rootId:1});
  for(const change of [p=>p.steps[1].tool='delete_order',p=>p.steps[0].dependsOn=['relation'],p=>p.steps.push(...p.steps,...p.steps),p=>p.query.sql='SELECT * FROM parts']){
   const p=structuredClone(base);change(p);await assert.rejects(()=>executeInvestigation(p,{...scope,execute:f.execute}),/PLAN_INVALID/);
  }
  assert.equal(f.calls.length,0);
 }finally{f.db.close();}
});
test('root evidence failure stops second read and answer; wrong-root relation evidence fails closed',async()=>{
 const f=fixture();try{
  const plan=createPlan({version:1,relation:'customer.orders',rootId:1});
  await assert.rejects(()=>executeInvestigation(plan,{...scope,execute:async(t,a)=>{const r=await f.execute(t,a);r.executionEvidence.verified=false;return r;}}),/EVIDENCE_INVALID/);
  assert.equal(f.calls.length,1);
  await assert.rejects(()=>executeInvestigation(plan,{...scope,execute:async(t,a)=>{const r=await f.execute(t,a);if(r.relation)r.relation.root.canonicalId='2';return r;}}),/EVIDENCE_INVALID/);
  assert.throws(()=>composeInvestigationAnswer({verificationStatus:'PASS'},scope),/UNAVAILABLE/);
 }finally{f.db.close();}
});
test('relation continuation reuses P16-L namespace, frozen query, TTL and opaque proof promotion',async()=>{
 const f=fixture();try{
  let now=100;const {createContinuationStore,TTL_MS}=require('../api/services/ai-v5/collectionContinuation.cjs');
  const store=createContinuationStore({now:()=>now}),ctx={version:1,contextKey:scope.contextKey,conversationId:'chat-1'};
  const q={version:1,relation:'customer.orders',rootId:1},a=await executeInvestigation(createPlan(q),{...scope,execute:f.execute});
  const state=store.setVerifiedRelation(ctx,q,a.handle,scope);
  assert.equal(store.peekCertified(ctx).query.relationRequest.rootId,1);
  assert.throws(()=>store.read(ctx,'tampered',state.queryId),/UNAVAILABLE/);
  assert.throws(()=>store.read(ctx,state.token,'wrong-query'),/UNAVAILABLE/);
  for(const bad of [{...ctx,conversationId:'chat-2'},{...ctx,contextKey:'b'.repeat(64)}])assert.equal(store.peekCertified(bad),null);
  const next={...state.query.relationRequest,afterId:state.nextAfterId};
  const b=await executeInvestigation(createPlan(next),{...scope,execute:f.execute});
  const pa=getVerifiedRelation(a.handle,scope).page,pb=getVerifiedRelation(b.handle,scope).page;
  assert.equal(new Set([...pa.items,...pb.items].map(i=>i.canonicalId)).size,40);
  assert.deepEqual(pa.filters,pb.filters);assert.equal(pb.items[0].canonicalId,'43');
  assert.throws(()=>store.setVerifiedRelation(ctx,q,{verificationStatus:'PASS'},scope),/UNAVAILABLE/);
  now+=TTL_MS;assert.equal(store.peekCertified(ctx),null);
 }finally{f.db.close();}
});
