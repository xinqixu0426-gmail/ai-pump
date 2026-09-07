'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('P16-M audit: bounded collections lack inventory and reverse-BOM filter contracts',()=>{
 const {validateRequest}=require('../api/services/collectionReadContract.cjs');
 assert.throws(()=>validateRequest({resourceType:'parts',operation:'list',stockStatus:'attention'}),/COLLECTION_REQUEST_INVALID/);
 assert.throws(()=>validateRequest({resourceType:'recipes',operation:'list',partId:1}),/COLLECTION_REQUEST_INVALID/);
});
test('P16-M audit: existing bounded order name relation and lines work, but downstream canonical references are not projected',()=>{
 const db=require('./helpers/collectionFixture.cjs').collectionFixture();
 try{
  const read=require('../api/services/collectionReadService.cjs').createCollectionReadService({db}).read;
  const page=read({resourceType:'orders',operation:'list',customerName:'客户甲',pageSize:20});
  assert.equal(page.returnedCount,20);assert.equal(page.totalCount,63);assert.equal(page.hasMore,true);
  const next=read({resourceType:'orders',operation:'list',customerName:'客户甲',afterId:page.pageBoundary.nextAfterId});
  assert.equal(next.filters.customerName,page.filters.customerName);
  const detail=read({resourceType:'orders',operation:'detail',targetId:63}).items[0].display;
  assert.equal(Object.hasOwn(detail,'customerId'),false);
  assert.deepEqual(Object.keys(detail.lines[0]).sort(),['qty','recipeName','unitPrice']);
  const recipe=read({resourceType:'recipes',operation:'detail',targetId:63}).items[0].display;
  assert.equal(Object.hasOwn(recipe,'parts'),false);assert.equal(Object.hasOwn(recipe,'partsJson'),false);
 }finally{db.close();}
});
test('P16-M audit: legacy part filter semantics exist but service consumes full supplied catalog and exposes no continuation',()=>{
 const {listParts}=require('../api/services/partQueries.cjs');let visits=0;
 const rows=Array.from({length:80},(_,i)=>({id:i+1,model:'fixture',get stock(){visits++;return 1;},price:1}));
 const page=listParts(rows,{stockStatus:'attention',limit:20});
 assert.equal(page.length,20);assert.ok(visits>=80);assert.equal(Object.hasOwn(page,'hasMore'),false);
});
test('P16-M audit: recipe inventory fallback selects a first model match rather than preserving ambiguity',()=>{
 const db=require('./helpers/collectionFixture.cjs').collectionFixture();
 try{
  const first=db.prepare('INSERT INTO parts(model,supplier,stock) VALUES(?,?,?)').run('fixture-duplicate','A',1).lastInsertRowid;
  db.prepare('INSERT INTO parts(model,supplier,stock) VALUES(?,?,?)').run('fixture-duplicate','B',2);
  db.prepare('UPDATE recipes SET parts_json=? WHERE id=1').run(JSON.stringify([{name:'fixture-part',model:'fixture-duplicate',supplier:'missing'}]));
  const stub=()=>[],queries=require('../api/services/recipeQueries.cjs').createRecipeQueries({db,listCoils:stub,listParts:stub,listRecipes:stub,modelVariantRow:x=>x,recipeRow:x=>x,templateRow:x=>x});
  const result=queries.getInventoryStatus(1);assert.equal(result.items[0].partId,Number(first));
 }finally{db.close();}
});
