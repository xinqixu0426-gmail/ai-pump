'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {collectionFixture}=require('./helpers/collectionFixture.cjs');
function fixture(){
 const db=collectionFixture();
 db.prepare('UPDATE customers SET name=? WHERE id=1').run('客户甲');
 db.prepare('UPDATE parts SET price=3,stock=2,supplier=?').run('供应甲');
 db.prepare('UPDATE recipes SET parts_json=?').run(JSON.stringify([{name:'配件',model:'零件-1',supplier:'供应甲'}]));
 return {db,read:require('../api/services/relationReadService.cjs').createRelationReadService({db}).read};
}
const q=(relation,extra={})=>({version:1,relation,...(relation==='parts.stock'?{}:{rootId:1}),...extra});
test('relation API: closed requests and authoritative bounded pages for all seven relations',()=>{
 const {db,read}=fixture();try{
  for(const relation of ['customer.orders','order.customer','order.lines','recipe.parts','part.recipes','part.facts']){
   const r=read(q(relation));assert.ok(r.returnedCount>0);assert.ok(r.returnedCount<=20);assert.equal(r.complete,true);
   assert.equal(JSON.stringify(r).includes('partsJson'),false);assert.equal(JSON.stringify(r).includes('items_json'),false);
  }
  for(const relation of ['customer.orders','part.recipes','parts.stock']){
   const extra=relation==='parts.stock'?{stockStatus:'attention'}:{};
   const a=read(q(relation,extra)),b=read(q(relation,{...extra,afterId:a.pageBoundary.nextAfterId}));
   assert.equal(a.totalCount,63);assert.equal(a.returnedCount,20);assert.equal(a.hasMore,true);
   assert.equal(b.totalCount,63);assert.equal(b.items[0].canonicalId,'43');
   assert.equal(new Set([...a.items,...b.items].map(r=>r.canonicalId)).size,40);
  }
  assert.throws(()=>read(q('part.facts',{sql:'DELETE'})),/REQUEST_INVALID/);
  assert.throws(()=>read(q('part.facts',{pageSize:51})),/REQUEST_INVALID/);
  assert.throws(()=>read(q('parts.stock',{stockStatus:'arbitrary'})),/REQUEST_INVALID/);
 }finally{db.close();}
});
test('customer relation: canonical ID wins; duplicate legacy name stays ambiguous; stale ID never falls back',()=>{
 const {db,read}=fixture();try{
  db.pragma('foreign_keys=OFF'); // Corrupt legacy reference scenarios are isolated, never production mutations.
  db.prepare('UPDATE orders SET customer_id=2 WHERE id=1').run();
  assert.equal(read(q('order.customer')).items[0].canonicalId,'2');
  assert.equal(read(q('customer.orders')).totalCount,62);
  // Legacy/import corruption fixture only: current production schema forbids duplicate names.
  db.exec('ALTER TABLE customers RENAME TO unique_customers; CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT,deleted_at TEXT); INSERT INTO customers SELECT id,name,deleted_at FROM unique_customers');
  db.prepare('INSERT INTO customers(name) VALUES(?)').run('客户甲');
  assert.throws(()=>read(q('customer.orders')),/AMBIGUOUS/);
  assert.throws(()=>read(q('order.customer',{rootId:2})),/AMBIGUOUS/);
  db.prepare('UPDATE orders SET customer_id=99999 WHERE id=1').run();
  assert.throws(()=>read(q('order.customer')),/NOT_FOUND/);
 }finally{db.close();}
});
test('BOM references: no supplier fallback, no first match, exact ID conflict rejects, coil role excluded',()=>{
 const {db,read}=fixture();try{
  const set=line=>db.prepare('UPDATE recipes SET parts_json=? WHERE id=1').run(JSON.stringify([line]));
  set({model:'零件-1',supplier:'missing'});const absent=read(q('recipe.parts'));
  assert.equal(absent.items.length,0);assert.equal(absent.referenceResolution.allResolved,false);
  assert.deepEqual(absent.referenceResolution.missing,[{sourceOrdinal:1,model:'零件-1',supplier:'missing',status:'NOT_FOUND'}]);
  db.prepare('INSERT INTO parts(model,supplier) VALUES(?,?)').run('零件-1','其他');
  set({model:'零件-1'});assert.throws(()=>read(q('recipe.parts')),/AMBIGUOUS/);
  set({partId:1,model:'零件-2'});assert.throws(()=>read(q('recipe.parts')),/REFERENCE_CONFLICT/);
  set({name:'线圈转子',model:'not-a-part'});const r=read(q('recipe.parts'));assert.equal(r.totalCount,0);assert.equal(r.excludedNonPartCount,1);
 }finally{db.close();}
});

