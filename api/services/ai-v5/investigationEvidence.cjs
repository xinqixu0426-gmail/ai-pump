'use strict';
const {randomUUID}=require('node:crypto');
const C=require('../relationReadContract.cjs');
const {createEvidenceLedger,addEvidence}=require('./evidenceLedger.cjs');
const {createEvidenceRequirement}=require('./evidenceRequirements.cjs');
const {verifyV5Task,isVerifiedTaskResult}=require('./verification.cjs');
const {createV5ToolResult}=require('./contracts.cjs');
const records=new WeakMap();
function verifyRelationExecution({taskId,contextKey,request,result,rootHandle=null}){
 const bad=()=>{throw Error('RELATION_EVIDENCE_INVALID');},q=C.request(request),c=C.RELATIONS[q.relation],e=result?.executionEvidence;
 if(result?.success!==true||e?.verified!==true||e.kind!=='formal_api_query'||e.calls?.length!==1
  ||e.calls[0].method!=='POST'||e.calls[0].path!=='/api/relations/read')bad();
 const page=C.validateResult(q,result.relation),scope={taskId,contextKey};
 let ledger=createEvidenceLedger(taskId),root=null;
 const add=(stepId,claimType,toolName,sourceRef,time)=>{
  ledger=addEvidence(ledger,{evidenceId:randomUUID(),taskId,evidenceType:'DIRECT_FACT',status:'VALID',claimType,
   sourceType:'TOOL',sourceRef,entityRef:null,toolName,capabilityId:'investigation.read',operationRefs:[],freshness:'CURRENT',createdAt:time,
   metadata:{stepId,relationClass:q.relation,resourceType:c.result,returnedCount:page.returnedCount}});
 };
 if(c.root){
  root=require('./collectionEvidence.cjs').getVerifiedCollection(rootHandle,scope);
  if(root.operation!=='detail'||root.resourceType!==require('./investigationPlan.cjs').RESOURCES[c.root]
   ||root.items.length!==1||root.items[0].canonicalId!==String(q.rootId))bad();
  add('root','investigation.root','read_collection',root.queryId,root.asOf);
 }
 add('relation','investigation.result','read_relation',page.queryId,page.asOf);
 const requirements=['investigation.result',...(c.root?['investigation.root']:[])].map(claimType=>createEvidenceRequirement({
  capabilityId:'investigation.read',requirementId:claimType,claimType,requiredEvidenceType:'DIRECT_FACT',minimumSourceTrust:'FORMAL',freshnessRequirement:'CURRENT',minimumCount:1,level:'REQUIRED',entityType:null}));
 const verification=verifyV5Task({ledger,requirements,execution:{orchestrationComplete:true,toolResults:[createV5ToolResult({taskId,toolName:'read_relation',status:'success',data:{queryId:page.queryId},operationRefs:[]})]}});
 if(!isVerifiedTaskResult(ledger,verification))bad();
 const handle=Object.freeze({taskId,evidenceRef:randomUUID(),verificationStatus:'PASS'});
 records.set(handle,{taskId,contextKey,page,root,ledger,verification});return handle;
}
function getVerifiedRelation(handle,scope){
 const record=records.get(handle);
 if(!record||record.taskId!==scope.taskId||record.contextKey!==scope.contextKey||!isVerifiedTaskResult(record.ledger,record.verification))throw Error('RELATION_VERIFIED_VALUE_UNAVAILABLE');
 return {page:structuredClone(record.page),root:structuredClone(record.root)};
}
module.exports={verifyRelationExecution,getVerifiedRelation};
