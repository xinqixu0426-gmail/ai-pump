'use strict';
const {DEFAULT_PAGE_SIZE,MAX_PAGE_SIZE,MAX_RESULT_BYTES}=require('./collectionReadContract.cjs');
const RELATIONS=Object.freeze({
 'customer.orders':{root:'customer',result:'order',semantics:'CUSTOMER_ID_OR_UNIQUE_LEGACY_NAME'},
 'order.customer':{root:'order',result:'customer',semantics:'CUSTOMER_ID_OR_UNIQUE_LEGACY_NAME'},
 'order.lines':{root:'order',result:'orderLine',semantics:'SAVED_ORDER_LINES_NOT_CURRENT_PRODUCTS'},
 'recipe.parts':{root:'recipe',result:'part',semantics:'SAVED_BOM_PART_REFERENCES'},
 'part.recipes':{root:'part',result:'recipe',semantics:'SAVED_BOM_PART_REFERENCES'},
 'parts.stock':{root:null,result:'part',semantics:'CURRENT_CATALOG_STOCK'},
 'part.facts':{root:'part',result:'part',semantics:'CURRENT_STOCK_AND_CATALOG_UNIT_PRICE'},
});
for(const v of Object.values(RELATIONS))Object.freeze(v);
const SCAN_LIMIT=512,NESTED_LIMIT=50;
const TOOL_SCHEMA={type:'object',additionalProperties:false,required:['version','relation'],properties:{
 version:{type:'integer',enum:[1]},relation:{type:'string',enum:Object.keys(RELATIONS)},
 rootId:{type:'integer',minimum:1},pageSize:{type:'integer',minimum:1,maximum:MAX_PAGE_SIZE},
 afterId:{type:'integer',minimum:1},stockStatus:{type:'string',enum:['low','out','attention','ok']}}};
