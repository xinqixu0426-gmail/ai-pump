'use strict';
const {randomUUID}=require('node:crypto');
const {validateRequest,validateDisplay,MAX_RESULT_BYTES}=require('../collectionReadContract.cjs');
const {createEvidenceLedger,addEvidence}=require('./evidenceLedger.cjs');
const {listEvidenceRequirements}=require('./evidenceRequirements.cjs');
const {verifyV5Task,isVerifiedTaskResult}=require('./verification.cjs');
const {createV5ToolResult}=require('./contracts.cjs');
const values=new WeakMap();
function verifyCollectionExecution({taskId,contextKey,request,result}){
    const fail=()=>{throw Error('COLLECTION_EVIDENCE_INVALID');};
    const q=validateRequest(request),p=result?.collection,e=result?.executionEvidence;
    if(result?.success!==true||!e?.verified||e.kind!=='formal_api_query'||e.calls?.length!==1
        ||e.calls[0].method!=='POST'||e.calls[0].path!=='/api/collections/read')fail();
    if(!p||p.version!==1||p.complete!==true||p.resourceType!==q.resourceType||p.operation!==q.operation
        ||p.sort!=='id_desc'||p.pageSize!==q.pageSize||p.consistency!=='READ_TRANSACTION_PER_PAGE'
        ||p.provenance?.capabilityId!=='collections.read'||p.provenance?.sourceApi!=='/api/collections/read'||p.provenance?.access!=='query'
        ||typeof p.queryId!=='string'||!Number.isFinite(Date.parse(p.asOf))
        ||p.filters?.status!==(q.status??null)||p.filters?.customerName!==(q.customerName??null)
        ||p.filters?.customerKeyword!==q.customerKeyword
        ||p.pageBoundary?.afterId!==(q.afterId??null)||typeof p.hasMore!=='boolean'||!Array.isArray(p.items)
        ||p.items.length!==p.returnedCount||p.returnedCount>q.pageSize)fail();
    if(q.operation==='detail'){
        if(p.items.length>1||p.hasMore||p.totalCountKnown!==false||p.totalCount!==null)fail();
    }else if(p.totalCountKnown!==true||!Number.isSafeInteger(p.totalCount)||p.totalCount<p.returnedCount)fail();
    if(q.operation==='count'&&(p.items.length||p.hasMore))fail();
    if(p.hasMore&&(p.returnedCount!==q.pageSize||p.totalCount<=p.returnedCount))fail();
    let previous=q.afterId??Infinity;
    for(const row of p.items){
        if(!row||Object.keys(row).sort().join(',')!=='canonicalId,display'||typeof row.canonicalId!=='string'
            ||! /^[1-9][0-9]*$/.test(row.canonicalId)||!Number.isSafeInteger(Number(row.canonicalId))
            ||Number(row.canonicalId)>=previous)fail();
        previous=Number(row.canonicalId);
        if(q.targetId!==undefined&&row.canonicalId!==String(q.targetId))fail();
        if(q.identity!==undefined&&q.resourceType!=='coils'&&row.display?.name!==q.identity)fail();
        validateDisplay(q.resourceType,q.operation,row.display);
    }
    if(p.pageBoundary.nextAfterId!==(p.hasMore?Number(p.items.at(-1).canonicalId):null)
        ||Buffer.byteLength(JSON.stringify(p))>=MAX_RESULT_BYTES)fail();
    const evidenceRef=randomUUID();
    const ledger=addEvidence(createEvidenceLedger(taskId),{evidenceId:evidenceRef,taskId,evidenceType:'DIRECT_FACT',status:'VALID',
        claimType:'collection.result',sourceType:'TOOL',sourceRef:p.queryId,entityRef:null,toolName:'read_collection',
        capabilityId:'collection.read',operationRefs:[],freshness:'CURRENT',createdAt:p.asOf,
        metadata:{resourceType:q.resourceType,operation:q.operation,returnedCount:p.returnedCount,totalCountKnown:p.totalCountKnown,hasMore:p.hasMore}});
    const verification=verifyV5Task({ledger,requirements:listEvidenceRequirements('collection.read'),execution:{orchestrationComplete:true,
        toolResults:[createV5ToolResult({taskId,toolName:'read_collection',status:'success',data:{queryId:p.queryId},operationRefs:[]})]}});
    if(!isVerifiedTaskResult(ledger,verification))fail();
    const handle=Object.freeze({evidenceRef,taskId,factKey:'collection.result',evidenceKind:'DIRECT_FACT',
        verificationStatus:'PASS',resourceType:q.resourceType,returnedCount:p.returnedCount});
    values.set(handle,{taskId,contextKey,ledger,verification,page:structuredClone(p)});
    return handle;
}
function getVerifiedCollection(handle,{taskId,contextKey}){
    const v=values.get(handle);
    if(!v||v.taskId!==taskId||v.contextKey!==contextKey||handle.verificationStatus!=='PASS'
        ||!isVerifiedTaskResult(v.ledger,v.verification))throw Error('COLLECTION_VERIFIED_VALUE_UNAVAILABLE');
    return structuredClone(v.page);
}
module.exports={verifyCollectionExecution,getVerifiedCollection};
