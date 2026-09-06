'use strict';
const {STATUSES}=require('../collectionReadContract.cjs');
const {getSourceSpan}=require('./sourceSpanCatalog.cjs');
const VERSION=1;
const RESOURCES=Object.freeze({orders:'订单',customers:'客户',parts:'零件',recipes:'配方',coils:'线圈'});
const OPERATIONS=Object.freeze({list:'有界记录清单；全部表示分页，不是取全表；可指定最近N条',
    count:'记录总数量，不是库存数量',detail:'指定业务对象的档案详情，不是单项价格、库存或成本事实'});
const CATALOG=Object.freeze(Object.entries(RESOURCES).flatMap(([resourceType,label])=>
    Object.entries(OPERATIONS).map(([operation,description])=>Object.freeze({ref:resourceType+'.'+operation,resourceType,operation,label,description}))));
const FILTERS=Object.freeze(['NONE','ORDER_STATUS','ORDER_CUSTOMER','ORDER_STATUS_CUSTOMER']);
const KEYS=Object.freeze(['version','routeRef','filterClass','status','customerSpanRef','detailSpanRef','topN','confidence']);
const fail=()=>{throw Error('COLLECTION_SEMANTIC_INVALID');};
function parseCollectionSemantic(content,source,catalog){
    let p;try{p=JSON.parse(content);}catch{fail();}
    if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join()!==[...KEYS].sort().join()
        ||p.version!==VERSION||!FILTERS.includes(p.filterClass)||!['high','medium','low'].includes(p.confidence))fail();
    if(p.routeRef==='NOT_APPLICABLE'){
        if(p.filterClass!=='NONE'||[p.status,p.customerSpanRef,p.detailSpanRef,p.topN].some(x=>x!==null))fail();
        return Object.freeze({version:VERSION,operation:'NONE',contractValid:true,confidence:p.confidence});
    }
    const choice=CATALOG.find(c=>c.ref===p.routeRef);if(!choice||p.confidence==='low')fail();
    if(p.topN!==null&&(!Number.isInteger(p.topN)||p.topN<1||p.topN>50||choice.operation!=='list'))fail();
    const sourceValue=ref=>{const span=typeof ref==='string'?getSourceSpan(catalog,ref):null;
        if(!span||span.text.length>160||span.text!==source.slice(span.start,span.end))fail();return span.text;};
    const hasStatus=['ORDER_STATUS','ORDER_STATUS_CUSTOMER'].includes(p.filterClass);
    const hasCustomer=['ORDER_CUSTOMER','ORDER_STATUS_CUSTOMER'].includes(p.filterClass);
    if((p.filterClass!=='NONE'&&(choice.resourceType!=='orders'||choice.operation==='detail'))
        ||(hasStatus?!STATUSES.includes(p.status):p.status!==null)
        ||(hasCustomer?p.customerSpanRef===null:p.customerSpanRef!==null))fail();
    const detail=choice.operation==='detail';if(detail?p.detailSpanRef===null:p.detailSpanRef!==null)fail();
    return Object.freeze({version:VERSION,contractValid:true,confidence:p.confidence,resourceType:choice.resourceType,operation:choice.operation,
        filterClass:p.filterClass,detailReferenceMode:detail?'SOURCE_IDENTITY':'NONE',continuationMode:'NONE',
        ...(p.topN===null?{}:{pageSize:p.topN}),...(hasStatus?{status:p.status}:{}),
        ...(hasCustomer?{customerName:sourceValue(p.customerSpanRef)}:{}),...(detail?{identity:sourceValue(p.detailSpanRef)}:{})});
}
function executionQuery(intent){
    const q={resourceType:intent.resourceType,operation:intent.operation};
    for(const k of ['pageSize','status','customerName'])if(Object.hasOwn(intent,k))q[k]=intent[k];
    return q;
}
module.exports={VERSION,RESOURCES,OPERATIONS,CATALOG,FILTERS,KEYS,parseCollectionSemantic,executionQuery};