function fail(code){const e=Error(code);e.code=code;e.statusCode=code==='RELATION_NOT_FOUND'?404:code==='RELATION_AMBIGUOUS'?409:400;throw e;}
function request(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['version','relation','rootId','pageSize','afterId','stockStatus'].includes(k))
  ||input.version!==1||!Object.hasOwn(RELATIONS,input.relation))fail('RELATION_REQUEST_INVALID');
 const c=RELATIONS[input.relation];
 if(c.root?(!Number.isSafeInteger(input.rootId)||input.rootId<1):input.rootId!==undefined)fail('RELATION_REQUEST_INVALID');
 for(const k of ['pageSize','afterId'])if(input[k]!==undefined&&(!Number.isSafeInteger(input[k])||input[k]<1))fail('RELATION_REQUEST_INVALID');
 if(input.pageSize>MAX_PAGE_SIZE||input.afterId!==undefined&&['order.customer','part.facts'].includes(input.relation))fail('RELATION_REQUEST_INVALID');
 if(input.relation==='parts.stock'?!['low','out','attention','ok'].includes(input.stockStatus):input.stockStatus!==undefined)fail('RELATION_REQUEST_INVALID');
 return Object.freeze({...input,pageSize:input.pageSize??DEFAULT_PAGE_SIZE});
}
function scalar(v){if(typeof v!=='number'||!Number.isFinite(v))fail('RELATION_VALUE_INVALID');return v;}
function text(v,optional=false){if(optional&&(v==null||v===''))return '';if(typeof v!=='string'||!v.length||v.length>160)fail('RELATION_VALUE_INVALID');return v;}
function validateResult(input,p){
 const q=request(input),c=RELATIONS[q.relation],bad=()=>fail('RELATION_EVIDENCE_INVALID');
 if(!p||p.version!==1||p.relation!==q.relation||p.semantics!==c.semantics||p.resourceType!==c.result
  ||p.complete!==true||p.consistency!=='READ_TRANSACTION_PER_PAGE'||p.sort!=='id_desc'||p.pageSize!==q.pageSize
  ||typeof p.queryId!=='string'||!p.queryId||!Number.isFinite(Date.parse(p.asOf))
  ||p.provenance?.sourceApi!=='/api/relations/read'||p.provenance?.capabilityId!=='relations.read'||p.provenance?.access!=='query'
  ||(c.root?(p.root?.resourceType!==c.root||p.root?.canonicalId!==String(q.rootId)):p.root!==null)
  ||p.filters?.stockStatus!==(q.stockStatus??null)||p.pageBoundary?.afterId!==(q.afterId??null)
  ||!Array.isArray(p.items)||p.items.length!==p.returnedCount||p.returnedCount>q.pageSize
  ||p.totalCountKnown!==true||!Number.isSafeInteger(p.totalCount)||p.totalCount<p.returnedCount||typeof p.hasMore!=='boolean'
  ||(p.hasMore&&(p.returnedCount!==q.pageSize||p.totalCount<=p.returnedCount))
  ||!Number.isSafeInteger(p.excludedNonPartCount)||p.excludedNonPartCount<0||p.excludedNonPartCount>NESTED_LIMIT)bad();
 const keys={order:['name','status'],customer:['name'],orderLine:['name','qty','unitPrice'],recipe:['name'],
  part:q.relation==='part.facts'?['name','stock','price']:q.relation==='parts.stock'?['name','stock']:['name','supplier']}[c.result];
 if(q.relation==='recipe.parts'){
  const a=p.referenceResolution;
  if(!a||Object.keys(a).sort().join(',')!=='allResolved,missing,resolvedReferenceCount,sourceReferenceCount,version'
   ||a.version!==1||!Array.isArray(a.missing)||a.missing.length>NESTED_LIMIT||a.allResolved!==(a.missing.length===0)
   ||!Number.isSafeInteger(a.sourceReferenceCount)||a.sourceReferenceCount<0||a.sourceReferenceCount>NESTED_LIMIT
   ||!Number.isSafeInteger(a.resolvedReferenceCount)||a.resolvedReferenceCount<p.totalCount
   ||a.resolvedReferenceCount+a.missing.length+p.excludedNonPartCount!==a.sourceReferenceCount)bad();
  let ordinal=0;
  for(const m of a.missing){
   if(!m||Object.keys(m).sort().join(',')!=='model,sourceOrdinal,status,supplier'||m.status!=='NOT_FOUND'
    ||!Number.isSafeInteger(m.sourceOrdinal)||m.sourceOrdinal<=ordinal||m.sourceOrdinal>a.sourceReferenceCount)bad();
   text(m.model);if(m.supplier!==null)text(m.supplier,true);ordinal=m.sourceOrdinal;
  }
 }else if(Object.hasOwn(p,'referenceResolution'))bad();
 let prior=q.afterId??Infinity;
 for(const r of p.items){
  if(!r||Object.keys(r).sort().join(',')!=='canonicalId,display,resourceType'||r.resourceType!==c.result
   ||typeof r.canonicalId!=='string'||! /^[1-9][0-9]*$/.test(r.canonicalId)||!Number.isSafeInteger(Number(r.canonicalId))||Number(r.canonicalId)>=prior
   ||!r.display||Object.keys(r.display).sort().join(',')!==[...keys].sort().join(','))bad();
  prior=Number(r.canonicalId);
  for(const k of keys)if(['stock','price','qty','unitPrice'].includes(k))scalar(r.display[k]);else text(r.display[k],k==='supplier');
 }
 if(['order.customer','part.facts'].includes(q.relation)&&(p.items.length!==1||p.totalCount!==1||p.hasMore))bad();
 if(q.relation==='part.facts'&&p.items[0].canonicalId!==String(q.rootId))bad();
 const units=q.relation==='part.facts'?{stock:'CATALOG_QUANTITY_UNIT',price:'CNY_PER_CATALOG_QUANTITY_UNIT'}:q.relation==='parts.stock'?{stock:'CATALOG_QUANTITY_UNIT'}:{};
 if(JSON.stringify(p.units)!==JSON.stringify(units)||p.pageBoundary.nextAfterId!==(p.hasMore?Number(p.items.at(-1).canonicalId):null)
  ||Buffer.byteLength(JSON.stringify(p))>=MAX_RESULT_BYTES)bad();
 return structuredClone(p);
}
module.exports={RELATIONS,SCAN_LIMIT,NESTED_LIMIT,DEFAULT_PAGE_SIZE,MAX_PAGE_SIZE,MAX_RESULT_BYTES,TOOL_SCHEMA,request,validateResult,fail,scalar,text};
