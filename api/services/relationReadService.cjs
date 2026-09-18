'use strict';
const {randomUUID}=require('node:crypto');
const C=require('./relationReadContract.cjs');
const {LOW_STOCK_MAX}=require('./partQueries.cjs');
// Business-service authority only. No caller-provided SQL, table, column or predicate.
const ROOT_SQL={
 customer:'SELECT id,name FROM customers WHERE id=? AND deleted_at IS NULL',
 order:'SELECT id,contract_no AS name,customer_id AS customerId,customer_name AS customerName,items_json AS lines FROM orders WHERE id=? AND deleted_at IS NULL',
 recipe:'SELECT id,name,parts_json AS partsJson FROM recipes WHERE id=? AND deleted_at IS NULL',
 part:'SELECT id,model AS name,supplier,stock,price FROM parts WHERE id=? AND deleted_at IS NULL',
};
function createRelationReadService({db}){
 const one=(rows)=>{if(!rows.length)C.fail('RELATION_NOT_FOUND');if(rows.length!==1)C.fail('RELATION_AMBIGUOUS');return rows[0];};
 const ref=(type,row)=>({resourceType:type,canonicalId:String(row.id)});
 const item=(type,row,fields={})=>({canonicalId:String(row.id),display:{name:C.text(row.name),...fields},resourceType:type});
 function parsed(raw){let rows;try{rows=JSON.parse(raw||'[]');}catch{C.fail('RELATION_SOURCE_INVALID');}
  if(!Array.isArray(rows))C.fail('RELATION_SOURCE_INVALID');if(rows.length>C.NESTED_LIMIT)C.fail('RELATION_NESTED_BOUND');
  if(rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))C.fail('RELATION_SOURCE_INVALID');return rows;
 }
 function partFor(line){
  if(line.name==='线圈转子')return null; // Existing non-part role, never relabel a coil as a part.
  const model=C.text(line.model),supplier=line.supplier;
  if(supplier!==undefined&&typeof supplier!=='string')C.fail('RELATION_SOURCE_INVALID');
  let candidates;
  if(line.partId!==undefined){
   if(!Number.isSafeInteger(line.partId)||line.partId<1)C.fail('RELATION_SOURCE_INVALID');
   candidates=db.prepare('SELECT id,model AS name,supplier FROM parts WHERE id=? AND deleted_at IS NULL').all(line.partId);
   const p=one(candidates);
   if(p.name!==model||(supplier!==undefined&&(p.supplier||'')!==supplier))C.fail('RELATION_REFERENCE_CONFLICT');return p;
  }
  candidates=supplier===undefined
   ?db.prepare('SELECT id,model AS name,supplier FROM parts WHERE model=? AND deleted_at IS NULL ORDER BY id LIMIT 2').all(model)
   :db.prepare("SELECT id,model AS name,supplier FROM parts WHERE model=? AND COALESCE(supplier,'')=? AND deleted_at IS NULL ORDER BY id LIMIT 2").all(model,supplier);
  return one(candidates);
 }
 function read(input){
  const q=C.request(input),contract=C.RELATIONS[q.relation];
  return db.transaction(()=>{
   const root=contract.root?db.prepare(ROOT_SQL[contract.root]).get(q.rootId):null;
   if(contract.root&&!root)C.fail('RELATION_NOT_FOUND');
   let rows=[],total=0,excludedNonPartCount=0,referenceResolution;
   const params={rootId:q.rootId,afterId:q.afterId??null,limit:q.pageSize+1};
   if(q.relation==='customer.orders'){
    const duplicates=db.prepare('SELECT id FROM customers WHERE name=? AND deleted_at IS NULL LIMIT 2').all(root.name);
    const legacy=db.prepare('SELECT id FROM orders WHERE COALESCE(customer_id,0)=0 AND customer_name=? AND deleted_at IS NULL LIMIT 1').get(root.name);
    if(legacy&&duplicates.length!==1)C.fail('RELATION_AMBIGUOUS');
    const where="deleted_at IS NULL AND (customer_id=:rootId OR (COALESCE(customer_id,0)=0 AND customer_name=:name))";
    total=db.prepare('SELECT COUNT(*) AS n FROM orders WHERE '+where).get({...params,name:root.name}).n;
    rows=db.prepare('SELECT id,contract_no AS name,status FROM orders WHERE '+where+' AND (:afterId IS NULL OR id<:afterId) ORDER BY id DESC LIMIT :limit').all({...params,name:root.name}).map(r=>item('order',r,{status:C.text(r.status)}));
   }else if(q.relation==='order.customer'){
    const customer=root.customerId
     ?one(db.prepare('SELECT id,name FROM customers WHERE id=? AND deleted_at IS NULL').all(root.customerId))
     :one(db.prepare('SELECT id,name FROM customers WHERE name=? AND deleted_at IS NULL ORDER BY id LIMIT 2').all(C.text(root.customerName)));
    rows=[item('customer',customer)];total=1;
   }else if(q.relation==='order.lines'){
    const lines=parsed(root.lines);total=lines.length;
    rows=lines.map((line,i)=>({canonicalId:String(i+1),resourceType:'orderLine',display:{name:C.text(line.recipeName),qty:C.scalar(line.qty),unitPrice:C.scalar(line.unitPrice)}})).reverse()
     .filter(r=>q.afterId===undefined||Number(r.canonicalId)<q.afterId).slice(0,q.pageSize+1);
   }else if(q.relation==='recipe.parts'){
    const parts=new Map(),lines=parsed(root.partsJson),missing=[];let resolvedReferences=0;
    for(const [index,line] of lines.entries()){
     try{const p=partFor(line);if(p){parts.set(p.id,p);resolvedReferences++;}else excludedNonPartCount++;}
     catch(error){
      // Only an authoritative exact absence is a reportable missing reference.
      // Ambiguity, conflicting IDs, invalid snapshots and technical errors still stop the read.
      if(error.code!=='RELATION_NOT_FOUND')throw error;
      missing.push({sourceOrdinal:index+1,model:C.text(line.model),supplier:line.supplier===undefined?null:C.text(line.supplier,true),status:'NOT_FOUND'});
     }
    }
    referenceResolution={version:1,allResolved:missing.length===0,sourceReferenceCount:lines.length,resolvedReferenceCount:resolvedReferences,missing};
    total=parts.size;rows=[...parts.values()].sort((a,b)=>b.id-a.id).filter(r=>q.afterId===undefined||r.id<q.afterId).slice(0,q.pageSize+1).map(r=>item('part',r,{supplier:C.text(r.supplier,true)}));
   }else if(q.relation==='part.recipes'){
    // Candidate SQL filters exact saved references before bounded authority validation.
    // A scan overflow is unavailable, never a silently incomplete relation count.
    const candidates=db.prepare(`SELECT id,name,parts_json AS partsJson FROM recipes r WHERE deleted_at IS NULL AND EXISTS
     (SELECT 1 FROM json_each(CASE WHEN json_valid(r.parts_json) THEN r.parts_json ELSE '[]' END) j
      WHERE json_extract(j.value,'$.model')=:model OR json_extract(j.value,'$.partId')=:rootId)
     ORDER BY id DESC LIMIT :scan`).all({model:root.name,rootId:root.id,scan:C.SCAN_LIMIT+1});
    // Malformed snapshots cannot be interpreted as an authoritative absence.
    if(db.prepare("SELECT id FROM recipes WHERE deleted_at IS NULL AND CASE WHEN json_valid(parts_json) THEN json_type(parts_json)!='array' ELSE 1 END LIMIT 1").get())C.fail('RELATION_SOURCE_INVALID');
    if(candidates.length>C.SCAN_LIMIT)C.fail('RELATION_SCAN_BOUND');
    const matched=[];
    for(const recipe of candidates){
     let found=false;
     for(const line of parsed(recipe.partsJson)){
      if(line.model!==root.name&&line.partId!==root.id)continue;
      const p=partFor(line);if(p?.id===root.id)found=true;
     }
     if(found)matched.push(recipe);
    }
    total=matched.length;rows=matched.filter(r=>q.afterId===undefined||r.id<q.afterId).slice(0,q.pageSize+1).map(r=>item('recipe',r));
   }else if(q.relation==='parts.stock'){
    const predicates={low:'COALESCE(stock,0)>0 AND COALESCE(stock,0)<=:threshold',out:'COALESCE(stock,0)<=0',attention:'COALESCE(stock,0)<=:threshold',ok:'COALESCE(stock,0)>:threshold'};
    const where='deleted_at IS NULL AND '+predicates[q.stockStatus],p={...params,threshold:LOW_STOCK_MAX};
    total=db.prepare('SELECT COUNT(*) AS n FROM parts WHERE '+where).get(p).n;
    rows=db.prepare('SELECT id,model AS name,COALESCE(stock,0) AS stock FROM parts WHERE '+where+' AND (:afterId IS NULL OR id<:afterId) ORDER BY id DESC LIMIT :limit').all(p).map(r=>item('part',r,{stock:C.scalar(r.stock)}));
   }else if(q.relation==='part.facts'){
    rows=[item('part',root,{stock:C.scalar(root.stock),price:C.scalar(root.price)})];total=1;
   }
   const hasMore=rows.length>q.pageSize,items=rows.slice(0,q.pageSize);
   const result={version:1,relation:q.relation,root:root?ref(contract.root,root):null,semantics:contract.semantics,
    queryId:randomUUID(),resourceType:contract.result,sort:'id_desc',pageSize:q.pageSize,returnedCount:items.length,totalCount:total,totalCountKnown:true,hasMore,items,
    pageBoundary:{afterId:q.afterId??null,nextAfterId:hasMore?Number(items.at(-1).canonicalId):null},
    filters:{stockStatus:q.stockStatus??null},excludedNonPartCount,...(referenceResolution?{referenceResolution}:{}),complete:true,consistency:'READ_TRANSACTION_PER_PAGE',asOf:new Date().toISOString(),
    provenance:{sourceApi:'/api/relations/read',capabilityId:'relations.read',access:'query'},
    units:q.relation==='part.facts'?{stock:'CATALOG_QUANTITY_UNIT',price:'CNY_PER_CATALOG_QUANTITY_UNIT'}:q.relation==='parts.stock'?{stock:'CATALOG_QUANTITY_UNIT'}:{}};
   if(Buffer.byteLength(JSON.stringify(result))>=C.MAX_RESULT_BYTES)C.fail('RELATION_PAYLOAD_BOUND');
   return C.validateResult(q,result);
  })();
 }
 return {read};
}
module.exports={createRelationReadService};
