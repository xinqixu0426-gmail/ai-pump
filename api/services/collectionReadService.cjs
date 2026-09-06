'use strict';
const {randomUUID}=require('node:crypto');
const {validateRequest,MAX_RESULT_BYTES,invalid,validateDisplay}=require('./collectionReadContract.cjs');
// Static, bound SQL only. No table/column/SQL supplied by any caller.
const SQL={
    orders: {
        list: "SELECT id, contract_no AS name, customer_name AS customerName, status, created_at AS createdAt FROM orders WHERE deleted_at IS NULL AND (:status IS NULL OR status=:status OR (:status='active' AND status NOT IN ('已关闭','已取消'))) AND (:customerName IS NULL OR customer_name=:customerName) AND (:afterId IS NULL OR id<:afterId) ORDER BY id DESC LIMIT :limit",
        count: "SELECT COUNT(*) AS total FROM orders WHERE deleted_at IS NULL AND (:status IS NULL OR status=:status OR (:status='active' AND status NOT IN ('已关闭','已取消'))) AND (:customerName IS NULL OR customer_name=:customerName)",
        detail: "SELECT id, contract_no AS name, customer_name AS customerName, status, created_at AS createdAt, CASE WHEN length(COALESCE(remark,''))<=512 THEN COALESCE(remark,'') ELSE NULL END AS remark, CASE WHEN length(COALESCE(items_json,'[]'))<=8192 THEN COALESCE(items_json,'[]') ELSE NULL END AS lines FROM orders WHERE deleted_at IS NULL AND ((:targetId IS NOT NULL AND id=:targetId) OR (:identity IS NOT NULL AND contract_no=:identity)) ORDER BY id DESC LIMIT 2"
    },
    customers: {
        list: "SELECT id, name, created_at AS createdAt FROM customers WHERE deleted_at IS NULL AND (:afterId IS NULL OR id<:afterId) ORDER BY id DESC LIMIT :limit",
        count: "SELECT COUNT(*) AS total FROM customers WHERE deleted_at IS NULL",
        detail: "SELECT id, name, created_at AS createdAt, CASE WHEN length(remark)<=512 THEN remark ELSE NULL END AS remark FROM customers WHERE deleted_at IS NULL AND ((:targetId IS NOT NULL AND id=:targetId) OR (:identity IS NOT NULL AND name=:identity)) ORDER BY id DESC LIMIT 2"
    },
    parts: {
        list: "SELECT id, model AS name, category, supplier FROM parts WHERE deleted_at IS NULL AND (:afterId IS NULL OR id<:afterId) ORDER BY id DESC LIMIT :limit",
        count: "SELECT COUNT(*) AS total FROM parts WHERE deleted_at IS NULL",
        detail: "SELECT id, model AS name, category, supplier, CASE WHEN length(remark)<=512 THEN remark ELSE NULL END AS remark FROM parts WHERE deleted_at IS NULL AND ((:targetId IS NOT NULL AND id=:targetId) OR (:identity IS NOT NULL AND model=:identity)) ORDER BY id DESC LIMIT 2"
    },
    recipes: {
        list: "SELECT id, name, spec FROM recipes WHERE deleted_at IS NULL AND (:afterId IS NULL OR id<:afterId) ORDER BY id DESC LIMIT :limit",
        count: "SELECT COUNT(*) AS total FROM recipes WHERE deleted_at IS NULL",
        detail: "SELECT id, name, spec, coil_spec AS coilSpec, coil_material AS coilMaterial, updated_at AS updatedAt FROM recipes WHERE deleted_at IS NULL AND ((:targetId IS NOT NULL AND id=:targetId) OR (:identity IS NOT NULL AND name=:identity)) ORDER BY id DESC LIMIT 2"
    },
    coils: {
        list: "SELECT id, scheme_name AS name, spec, material, scheme_status AS schemeStatus FROM coils WHERE 1=1 AND (:afterId IS NULL OR id<:afterId) ORDER BY id DESC LIMIT :limit",
        count: "SELECT COUNT(*) AS total FROM coils WHERE 1=1",
        detail: "SELECT id, scheme_name AS name, spec, material, scheme_status AS schemeStatus, slot_type AS slotType, updated_at AS updatedAt FROM coils WHERE ((:targetId IS NOT NULL AND id=:targetId) OR (:identity IS NOT NULL AND (scheme_name=:identity OR scheme_code=:identity))) ORDER BY id DESC LIMIT 2"
    }
};
function createCollectionReadService({db}){
    function read(input){
        const q=validateRequest(input),sql=SQL[q.resourceType];
        const params={status:q.status??null,customerName:q.customerName??null,afterId:q.afterId??null,
            targetId:q.targetId??null,identity:q.identity??null,limit:q.pageSize+1};
        const result=db.transaction(()=>{
            const total=q.operation==='detail'?null:db.prepare(sql.count).get(params).total;
            const fetched=q.operation==='count'?[]:db.prepare(q.operation==='detail'?sql.detail:sql.list).all(params);
            if(q.operation==='detail'&&fetched.length>1)invalid('COLLECTION_ENTITY_AMBIGUOUS');
            const hasMore=q.operation==='list'&&fetched.length>q.pageSize;
            const items=fetched.slice(0,q.operation==='detail'?1:q.pageSize).map(row=>{
                if(!Number.isSafeInteger(row.id)||row.id<=0)invalid('COLLECTION_IDENTITY_INVALID');
                const {id,...display}=row;
                if(Object.hasOwn(display,'lines')){
                    if(display.lines===null)invalid('COLLECTION_DETAIL_OVERSIZED');
                    try { display.lines=JSON.parse(display.lines); } catch { invalid('COLLECTION_PROJECTION_INVALID'); }
                    if(!Array.isArray(display.lines)||display.lines.length>50)invalid('COLLECTION_DETAIL_OVERSIZED');
                    display.lines=display.lines.map(({recipeName,qty,unitPrice})=>({recipeName,qty,unitPrice}));
                }
                if(display.remark===null)invalid('COLLECTION_DETAIL_OVERSIZED');
                validateDisplay(q.resourceType,q.operation,display);
                return {canonicalId:String(id),display};
            });
            return {version:1,resourceType:q.resourceType,operation:q.operation,queryId:randomUUID(),
                filters:{status:q.status??null,customerName:q.customerName??null},sort:'id_desc',pageSize:q.pageSize,
                returnedCount:items.length,totalCount:total,totalCountKnown:total!==null,hasMore,items,
                pageBoundary:{afterId:q.afterId??null,nextAfterId:hasMore?Number(items.at(-1).canonicalId):null},
                complete:true,consistency:'READ_TRANSACTION_PER_PAGE',asOf:new Date().toISOString(),
                provenance:{capabilityId:'collections.read',sourceApi:'/api/collections/read',access:'query'}};
        })();
        if(Buffer.byteLength(JSON.stringify(result))>=MAX_RESULT_BYTES)invalid('COLLECTION_RESULT_OVERSIZED');
        return result;
    }
    return {read};
}
module.exports={createCollectionReadService};
