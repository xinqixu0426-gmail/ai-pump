'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {withConversationContext}=require('../api/services/conversationContext.cjs');
const {runCandidateRead}=require('../api/services/ai-v5/candidateRead.cjs');
const {createContinuationStore}=require('../api/services/ai-v5/collectionContinuation.cjs');
const choice=require('../api/services/ai-v5/candidateChoice.cjs');
const context={version:1,contextKey:'a'.repeat(64),conversationId:'chat-901'};
const read={goal:'读取',mode:'query',domains:['order'],needsBusinessData:true,contextMode:'current_turn',answerShape:'list',entityScope:'collection',requiresClarification:false,ambiguities:[],confidence:'high'};
async function harness(fn){
 const db=require('./helpers/investigationCorpus.cjs').fixture(),app=require('express')();
 app.use(require('express').json());
 app.use('/api/collections',require('../api/routes/collectionRead.cjs').createCollectionReadRouter({db}));
 app.use('/api/relations',require('../api/routes/relationRead.cjs').createRelationReadRouter({db}));
 app.use('/api/entity-lookup',require('../api/routes/entityLookup.cjs').createEntityLookupRouter({db}));
 app.use('/api/entity-span-candidates',require('../api/routes/entitySpanCandidates.cjs').createEntitySpanCandidateRouter({db}));
 const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
 const old={PORT:process.env.PORT,PUMP_V5_CANDIDATE_RUNTIME:process.env.PUMP_V5_CANDIDATE_RUNTIME};
 process.env.PORT=String(server.address().port);process.env.PUMP_V5_CANDIDATE_RUNTIME='true';
 let clock=1000,modelCalls=0,riskCalls=0;const calls=[],s=createContinuationStore({now:()=>clock});
 const execute=async(name,args,opts)=>{calls.push({name,args:structuredClone(args)});return require('../api/routes/ai/executor.cjs').executeToolCall(name,args,opts);};
 const env={PUMP_V5_CANDIDATE_RUNTIME:'true',AI_V5_READ_CANARY_ENABLED:'true',AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED:'true',AI_V5_MULTI_READ_ENABLED:'true'};
 async function run(source,plan={},ctx=context,overrides={}){
  let text='';
  const options={env,continuationStore:s,collectionExecute:execute,investigationExecute:execute,
   riskOptions:{request:async()=>{riskCalls++;return plan.write?{...read,mode:'command'}:read;}},
   investigationModelRequest:async messages=>{modelCalls++;const choices=JSON.parse(messages[1].content).choices;
    return {content:JSON.stringify({version:6,choiceRef:plan.relation?choices.find(c=>c.relation===plan.relation).choiceRef:'NOT_APPLICABLE',topN:null,confidence:'high'})};},
   collectionModelRequest:async messages=>{modelCalls++;const wire=JSON.parse(messages[1].content);
    const span=wire.spans.find(s=>s.text===plan.keyword||s.text===plan.identity);
    return {content:JSON.stringify({version:1,routeRef:plan.none?'NOT_APPLICABLE':(plan.resource||'customers')+'.'+(plan.operation||'list'),
     filterClass:plan.keyword?(plan.refine?'CUSTOMER_CHOICE_KEYWORD':'CUSTOMER_KEYWORD'):'NONE',status:null,customerSpanRef:null,
     detailSpanRef:span?.spanRef??null,topN:null,confidence:'high'})};},...overrides};
  const result=await withConversationContext(ctx,()=>runCandidateRead({sourceRequest:source,previewOptIn:true,internalAuthorized:true,collectionOnly:true,
   deliver:t=>{text=t;return plan.close!==true;}},options));
  return {result,text};
 }
 try{await fn({db,run,s,calls,env,advance:n=>{clock+=n;},counts:()=>({riskCalls,modelCalls}),execute});}
 finally{for(const [k,v]of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;
  await new Promise(r=>server.close(r));db.close();}
}
test('literal customer discovery uses bounded SQL pages/count, no wildcard rewrite or business mutation',()=>{
 const db=require('./helpers/collectionFixture.cjs').collectionFixture();
 try{
  db.prepare('INSERT INTO customers(name) VALUES (?)').run('张%_客户');
  const before=db.prepare('SELECT total_changes() AS n').get().n;
  const service=require('../api/services/collectionReadService.cjs').createCollectionReadService({db});
  let afterId,ids=[];
  do{const p=service.read({resourceType:'customers',operation:'list',customerKeyword:'客户-',...(afterId?{afterId}:{})});
   assert.equal(p.totalCount,63);assert.ok(p.returnedCount<=20);ids.push(...p.items.map(i=>i.canonicalId));afterId=p.pageBoundary.nextAfterId;
  }while(afterId);
  assert.equal(ids.length,63);assert.equal(new Set(ids).size,63);
  assert.equal(service.read({resourceType:'customers',operation:'list',customerKeyword:'%_'}).totalCount,1);
  for(const q of [{resourceType:'orders',operation:'list',customerKeyword:'张'},{resourceType:'customers',operation:'count',customerKeyword:'张'},
   {resourceType:'customers',operation:'list',customerKeyword:' '},{resourceType:'customers',operation:'list',customerKeyword:'张',pageSize:51}])assert.throws(()=>service.read(q));
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n,before);
 }finally{db.close();}
});
test('real HTTP search -> multiple pages -> explicit choice; one candidate never autoselects',()=>harness(async h=>{
 const before=h.db.prepare('SELECT total_changes() AS n').get().n;
 const first=await h.run('查找客户「客户」',{keyword:'客户'});assert.equal(first.result.choicePending,true);assert.equal(h.s.peekCertified(context).rowIds[0],'63');
 const counts=h.counts();await h.run('继续');assert.deepEqual(h.counts(),counts);assert.equal(h.s.peekCertified(context).rowIds[0],'43');
 const out=await h.run('第1个');assert.equal(out.result.delivered,true);assert.match(out.text,/客户-43/);assert.equal(h.s.peek(context),null);
 assert.equal(h.calls.at(-1).args.targetId,43);
 const one=await h.run('查找客户「客户-63」',{keyword:'客户-63'});assert.equal(one.result.choicePending,true);assert.equal(h.s.peekCertified(context).rowIds.length,1);
 assert.equal(h.calls.at(-1).args.operation,'list');
 assert.equal(h.db.prepare('SELECT total_changes() AS n').get().n,before);
}));
test('missing customer -> contextual keyword -> selection continues original customer.orders, then relation paging',()=>harness(async h=>{
 const missing=await h.run('客户「不存在」有哪些订单？',{relation:'customer.orders'});
 assert.equal(missing.result.delivered,true);assert.match(missing.text,/没有找到精确匹配/);assert.equal(h.s.peekCertified(context).query.purpose.kind,'customer.orders');
 const refined=await h.run('客户',{keyword:'客户',refine:true});assert.equal(refined.result.choicePending,true);
 // All fixture orders belong to customer 1; choosing it must use the relation, not customer detail.
 await h.run('继续');await h.run('继续');await h.run('继续');
 const out=await h.run('第3个');assert.equal(out.result.delivered,true);assert.match(out.text,/ORD/);
 assert.deepEqual(h.calls.slice(-2).map(c=>c.name),['read_collection','read_relation']);assert.equal(h.calls.at(-1).args.rootId,1);
 assert.equal(h.s.peekCertified(context).query.kind,'relation');
 const next=await h.run('继续');assert.equal(next.result.delivered,true);assert.equal(h.calls.at(-1).args.afterId,44);
}));
test('coil exact overlapping identities ask choice; choose one/both reread only advertised canonical IDs',()=>harness(async h=>{
 const source='看看线圈-63的详情',p={resource:'coils',operation:'detail',identity:'线圈-63'};
 const first=await h.run(source,p);assert.equal(first.result.choicePending,true);assert.equal(first.result.toolCalls,2);
 const ids=h.s.peekCertified(context).rowIds;assert.deepEqual(new Set(ids),new Set(['6','63']));
 const counts=h.counts(),out=await h.run('两者都看');assert.equal(out.result.delivered,true);assert.equal(out.result.toolCalls,2);assert.deepEqual(h.counts(),counts);
 assert.deepEqual(h.calls.slice(-2).map(c=>String(c.args.targetId)),ids);
 await h.run(source,p);const one=await h.run('第2个');assert.equal(one.result.delivered,true);assert.equal(one.result.toolCalls,1);
 assert.equal(h.calls.at(-1).args.targetId,Number(ids[1]));
}));
test('coil aliases deduplicate, real duplicate records do not; partial/broken lookup and >2 identities fail closed',()=>harness(async h=>{
 const lookup=require('../api/services/entityLookupService.cjs').createEntityLookupService({db:h.db});
 h.db.prepare('UPDATE coils SET scheme_name=?,scheme_code=? WHERE id=63').run('独特方案','唯一代号');
 const supply=require('../api/services/entitySpanCandidates.cjs').createEntitySpanCandidateService({db:h.db});
 const options={supplySpanCandidates:async sourceText=>supply.supply({version:1,sourceText,entityScope:'coil'}),lookupEntities:async(_f,q)=>lookup.lookupEntities(q)};
 assert.deepEqual(await choice.discoverCoils('独特方案 唯一代号',options),['63']);
 h.db.prepare('UPDATE coils SET scheme_name=? WHERE id=62').run('独特方案');
 assert.equal((await choice.discoverCoils('独特方案',options)).length,2);
 h.db.prepare('UPDATE coils SET scheme_name=? WHERE id=61').run('独特方案');
 await assert.rejects(choice.discoverCoils('独特方案',options),/CHOICE_UNAVAILABLE/);
 await assert.rejects(choice.discoverCoils('独特方案',{...options,lookupEntities:async()=>{throw Error('network');}}),/CHOICE_UNAVAILABLE/);
 await assert.rejects(choice.discoverCoils('独特方案',{...options,supplySpanCandidates:async()=>({complete:false})}),/CHOICE_UNAVAILABLE/);
}));
test('pending proof rejects forgery/tampering/wrong token/principal/conversation and fixed TTL across pages',()=>harness(async h=>{
 await h.run('查找客户「客户」',{keyword:'客户'});
 const entry=h.s.peekCertified(context);const scope={taskId:'fake',contextKey:context.contextKey};
 assert.throws(()=>h.s.setVerifiedChoice(context,{},scope));assert.throws(()=>h.s.read(context,'fake',entry.queryId));
 assert.equal(h.s.peekCertified({...context,contextKey:'b'.repeat(64)}),null);
 assert.equal(h.s.peekCertified({...context,conversationId:'chat-902'}),null);
 entry.rowIds[0]='1';entry.query.purpose.kind='customer.orders';
 assert.equal(h.s.peekCertified(context).rowIds[0],'63');assert.equal(h.s.peekCertified(context).query.purpose.kind,'detail');
 h.advance(500000);await h.run('继续');assert.equal(h.s.peekCertified(context).expiresAt,entry.expiresAt);
 h.advance(100001);assert.equal(h.s.peekCertified(context),null);
 const count=h.calls.length;assert.equal((await h.run('第1个')).result.delivered,false);assert.equal(h.calls.length,count);
}));
test('mixed mutation choices cannot use control bypass; unrelated request invalidates pending purpose',()=>harness(async h=>{
 for(const source of ['第1个并删除','两者都看并改库存','选择第2个并下单']){
  await h.run('查找客户「客户」',{keyword:'客户'});const calls=h.calls.length,counts=h.counts();
  const out=await h.run(source,{write:true});assert.equal(out.result.delivered,false);assert.equal(h.calls.length,calls);
  assert.equal(h.counts().riskCalls,counts.riskCalls+1);assert.equal(h.counts().modelCalls,counts.modelCalls);assert.equal(h.s.peek(context),null);
 }
 await h.run('客户「不存在」有哪些订单？',{relation:'customer.orders'});
 await h.run('查询订单清单',{resource:'orders'});assert.equal(h.s.peekCertified(context).query.kind,undefined);
 const out=await h.run('第1个');assert.equal(out.result.delivered,true);assert.equal(h.calls.at(-1).args.resourceType,'orders');
}));
test('failed second coil detail never delivers partial answer; failed delivery clears choice',()=>harness(async h=>{
 await h.run('看看线圈-63的详情',{resource:'coils',operation:'detail',identity:'线圈-63'});
 let calls=0;const out=await h.run('两者都看',{},context,{collectionExecute:async(name,q,opts)=>{
  if(++calls===2)throw Error('transport');return h.execute(name,q,opts);
 }});
 assert.equal(out.result.delivered,false);assert.equal(out.text,'');assert.equal(h.s.peek(context),null);
 const closed=await h.run('查找客户「客户」',{keyword:'客户',close:true});assert.equal(closed.result.delivered,false);assert.equal(h.s.peek(context),null);
}));
test('risk receives only certified pending-customer context; snapshots cannot introduce that authority',()=>harness(async h=>{
 const fakePage={items:[],resourceType:'customers',pageBoundary:{nextAfterId:null},hasMore:false};
 h.s.set(context,{kind:'choice',operation:'list'},fakePage);
 let pendingFlag=false;
 const riskOptions={request:async messages=>{pendingFlag=messages.some(m=>m.content.includes('awaiting an explicit customer selection'));
  assert.ok(messages.every(m=>!m.content.includes(context.contextKey)));return {...read,mode:'command'};}};
 await h.run('删除',{},context,{riskOptions});assert.equal(pendingFlag,false);
 await h.run('查找客户「客户」',{keyword:'客户'});
 await h.run('删除',{},context,{riskOptions});assert.equal(pendingFlag,true);assert.equal(h.s.peek(context),null);
}));
test('wrong conversation/principal and tampered filter responses cannot execute a pending selection',()=>harness(async h=>{
 await h.run('查找客户「客户」',{keyword:'客户'});const count=h.calls.length;
 for(const ctx of [{...context,contextKey:'b'.repeat(64)},{...context,conversationId:'chat-902'}]){
  const out=await h.run('第1个',{},ctx);assert.equal(out.result.delivered,false);assert.equal(h.calls.length,count);
 }
 assert.ok(h.s.peekCertified(context));
 const out=await h.run('继续',{},context,{collectionExecute:async(name,q,opts)=>{
  const r=await h.execute(name,q,opts);r.collection.filters.customerKeyword='different';return r;
 }});
 assert.equal(out.result.delivered,false);assert.equal(out.result.failureClass,'COLLECTION_EVIDENCE_INVALID');assert.equal(h.s.peek(context),null);
}));
test('keyword semantic contract uses exact source span; context cannot be guessed and IDs cannot be generated',()=>{
 const source='张',catalog=require('../api/services/ai-v5/sourceSpanCatalog.cjs').createV5SourceSpanCatalog(source);
 const parse=require('../api/services/ai-v5/collectionSemanticContract.cjs').parseCollectionSemantic;
 const p={version:1,routeRef:'customers.list',filterClass:'CUSTOMER_CHOICE_KEYWORD',status:null,customerSpanRef:null,detailSpanRef:catalog.spans[0].spanRef,topN:null,confidence:'high'};
 assert.throws(()=>parse(JSON.stringify(p),source,catalog));
 const active={query:{kind:'choice'}};assert.equal(parse(JSON.stringify(p),source,catalog,active).customerKeyword,'张');
 for(const bad of [{...p,targetId:1},{...p,detailSpanRef:'张'},{...p,routeRef:'orders.list'}])assert.throws(()=>parse(JSON.stringify(bad),source,catalog,active));
});
