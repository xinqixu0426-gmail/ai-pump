'use strict';
// Fixed, one-shot natural-language UAT against migrated in-memory fixture data.
// Real configured models + real Executor/internal HTTP/API; never the business DB.
const fs=require('node:fs'),crypto=require('node:crypto');
const FREEZE=['api/services/collectionReadContract.cjs','api/services/collectionReadService.cjs','api/routes/collectionRead.cjs',
    'api/services/ai-v5/collectionContinuation.cjs','api/services/ai-v5/collectionIntent.cjs','api/services/ai-v5/collectionEvidence.cjs',
    'api/services/ai-v5/collectionAnswer.cjs','api/services/ai-v5/collectionReadRuntime.cjs','api/services/ai-v5/candidateRead.cjs',
    'api/services/candidateRiskEnvelope.cjs','api/services/ownerReadCanaryGateway.cjs','api/routes/ai/executor.cjs',
    'api/services/ai-v5/evidenceRequirements.cjs','api/services/ai-v5/evidenceLedger.cjs','api/services/ai-v5/verification.cjs',
    'api/services/ai-v5/capabilityRegistry.cjs','api/capabilities/registry.cjs','api/routes/ai/tools.cjs','api/routes/ai/executors/queryExecutors.cjs'];
const hashes=()=>Object.fromEntries(FREEZE.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
const {cases}=require('./certify-v5-collections.cjs');
FREEZE.push(...require('./certify-p16lr4-semantics.cjs').FILES,'scripts/certify-p16lr4-collections.cjs');
const median=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?(s[(s.length-1)>>1]+s[s.length>>1])/2:null;};
async function main(settings={}){
    if(settings.multiRead===true)FREEZE.push('api/services/ai-v5/investigationIntent.cjs','api/services/ai-v5/investigationRuntime.cjs');
    const semantic=JSON.parse(fs.readFileSync('docs/ai-governance/data/p16lr4-semantic-certification.json'));
    // R4 requires mutation denial, not that every denied request receive WRITE
    // rather than UNKNOWN. Preserve the stricter semantic audit result unchanged.
    const safeNegatives=semantic.negatives.length===6&&semantic.negatives.every(n=>!n.unsafeAdmission&&!n.controlActivated
        &&n.semanticModelCalls===0&&['WRITE_OR_MUTATION','UNAVAILABLE_OR_UNKNOWN'].includes(n.riskClass));
    if(semantic.correct!==90||!semantic.focusedPass||!semantic.hashesMatch||!safeNegatives
        ||semantic.orphanSpans||semantic.crossRequestContamination||semantic.traceRawQuestionLeakage)throw Error('SEMANTIC_GATE_NOT_PASSED');
    const OUTPUT=settings.output||'docs/ai-governance/data/p16lr4-collection-certification.json';
    if(fs.existsSync(OUTPUT))throw Error('CERTIFICATION_ALREADY_EXISTS');
    const env={...require('dotenv').parse(fs.readFileSync('.env')),AI_PROVIDER:'deepseek',DEEPSEEK_MODEL:'deepseek-v4-flash',
        PUMP_V5_CANDIDATE_RUNTIME:'true',AI_V5_READ_CANARY_ENABLED:'true',AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED:'true'};
    if(settings.multiRead===true)env.AI_V5_MULTI_READ_ENABLED='true';
    if(!env.DEEPSEEK_API_KEY)throw Error('CERTIFICATION_PROVIDER_UNAVAILABLE');
    const data={stage:settings.stage||'P16-L-R4',mode:'REAL_MODEL_ISOLATED_FIXTURE',status:'RUNNING',freezeBefore:hashes(),cases:[],
        expectedQuestions:30,productionCalls:0,writes:0,retries:0};
    fs.writeFileSync(OUTPUT,JSON.stringify(data,null,2),{flag:'wx'});
    const emit=console.log.bind(console);for(const k of ['log','warn','error','info','debug'])console[k]=()=>{};
    const obs=require('../api/services/observability.cjs'),capture=require('../tests/helpers/collectionTraceCapture.cjs')();
    obs.initializeObservability({env:{AI_OBSERVABILITY_ENABLED:'true'},phoenixModule:capture.phoenixModule});
    const db=require('../tests/helpers/collectionFixture.cjs').collectionFixture(),app=require('express')();
    app.use(require('express').json());app.use('/api/collections',require('../api/routes/collectionRead.cjs').createCollectionReadRouter({db}));
    app.use('/api/entity-lookup',require('../api/routes/entityLookup.cjs').createEntityLookupRouter({db}));
    app.use('/api/entity-span-candidates',require('../api/routes/entitySpanCandidates.cjs').createEntitySpanCandidateRouter({db}));
    const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
    const old={PORT:process.env.PORT,PUMP_V5_CANDIDATE_RUNTIME:process.env.PUMP_V5_CANDIDATE_RUNTIME};
    process.env.PORT=String(server.address().port);process.env.PUMP_V5_CANDIDATE_RUNTIME='true';
    const {runCandidateRead}=require('../api/services/ai-v5/candidateRead.cjs'),{withConversationContext}=require('../api/services/conversationContext.cjs');
    const {createContinuationStore}=require('../api/services/ai-v5/collectionContinuation.cjs'),continuationStore=createContinuationStore();
    const {executeToolCall}=require('../api/routes/ai/executor.cjs');
    const groups=['orders','customers','parts','recipes','coils'];
    try{
        for(const c of cases()){
            let calls=0,answer='',queryMatch=false,canonicalOracleMatch=false,filterOracleMatch=false;
            const started=performance.now();
            const o=await withConversationContext({version:1,contextKey:'a'.repeat(64),conversationId:'chat-'+(groups.indexOf(c.resource)+1)},
                ()=>runCandidateRead({sourceRequest:c.question,internalAuthorized:true,previewOptIn:true,collectionOnly:true,deliver:t=>{answer=t;return true;}},
                    {env,continuationStore,collectionExecute:async(name,args,options)=>{
                        calls++;const r=await executeToolCall(name,args,options),p=r.collection;
                        queryMatch=name==='read_collection'&&p?.resourceType===c.resource&&p?.operation===c.operation&&p?.returnedCount===c.returned&&p?.totalCount===c.total;
                        const continuation=['L-02','L-07','L-12','L-17','L-22','L-27'].includes(c.id);
                        const active=['L-06','L-07'].includes(c.id),closed=c.id==='L-10';
                        const expectedIds=c.operation==='detail'?[c.id==='L-03'?'41':'63']
                            :c.operation==='count'||c.id==='L-09'?[]
                            :Array.from({length:c.returned},(_,i)=>String((closed?62:63)-(continuation?20:0)*(active?2:1)-i*(active||closed?2:1)));
                        canonicalOracleMatch=JSON.stringify(p?.items.map(x=>x.canonicalId))===JSON.stringify(expectedIds);
                        filterOracleMatch=p?.sort==='id_desc'&&(p.filters.status??null)===(active?'active':closed?'已关闭':null)
                            &&(p.filters.customerName??null)===(c.id==='L-09'?'不存在':null);
                        return r;
                    }}));
            const pass=o.delivered===true&&o.validationPass===true&&calls===1&&queryMatch&&canonicalOracleMatch&&filterOracleMatch&&answer.length>0;
            const record={case_id:c.id,resourceType:c.resource,expectedOperation:c.operation,pass,toolCalls:calls,queryContractMatch:queryMatch,canonicalOracleMatch,filterOracleMatch,
                delivered:o.delivered===true,failureClass:o.failureClass,returnedCount:o.returnedCount??null,pageSize:o.pageSize??null,
                hasMore:o.hasMore??null,bytes:o.resultBytes??null,apiMs:o.collectionApiMs??null,durationMs:performance.now()-started,
                continuation:o.continuation===true,continuationControl:o.continuationControl===true,riskCalls:o.risk?.invoked===false?0:1,semanticModelCalls:o.semanticModelCalls??null,detailTargetBinding:o.detailTargetBinding||'NONE',
                filterContractReused:o.filterContractReused===true,filterReclassificationCalls:o.filterReclassificationCalls??null,
                technicalParameterLeakage:/afterId|pageSize|canonicalId|read_collection|\/api\/|limit|offset|cursor/.test(answer)?1:0};
            data.cases.push(record);fs.writeFileSync(OUTPUT,JSON.stringify(data,null,2));emit(JSON.stringify({case_id:c.id,pass,failureClass:o.failureClass}));
            answer='';
        }
        data.freezeAfter=hashes();data.hashesMatch=JSON.stringify(data.freezeBefore)===JSON.stringify(data.freezeAfter);
        data.passed=data.cases.filter(c=>c.pass).length;data.failed=data.cases.length-data.passed;
        const spans=capture.spans;
        data.orphanSpans=spans.filter(s=>s.parentId&&!spans.some(p=>p.id===s.parentId)).length;
        data.crossRequestContamination=spans.filter(s=>s.parentId&&spans.find(p=>p.id===s.parentId)?.rootId!==s.rootId).length;
        data.traceRawQuestionLeakage=cases().filter(c=>JSON.stringify(spans).includes(c.question)).length;
        data.status=data.passed===30&&data.hashesMatch&&!data.orphanSpans&&!data.crossRequestContamination&&!data.traceRawQuestionLeakage?'PASS':'REWORK';
        data.metrics={apiMedian:median(data.cases.map(c=>c.apiMs).filter(x=>x!==null)),collectionMedian:median(data.cases.filter(c=>c.expectedOperation==='list'&&!c.continuation).map(c=>c.durationMs)),
            continuationMedian:median(data.cases.filter(c=>c.continuation).map(c=>c.durationMs)),detailMedian:median(data.cases.filter(c=>c.expectedOperation==='detail').map(c=>c.durationMs)),
            maxBytes:Math.max(0,...data.cases.map(c=>c.bytes||0))};
    }finally{
        await obs.resetObservabilityForTesting();
        await new Promise(r=>server.close(r));db.close();for(const [k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
        fs.writeFileSync(OUTPUT,JSON.stringify(data,null,2));
    }
    emit(JSON.stringify({status:data.status,passed:data.passed,failed:data.failed}));
}
if(require.main===module)main().catch(()=>{process.stdout.write('COLLECTION_CERTIFICATION_FAILED\n');process.exitCode=1;});
module.exports={cases,FREEZE,main};
