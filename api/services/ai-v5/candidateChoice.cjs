'use strict';
const {getVerifiedCollection,verifyCollectionExecution}=require('./collectionEvidence.cjs');
const {composeCollectionAnswer}=require('./collectionAnswer.cjs');
const {store,getConversationContext}=require('./collectionContinuation.cjs');
const proofs=new WeakMap();
const fail=()=>{throw Error('COLLECTION_CHOICE_UNAVAILABLE');};
function purpose(value){
 if(!value||Object.keys(value).some(k=>!['kind','resourceType','pageSize'].includes(k))
  ||!['detail','customer.orders'].includes(value.kind)||!['customers','coils'].includes(value.resourceType)
  ||(value.kind==='customer.orders'&&value.resourceType!=='customers')
  ||!Number.isInteger(value.pageSize)||value.pageSize<1||value.pageSize>50)fail();
 return structuredClone(value);
}
function mint(scope,data){const handle=Object.freeze({});proofs.set(handle,{scope:{...scope},data:structuredClone(data)});return handle;}
function readChoiceProof(handle,scope){const v=proofs.get(handle);if(!v||v.scope.taskId!==scope.taskId||v.scope.contextKey!==scope.contextKey)fail();return structuredClone(v.data);}
function pageProof(handle,scope,originalPurpose,query,notice){
 const page=getVerifiedCollection(handle,scope),q=require('../collectionReadContract.cjs').validateRequest(query);
 if(originalPurpose?.resourceType!=='customers'||page.resourceType!=='customers'||page.operation!=='list'||q.customerKeyword===undefined
  ||page.filters.customerKeyword!==q.customerKeyword||q.pageSize!==page.pageSize
  ||(q.afterId??null)!==page.pageBoundary.afterId)fail();
 return mint(scope,{purpose:purpose(originalPurpose),page,discoveryQuery:q,notice});
}
function choiceText(data){
 const escape=v=>String(v).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/[\\`*_{}\[\]()<>#+.!|~>-]/g,'\\$&');
 const {page}=data,rows=page.items.map((row,i)=>(i+1)+'. '+Object.entries(row.display)
  .filter(([k,v])=>v!==null&&v!==''&&k!=='lines').map(([k,v])=>({name:'名称',createdAt:'创建时间',spec:'规格',material:'材质',schemeStatus:'方案状态',slotType:'槽型',updatedAt:'更新时间',remark:'备注'}[k]||k)+'：'+escape(v)).join('；'));
 const heading=data.notice==='not_found'?'没有找到精确匹配的客户。':data.notice==='ambiguous'?'存在多个精确匹配，请明确选择。':'以下是候选客户，请明确选择。';
 let text=heading;
 if(page.totalCountKnown)text+='\n关键词匹配共 '+page.totalCount+' 条，本页 '+page.items.length+' 条。';
 if(rows.length)text+='\n'+rows.join('\n')+'\n请回复“第1个”等本页序号'+(page.resourceType==='coils'&&rows.length===2?'，或“两者都看”':'')+'。';
 if(data.purpose.kind==='customer.orders')text+='\n选择后继续查询该客户的订单。';
 if(page.resourceType==='customers')text+='\n也可以提供客户姓名关键词或姓氏'+(page.hasMore?'；回复“继续”查看下一页':'')+'。';
 if(Buffer.byteLength(text)>128*1024)fail();return text;
}
function outcome(delivered,toolCalls,extra={}){return {attempted:true,eligible:true,validationPass:true,delivered,exposed:delivered,
 failureClass:delivered?'NONE':'REQUEST_CLOSED',readExecution:'SUCCESS',resultEquivalence:'MATCH',evidenceVerification:'PASS',
 toolCalls,modelCalls:0,numericValid:true,entityValid:true,contractValid:true,evidenceRefsValid:true,groundingValid:true,
 requiredFactCoverage:true,unsupportedClaimCount:0,internalLeakageCount:0,...extra};}
async function readPage(request,input,taskId,options){
 if(input.signal?.aborted)fail();
 const result=await (options.collectionExecute||require('../../routes/ai/executor.cjs').executeToolCall)('read_collection',request,{signal:input.signal});
 if(input.signal?.aborted)fail();
 const scope={taskId,contextKey:getConversationContext().contextKey};
 const handle=verifyCollectionExecution({taskId,contextKey:scope.contextKey,request,result});
 return {handle,scope,page:getVerifiedCollection(handle,scope)};
}
function deliverChoice(proof,input,scope,options,previous=null,toolCalls=1){
 const ctx=getConversationContext(),s=options.continuationStore||store,data=readChoiceProof(proof,scope);
 const text=choiceText(data);if(input.signal?.aborted)fail();
 s.setVerifiedChoice(ctx,proof,scope,previous);
 const delivered=input.deliver(text)===true;if(!delivered)s.clear(ctx);
 return outcome(delivered,toolCalls,{choicePending:true,returnedCount:data.page.items.length,hasMore:data.page.hasMore});
}
async function searchCustomers(input,{taskId,options,purpose:originalPurpose,keyword,pageSize=20,afterId,notice='search',previous=null,intent=null}){
 const query={resourceType:'customers',operation:'list',customerKeyword:keyword,pageSize,...(afterId?{afterId}:{})};
 const {handle,scope}=await readPage(query,input,taskId,options);
 return {...deliverChoice(pageProof(handle,scope,originalPurpose,query,notice),input,scope,options,previous),
  semanticModelCalls:intent?.modelCalls??0,semanticDurationMs:intent?.durationMs??0};
}
// Only complete, successful governed lookup can open missing-target recovery.
async function recoverCustomer(input,{taskId,options,intent,governed,originalPurpose}){
 if(!governed?.complete||!['NOT_FOUND','RESOLVED','AMBIGUOUS'].includes(governed.status)
  ||governed.candidateCount!==governed.candidates?.length)fail();
 const matches=governed.candidates.filter(c=>c.entityType==='customer');
 if(matches.length===1)fail();
 const notice=matches.length?'ambiguous':'not_found';
 if(intent.identity)return searchCustomers(input,{taskId,options,purpose:originalPurpose,keyword:intent.identity,notice,intent});
 // The two source references are alternatives, not permission to pick a keyword.
 const scope={taskId,contextKey:getConversationContext().contextKey};
 const page={resourceType:'customers',items:[],hasMore:false,totalCountKnown:false,pageBoundary:{nextAfterId:null}};
 return deliverChoice(mint(scope,{purpose:purpose(originalPurpose),page,discoveryQuery:null,notice}),input,scope,options,null,0);
}
async function discoverCoils(source,options){
 const spans=require('./sourceSpanCatalog.cjs');
 const supply=await (options.supplySpanCandidates||require('../../routes/ai/internalApiClient.cjs').supplyCoilSpanCandidates)(source,options);
 const catalog=spans.mergeAuthoritativeCoilSpans(source,spans.createV5SourceSpanCatalog(source),supply);
 if(catalog.status!=='READY')fail();
 const occurrences=new Map(supply.candidates.map(c=>[c.start+':'+c.end,c]));
 const choices=new Map();
 for(const c of occurrences.values()){
  const span=catalog.spans.find(s=>s.start===c.start&&s.end===c.end);
  if(!span)fail();
  const governed=await require('./exactAuthoritativeSpan.cjs').acquireExactAuthoritativeCandidateSet(span,options);
  if(!governed.complete||!['RESOLVED','AMBIGUOUS'].includes(governed.status))fail();
  const matches=governed.candidates.filter(x=>x.entityType==='coil');if(!matches.length)fail();
  for(const match of matches){choices.set(match.canonicalId,match);if(choices.size>2)fail();}
 }
 if(!choices.size)throw Error('COLLECTION_TARGET_NOT_FOUND');
 return [...choices.keys()];
}
async function openCoilChoice(ids,input,{taskId,options}){
 if(ids.length!==2||new Set(ids).size!==2)fail();
 const pages=[];let scope;
 for(const id of ids){
  require('./collectionDetailTarget.cjs').createDetailTarget('coils',id,'governed_entity_lookup');
  const r=await readPage({resourceType:'coils',operation:'detail',targetId:Number(id)},input,taskId,options);
  if(r.page.items.length!==1)fail();pages.push(r.page);scope=r.scope;
 }
 const page={resourceType:'coils',items:pages.flatMap(p=>p.items),hasMore:false,totalCountKnown:false,pageBoundary:{nextAfterId:null}};
 return deliverChoice(mint(scope,{purpose:purpose({kind:'detail',resourceType:'coils',pageSize:20}),page,discoveryQuery:null,notice:'ambiguous'}),input,scope,options,null,2);
}
function choiceControl(source,ctx,s){
 const active=s.peekCertified(ctx);if(active?.query?.kind!=='choice')return null;
 const text=source.trim();
 const both=/^(?:请)?(?:两者都看|两个都看|都看|两个都要|两个都查|两个都查看)[。！!?？]?$/u.test(text);
 if(both)return active.resourceType==='coils'&&active.rowIds.length===2?{operation:'choiceBoth',contractValid:true}:null;
 const command=require('./collectionContextCommand.cjs').contextCommand(source,active);
 if(!command)return null;
 if(command.operation==='ordinal'&&!active.rowIds[command.ordinal-1])return null;
 return {...command,operation:command.operation==='ordinal'?'choiceSelect':'choiceContinue'};
}
async function tryPendingChoice(input,{taskId,controlIntent,options}){
 const ctx=getConversationContext(),s=options.continuationStore||store;
 if(!controlIntent?.operation?.startsWith('choice')){
  const pending=s.peekCertified(ctx);if(pending?.query?.kind!=='choice')return null;
  // This model sees only an explicit customer-selection context flag, no rows or IDs.
  const intent=await require('./collectionIntent.cjs').selectCollectionIntent(input.sourceRequest,pending,{
   env:options.env,modelRequest:options.collectionModelRequest,shadowTaskId:taskId,
   observeModelCall:(m,fn)=>require('../observability.cjs').withModelSpan({...m,stage:'collection_intent'},fn)});
  if(intent.refineChoice&&pending.resourceType==='customers')return searchCustomers(input,{taskId,options,
   purpose:pending.query.purpose,keyword:intent.customerKeyword,pageSize:intent.pageSize,notice:'search',previous:pending,intent});
  s.clear(ctx);return null;
 }
 const active=s.peekCertified(ctx);if(active?.query?.kind!=='choice')fail();
 const current=s.read(ctx,active.token,active.queryId),data=current.query;
 if(controlIntent.operation==='choiceContinue'){
  if(!current.hasMore||!data.discoveryQuery)throw Error('COLLECTION_END_REACHED');
  return searchCustomers(input,{taskId,options,purpose:data.purpose,keyword:data.discoveryQuery.customerKeyword,
   pageSize:data.discoveryQuery.pageSize,afterId:current.nextAfterId,notice:data.notice,previous:current});
 }
 const ids=controlIntent.operation==='choiceBoth'?current.rowIds:[current.rowIds[controlIntent.ordinal-1]];
 if(ids.some(id=>!id)||!ids.length||ids.length>2||(ids.length===2&&current.resourceType!=='coils'))fail();
 // Consume the pending choice before any reread; failure cannot resurrect a stale choice.
 s.clear(ctx);
 if(data.purpose.kind==='customer.orders'){
  const query={version:1,relation:'customer.orders',rootId:Number(ids[0]),pageSize:data.purpose.pageSize};
  return require('./investigationRuntime.cjs').deliverInvestigation(input,{taskId,options,query,intent:{modelCalls:0,durationMs:0}});
 }
 const answers=[];
 for(const id of ids){
  const r=await readPage({resourceType:current.resourceType,operation:'detail',targetId:Number(id)},input,taskId,options);
  if(r.page.items.length!==1)fail();answers.push(composeCollectionAnswer(r.handle,r.scope).answerText);
 }
 if(input.signal?.aborted)fail();
 return outcome(input.deliver(answers.join('\n\n'))===true,ids.length,{choicePending:false});
}
module.exports={readChoiceProof,searchCustomers,recoverCustomer,discoverCoils,openCoilChoice,choiceControl,tryPendingChoice};
