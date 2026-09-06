'use strict';
const {selectCollectionIntent}=require('./collectionIntent.cjs');
const {store,getConversationContext}=require('./collectionContinuation.cjs');
const {verifyCollectionExecution,getVerifiedCollection}=require('./collectionEvidence.cjs');
const {composeCollectionAnswer}=require('./collectionAnswer.cjs');
const obs=require('../observability.cjs');
async function tryCollectionRead(input,{taskId,risk,controlIntent=null,options={}}){
    const ctx=getConversationContext(),stateStore=options.continuationStore||store;
    if(!ctx||input.factKey!==undefined)return null;
    const active=stateStore.peek(ctx);
    const intent=controlIntent||await selectCollectionIntent(input.sourceRequest,active,{env:options.env,
        modelRequest:options.collectionModelRequest,shadowTaskId:taskId,
        observeModelCall:(m,fn)=>obs.withModelSpan({...m,stage:'collection_intent'},fn)});
    if(intent.operation==='NONE'){
        stateStore.clear(ctx);
        if(risk.contextual===true||input.collectionOnly)throw Error('COLLECTION_NOT_APPLICABLE');
        return null;
    }
    require('./collectionAdmission.cjs').assertCollectionAdmission(risk,intent);
    let request,queryId;
    if(['continue','ordinal'].includes(intent.operation)){
        const current=stateStore.read(ctx,active?.token,active?.queryId);queryId=current.queryId;
        if(intent.operation==='continue'){
            if(!current.hasMore)throw Error('COLLECTION_END_REACHED');
            if(intent.pageSize!==undefined&&intent.pageSize!==(current.query.pageSize||20))throw Error('COLLECTION_CONTINUATION_CONTRACT_MISMATCH');
            request={...current.query,afterId:current.nextAfterId};
        }else{
            const id=current.rowIds[intent.ordinal-1];if(!id)throw Error('COLLECTION_REFERENCE_UNAVAILABLE');
            const target=require('./collectionDetailTarget.cjs').createDetailTarget(current.resourceType,id,'verified_current_page');
            request={operation:'detail',resourceType:target.resourceType,targetId:Number(target.canonicalEntityRef)};
        }
    }else {
        stateStore.clear(ctx);
        if(intent.operation==='detail'){
            const target=await require('./collectionDetailTarget.cjs').bindCollectionDetail(intent,options.collectionLookupOptions);
            request={operation:'detail',resourceType:target.resourceType,targetId:Number(target.canonicalEntityRef)};
        }else request=require('./collectionSemanticContract.cjs').executionQuery(intent);
    }
    if(input.signal?.aborted)throw Error('COLLECTION_REQUEST_CLOSED');
    const capability=require('./capabilityRegistry.cjs').getV5Capability('collection.read');
    if(capability?.readWriteClass!=='READ'||capability.allowedTools.length!==1||capability.allowedTools[0]!=='read_collection')throw Error('COLLECTION_CAPABILITY_UNAVAILABLE');
    const started=performance.now();
    const result=await (options.collectionExecute||require('../../routes/ai/executor.cjs').executeToolCall)('read_collection',request,{signal:input.signal});
    const apiMs=performance.now()-started;
    if(input.signal?.aborted)throw Error('COLLECTION_REQUEST_CLOSED');
    const handle=obs.withReadAnswerValidationSpan({taskId,factCount:1},()=>verifyCollectionExecution({taskId,contextKey:ctx.contextKey,request,result}));
    const scope={taskId,contextKey:ctx.contextKey},page=getVerifiedCollection(handle,scope);
    const draft=composeCollectionAnswer(handle,scope);
    if(input.signal?.aborted)throw Error('COLLECTION_REQUEST_CLOSED');
    // Commit continuation only for a validated delivered page. Same-conversation requests are leased.
    if(page.operation==='list')stateStore.setVerified(ctx,request,handle,scope,queryId);
    const delivered=input.deliver(draft.answerText)===true;
    if(!delivered)stateStore.clear(ctx);
    return {attempted:true,eligible:true,validationPass:true,delivered,exposed:delivered,failureClass:delivered?'NONE':'REQUEST_CLOSED',
        readExecution:'SUCCESS',resultEquivalence:'MATCH',evidenceVerification:'PASS',toolCalls:1,
        modelCalls:0,numericValid:true,entityValid:true,contractValid:true,evidenceRefsValid:true,groundingValid:true,
        requiredFactCoverage:true,unsupportedClaimCount:0,internalLeakageCount:0,
        collectionType:page.resourceType,collectionOperation:page.operation,continuation:intent.operation==='continue',
        detailTargetBinding:intent.operation==='detail'?'GOVERNED_LOOKUP':intent.operation==='ordinal'?'VERIFIED_CURRENT_PAGE':'NONE',
        filterContractReused:intent.operation==='continue',filterReclassificationCalls:0,
        semanticContractVersion:intent.version,semanticModelCalls:intent.modelCalls,semanticDurationMs:intent.durationMs,
        pageSize:page.pageSize,returnedCount:page.returnedCount,totalKnown:page.totalCountKnown,hasMore:page.hasMore,
        collectionApiMs:apiMs,resultBytes:Buffer.byteLength(JSON.stringify(page))};
}
module.exports={tryCollectionRead};
