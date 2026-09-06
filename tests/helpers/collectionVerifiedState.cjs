'use strict';
// Fixture authority only. Uses the same service, evidence verification and promotion
// as runtime, never an unverified cursor seeded as certified state.
function verifiedState(db,store,ctx,query,taskId='fixture-prior-read'){
    const collection=require('../../api/services/collectionReadService.cjs').createCollectionReadService({db}).read(query);
    const result={success:true,collection,executionEvidence:{verified:true,kind:'formal_api_query',calls:[{method:'POST',path:'/api/collections/read'}]}};
    const scope={taskId,contextKey:ctx.contextKey};
    const handle=require('../../api/services/ai-v5/collectionEvidence.cjs').verifyCollectionExecution({...scope,request:query,result});
    store.setVerified(ctx,query,handle,scope);
    return {result,handle,scope};
}
module.exports={verifiedState};
