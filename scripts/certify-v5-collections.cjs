'use strict';
// Fixed, one-shot natural-language UAT against migrated in-memory fixture data.
// Real configured models + real Executor/internal HTTP/API; never the business DB.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const OUTPUT=path.resolve('docs/ai-governance/data/p16l-resume-collection-certification.json');
const FREEZE=['api/services/collectionReadContract.cjs','api/services/collectionReadService.cjs','api/routes/collectionRead.cjs',
    'api/services/ai-v5/collectionContinuation.cjs','api/services/ai-v5/collectionIntent.cjs','api/services/ai-v5/collectionEvidence.cjs',
    'api/services/ai-v5/collectionAnswer.cjs','api/services/ai-v5/collectionReadRuntime.cjs','api/services/ai-v5/candidateRead.cjs',
    'api/services/candidateRiskEnvelope.cjs','api/services/ownerReadCanaryGateway.cjs','api/routes/ai/executor.cjs',
    'api/services/ai-v5/evidenceRequirements.cjs','api/services/ai-v5/evidenceLedger.cjs','api/services/ai-v5/verification.cjs',
    'api/services/ai-v5/capabilityRegistry.cjs','api/capabilities/registry.cjs','api/routes/ai/tools.cjs','api/routes/ai/executors/queryExecutors.cjs'];
