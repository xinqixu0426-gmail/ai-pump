'use strict';
const http = require('node:http'), fs = require('node:fs'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { openFixture, fixtures, freezeHashes } = require('./run-ai-v5f1b-read-certification.cjs');
const { dbSnapshot } = require('./run-ai-v5e4r-nested-refinement-evaluation.cjs');
const { createV5ShadowMirror } = require('../api/services/ai-v5/shadowMirror.cjs');
const { captureSafeV4ShadowFacts } = require('../api/services/ai-v5/shadowProjection.cjs');
const { createV5InterpreterInputEnvelope } = require('../api/services/ai-v5/taskInterpreterInput.cjs');
const { runV5IndependentShadow } = require('../api/services/ai-v5/independentShadow.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function stats(values) { const a = [...values].sort((a,b)=>a-b); return { median:a[Math.ceil(a.length*.5)-1],p95:a[Math.ceil(a.length*.95)-1] }; }
async function main() {
    const output = 'docs/ai-governance/data/v5-f1b-performance-certification.json';
    if (fs.existsSync(output)) throw Error('PERFORMANCE_CERTIFICATION_ALREADY_STARTED');
    process.env.AI_OBSERVABILITY_ENABLED = 'false';
    const before = dbSnapshot(), preHashes = freezeHashes();
    const fixture = await openFixture();
    const source = fixtures(fixture.db).get('FLAT_BLADE_PRICE');
    const records = [];
    let totalExecutions = 0;
    fs.writeFileSync(output, JSON.stringify({ status:'STARTED',preHashes })+'\n',{flag:'wx'});
    try {
        const orders = [['A','B','C','D_CONTROL','D'],['B','C','D','A','D_CONTROL'],['D','D_CONTROL','A','C','B']];
        for (let set=0;set<3;set++) for (const mode of orders[set]) {
            const enabled=mode!=='A', execution=['C','D'].includes(mode), width=mode.startsWith('D')?4:1;
            const env={...process.env,AI_V5_SHADOW_ENABLED:String(enabled),AI_V5_EXECUTION_SHADOW_ENABLED:String(execution),AI_V5_SHADOW_SAMPLE_RATE:'1'};
            const commits=[],clients=[],completions=[],jobs=[],states=new Map();
            let measured=false, toolCalls=0, beforeFinish=0;
            const mirror=createV5ShadowMirror({env,runIndependent:async input=>{
                const state=states.get(input.shadowTaskId);
                if(!state.finished)beforeFinish++;
                const result=await runV5IndependentShadow(input,{env,interpret:async()=>{
                    await delay(2);
                    return {status:'VALID',reasonCode:'SYNTHETIC_INTERPRETER',modelCalls:0,
                        interpretation:{version:1,domain:'catalog',operation:'read_inventory',entityCandidates:[{entityType:'part',candidateText:source.mention}],needsClarification:false,reasonCodes:[]},
                        resolvedIdentity:{entityType:'part',canonicalId:source.id,matchKind:'EXACT'},
                        architectureMetadata:{complete:true,finalEntityStatus:'FINAL_ENTITY_RESOLVED'}};
                }});
                if(execution){ assert.equal(result.readExecution?.verificationStatus,'PASS'); assert.equal(result.readExecution.toolCalls,1);toolCalls++; }
                return result;
            }});
            const server=http.createServer(async(_,res)=>{
                const start=performance.now(), id=crypto.randomUUID(), state={finished:false};states.set(id,state);
                const envelope=enabled?createV5InterpreterInputEnvelope({rawUserRequest:source.mention,pageContext:null}):null;
                await delay(20);
                let job;
                if(enabled){const facts=captureSafeV4ShadowFacts({requestId:id},{intent:{mode:'query'},telemetry:{outcome:'completed',toolSteps:[{capabilityName:'search_parts',success:true}]}},{traceId:crypto.randomBytes(16).toString('hex')},{shadowTaskId:id});
                    job=mirror.mirror(facts,{interpreterEnvelope:envelope});assert.equal(job.shadowStatus,'SCHEDULED');}
                res.on('finish',()=>{state.finished=true;if(measured)commits.push(performance.now()-start);});
                res.end('synthetic-v4-response');
                jobs.push(Promise.resolve(job?.completion).then(()=>{if(enabled&&measured)completions.push(performance.now()-start);states.delete(id);}));
            });
            await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
            const agent=new http.Agent({keepAlive:true,maxSockets:4});
            try {
                for(let batch=0;batch<55;batch++){
                    measured=batch>=5;
                    await Promise.all(Array.from({length:width},async()=>{
                        const start=performance.now();
                        await new Promise((resolve,reject)=>http.get({hostname:'127.0.0.1',port:server.address().port,agent},res=>{
                            let body='';res.on('data',d=>{body+=d;});res.on('end',()=>{assert.equal(body,'synthetic-v4-response');resolve();});
                        }).on('error',reject));
                        if(measured)clients.push(performance.now()-start);
                    }));
                    await Promise.all(jobs.splice(0)); // Never part of response latency.
                    assert.equal(await mirror.waitForIdle(1000),true);
                }
                assert.equal(commits.length,50*width);assert.equal(mirror.snapshot().shadowErrors,0);
                totalExecutions+=toolCalls;
                records.push({set:set+1,mode,concurrentRequests:width,warmupRequests:5*width,measuredRequests:50*width,
                    commitMs:stats(commits),clientMs:stats(clients),shadowCompletionMs:enabled?stats(completions):null,
                    toolCalls,beforeFinish,contamination:0});
            }finally{agent.destroy();await new Promise(resolve=>server.close(resolve));}
        }
        for(const r of records){const control=records.find(c=>c.set===r.set&&c.mode===(r.mode==='D'?'D_CONTROL':'A'));
            r.control=control.mode;r.overhead=Object.fromEntries(['median','p95'].map(k=>[k,(r.commitMs[k]/control.commitMs[k]-1)*100]));}
    } finally {
        const fixtureSafety=await fixture.close(),after=dbSnapshot(),postHashes=freezeHashes();
        const valid=records.length===15 && fixtureSafety.unchanged && JSON.stringify(before)===JSON.stringify(after)&&JSON.stringify(preHashes)===JSON.stringify(postHashes);
        const gate=valid && records.filter(r=>['B','C','D'].includes(r.mode)).every(r=>r.overhead.median<=5&&r.overhead.p95<=10);
        const data={status:valid?'COMPLETE':'INCOMPLETE',gate:gate?'PASS':'FAIL',records,totalExecutions,
            realModelCalls:0,writes:0,fixtureSafety,databaseBefore:before,databaseAfter:after,preHashes,postHashes,hashesMatch:JSON.stringify(preHashes)===JSON.stringify(postHashes),
            businessApiReadCalls:fixture.calls.length};
        fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n');
        console.log(JSON.stringify({status:data.status,gate:data.gate,totalExecutions,records}));
        assert.ok(valid,'CERTIFICATION_SAFETY_OR_COMPLETENESS_FAILED');
    }
}
if(require.main===module)main().catch(()=>{console.error('F1B_PERFORMANCE_BLOCKED');process.exitCode=1;});
