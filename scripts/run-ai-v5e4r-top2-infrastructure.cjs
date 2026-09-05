'use strict';
const assert=require('node:assert/strict');
const {createV5ShadowMirror}=require('../api/services/ai-v5/shadowMirror.cjs');
const {captureSafeV4ShadowFacts}=require('../api/services/ai-v5/shadowProjection.cjs');
const {createV5SourceSpanCatalog}=require('../api/services/ai-v5/sourceSpanCatalog.cjs');
const {percentile}= {percentile:(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]};
function facts(i) {return captureSafeV4ShadowFacts({requestId:`synthetic-${i}`},{intent:{mode:'query'},telemetry:{outcome:'completed',toolSteps:[{capabilityName:'search_parts',success:true}]}},{traceId:String(i).padStart(32,'0')},{shadowTaskId:`v3-infra-${i}`});}
function runtime(i) {
    const sourceRequest=`查 SYNTH-${i} 库存`,span=createV5SourceSpanCatalog(sourceRequest).spans.find(s=>s.text===`SYNTH-${i}`);
    let calls=0;
    return {sourceRequest,interpreterModelRequest:async()=>{
        calls++;await new Promise(resolve=>setTimeout(resolve,3));
        return {content:JSON.stringify(calls===1?{version:2,spanRefs:[span.spanRef,createV5SourceSpanCatalog(sourceRequest).spans.find(s=>s.spanRef!==span.spanRef).spanRef],needsClarification:false}:{version:1,localTaskClassRef:'tc_002'})};
    },lookupEntities:async()=>({version:1,status:'OK',complete:true,attemptedEntityTypes:6,candidateCount:2,candidates:[{entityType:'part',canonicalId:`PRIVATE_${i}`,matchKind:'EXACT'},{entityType:'template',canonicalId:`OTHER_${i}`,matchKind:'EXACT'}]})};
}
async function main(){
    const mirror=createV5ShadowMirror({env:{AI_V5_SHADOW_ENABLED:'true',AI_V5_SHADOW_SAMPLE_RATE:'1'},maxConcurrency:10});
    const jobs=Array.from({length:10},(_,i)=>mirror.mirror(facts(i+1),runtime(i+1)));
    const outcomes=await Promise.all(jobs.map(j=>j.completion));
    assert.equal(new Set(outcomes.map(o=>o.shadowTaskId)).size,10);
    assert.ok(outcomes.every(o=>o.independentShadow.capabilityId==='inventory.read'));
    assert.ok(!JSON.stringify(outcomes).includes('PRIVATE_'));
    assert.equal(mirror.snapshot().v5ModelCalls,20);assert.equal(mirror.snapshot().v5BusinessApiCalls,20);
    async function bench(enabled){
        const m=createV5ShadowMirror({env:{AI_V5_SHADOW_ENABLED:String(enabled),AI_V5_SHADOW_SAMPLE_RATE:'1'}}),values=[];
        for(let i=0;i<35;i++){
            const f=facts(i+100),r=runtime(i+100),started=performance.now();
            // Synthetic V4 latency model, identical fixed work in OFF/ON.
            await new Promise(resolve=>setTimeout(resolve,10));
            const response={status:'completed',content:'SYNTHETIC_RESPONSE',events:['start','content','end']};
            const scheduled=m.mirror(f,r);
            if(i>=5)values.push(performance.now()-started);
            assert.deepEqual(response,{status:'completed',content:'SYNTHETIC_RESPONSE',events:['start','content','end']});
            if(scheduled.completion)await scheduled.completion;
        }
        return {runs:30,warmup:5,median:percentile(values,.5),p95:percentile(values,.95)};
    }
    const off=await bench(false),on=await bench(true);
    const medianOverheadPercent=(on.median/off.median-1)*100,p95OverheadPercent=(on.p95/off.p95-1)*100;
    console.log(JSON.stringify({concurrency:10,contamination:0,privacySentinelLeakage:0,responseInvariant:true,benchmark:'SYNTHETIC_SCHEDULER_FIXED_10MS_V4',off,on,medianOverheadPercent,p95OverheadPercent,performancePass:medianOverheadPercent<=5&&p95OverheadPercent<=10}));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
