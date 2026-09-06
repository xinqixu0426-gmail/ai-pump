'use strict';
// P16-K audit fixtures: no DB connection, network, model or mutation executor.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createOrderQueries } = require('../api/services/orderQueries.cjs');
const { enforceAiToolResultSize, enforceAiToolResultBudget, MAX_AI_READ_TOOL_RESULT_BYTES } = require('../api/services/aiToolProtocol.cjs');
const { AI_TOOLS } = require('../api/routes/ai/tools.cjs');
const inventory = require('../docs/ai-governance/data/p16k-read-surface-inventory.json');
const uat = require('../docs/ai-governance/data/p16k-owner-read-uat.json');
function query() {
    const rows=Array.from({length:101},(_,i)=>({id:i+1,status:'待采购',customerName:'Fixture',contractNo:'Fixture',itemsJson:'x'.repeat(3000)}));
    return createOrderQueries({db:{prepare(){throw Error('DB_ACCESS_FORBIDDEN');}},listOrdersWithCurrentPurchasePlans:()=>rows,
        getOrderWithCurrentPurchasePlan:()=>null,buildActiveOrdersReadinessOverview:()=>null,buildOrderReadinessContext:()=>null});
}
test('omitted limit returns full fixture collection, not a default page',()=>{
    const rows=query().getAllOrders(); assert.equal(rows.length,101); assert.ok(Array.isArray(rows)); assert.equal(rows.totalCount,undefined);
});
test('limit is top-N only; cursor/offset are not supported by the list service',()=>{
    const q=query(),a=q.getAllOrders({limit:20}),b=q.getAllOrders({limit:20,offset:20,cursor:'opaque'});
    assert.equal(a.length,20); assert.deepEqual(a,b); assert.equal(a[0].id,101);
});
test('real result-size guard reproduces refusal with synthetic order DTOs',()=>{
    assert.equal(MAX_AI_READ_TOOL_RESULT_BYTES,262144);
    assert.equal(enforceAiToolResultSize('get_recent_orders',{success:true,data:query().getAllOrders()}).code,'AI_QUERY_RESULT_TOO_LARGE');
    assert.equal(enforceAiToolResultSize('get_recent_orders',{success:true,data:query().getAllOrders({limit:20})}).success,true);
});
test('combined evidence budget can reject individually small read results',()=>{
    const item={success:true,data:'x'.repeat(140000)};
    assert.equal(enforceAiToolResultBudget('get_recent_orders',item,[{name:'get_recent_orders',result:item}]).code,'AI_QUERY_RESULT_TOO_LARGE');
});
test('Tool limit is optional and has no pagination state',()=>{
    const schema=AI_TOOLS.find(t=>t.function.name==='get_recent_orders').function.parameters;
    assert.equal((schema.required||[]).includes('limit'),false); assert.equal(schema.properties.limit.maximum,100);
    assert.equal(schema.properties.offset,undefined); assert.equal(schema.properties.cursor,undefined);
});
test('proposed UAT has 60 unique questions and one primary classification each',()=>{
    assert.equal(uat.questions.length,60); assert.equal(new Set(uat.questions.map(q=>q.caseId)).size,60);
    assert.equal(Object.values(uat.counts).reduce((a,b)=>a+b,0),60);
    assert.ok(uat.questions.every(q=>q.primaryBlocker===q.status&&q.reason));
    assert.equal(uat.ownerUsableCoverage,4/58);
});
test('surface inventory separates registered read tools from executable narrow cohort',()=>{
    assert.equal(inventory.tools.length,48); assert.equal(inventory.tools.filter(t=>t.executionRegistered).length,3);
    assert.equal(inventory.routes.filter(r=>r.scope==='BUSINESS_READ_CAPABLE').length,121);
    assert.ok(inventory.tools.every(t=>t.TOOL_EXISTS&&t.source&&t.V5_ROUTABLE.length));
});
test('current Candidate and answer contracts do not admit arbitrary collection facts',()=>{
    const source=fs.readFileSync(require.resolve('../api/services/ai-v5/requiredFactScope.cjs'),'utf8');
    assert.equal((source.match(/factKey:/g)||[]).length,4);
    const composer=fs.readFileSync(require.resolve('../api/services/ai-v5/readAnswerComposer.cjs'),'utf8');
    assert.ok(composer.includes('APPROVED_RUNTIME_FACTS')); assert.ok(composer.includes('numericValue'));
});
