'use strict';
const {validatePlan,RESOURCES}=require('./investigationPlan.cjs');
const {verifyCollectionExecution,getVerifiedCollection}=require('./collectionEvidence.cjs');
const {verifyRelationExecution}=require('./investigationEvidence.cjs');
async function executeInvestigation(plan,{taskId,contextKey,signal,execute}){
 const valid=validatePlan(plan),scope={taskId,contextKey};
 let rootHandle=null,toolCalls=0,request={...valid.query};
 const call=async(tool,args)=>{if(signal?.aborted)throw Error('INVESTIGATION_CANCELLED');
  if(++toolCalls>valid.maxReadSteps)throw Error('INVESTIGATION_BUDGET_EXCEEDED');
  const r=await execute(tool,args,{signal});if(signal?.aborted)throw Error('INVESTIGATION_CANCELLED');return r;};
 for(const step of valid.steps){
  if(step.stepId==='root'){
   const rootQuery={resourceType:RESOURCES[require('../relationReadContract.cjs').RELATIONS[request.relation].root],operation:'detail',targetId:request.rootId};
   const result=await call(step.tool,rootQuery);
   rootHandle=verifyCollectionExecution({...scope,request:rootQuery,result});
   const root=getVerifiedCollection(rootHandle,scope);
   if(root.items.length!==1||root.items[0].canonicalId!==String(request.rootId))throw Error('INVESTIGATION_ROOT_NOT_FOUND');
   // Sole downstream argument binding is a verified canonical reference, not rendered text.
   request.rootId=Number(root.items[0].canonicalId);
  }else{
   const result=await call(step.tool,request);
   const handle=verifyRelationExecution({...scope,request,result,rootHandle});
   return {handle,toolCalls,plannedSteps:valid.steps.length};
  }
 }
 throw Error('INVESTIGATION_INCOMPLETE');
}
module.exports={executeInvestigation};