test('saved BOM missing references stay separate from canonical rows, counts and continuation',()=>{
 const {db,read}=fixture();try{
  const lines=[{model:'零件-1',supplier:'其他供应商'},...Array.from({length:23},(_,i)=>({model:'零件-'+(i+1),supplier:'供应甲'})),{model:'零件-1',supplier:'供应甲'}];
  db.prepare('UPDATE recipes SET parts_json=? WHERE id=1').run(JSON.stringify(lines));
  const before=db.prepare('SELECT total_changes() AS n').get().n;
  const a=read(q('recipe.parts')),b=read(q('recipe.parts',{afterId:a.pageBoundary.nextAfterId}));
  assert.equal(a.totalCount,23);assert.equal(a.referenceResolution.resolvedReferenceCount,24);
  assert.equal(a.referenceResolution.sourceReferenceCount,25);assert.equal(a.referenceResolution.allResolved,false);
  assert.equal(a.items.length,20);assert.equal(b.items.length,3);
  assert.deepEqual(a.referenceResolution,b.referenceResolution);
  assert.equal(new Set([...a.items,...b.items].map(r=>r.canonicalId)).size,23);
  assert.equal(a.items.some(r=>r.display.supplier==='其他供应商'),false);
  const C=require('../api/services/relationReadContract.cjs');
  for(const mutate of [p=>p.referenceResolution.allResolved=true,p=>p.referenceResolution.missing[0].canonicalId='1',
   p=>p.referenceResolution.missing[0].price=3,p=>p.referenceResolution.missing[0].status='VERIFIED',
   p=>p.referenceResolution.missing[0].sourceOrdinal=0,p=>p.referenceResolution.resolvedReferenceCount++,
   p=>delete p.referenceResolution]){
   const tampered=structuredClone(a);mutate(tampered);assert.throws(()=>C.validateResult(q('recipe.parts'),tampered),/EVIDENCE_INVALID/);
  }
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n,before);
 }finally{db.close();}
});

test('missing IDs never fall back; malformed and technical failures never become missing-reference answers',()=>{
 const {db,read}=fixture();try{
  db.prepare('UPDATE recipes SET parts_json=? WHERE id=1').run(JSON.stringify([{partId:999999,model:'零件-1',supplier:'供应甲'}]));
  const r=read(q('recipe.parts'));assert.equal(r.items.length,0);assert.equal(r.referenceResolution.missing.length,1);
  db.prepare('UPDATE recipes SET parts_json=? WHERE id=1').run('invalid');assert.throws(()=>read(q('recipe.parts')),/SOURCE_INVALID/);
  db.prepare('UPDATE recipes SET parts_json=? WHERE id=1').run(JSON.stringify([{model:'零件-1',supplier:'供应甲'}]));
  db.exec('ALTER TABLE parts RENAME TO unavailable_parts');assert.throws(()=>read(q('recipe.parts')),/no such table/);
 }finally{db.close();}
});
test('projection and work bounds: snapshots excluded, nested overflow and reverse scan overflow fail closed',()=>{
 const {db,read}=fixture();try{
  const line={recipeName:'配方甲',qty:2,unitPrice:3,snapshot:'x'.repeat(12000)};
  db.prepare('UPDATE orders SET items_json=? WHERE id=1').run(JSON.stringify([line]));
  const result=read(q('order.lines'));assert.ok(Buffer.byteLength(JSON.stringify(result))<2000);assert.equal(JSON.stringify(result).includes('snapshot'),false);
  db.prepare('UPDATE orders SET items_json=? WHERE id=1').run(JSON.stringify(Array(51).fill(line)));
  assert.throws(()=>read(q('order.lines')),/NESTED_BOUND/);
  db.transaction(()=>{for(let i=0;i<451;i++)db.prepare('INSERT INTO recipes(name,parts_json) VALUES(?,?)').run('额外配方',JSON.stringify([{model:'零件-1',supplier:'供应甲'}]));})();
  assert.throws(()=>read(q('part.recipes')),/SCAN_BOUND/);
 }finally{db.close();}
});
test('stock threshold is formal, empty is valid, read operations do not mutate fixture',()=>{
 const {db,read}=fixture();try{
  const before=db.prepare('SELECT total_changes() AS n').get().n;
  assert.equal(read(q('parts.stock',{stockStatus:'out'})).totalCount,0);
  assert.equal(read(q('parts.stock',{stockStatus:'low'})).totalCount,63);
  assert.deepEqual(read(q('part.facts')).items[0].display,{name:'零件-1',stock:2,price:3});
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n,before);
 }finally{db.close();}
});
