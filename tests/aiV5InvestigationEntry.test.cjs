'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const I=require('../api/services/ai-v5/investigationIntent.cjs');
test('list delegation accepts bounded topN without forwarding executable arguments',()=>{
 const source='最近的记录',catalog=I.semanticChoices(source);
 for(const c of catalog.choices.filter(c=>c.delegate)){
  const parse=topN=>I.parseIntent(JSON.stringify({version:6,choiceRef:c.choiceRef,topN,confidence:'high'}),source,catalog);
  if(c.operation==='list')for(const n of [1,10,50]){const out=parse(n);assert.equal(out.operation,'NONE');assert.equal(out.topN,undefined);assert.equal(out.pageSize,undefined);}
  else assert.throws(()=>parse(10),/SEMANTIC_INVALID/);
  for(const n of [0,51,-1,1.5,'10'])assert.throws(()=>parse(n),/SEMANTIC_INVALID/);
 }
});
test('every investigation choice retains authoritative semantics and bounded fact requirements',()=>{
 const choices=I.semanticChoices('查询').choices;
 const authority=require('../api/services/ai-v5/investigationPlan.cjs').CATALOG;
 for(const c of choices.filter(c=>!c.delegate)){
  assert.equal(c.semantics,authority.find(a=>a.ref===c.relation).semantics);
  assert.ok(typeof c.description==='string'&&c.description.length>0&&c.description.length<160);
 }
 assert.deepEqual(choices.find(c=>c.relation==='part.facts').requiredFacts,['inventory.quantity','price.current']);
 assert.equal(choices.length,29);
});
test('delegates do not require investigation identity or invoke the source selector',async()=>{
 for(const kind of I.semanticChoices('查询').choices.filter(c=>c.delegate).map(c=>c.relation)){
  const source='「甲」与「乙」'+('说明'.repeat(300));let calls=0;
  const out=await I.selectInvestigationIntent(source,{modelRequest:async(messages)=>{
   calls++;const choices=JSON.parse(messages[1].content).choices;
   return {content:JSON.stringify({version:6,choiceRef:choices.find(c=>c.relation===kind).choiceRef,topN:null,confidence:'high'})};
  }});
  assert.equal(calls,1);assert.equal(out.operation,'NONE');assert.equal(out.delegate,kind);
  assert.equal(out.identity,undefined);assert.equal(out.sourceSpans,undefined);
 }
});
test('two source candidates are consumed by the existing governed union, never by first-result selection',async()=>{
 const f=require('./helpers/investigationCorpus.cjs').fixture();
 try{
  const source='零件-1 的库存和单价',catalog=I.semanticChoices(source);
  const specific=catalog.spans.spans.find(s=>s.text==='零件-1'),whole=catalog.spans.spans.find(s=>s.text===source);assert.ok(specific&&whole);
  for(const mode of ['second-only','same-canonical','ambiguous','incomplete']){
   let modelCalls=0,lookupCalls=0,toolCalls=0,delivered=0;
   const options={env:{AI_V5_MULTI_READ_ENABLED:'true'},
    investigationModelRequest:async()=>({content:JSON.stringify(++modelCalls===1
     ?{version:6,choiceRef:catalog.choices.find(c=>c.relation==='part.facts').choiceRef,topN:null,confidence:'high'}
     :{version:2,spanRefs:[whole.spanRef,specific.spanRef],needsClarification:false})}),
    collectionLookupOptions:{lookupEntities:async(_fetch,input)=>{
     lookupCalls++;const specificMention=input.mention==='零件-1';
     const candidates=mode==='second-only'&&!specificMention?[]:[{canonicalId:mode==='ambiguous'&&!specificMention?'2':'1',entityType:'part',matchKind:'EXACT'}];
     return {version:1,status:mode==='incomplete'?'INCOMPLETE':'OK',complete:mode!=='incomplete',attemptedEntityTypes:input.entityTypes.length,candidateCount:candidates.length,candidates};
    }},
    investigationExecute:async(name,q)=>{
     toolCalls++;const collection=name==='read_collection';
     const result=(collection?require('../api/services/collectionReadService.cjs').createCollectionReadService({db:f}):require('../api/services/relationReadService.cjs').createRelationReadService({db:f})).read(q);
     return {success:true,[collection?'collection':'relation']:result,executionEvidence:{verified:true,kind:'formal_api_query',calls:[{method:'POST',path:collection?'/api/collections/read':'/api/relations/read'}]}};
    }};
   const run=()=>require('../api/services/conversationContext.cjs').withConversationContext({version:1,contextKey:'a'.repeat(64),conversationId:'chat-922'},()=>
    require('../api/services/ai-v5/investigationRuntime.cjs').tryInvestigation({sourceRequest:source,deliver:()=>{delivered++;return true;}},{taskId:'entry',risk:{riskClass:'READ_SAFE',contractValid:true},options}));
   if(['ambiguous','incomplete'].includes(mode)){await assert.rejects(run,mode==='ambiguous'?/TARGET_AMBIGUOUS/:/TARGET_UNAVAILABLE/);assert.equal(toolCalls,0);assert.equal(delivered,0);}
   else{const out=await run();assert.equal(out.validationPass,true);assert.equal(toolCalls,2);assert.equal(delivered,1);}
   assert.equal(modelCalls,2);assert.equal(lookupCalls,mode==='incomplete'?1:2);
  }
 }finally{f.close();}
});
