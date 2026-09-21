'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Database=require('better-sqlite3');
const {createCollectionReadService}=require('../api/services/collectionReadService.cjs');
const {validateRequest}=require('../api/services/collectionReadContract.cjs');
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
