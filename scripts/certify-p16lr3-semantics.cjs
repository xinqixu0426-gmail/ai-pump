'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const OUTPUT='docs/ai-governance/data/p16lr3-semantic-certification.json';
const FILES=['api/services/candidateRiskEnvelope.cjs','api/services/ai-v5/collectionIntent.cjs',
    'api/services/ai-v5/collectionSemanticContract.cjs','api/services/ai-v5/collectionContextCommand.cjs',
    'api/services/ai-v5/collectionAdmission.cjs','api/services/ai-v5/collectionReadRuntime.cjs','api/services/ai-v5/collectionDetailTarget.cjs',
    'api/services/ai-v5/candidateRead.cjs','api/services/ai-v5/collectionContinuation.cjs','api/services/ai-v5/sourceSpanCatalog.cjs',
    'api/services/collectionReadContract.cjs','api/services/collectionReadService.cjs','scripts/certify-v5-collections.cjs',
    'scripts/certify-p16lr3-semantics.cjs'];
const hashes=()=>Object.fromEntries(FILES.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
const median=a=>{const s=[...a].sort((a,b)=>a-b);return s.length?(s[(s.length-1)>>1]+s[s.length>>1])/2:null;};
function expected(c){
    const cont=['L-02','L-07','L-12','L-17','L-22','L-27'].includes(c.id),ordinal=c.id==='L-03';
    const status=['L-06','L-07'].includes(c.id)?'active':c.id==='L-10'?'已关闭':null;
    const customer=c.id==='L-09'?'不存在':null;
    const identity=c.operation==='detail'&&!ordinal?({orders:'ORD-63',customers:'客户-63',parts:'零件-63',recipes:'配方-63',coils:'线圈-63'})[c.resource]:null;
    return {resourceType:c.resource,operation:cont?'continue':ordinal?'ordinal':c.operation,
        filterClass:cont||ordinal?'FROZEN':status?'ORDER_STATUS':customer?'ORDER_CUSTOMER':'NONE',
        status,customer,identity,ordinal:ordinal?3:null,pageSize:c.operation==='list'&&!cont&&c.returned<20&&c.total!==0?c.returned:null,
        active:cont||ordinal?{resourceType:c.resource,query:{resourceType:c.resource,operation:'list',pageSize:20,...(status?{status}:{})}}:null};
}
async function main(){
    if(fs.existsSync(OUTPUT))throw Error('SEMANTIC_CERTIFICATION_ALREADY_EXISTS');
    const env={...require('dotenv').parse(fs.readFileSync('.env')),AI_PROVIDER:'deepseek',DEEPSEEK_MODEL:'deepseek-v4-flash'};
    const emit=console.log.bind(console);for(const k of ['log','warn','error','info','debug'])console[k]=()=>{};
    const {classifyCandidateRisk}=require('../api/services/candidateRiskEnvelope.cjs');
    const {selectCollectionIntent}=require('../api/services/ai-v5/collectionIntent.cjs');
    const {assertCollectionAdmission}=require('../api/services/ai-v5/collectionAdmission.cjs');
    const obs=require('../api/services/observability.cjs'),capture=require('../tests/helpers/collectionTraceCapture.cjs')();
    obs.initializeObservability({env:{AI_OBSERVABILITY_ENABLED:'true'},phoenixModule:capture.phoenixModule});
    const cases=require('./certify-v5-collections.cjs').cases();
    const data={stage:'P16-L-R3',mode:'SEMANTIC_ONLY_REAL_MODELS_FIXED_CONTEXT_FIXTURE',status:'RUNNING',repeatCount:3,
        questions:30,decisions:[],negatives:[],freezeBefore:hashes(),businessApiCalls:0,toolCalls:0,answerModelCalls:0,retries:0};
    fs.writeFileSync(OUTPUT,JSON.stringify(data,null,2),{flag:'wx'});
    async function decide(source,active,taskId){
        return obs.withAgentSpan({requestId:taskId},async()=>{
            const risk=await obs.withModelSpan({stage:'collection_risk',provider:'deepseek',model:'deepseek-v4-flash'},()=>classifyCandidateRisk(source,{env,collectionContext:active}));
            let intent=null,error=null,routerCalls=0,modelCalls=0;
            if(risk.riskClass==='READ_SAFE')try{
                routerCalls++;
                intent=await selectCollectionIntent(source,active,{env,observeModelCall:(m,fn)=>{modelCalls++;return obs.withModelSpan({...m,stage:'collection_semantic'},fn);}});
                assertCollectionAdmission(risk,intent);
            }catch(e){error=/^COLLECTION_[A-Z_]+$/.test(e.message)?e.message:'COLLECTION_SEMANTIC_UNAVAILABLE';}
            else error=risk.riskClass;
            return {risk,intent,error,routerCalls,modelCalls};
        });
    }
    try{
        for(let repeat=1;repeat<=3;repeat++)for(const c of cases){
            const e=expected(c),r=await decide(c.question,e.active,'r3-'+repeat+'-'+c.id),i=r.intent;
            const reasons=[];
            if(r.error)reasons.push(r.error);
            if(i){if(i.resourceType!==e.resourceType)reasons.push('RESOURCE_MISMATCH');if(i.operation!==e.operation)reasons.push('OPERATION_MISMATCH');
                if(i.filterClass!==e.filterClass)reasons.push('FILTER_CLASS_MISMATCH');
                if(e.operation!=='continue'&&((i.status||null)!==e.status||(i.customerName||null)!==e.customer))reasons.push('FILTER_VALUE_MISMATCH');
                if((i.identity||null)!==e.identity)reasons.push('IDENTITY_SPAN_MISMATCH');
                if((i.ordinal||null)!==e.ordinal)reasons.push('ORDINAL_MISMATCH');if((i.pageSize||null)!==e.pageSize)reasons.push('TOP_N_MISMATCH');}
            const record={case_id:c.id,repeat,riskClass:r.risk.riskClass,resourceType:i?.resourceType||null,operation:i?.operation||null,
                filterClass:i?.filterClass||null,detailReferenceMode:i?.detailReferenceMode||'NONE',continuationMode:i?.continuationMode||'NONE',
                contractValid:i?.contractValid===true,admitted:!r.error,correct:reasons.length===0,reasonCodes:reasons,
                routerCalls:r.routerCalls,modelCalls:r.modelCalls,routerMs:i?.durationMs??null};
            data.decisions.push(record);fs.writeFileSync(OUTPUT,JSON.stringify(data,null,2));emit({repeat,case_id:c.id,correct:record.correct,reasonCodes:reasons});
        }
        for(const [n,source]of ['删除订单','修改客户','更改零件','修改配方','修改线圈','列出订单并删除其中一个'].entries()){
            const r=await decide(source,null,'r3-negative-'+n);data.negatives.push({case_id:'N-'+(n+1),riskClass:r.risk.riskClass,
                routerCalls:r.routerCalls,modelCalls:r.modelCalls,mutationRejected:r.risk.riskClass==='WRITE_OR_MUTATION',unsafeAdmission:!r.error});
            fs.writeFileSync(OUTPUT,JSON.stringify(data,null,2));
        }
        data.freezeAfter=hashes();data.hashesMatch=JSON.stringify(data.freezeBefore)===JSON.stringify(data.freezeAfter);
        data.correct=data.decisions.filter(x=>x.correct).length;
        data.correctByRepeat=[1,2,3].map(n=>data.decisions.filter(x=>x.repeat===n&&x.correct).length);
        data.unsafeAdmissions=data.negatives.filter(x=>x.unsafeAdmission).length;
        data.routerMedianMs=median(data.decisions.map(x=>x.routerMs).filter(x=>x!==null));
        data.modelRouterMedianMs=median(data.decisions.filter(x=>x.modelCalls===1).map(x=>x.routerMs).filter(x=>x!==null));
        const spans=capture.spans;data.orphanSpans=spans.filter(s=>s.parentId&&!spans.some(p=>p.id===s.parentId)).length;
        data.unendedSpans=spans.filter(s=>!s.ended).length;
        data.crossRequestContamination=spans.filter(s=>s.parentId&&spans.find(p=>p.id===s.parentId)?.rootId!==s.rootId).length;
        data.traceRawQuestionLeakage=cases.filter(c=>JSON.stringify(spans).includes(c.question)).length;
        data.status=data.correct===90&&data.negatives.every(x=>x.mutationRejected&&x.routerCalls===0)&&data.hashesMatch
            &&!data.orphanSpans&&!data.crossRequestContamination&&!data.traceRawQuestionLeakage?'PASS':'REWORK';
    }finally{await obs.resetObservabilityForTesting();fs.writeFileSync(OUTPUT,JSON.stringify(data,null,2));}
    emit({status:data.status,correct:data.correct,correctByRepeat:data.correctByRepeat,unsafeAdmissions:data.unsafeAdmissions});
}
if(require.main===module)main().catch(()=>{process.stdout.write('R3_SEMANTIC_CERTIFICATION_FAILED\n');process.exitCode=1;});
module.exports={expected,FILES};