const hashes=()=>Object.fromEntries(FREEZE.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
function cases(){
    const data=[
        ['orders','列出所有订单','list',20,63],['orders','继续','list',20,63],['orders','看看第3个','detail',1,null],
        ['orders','最近10个订单','list',10,63],['orders','现在一共有多少订单','count',0,63],
        ['orders','未完成的订单有哪些','list',20,32],['orders','下一页','list',12,32],
        ['orders','看看订单 ORD-63 的详细信息','detail',1,null],
        ['orders','客户「不存在」有哪些订单','list',0,0],['orders','最近5个已关闭的订单','list',5,31],
    ];
    for(const [r,n,identity]of [['customers','客户','客户-63'],['parts','零件','零件-63'],['recipes','配方','配方-63'],['coils','线圈','线圈-63']]){
        data.push([r,'有哪些'+n,'list',20,63],[r,'再看后20条','list',20,63],[r,'现在共有多少'+n,'count',0,63],
            [r,'看看'+identity+'的详细信息','detail',1,null],[r,'列出最近10个'+n,'list',10,63]);
    }
    return data.map(([resource,question,operation,returned,total],i)=>({id:'L-'+String(i+1).padStart(2,'0'),resource,question,operation,returned,total}));
}
const median=a=>a.length?[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)]:null;
async function main(settings={}){
    const OUTPUT=settings.output||'docs/ai-governance/data/p16l-resume-collection-certification.json';
    if(fs.existsSync(OUTPUT))throw Error('CERTIFICATION_ALREADY_EXISTS');
    const env={...require('dotenv').parse(fs.readFileSync('.env')),AI_PROVIDER:'deepseek',DEEPSEEK_MODEL:'deepseek-v4-flash',
        PUMP_V5_CANDIDATE_RUNTIME:'true',AI_V5_READ_CANARY_ENABLED:'true',AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED:'true'};
    if(!env.DEEPSEEK_API_KEY)throw Error('CERTIFICATION_PROVIDER_UNAVAILABLE');
    const data={stage:settings.stage||'P16-L-RESUME',mode:'REAL_MODEL_ISOLATED_FIXTURE',status:'RUNNING',freezeBefore:hashes(),cases:[],
        expectedQuestions:30,productionCalls:0,writes:0,retries:0};
    fs.writeFileSync(OUTPUT,JSON.stringify(data,null,2),{flag:'wx'});
    const emit=console.log.bind(console);for(const k of ['log','warn','error','info','debug'])console[k]=()=>{};
    const db=require('../tests/helpers/collectionFixture.cjs').collectionFixture(),app=require('express')();
    app.use(require('express').json());app.use('/api/collections',require('../api/routes/collectionRead.cjs').createCollectionReadRouter({db}));
    app.use('/api/entity-lookup',require('../api/routes/entityLookup.cjs').createEntityLookupRouter({db}));
    const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
    const old={PORT:process.env.PORT,PUMP_V5_CANDIDATE_RUNTIME:process.env.PUMP_V5_CANDIDATE_RUNTIME};
    process.env.PORT=String(server.address().port);process.env.PUMP_V5_CANDIDATE_RUNTIME='true';
    const {runCandidateRead}=require('../api/services/ai-v5/candidateRead.cjs'),{withConversationContext}=require('../api/services/conversationContext.cjs');
    const {createContinuationStore}=require('../api/services/ai-v5/collectionContinuation.cjs'),continuationStore=createContinuationStore();
    const {executeToolCall}=require('../api/routes/ai/executor.cjs');
    const groups=['orders','customers','parts','recipes','coils'];
    try{
        for(const c of cases()){
            let calls=0,answer='',queryMatch=false;
            const started=performance.now();
            const o=await withConversationContext({version:1,contextKey:'a'.repeat(64),conversationId:'chat-'+(groups.indexOf(c.resource)+1)},
                ()=>runCandidateRead({sourceRequest:c.question,internalAuthorized:true,previewOptIn:true,collectionOnly:true,deliver:t=>{answer=t;return true;}},
                    {env,continuationStore,collectionExecute:async(name,args,options)=>{
                        calls++;const r=await executeToolCall(name,args,options),p=r.collection;
                        queryMatch=name==='read_collection'&&p?.resourceType===c.resource&&p?.operation===c.operation&&p?.returnedCount===c.returned&&p?.totalCount===c.total;
                        return r;
                    }}));
            const pass=o.delivered===true&&o.validationPass===true&&calls===1&&queryMatch&&answer.length>0;
            const record={case_id:c.id,resourceType:c.resource,expectedOperation:c.operation,pass,toolCalls:calls,queryContractMatch:queryMatch,
                delivered:o.delivered===true,failureClass:o.failureClass,returnedCount:o.returnedCount??null,pageSize:o.pageSize??null,
                hasMore:o.hasMore??null,bytes:o.resultBytes??null,apiMs:o.collectionApiMs??null,durationMs:performance.now()-started,
                continuation:o.continuation===true,detailTargetBinding:o.detailTargetBinding||'NONE',
                filterContractReused:o.filterContractReused===true,filterReclassificationCalls:o.filterReclassificationCalls??null,
                technicalParameterLeakage:/afterId|pageSize|canonicalId|read_collection|\/api\/|limit|offset|cursor/.test(answer)?1:0};
            data.cases.push(record);fs.writeFileSync(OUTPUT,JSON.stringify(data,null,2));emit(JSON.stringify({case_id:c.id,pass,failureClass:o.failureClass}));
            answer='';
        }
        data.freezeAfter=hashes();data.hashesMatch=JSON.stringify(data.freezeBefore)===JSON.stringify(data.freezeAfter);
        data.passed=data.cases.filter(c=>c.pass).length;data.failed=data.cases.length-data.passed;
        data.status=data.passed===30&&data.hashesMatch?'PASS':'REWORK';
        data.metrics={apiMedian:median(data.cases.map(c=>c.apiMs).filter(x=>x!==null)),collectionMedian:median(data.cases.filter(c=>c.expectedOperation==='list'&&!c.continuation).map(c=>c.durationMs)),
            continuationMedian:median(data.cases.filter(c=>c.continuation).map(c=>c.durationMs)),detailMedian:median(data.cases.filter(c=>c.expectedOperation==='detail').map(c=>c.durationMs)),
            maxBytes:Math.max(0,...data.cases.map(c=>c.bytes||0))};
    }finally{
        await new Promise(r=>server.close(r));db.close();for(const [k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
        fs.writeFileSync(OUTPUT,JSON.stringify(data,null,2));
    }
    emit(JSON.stringify({status:data.status,passed:data.passed,failed:data.failed}));
}
if(require.main===module)main().catch(()=>{process.stdout.write('COLLECTION_CERTIFICATION_FAILED\n');process.exitCode=1;});
module.exports={cases,FREEZE,main};
