'use strict';
const {DETAIL_FIELDS,validateDisplay,invalid}=require('./collectionReadContract.cjs');
// Business-service projection only: source snapshots never become API fields.
const VERSION=1,MAX_DETAIL_BYTES=8192,MAX_NESTED_ITEMS=50;
const PROJECTIONS=Object.freeze(Object.fromEntries(Object.entries(DETAIL_FIELDS).map(([resourceType,fields])=>[
    resourceType,Object.freeze({resourceType,projectionId:resourceType+'.detail.v1',version:VERSION,
        scalarFields:Object.freeze(fields.filter(k=>k!=='lines')),
        nestedFields:Object.freeze(resourceType==='orders'?['recipeName','qty','unitPrice']:[])})
])));
function projectCollectionDetail(resourceType,source){
    const contract=PROJECTIONS[resourceType];
    if(!contract||!source||typeof source!=='object')invalid('COLLECTION_PROJECTION_INVALID');
    const display=Object.fromEntries(contract.scalarFields.map(k=>[k,source[k]]));
    if(resourceType==='orders'){
        let lines;
        try{lines=JSON.parse(source.lines);}catch{invalid('COLLECTION_PROJECTION_INVALID');}
        if(!Array.isArray(lines))invalid('COLLECTION_PROJECTION_INVALID');
        if(lines.length>MAX_NESTED_ITEMS)invalid('COLLECTION_DETAIL_OVERSIZED');
        display.lines=lines.map(row=>{
            if(!row||typeof row!=='object'||Array.isArray(row))invalid('COLLECTION_PROJECTION_INVALID');
            return Object.fromEntries(contract.nestedFields.map(k=>[k,row[k]]));
        });
    }
    // Preserve existing invalid/oversized remark behavior, without guarding raw DTOs.
    if(display.remark===null)invalid('COLLECTION_DETAIL_OVERSIZED');
    validateDisplay(resourceType,'detail',display);
    if(Buffer.byteLength(JSON.stringify(display),'utf8')>MAX_DETAIL_BYTES)invalid('COLLECTION_DETAIL_OVERSIZED');
    return display;
}
module.exports={projectCollectionDetail,PROJECTIONS,MAX_DETAIL_BYTES,MAX_NESTED_ITEMS};
