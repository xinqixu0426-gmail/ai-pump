'use strict';
// Audit-only instrumentation. No production module or scheduling policy is edited.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { AsyncLocalStorage } = require('node:async_hooks');
const dc = require('node:diagnostics_channel');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function stats(values) {
    const a = [...values].sort((x,y)=>x-y);
    return { count:a.length, median:a[Math.ceil(a.length*.5)-1] ?? null, p95:a[Math.ceil(a.length*.95)-1] ?? null };
}
function intersection(a,b,c,d) { return Math.max(0, Math.min(b,d)-Math.max(a,c)); }
function maxConcurrent(intervals, start, end) {
    const points = intervals.filter(x=>intersection(start,end,x.start,x.end)>0)
        .flatMap(x=>[[Math.max(start,x.start),1],[Math.min(end,x.end),-1]])
        .sort((a,b)=>a[0]-b[0] || a[1]-b[1]);
    let active=0,max=0; for(const [,delta] of points){active+=delta;max=Math.max(max,active);} return max;
}
function selfTest() {
    assert.equal(intersection(0,4,2,5),2);assert.equal(intersection(0,2,2,4),0);
    assert.equal(maxConcurrent([{start:0,end:3},{start:2,end:4}],0,5),2);
    assert.equal(maxConcurrent([{start:0,end:2},{start:2,end:4}],0,5),1);
    assert.deepEqual(stats([4,3,2,1]),{count:4,median:2,p95:4});
    console.log('AUDIT_METRIC_TESTS_PASS');
}
function fileState(file) {
    const s=fs.statSync(file);return {hash:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),mtimeMs:s.mtimeMs,size:s.size};
}
function businessState(root) {
    let backups=0;
    function walk(p){if(!fs.existsSync(p))return;for(const e of fs.readdirSync(p,{withFileTypes:true})){if(e.isDirectory())walk(path.join(p,e.name));else backups++;}}
    for(const p of ['backups','api/backups'])walk(path.join(root,p));
    return {...fileState(path.join(root,'pump.db')),backups};
}
function trackedHashes(root) {
    const files=execFileSync('git',['ls-files','-z'],{cwd:root}).toString().split('\0').filter(Boolean);
    return Object.fromEntries(files.map(f=>[f,fileState(path.join(root,f)).hash]));
}
async function main() {
    const cleanRoot=path.resolve(process.argv[2]), mainRoot=path.resolve(process.argv[3]);
    const output=path.join(mainRoot,'docs/ai-governance/data/v5-f1c-cross-request-contention-audit.json');
    assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:cleanRoot}).toString().trim(),'b98b5b81dca1d9fa3f482930a2aff9d95e10fa2c');
    assert.equal(execFileSync('git',['diff','--name-only','HEAD'],{cwd:cleanRoot}).toString().trim(),'');
    assert.ok(!fs.existsSync(output),'AUDIT_ALREADY_STARTED');
    const before=businessState(mainRoot), productionBefore=trackedHashes(cleanRoot);
    const load=f=>require(path.join(cleanRoot,f));
    process.chdir(cleanRoot);process.env.AI_OBSERVABILITY_ENABLED='false';
    const {openFixture,fixtures}=load('scripts/run-ai-v5f1b-read-certification.cjs');
    const fixture=await openFixture(), source=fixtures(fixture.db).get('FLAT_BLADE_PRICE');
    const {createV5ShadowMirror}=load('api/services/ai-v5/shadowMirror.cjs');
    const {captureSafeV4ShadowFacts}=load('api/services/ai-v5/shadowProjection.cjs');
    const {createV5InterpreterInputEnvelope}=load('api/services/ai-v5/taskInterpreterInput.cjs');
    const {runV5IndependentShadow}=load('api/services/ai-v5/independentShadow.cjs');
    const executionModule=load('api/services/ai-v5/readExecutionShadow.cjs');
    const realExecution=executionModule.runReadExecutionShadow;
    const context=new AsyncLocalStorage(), requestMap=new WeakMap();
    let current=null;
    // Only timestamps and generated task IDs are retained. URL/headers/payload are never copied.
    const onCreate=({request})=>{const s=context.getStore();if(!s)return;const e={requestId:s.id,start:performance.now(),end:null};s.http.push(e);requestMap.set(request,e);};
    const onEnd=({request})=>{const e=requestMap.get(request);if(e&&e.end===null)e.end=performance.now();};
    dc.subscribe('undici:request:create',onCreate);dc.subscribe('undici:request:trailers',onEnd);dc.subscribe('undici:request:error',onEnd);
    executionModule.runReadExecutionShadow=async(input,options)=>{
        const s=current.states.get(input.task.taskId);assert.ok(s,'TASK_CROSSING');
        if(current.mode==='C' && current.foreground.size) await new Promise(resolve=>current.waiters.push(resolve));
        s.v5ExecutionStart=performance.now();s.runningAtStart=++current.running;
        try {
            // Delegates to the actual function, without injecting an Executor or fetch.
            const result=await context.run(s,()=>realExecution(input,options));
            assert.equal(result.verificationStatus,'PASS');assert.equal(result.toolCalls,1);assert.equal(result.writes,0);
            s.executionStatus='PASS';return result;
        } finally {s.v5ExecutionEnd=performance.now();current.running--;}
    };
    const plan={sets:3,loads:[2,4,8],warmupForeground:24,measuredForeground:200,
        foregroundDelay:'20 + 2 * burst index milliseconds',arrival:'simultaneous burst; wait outside metric for shadow settlement',
        enrolledShadowsPerBurst:'min(load,4), first positions, identical in A/B/C',
        modeD:'same per-burst Tool workload, no foreground HTTP; 200 or more measured executions',
        percentile:'nearest rank ceil(n*p), unchanged from A2',schedulerConcurrency:4,
        modeC:'harness-only barrier immediately before real readExecutionShadow',
        comparison:'B/A and C/A within same set/load; all sets retained',
        importantLimitation:'At load 8 only four shadows are enrolled to keep B/C executed Tool workload equal; not a full-admission saturation test'};
    const records=[];fs.writeFileSync(output,JSON.stringify({status:'STARTED',plan})+'\n',{flag:'wx'});
    let fatal=null;
    try {
        for(let set=1;set<=3;set++) for(const width of plan.loads) {
            const order=[['A','B','C','D'],['C','D','A','B'],['B','A','D','C']][set-1];
            for(const mode of order) {
                current={mode,states:new Map(),foreground:new Set(),waiters:[],running:0};
                const env={...process.env,AI_V5_SHADOW_ENABLED:'true',AI_V5_EXECUTION_SHADOW_ENABLED:String(mode!=='A'),AI_V5_SHADOW_SAMPLE_RATE:'1'};
                const mirror=createV5ShadowMirror({env,runIndependent:input=>runV5IndependentShadow(input,{env,interpret:async()=>{
                    await delay(2);return {status:'VALID',reasonCode:'FIXTURE_INTERPRETER',modelCalls:0,
                        interpretation:{version:1,domain:'catalog',operation:'read_inventory',entityCandidates:[{entityType:'part',candidateText:source.mention}],needsClarification:false,reasonCodes:[]},
                        resolvedIdentity:{entityType:'part',canonicalId:source.id,matchKind:'EXACT'},
                        architectureMetadata:{complete:true,finalEntityStatus:'FINAL_ENTITY_RESOLVED'}};
                }})});
                assert.equal(mirror.config.maxConcurrency,4);
                const all=[],jobs=[];let measured=false, ordinal=0;
                function schedule(s) {
                    const envelope=createV5InterpreterInputEnvelope({rawUserRequest:source.mention,pageContext:null});
                    const facts=captureSafeV4ShadowFacts({requestId:s.id},{intent:{mode:'query'},telemetry:{outcome:'completed',toolSteps:[{capabilityName:'search_parts',success:true}]}},
                        {traceId:crypto.randomBytes(16).toString('hex')},{shadowTaskId:s.id});
                    s.v5ShadowSchedule=performance.now();const job=mirror.mirror(facts,{interpreterEnvelope:envelope});s.scheduleStatus=job.shadowStatus;
                    assert.equal(job.shadowStatus,'SCHEDULED','UNEQUAL_ADMITTED_WORKLOAD');
                    jobs.push(job.completion.then(r=>{assert.notEqual(r.comparisonStatus,'SHADOW_ERROR');s.shadowEnd=performance.now();}));
                }
                function state(index) {
                    const s={id:crypto.randomUUID(),measured,index,requestStart:null,v4ResponseCommit:null,v5ShadowSchedule:null,v5ExecutionStart:null,v5ExecutionEnd:null,http:[]};
                    current.states.set(s.id,s);all.push(s);return s;
                }
                const server=http.createServer(async(req,res)=>{
                    const index=ordinal++%width,s=state(index);s.requestStart=performance.now();current.foreground.add(s.id);
                    res.on('finish',()=>{
                        s.v4ResponseCommit=performance.now();current.foreground.delete(s.id);
                        if(!current.foreground.size)for(const release of current.waiters.splice(0))release();
                    });
                    await delay(20+2*index);
                    if(index<Math.min(width,4))schedule(s);
                    res.end('fixture-foreground-response');
                });
                await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
                const agent=new http.Agent({keepAlive:true,maxSockets:8});
                const histogram=monitorEventLoopDelay({resolution:1});histogram.enable();
                let cpuStart,wallStart,eluStart;
                const perBatch=mode==='D'?Math.min(width,4):width;
                const warmBatches=Math.ceil(24/perBatch),measuredBatches=Math.ceil(200/perBatch);
                try {
                    for(let batch=0;batch<warmBatches+measuredBatches;batch++) {
                        measured=batch>=warmBatches;
                        if(batch===warmBatches){histogram.reset();cpuStart=process.cpuUsage();wallStart=performance.now();eluStart=performance.eventLoopUtilization();}
                        if(mode==='D'){for(let i=0;i<perBatch;i++)schedule(state(i));}
                        else await Promise.all(Array.from({length:width},()=>new Promise((resolve,reject)=>{
                            http.get({hostname:'127.0.0.1',port:server.address().port,agent},res=>{
                                let body='';res.on('data',x=>body+=x);res.on('end',()=>{try{assert.equal(res.statusCode,200);assert.equal(body,'fixture-foreground-response');resolve();}catch(e){reject(e);}});
                            }).on('error',reject);
                        })));
                        await Promise.all(jobs.splice(0));assert.equal(await mirror.waitForIdle(1000),true);
                        assert.equal(current.foreground.size,0);assert.equal(current.running,0);
                    }
                    const cpu=process.cpuUsage(cpuStart),wall=performance.now()-wallStart;
                    const measuredRows=all.filter(s=>s.measured), foreground=measuredRows.filter(s=>s.requestStart!==null);
                    const executions=measuredRows.filter(s=>s.v5ExecutionStart!==null);
                    const httpIntervals=measuredRows.flatMap(s=>s.http);assert.ok(httpIntervals.every(x=>x.end!==null));
                    const execIntervals=executions.map(s=>({start:s.v5ExecutionStart,end:s.v5ExecutionEnd}));
                    let overlapPairs=0,overlapPairMs=0,overlapExecutions=0,ownBefore=0;
                    for(const e of executions) {
                        let overlapped=false;
                        if(e.v4ResponseCommit!==null&&e.v5ExecutionStart<e.v4ResponseCommit)ownBefore++;
                        for(const f of foreground)if(f.id!==e.id){const ms=intersection(e.v5ExecutionStart,e.v5ExecutionEnd,f.requestStart,f.v4ResponseCommit);if(ms){overlapPairs++;overlapPairMs+=ms;overlapped=true;}}
                        if(overlapped)overlapExecutions++;
                    }
                    for(const f of foreground){f.httpConcurrentMax=maxConcurrent(httpIntervals,f.requestStart,f.v4ResponseCommit);f.executionConcurrentMax=maxConcurrent(execIntervals,f.requestStart,f.v4ResponseCommit);}
                    if(mode==='C')assert.equal(overlapPairs,0,'NO_OVERLAP_CONTROL_INVALID');
                    assert.equal(httpIntervals.length,executions.length,'HTTP_INSTRUMENTATION_INCOMPLETE');
                    const group=(field,predicate)=>stats(foreground.filter(s=>predicate(s[field])).map(s=>s.v4ResponseCommit-s.requestStart));
                    const row={set,load:width,mode,warmup:24,measuredForeground:foreground.length,measuredExecutions:executions.length,
                        commitMs:stats(foreground.map(s=>s.v4ResponseCommit-s.requestStart)),executionMs:stats(executions.map(s=>s.v5ExecutionEnd-s.v5ExecutionStart)),
                        shadowMs:stats(measuredRows.filter(s=>s.shadowEnd).map(s=>s.shadowEnd-s.v5ShadowSchedule)),
                        internalHttpMs:stats(httpIntervals.map(s=>s.end-s.start)),overlapPairs,overlapPairMs,overlapExecutions,ownBefore,
                        httpForegroundMax:Math.max(0,...foreground.map(s=>s.httpConcurrentMax)),
                        lowHttpWindows:group('httpConcurrentMax',n=>n===0),highHttpWindows:group('httpConcurrentMax',n=>n>0),
                        runningBelow3:group('executionConcurrentMax',n=>n<3),running3Or4:group('executionConcurrentMax',n=>n>=3),
                        maxRunning:Math.max(0,...executions.map(s=>s.runningAtStart)),scheduler:mirror.snapshot(),
                        eventLoopDelayMs:{p50:histogram.percentile(50)/1e6,p95:histogram.percentile(95)/1e6,max:histogram.max/1e6},
                        cpuOneCorePercent:(cpu.user+cpu.system)/1000/wall*100,eventLoopUtilization:performance.eventLoopUtilization(eluStart).utilization,
                        timings:measuredRows};
                    records.push(row);console.log(JSON.stringify({set,load:width,mode,commit:row.commitMs,overlapExecutions,executions:executions.length}));
                } finally {histogram.disable();agent.destroy();await new Promise(resolve=>server.close(resolve));}
            }
        }
        for(const r of records){if(r.mode==='D')continue;const a=records.find(x=>x.set===r.set&&x.load===r.load&&x.mode==='A');
            r.overhead=Object.fromEntries(['median','p95'].map(k=>[k,(r.commitMs[k]/a.commitMs[k]-1)*100]));}
    } catch(error){fatal=error.code||'AUDIT_INVARIANT_FAILURE';console.error(fatal);}
    finally {
        executionModule.runReadExecutionShadow=realExecution;
        dc.unsubscribe('undici:request:create',onCreate);dc.unsubscribe('undici:request:trailers',onEnd);dc.unsubscribe('undici:request:error',onEnd);
        const fixtureSafety=await fixture.close(),after=businessState(mainRoot),productionAfter=trackedHashes(cleanRoot);
        const safety={databaseUnchanged:JSON.stringify(before)===JSON.stringify(after),fixtureSafety,
            productionUnchanged:JSON.stringify(productionBefore)===JSON.stringify(productionAfter)};
        const data={status:!fatal&&records.length===36&&safety.databaseUnchanged&&fixtureSafety.unchanged&&safety.productionUnchanged?'COMPLETE':'INCOMPLETE',
            baselineCommit:'b98b5b81dca1d9fa3f482930a2aff9d95e10fa2c',node:process.version,plan,records,safety,before,after,
            realModelCalls:0,writes:0,businessMutationCalls:0,businessApiReadCalls:fixture.calls.length,fatal};
        // Block accidental source-text persistence; no argument/result/identity values are serialized.
        assert.ok(!JSON.stringify(data).includes(source.mention),'SOURCE_PRIVACY_FAILURE');
        fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n');console.log(JSON.stringify({status:data.status,safety,readCalls:fixture.calls.length}));
        if(data.status!=='COMPLETE')process.exitCode=1;
    }
}
if(require.main===module){if(process.argv.includes('--self-test'))selfTest();else main().catch(()=>{console.error('AUDIT_SETUP_BLOCKED');process.exitCode=1;});}
module.exports={stats,intersection,maxConcurrent};
