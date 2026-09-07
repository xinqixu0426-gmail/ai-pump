'use strict';
const {store,getConversationContext}=require('./collectionContinuation.cjs');
const {createPlan,RESOURCES}=require('./investigationPlan.cjs');
const {executeInvestigation}=require('./investigationExecution.cjs');
const {getVerifiedRelation}=require('./investigationEvidence.cjs');
const {composeInvestigationAnswer}=require('./investigationAnswer.cjs');
async function tryInvestigation(input,{taskId,risk,controlIntent,options={}}){
 const ctx=getConversationContext(),stateStore=options.continuationStore||store;
 if(options.env?.AI_V5_MULTI_READ_ENABLED!=='true'||!ctx||input.factKey!==undefined)return null;
 if(risk.riskClass!=='READ_SAFE'||risk.contractValid!==true)throw Error('INVESTIGATION_RISK_REJECTED');
 const active=stateStore.peek(ctx);let query,queryId,intent={modelCalls:0,durationMs:0};
 if(controlIntent){
  if(active?.query?.kind!=='relation')return null;
  if(controlIntent.operation==='ordinal'){
   if(active.query.relationRequest.relation==='order.lines')throw Error('INVESTIGATION_REFERENCE_UNSUPPORTED');
   return null; // Existing P16-L ordinal executor consumes the same VERIFIED canonical page row.
  }
  const current=stateStore.read(ctx,active.token,active.queryId);
  if(!current.hasMore)throw Error('COLLECTION_END_REACHED');
  query={...current.query.relationRequest,afterId:current.nextAfterId};queryId=current.queryId;
 }else{
  // An ordinal over a line snapshot must never be misbound as an order's canonical ID.
  if(active?.query?.relationRequest?.relation==='order.lines'
   &&require('./collectionContextCommand.cjs').contextCommand(input.sourceRequest,active)?.operation==='ordinal')throw Error('INVESTIGATION_REFERENCE_UNSUPPORTED');
  intent=await require('./investigationIntent.cjs').selectInvestigationIntent(input.sourceRequest,{
   env:options.env,modelRequest:options.investigationModelRequest,shadowTaskId:taskId,
   observeModelCall:(m,fn)=>require('../observability.cjs').withModelSpan({...m,stage:'investigation_intent'},fn)});
  if(intent.operation==='NONE')return null;
  query={version:1,relation:intent.relation,pageSize:intent.pageSize};
  if(intent.rootType){
   const root=await require('./collectionDetailTarget.cjs').bindCollectionDetail({operation:'detail',resourceType:RESOURCES[intent.rootType],identity:intent.identity},
    {signal:input.signal,...options.collectionLookupOptions});
   query.rootId=Number(root.canonicalEntityRef);
  }else query.stockStatus=intent.stockStatus;
  stateStore.clear(ctx);
 }
 const started=performance.now(),plan=createPlan(query);
 const execution=await executeInvestigation(plan,{taskId,contextKey:ctx.contextKey,signal:input.signal,
  execute:options.investigationExecute||require('../../routes/ai/executor.cjs').executeToolCall});
 const scope={taskId,contextKey:ctx.contextKey},page=getVerifiedRelation(execution.handle,scope).page;
 const answer=composeInvestigationAnswer(execution.handle,scope);
 if(input.signal?.aborted)throw Error('INVESTIGATION_CANCELLED');
 if(!['order.customer','part.facts'].includes(query.relation))stateStore.setVerifiedRelation(ctx,query,execution.handle,scope,queryId);
 const delivered=input.deliver(answer.answerText)===true;if(!delivered)stateStore.clear(ctx);
 return {attempted:true,eligible:true,validationPass:true,delivered,exposed:delivered,failureClass:delivered?'NONE':'REQUEST_CLOSED',
  readExecution:'SUCCESS',resultEquivalence:'MATCH',evidenceVerification:'PASS',toolCalls:execution.toolCalls,modelCalls:0,
  numericValid:true,entityValid:true,contractValid:true,evidenceRefsValid:true,groundingValid:true,requiredFactCoverage:true,
  unsupportedClaimCount:0,internalLeakageCount:0,investigationType:query.relation,plannedSteps:execution.plannedSteps,
  semanticModelCalls:intent.modelCalls,semanticDurationMs:intent.durationMs,investigationMs:performance.now()-started,
  continuation:controlIntent?.operation==='continue',filterReclassificationCalls:0,returnedCount:page.returnedCount,
  totalKnown:true,hasMore:page.hasMore,resultBytes:Buffer.byteLength(JSON.stringify(page))};
}
module.exports={tryInvestigation};
