'use strict';
const {randomUUID}=require('node:crypto');
const {getConversationContext}=require('../conversationContext.cjs');
const TTL_MS=10*60*1000, MAX_CONTEXTS=128;
const fail=()=>{throw Error('COLLECTION_CONTINUATION_UNAVAILABLE');};
// One current collection per authenticated conversation, never per owner/process.
// Values and opaque handles stay in memory. Eviction/expiry never accesses business storage.
function createContinuationStore({now=Date.now}={}){
    const entries=new Map(),busy=new Set(),certified=new WeakSet();
    const key=ctx=>ctx?.version===1&&typeof ctx.contextKey==='string'&&/^[a-f0-9]{64}$/.test(ctx.contextKey)
        &&typeof ctx.conversationId==='string'?ctx.contextKey+':'+ctx.conversationId:null;
    function peek(ctx){const k=key(ctx),entry=entries.get(k);if(entry&&entry.expiresAt<=now()){entries.delete(k);return null;}return entry||null;}
    function read(ctx,token,queryId){const e=peek(ctx);if(!e||e.token!==token||e.queryId!==queryId)fail();return structuredClone(e);}
    function put(ctx,query,page,queryId=randomUUID(),verified=false){
        const k=key(ctx);if(!k)fail();
        for(const [id,e]of entries)if(e.expiresAt<=now())entries.delete(id);
        if(!entries.has(k)&&entries.size>=MAX_CONTEXTS)fail();
        const entry={query:structuredClone(query),queryId,token:randomUUID(),expiresAt:now()+TTL_MS,
            nextAfterId:page.pageBoundary.nextAfterId,hasMore:page.hasMore,
            rowIds:page.items.map(x=>x.canonicalId),resourceType:page.resourceType};
        if(verified)certified.add(entry);
        entries.set(k,Object.freeze(entry));return structuredClone(entry);
    }
    function setVerified(ctx,query,handle,scope,queryId){
        if(scope?.contextKey!==ctx?.contextKey)fail();
        const page=require('./collectionEvidence.cjs').getVerifiedCollection(handle,scope);
        const q=require('../collectionReadContract.cjs').validateRequest(query);
        if(q.operation!=='list'||page.operation!=='list'||q.resourceType!==page.resourceType
            ||q.pageSize!==page.pageSize||page.sort!=='id_desc'
            ||(q.status??null)!==page.filters.status||(q.customerName??null)!==page.filters.customerName
            ||(q.afterId??null)!==page.pageBoundary.afterId)fail();
        return put(ctx,q,page,queryId,true);
    }
    function peekCertified(ctx){
        if(!require('../conversationContext.cjs').validConversationId(ctx?.conversationId))return null;
        const e=peek(ctx);return e&&certified.has(e)?structuredClone(e):null;
    }
    function setVerifiedRelation(ctx,query,handle,scope,queryId){
        if(scope?.contextKey!==ctx?.contextKey)fail();
        const {page}=require('./investigationEvidence.cjs').getVerifiedRelation(handle,scope);
        const q=require('../relationReadContract.cjs').request(query);
        require('../relationReadContract.cjs').validateResult(q,page);
        if(['order.customer','part.facts'].includes(q.relation))fail();
        const resourceType={order:'orders',customer:'customers',part:'parts',recipe:'recipes',orderLine:'orders'}[page.resourceType];
        if(!resourceType)fail();
        return put(ctx,{kind:'relation',operation:'list',pageSize:q.pageSize,relationRequest:q},
            {...page,resourceType},queryId,true);
    }
    async function lease(ctx,fn){const k=key(ctx);if(!k)return fn();if(busy.has(k))throw Error('COLLECTION_CONVERSATION_BUSY');busy.add(k);try{return await fn();}finally{busy.delete(k);}}
    return {peek:ctx=>{const e=peek(ctx);return e?structuredClone(e):null;},read,
        set:(ctx,query,page,queryId)=>put(ctx,query,page,queryId),setVerified,setVerifiedRelation,peekCertified,
        clear:ctx=>entries.delete(key(ctx)),lease};
}
const store=createContinuationStore();
module.exports={TTL_MS,MAX_CONTEXTS,createContinuationStore,store,getConversationContext};
