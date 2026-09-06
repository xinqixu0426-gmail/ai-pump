'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Database=require('better-sqlite3');
const {createCollectionReadService}=require('../api/services/collectionReadService.cjs');
const {validateRequest}=require('../api/services/collectionReadContract.cjs');
const {createContinuationStore,TTL_MS}=require('../api/services/ai-v5/collectionContinuation.cjs');
const {verifyCollectionExecution,getVerifiedCollection}=require('../api/services/ai-v5/collectionEvidence.cjs');
const {composeCollectionAnswer}=require('../api/services/ai-v5/collectionAnswer.cjs');
const {parseIntent}=require('../api/services/ai-v5/collectionIntent.cjs');
function fixture(){
    const db=new Database(':memory:');require('../api/database/migrations.cjs').runMigrations(db);
    db.transaction(()=>{for(let n=1;n<=63;n++){
        db.prepare('INSERT INTO orders(contract_no,customer_name,status,items_json) VALUES(?,?,?,?)').run('ORD-'+n,'客户甲',n%2?'待确认':'已关闭',JSON.stringify([{recipeName:'配方甲',qty:2,unitPrice:3}]));
        db.prepare('INSERT INTO customers(name) VALUES(?)').run('客户-'+n);
        db.prepare('INSERT INTO parts(model,category) VALUES(?,?)').run('零件-'+n,'壳体');
        db.prepare('INSERT INTO recipes(name,spec) VALUES(?,?)').run('配方-'+n,'规格甲');
        db.prepare('INSERT INTO coils(scheme_name,scheme_code,spec,material,sheets) VALUES(?,?,?,?,?)').run('线圈-'+n,'C-'+n,'规格-'+n,'钢带',20);
    }})();
    return {db,service:createCollectionReadService({db})};
}
function result(page){return {success:true,collection:page,executionEvidence:{verified:true,kind:'formal_api_query',calls:[{method:'POST',path:'/api/collections/read'}]}};}
const ctx=(id,owner='a')=>({version:1,contextKey:owner.repeat(64),conversationId:'chat-'+id});
test('five-resource bounded list/count/detail, deterministic keyset, no missing or duplicate fixture rows',()=>{
    const {db,service}=fixture();try{
        for(const resourceType of ['orders','customers','parts','recipes','coils']){
            const first=service.read({resourceType,operation:'list'});assert.equal(first.items.length,20);assert.equal(first.totalCount,63);assert.equal(first.hasMore,true);
            const second=service.read({resourceType,operation:'list',afterId:first.pageBoundary.nextAfterId});
            assert.equal(second.items[0].canonicalId,'43');assert.equal(new Set([...first.items,...second.items].map(r=>r.canonicalId)).size,40);
            const detail=service.read({resourceType,operation:'detail',targetId:63});assert.equal(detail.items.length,1);
            assert.ok(Object.keys(detail.items[0].display).length>Object.keys(first.items[0].display).length);
            assert.equal(service.read({resourceType,operation:'count'}).totalCount,63);
        }
        assert.equal(service.read({resourceType:'orders',operation:'count',status:'active'}).totalCount,32);
        assert.equal(service.read({resourceType:'orders',operation:'list',customerName:'不存在'}).totalCount,0);
    }finally{db.close();}
});
test('strict schema rejects arbitrary filter, SQL, unbounded/invalid requests and coercion',()=>{
    for(const extras of [{pageSize:51},{pageSize:'10'},{pageSize:0},{pageSize:Infinity},{where:'1=1'},{sort:'arbitrary'},
        {status:'unfinished'},{operation:'detail'},{afterId:'1'},{targetId:1},{resourceType:'files'}]){
        assert.throws(()=>validateRequest({resourceType:'orders',operation:'list',...extras}));
    }
    assert.equal(validateRequest({resourceType:'orders',operation:'list'}).pageSize,20);
    assert.throws(()=>validateRequest({resourceType:'parts',operation:'list',status:'active'}));
});
test('query/owner/conversation/token isolation, TTL, opaque state and lease',async()=>{
    let time=0;const s=createContinuationStore({now:()=>time}),{db,service}=fixture();try{
        const q={resourceType:'orders',operation:'list'},p=service.read(q),a=s.set(ctx(1),q,p);
        s.set(ctx(2),{resourceType:'customers',operation:'list'},service.read({resourceType:'customers',operation:'list'}));
        assert.equal(s.read(ctx(1),a.token,a.queryId).resourceType,'orders');assert.equal(s.peek(ctx(2)).resourceType,'customers');
        for(const [c,t,id]of [[ctx(2),a.token,a.queryId],[ctx(1,'b'),a.token,a.queryId],[ctx(1),'bad',a.queryId],[ctx(1),a.token,'other']])assert.throws(()=>s.read(c,t,id));
        await s.lease(ctx(1),()=>assert.rejects(s.lease(ctx(1),async()=>{}),/BUSY/));
        time=TTL_MS;assert.throws(()=>s.read(ctx(1),a.token,a.queryId));
    }finally{db.close();}
});
test('verified field projection owns answer; wrong task/evidence/count/row identity rejected',()=>{
    const {db,service}=fixture();try{
        const request={resourceType:'orders',operation:'list'},p=service.read(request),scope={taskId:'task-a',contextKey:'ctx-a'};
        const h=verifyCollectionExecution({...scope,request,result:result(p)});
        const answer=composeCollectionAnswer(h,scope);assert.ok(answer.answerText.includes('继续'));assert.ok(!answer.answerText.includes('canonicalId'));
        assert.throws(()=>getVerifiedCollection(h,{...scope,taskId:'other'}));assert.throws(()=>getVerifiedCollection(h,{...scope,contextKey:'other'}));
        for(const alter of [p=>p.returnedCount++,p=>p.totalCount=0,p=>p.items[0].canonicalId=p.items[1].canonicalId,p=>p.items[0].display.secret='x',p=>p.sort='random',p=>p.complete=false]){
            const wrong=structuredClone(p);alter(wrong);assert.throws(()=>verifyCollectionExecution({...scope,request,result:result(wrong)}));
        }
        const empty=service.read({...request,customerName:'不存在'}),eh=verifyCollectionExecution({...scope,request:{...request,customerName:'不存在'},result:result(empty)});
        assert.ok(composeCollectionAnswer(eh,scope).answerText.includes('没有找到'));
    }finally{db.close();}
});
test('model intent source-owned reference, no model offsets, arbitrary filters or fabricated row ID',()=>{
    const ref=require('../api/services/ai-v5/sourceSpanCatalog.cjs').createV5SourceSpanCatalog('看看ORD-1详情').spans.find(s=>s.text==='ORD-1').spanRef;
    const base={version:1,routeRef:'orders.detail',filterClass:'NONE',status:null,customerSpanRef:null,detailSpanRef:ref,topN:null,confidence:'high'};
    assert.equal(parseIntent(JSON.stringify(base),'看看ORD-1详情',null).identity,'ORD-1');
    assert.throws(()=>parseIntent(JSON.stringify({...base,canonicalId:1}),'看看ORD-1详情',null));
    assert.throws(()=>parseIntent(JSON.stringify({...base,detailSpanRef:{start:0,end:99}}),'看看ORD-1详情',null));
    assert.throws(()=>parseIntent(JSON.stringify({...base,operation:'continue',identitySpan:null}),'继续',null));
});
module.exports={fixture,result,ctx};
