'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {collectionFixture}=require('./helpers/collectionFixture.cjs');
const {createCollectionReadService}=require('../api/services/collectionReadService.cjs');
const {projectCollectionDetail,PROJECTIONS,MAX_DETAIL_BYTES,MAX_NESTED_ITEMS}=require('../api/services/collectionDetailProjection.cjs');
const line={recipeName:'fixture-product',qty:2,unitPrice:3};
test('all five projectors discard unknown source fields; explicit nested contract and unchanged caps',()=>{
    const db=collectionFixture();try{
        const service=createCollectionReadService({db});
        for(const resourceType of Object.keys(PROJECTIONS)){
            const p=service.read({resourceType,operation:'detail',targetId:63});
            const source={...p.items[0].display,secretSnapshot:'private-snapshot'.repeat(2000)};
            if(source.lines)source.lines=JSON.stringify(source.lines);
            assert.deepEqual(projectCollectionDetail(resourceType,source),p.items[0].display);
        }
        assert.equal(MAX_DETAIL_BYTES,8192);assert.equal(MAX_NESTED_ITEMS,50);
        assert.equal(require('../api/services/collectionReadContract.cjs').MAX_RESULT_BYTES,256*1024);
    }finally{db.close();}
});
test('large raw snapshot is projected inside HTTP Business API before transport',async()=>{
    const db=collectionFixture(),app=require('express')();
    const raw=JSON.stringify([{...line,configurationSnapshot:'PRIVATE_SNAPSHOT'.repeat(2000),costSnapshot:{internal:999}}]);
    assert.ok(Buffer.byteLength(raw)>8192);
    // Isolated fixture preparation only.
    db.prepare('UPDATE orders SET items_json=? WHERE id=63').run(raw);
    app.use(require('express').json());app.use('/api/collections',require('../api/routes/collectionRead.cjs').createCollectionReadRouter({db}));
    const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
    try{
        const request={resourceType:'orders',operation:'detail',targetId:63};
        const response=await fetch(`http://127.0.0.1:${server.address().port}/api/collections/read`,{
            method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request),
        });
        assert.equal(response.status,200);
        const body=await response.json();
        const result={success:body.success,collection:body.data};
        assert.equal(result.success,true);
        const wire=JSON.stringify(result);assert.ok(!wire.includes('PRIVATE_SNAPSHOT'));assert.ok(!wire.includes('costSnapshot'));assert.ok(!wire.includes('items_json'));
        assert.deepEqual(result.collection.items[0].display.lines,[line]);
        assert.ok(Buffer.byteLength(JSON.stringify(result.collection.items[0].display))<8192);
    }finally{await new Promise(r=>server.close(r));db.close();}
});
test('genuinely oversized approved projection, nested overflow, malformed and invalid numeric source fail closed with safe errors',()=>{
    const base={name:'fixture',customerName:'fixture',status:'待确认',createdAt:'fixture',remark:''};
    const oversized=Array.from({length:50},()=>({...line,recipeName:'界'.repeat(160)}));
    assert.ok(Buffer.byteLength(JSON.stringify({...base,lines:oversized}))>8192);
    for(const lines of [oversized,Array.from({length:51},()=>line),[null],[{...line,qty:'2'}],[{...line,unitPrice:null}]]){
        assert.throws(()=>projectCollectionDetail('orders',{...base,lines:JSON.stringify(lines)}),e=>/^COLLECTION_/.test(e.message)&&!e.message.includes('fixture'));
    }
    assert.throws(()=>projectCollectionDetail('orders',{...base,lines:'invalid-private'}),/COLLECTION_PROJECTION_INVALID/);
    const db=collectionFixture();try{
        db.prepare('UPDATE orders SET items_json=? WHERE id=63').run(JSON.stringify(oversized));
        let answerCalls=0;
        assert.throws(()=>{createCollectionReadService({db}).read({resourceType:'orders',operation:'detail',targetId:63});answerCalls++;},/COLLECTION_DETAIL_OVERSIZED/);
        assert.equal(answerCalls,0);
    }finally{db.close();}
});
