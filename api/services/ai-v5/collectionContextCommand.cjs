'use strict';
// Closed control-language grammar only: no domain/entity/business filters or substring scanning.
// Anchoring rejects added clauses, including mixed read/write utterances. Risk runs first.
function contextCommand(source,active){
    if(typeof source!=='string')return null;
    const text=source.trim();
    const next=/^(?:请)?(?:(?:继续|下一页)|(?:再看后([1-9][0-9]?)条)|(?:剩下的呢))[。！!?？]?$/u.exec(text);
    const ordinal=/^(?:请)?(?:看看|查看|看)?第([1-9][0-9]?)(?:个|条)(?:的详情|的详细信息)?[。！!?？]?$/u.exec(text);
    if(!next&&!ordinal)return null;
    if(!active||!['orders','customers','parts','recipes','coils'].includes(active.resourceType))throw Error('COLLECTION_CONTEXT_UNAVAILABLE');
    if(next&&next[1]&&Number(next[1])!==(active.query?.pageSize||20))throw Error('COLLECTION_CONTINUATION_CONTRACT_MISMATCH');
    if(ordinal&&Number(ordinal[1])>50)throw Error('COLLECTION_REFERENCE_UNAVAILABLE');
    return Object.freeze({version:1,contractValid:true,confidence:'high',resourceType:active.resourceType,
        operation:next?'continue':'ordinal',filterClass:'FROZEN',detailReferenceMode:next?'NONE':'CURRENT_PAGE_ORDINAL',
        continuationMode:next?'FROZEN_QUERY':'NONE',...(ordinal?{ordinal:Number(ordinal[1])}:{}),modelCalls:0});
}
module.exports={contextCommand};
