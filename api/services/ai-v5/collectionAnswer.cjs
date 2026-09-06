'use strict';
const {getVerifiedCollection}=require('./collectionEvidence.cjs');
const resources={orders:'订单',customers:'客户',parts:'零件',recipes:'配方',coils:'线圈方案'};
const labels={customerName:'客户',status:'状态',createdAt:'创建时间',category:'类别',supplier:'供应商',spec:'规格',
    material:'材质',schemeStatus:'方案状态',remark:'备注',coilSpec:'线圈规格',coilMaterial:'线圈材质',updatedAt:'更新时间',slotType:'槽型'};
// Deterministic composer: no model, tools, investigation, hidden rows or technical cursor text.
// Business text is plain text, not executed/rendered as trusted HTML or instructions.
function composeCollectionAnswer(handle,scope){
    const p=getVerifiedCollection(handle,scope),name=resources[p.resourceType];
    const clean=s=>String(s).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/[<>]/g,'');
    const filtered=p.filters.status!==null||p.filters.customerName!==null;
    const header=filtered?'符合条件的'+name:name;
    const clauses=[];
    if(p.filters.status)clauses.push(p.filters.status==='active'?'未关闭、未取消':'状态为'+p.filters.status);
    if(p.filters.customerName)clauses.push('客户为'+clean(p.filters.customerName));
    const filterText=clauses.length?'（'+clauses.join('，')+'）':'';
    let text;
    if(p.operation==='count')text=header+filterText+'共有 '+p.totalCount+' 条。';
    else if(p.items.length===0)text='没有找到'+header+filterText+'。';
    else{
        const rows=p.items.map((row,i)=>{
            const d=row.display,fields=Object.entries(d).filter(([k,v])=>k!=='name'&&k!=='lines'&&v!==null&&v!=='')
                .map(([k,v])=>labels[k]+'：'+clean(v));
            const lines=d.lines?.map((l,j)=>'  '+(j+1)+'. '+clean(l.recipeName)+'；数量：'+l.qty+'；订单单价：'+l.unitPrice)||[];
            return (i+1)+'. '+clean(d.name)+(fields.length?'；'+fields.join('；'):'')+(lines.length?'\n'+lines.join('\n'):'');
        });
        text=p.operation==='detail'?name+'详情（已核实的字段）：\n'+rows.join('\n')
            :header+filterText+'共 '+p.totalCount+' 条，本次显示 '+p.returnedCount+' 条（按记录创建顺序由新到旧）：\n'+rows.join('\n');
        if(p.operation==='list')text+=p.hasMore?'\n还有更多，可以说“继续”。':'\n已到末尾。';
    }
    if(Buffer.byteLength(text)>=128*1024)throw Error('COLLECTION_ANSWER_OVERSIZED');
    return {version:1,answerStatus:'ANSWERED',answerText:text,claims:[{claimType:'FACT',factKey:handle.factKey,evidenceRefs:[handle.evidenceRef]}]};
}
module.exports={composeCollectionAnswer};
