'use strict';

const RESOURCES = Object.freeze(['orders','customers','parts','recipes','coils']);
const DEFAULT_PAGE_SIZE = 20, MAX_PAGE_SIZE = 50, MAX_RESULT_BYTES = 256 * 1024;
const STATUSES = Object.freeze(['待确认','待采购','采购中','采购完成','已关闭','已取消','active']);
const LIST_FIELDS = Object.freeze({ orders:['name','customerName','status','createdAt'], customers:['name','createdAt'],
    parts:['name','category','supplier'], recipes:['name','spec'], coils:['name','spec','material','schemeStatus'] });
const DETAIL_FIELDS = Object.freeze({ orders:[...LIST_FIELDS.orders,'remark','lines'], customers:[...LIST_FIELDS.customers,'remark'],
    parts:[...LIST_FIELDS.parts,'remark'], recipes:[...LIST_FIELDS.recipes,'coilSpec','coilMaterial','updatedAt'],
    coils:[...LIST_FIELDS.coils,'slotType','updatedAt'] });
const TOOL_SCHEMA = Object.freeze({type:'object',additionalProperties:false,required:['resourceType','operation'],properties:{
    resourceType:{type:'string',enum:RESOURCES},operation:{type:'string',enum:['list','count','detail']},
    pageSize:{type:'integer',minimum:1,maximum:50},afterId:{type:'integer',minimum:1},
    targetId:{type:'integer',minimum:1},identity:{type:'string',minLength:1,maxLength:160},
    status:{type:'string',enum:STATUSES},customerName:{type:'string',minLength:1,maxLength:160}
}});
function invalid(code='COLLECTION_REQUEST_INVALID'){const e=Error(code);e.code=code;e.statusCode=400;throw e;}
function validateRequest(input){
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!Object.hasOwn(TOOL_SCHEMA.properties,k)))invalid();
    if(!RESOURCES.includes(input.resourceType)||!['list','count','detail'].includes(input.operation))invalid();
    for(const k of ['pageSize','afterId','targetId'])if(input[k]!==undefined&&(!Number.isSafeInteger(input[k])||input[k]<1||(k==='pageSize'&&input[k]>50)))invalid();
    for(const k of ['identity','customerName'])if(input[k]!==undefined&&(typeof input[k]!=='string'||!input[k].length||input[k].length>160))invalid();
    if(input.status!==undefined&&!STATUSES.includes(input.status))invalid();
    if(input.resourceType!=='orders'&&(input.status!==undefined||input.customerName!==undefined))invalid('COLLECTION_FILTER_UNSUPPORTED');
    if(input.operation==='detail'){
        if((input.targetId===undefined)===(input.identity===undefined)||input.afterId!==undefined||input.status!==undefined||input.customerName!==undefined||input.pageSize!==undefined)invalid();
    }else if(input.targetId!==undefined||input.identity!==undefined||(input.operation==='count'&&input.afterId!==undefined))invalid();
    return Object.freeze({...input,pageSize:input.pageSize??DEFAULT_PAGE_SIZE});
}
function validateDisplay(resource, operation, display) {
    const fields=(operation==='detail'?DETAIL_FIELDS:LIST_FIELDS)[resource];
    if(!display||Object.keys(display).sort().join(',')!==[...fields].sort().join(','))invalid('COLLECTION_PROJECTION_INVALID');
    for(const [key,value]of Object.entries(display)){
        if(key==='lines'){
            if(!Array.isArray(value)||value.length>50)invalid('COLLECTION_DETAIL_OVERSIZED');
            for(const row of value){
                if(!row||Object.keys(row).sort().join(',')!=='qty,recipeName,unitPrice'
                    ||typeof row.recipeName!=='string'||row.recipeName.length>160
                    ||!Number.isFinite(row.qty)||!Number.isFinite(row.unitPrice))invalid('COLLECTION_PROJECTION_INVALID');
            }
        }else if(value!==null&&(typeof value!=='string'||value.length>(key==='remark'?512:160)))invalid('COLLECTION_ROW_OVERSIZED');
    }
    if(typeof display.name!=='string'||!display.name.length)invalid('COLLECTION_IDENTITY_INVALID');
    return true;
}
module.exports={RESOURCES,DEFAULT_PAGE_SIZE,MAX_PAGE_SIZE,MAX_RESULT_BYTES,STATUSES,TOOL_SCHEMA,validateRequest,invalid,LIST_FIELDS,DETAIL_FIELDS,validateDisplay};
