'use strict';
const LABELS=Object.freeze({'customer.orders':'关联订单','order.customer':'所属客户','order.lines':'已保存订单明细',
 'recipe.parts':'已保存BOM引用的零件','part.recipes':'引用该零件的已保存配方','parts.stock':'符合库存条件的零件','part.facts':'库存和目录单价'});
// Closed deterministic renderer, Tools=NONE; only opaque VERIFIED values are available.
function composeInvestigationAnswer(handle,scope){
 const {page:p,root}=require('./investigationEvidence.cjs').getVerifiedRelation(handle,scope);
 const safe=s=>String(s).replace(/[\r\n\t]/g,' ').replace(/[\\`*_{}\[\]<>|]/g,c=>'\\'+c);
 const title=(root?safe(root.items[0].display.name)+'：':'')+LABELS[p.relation];
 const lines=p.items.map((r,i)=>{
  const d=r.display;
  let s=`${i+1}. ${safe(d.name)}`;
  if('status'in d)s+=`（${safe(d.status)}）`;
  if('supplier'in d&&d.supplier)s+=` — 供应商：${safe(d.supplier)}`;
  if('stock'in d)s+=`；库存：${d.stock}`;
  if('price'in d)s+=`；目录单价：${d.price}元`;
  if('qty'in d)s+=`；数量：${d.qty}；单价：${d.unitPrice}元`;
  return s;
 });
 const filter=p.relation==='parts.stock'?{low:'库存大于0且不超过5',out:'库存不大于0',attention:'库存不超过5',ok:'库存大于5'}[p.filters.stockStatus]:null;
 return {answerText:[title,filter?`条件：${filter}。`:null,`共${p.totalCount}条，本页${p.returnedCount}条。`,...lines,
  p.returnedCount===0?'没有符合条件的记录。':null,
  p.excludedNonPartCount?`BOM中的${p.excludedNonPartCount}项线圈转子不属于零件引用。`:null,
  p.hasMore?'还有后续记录，可以说“继续”。':null].filter(Boolean).join('\n')};
}
module.exports={composeInvestigationAnswer};
