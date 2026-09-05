'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process');
const {AsyncLocalStorage}=require('node:async_hooks'),dc=require('node:diagnostics_channel');
const {performance,monitorEventLoopDelay,PerformanceObserver}=require('node:perf_hooks');
const BASE='b2c263d3370d69f5636ef0806d02779b30f571bc';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const quantile=(a,p)=>[...a].sort((x,y)=>x-y)[Math.ceil(a.length*p)-1]??null;
const stats=a=>({count:a.length,median:quantile(a,.5),p95:quantile(a,.95)});
function schedule(width){return Array.from({length:(24+200)/width},(_,batch)=>({offsetMs:batch*80,measured:batch>=24/width,
    requests:Array.from({length:width},(_,index)=>({index,foregroundMs:20+2*index}))}));}
function orders(width){let seed=0x163b+width;const values=Array.from({length:10},(_,i)=>i<5?['OFF','ON']:['ON','OFF']);
    for(let i=values.length-1;i>0;i--){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const j=seed%(i+1);[values[i],values[j]]=[values[j],values[i]];}return values;}
function database(root){const f=path.join(root,'pump.db'),s=fs.statSync(f);let backups=0;
    function walk(p){if(!fs.existsSync(p))return;for(const e of fs.readdirSync(p,{withFileTypes:true})){if(e.isDirectory())walk(path.join(p,e.name));else backups++;}}
    ['backups','api/backups'].forEach(p=>walk(path.join(root,p)));
    return {hash:hash(fs.readFileSync(f)),mtimeMs:s.mtimeMs,size:s.size,backups};}
function filesHash(root){const files=execFileSync('git',['ls-files','-z'],{cwd:root}).toString().split('\0').filter(Boolean);
    return hash(JSON.stringify(files.map(f=>[f,hash(fs.readFileSync(path.join(root,f)))])));}
function overlap(a,b,c,d){return Math.max(0,Math.min(b,d)-Math.max(a,c));}
function maximum(intervals){let n=0,max=0;const points=intervals.flatMap(x=>[[x.start,1],[x.end,-1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    for(const [,v]of points){n+=v;max=Math.max(max,n);}return max;}
function selfTest(){for(const width of [2,4,8]){assert.equal(orders(width).filter(o=>o[0]==='OFF').length,5);
    assert.equal(schedule(width).filter(b=>b.measured).reduce((n,b)=>n+b.requests.length,0),200);
    assert.equal(hash(JSON.stringify(schedule(width))),hash(JSON.stringify(schedule(width))));}
    assert.deepEqual(stats([4,1,2,3]),{count:4,median:2,p95:4});assert.equal(maximum([{start:0,end:2},{start:2,end:4}]),1);
    assert.equal(overlap(0,4,2,6),2);console.log('PAIRED_METRIC_DESIGN_TESTS_PASS');}
async function worker(root,width,trial,order) {
    process.chdir(root);process.env.AI_OBSERVABILITY_ENABLED='false';
    const load=f=>require(path.join(root,f));
    const {openFixture,fixtures}=load('scripts/run-ai-v5f1b-read-certification.cjs');
    const fixture=await openFixture(),source=fixtures(fixture.db).get('FLAT_BLADE_PRICE');
    const {createInternalFetch,getJson}=load('api/routes/ai/internalApiClient.cjs');
    const reference=await getJson(createInternalFetch(),'/api/parts?keyword='+encodeURIComponent(source.mention));
    const shape=r=>({id:String(r.id??r.Id),model:r.model,stock:r.stock,price:r.price});
    const expected=hash(JSON.stringify(reference.map(shape)));
    const compare=r=>Array.isArray(r.parts)&&hash(JSON.stringify(r.parts.map(shape)))===expected?'MATCH':'MISMATCH';
    assert.equal(compare({parts:reference}),'MATCH');assert.equal(compare({parts:[]}), 'MISMATCH');
    const {runV5IndependentShadow}=load('api/services/ai-v5/independentShadow.cjs');
    const {createV5InterpreterInputEnvelope}=load('api/services/ai-v5/taskInterpreterInput.cjs');
    const {createV5ShadowMirror}=load('api/services/ai-v5/shadowMirror.cjs');
    const {captureSafeV4ShadowFacts}=load('api/services/ai-v5/shadowProjection.cjs');
    const execution=load('api/services/ai-v5/readExecutionShadow.cjs'),real=execution.runReadExecutionShadow;
    const als=new AsyncLocalStorage(),httpMap=new WeakMap();let block=null;
    const onCreate=({request})=>{const s=als.getStore();if(!s)return;const e={start:performance.now(),end:null};s.http.push(e);httpMap.set(request,e);};
    const onEnd=({request})=>{const e=httpMap.get(request);if(e&&e.end===null)e.end=performance.now();};
    dc.subscribe('undici:request:create',onCreate);dc.subscribe('undici:request:trailers',onEnd);dc.subscribe('undici:request:error',onEnd);
    execution.runReadExecutionShadow=async(input,options)=>{const s=block?.states.get(input.task.taskId);
        if(!s)return real(input,options);s.v5ExecutionStart=performance.now();
        try {return await als.run(s,()=>real(input,options));}finally{s.v5ExecutionEnd=performance.now();}};
    const interpret=async()=>{await delay(2);return {status:'VALID',reasonCode:'FIXTURE_INTERPRETER',modelCalls:0,
        interpretation:{version:1,domain:'catalog',operation:'read_inventory',entityCandidates:[{entityType:'part',candidateText:source.mention}],needsClarification:false,reasonCodes:[]},
        resolvedIdentity:{entityType:'part',canonicalId:source.id,matchKind:'EXACT'},architectureMetadata:{complete:true,finalEntityStatus:'FINAL_ENTITY_RESOLVED'}};};
    const baseEnv={...process.env,AI_V5_SHADOW_ENABLED:'true',AI_V5_SHADOW_SAMPLE_RATE:'1'};
    async function sanity(){const result=await runV5IndependentShadow({shadowTaskId:crypto.randomUUID(),sourceRequest:source.mention},
        {env:{...baseEnv,AI_V5_EXECUTION_SHADOW_ENABLED:'true'},interpret,compareReadResult:compare});
        assert.equal(result.readExecution?.verificationStatus,'PASS');assert.equal(result.readExecution.resultComparison,'MATCH');assert.equal(result.v5Writes,0);return 'PASS';}
    const modes=[];let beforeSanity,afterSanity;
    const server=http.createServer(async(req,res)=>{
        const n=Number(req.headers['x-fixture-sequence']),planned=block.flat[n];
        assert.ok(planned);const s={id:crypto.randomUUID(),sequence:n,index:planned.index,measured:planned.measured,
            requestStart:performance.now(),v4ResponseCommit:null,v5ExecutionStart:null,v5ExecutionEnd:null,http:[]};
        block.states.set(s.id,s);block.rows.push(s);
        res.once('finish',()=>{s.v4ResponseCommit=performance.now();});
        await delay(planned.foregroundMs);
        const envelope=createV5InterpreterInputEnvelope({rawUserRequest:source.mention,pageContext:null});
        const facts=captureSafeV4ShadowFacts({requestId:s.id},{intent:{mode:'query'},telemetry:{outcome:'completed',toolSteps:[{capabilityName:'search_parts',success:true}]}},
            {traceId:crypto.randomBytes(16).toString('hex')},{shadowTaskId:s.id});
        s.v5ShadowSchedule=performance.now();const job=block.mirror.mirror(facts,{interpreterEnvelope:envelope});s.scheduleStatus=job.shadowStatus;
        if(job.completion)block.jobs.push(job.completion.then(r=>{assert.notEqual(r.comparisonStatus,'SHADOW_ERROR');
            if(block.mode==='ON'){assert.equal(r.independentShadow?.readExecution?.verificationStatus,'PASS');assert.equal(r.independentShadow.readExecution.resultComparison,'MATCH');}
            s.shadowEnd=performance.now();}));
        else assert.ok(['SHADOW_EXECUTION_SKIPPED_CAPACITY','SHADOW_SKIPPED_CAPACITY'].includes(job.shadowStatus));
        res.end('paired-fixture-response');
    });
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const agent=new http.Agent({keepAlive:true,maxSockets:8});
    let fixtureSafety;
    try {
        beforeSanity=await sanity();
        for(const mode of order){
            const env={...baseEnv,AI_V5_EXECUTION_SHADOW_ENABLED:String(mode==='ON')};
            const plan=schedule(width),flat=plan.flatMap(b=>b.requests.map(r=>({...r,measured:b.measured})));
            block={mode,states:new Map(),rows:[],jobs:[],flat};
            block.mirror=createV5ShadowMirror({env,runIndependent:input=>runV5IndependentShadow(input,{env,interpret,compareReadResult:compare})});
            assert.equal(block.mirror.config.maxConcurrency,4);
            const hist=monitorEventLoopDelay({resolution:1}),gc=[];
            const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())gc.push({start:e.startTime,duration:e.duration,kind:e.detail?.kind??null});});
            observer.observe({entryTypes:['gc']});hist.enable();
            const arrivalLags=[],requests=[];let cpuStart,eluStart,measuredStart,sequence=0,reused=0;
            const origin=performance.now();
            for(const b of plan){
                const target=origin+b.offsetMs;await delay(Math.max(0,target-performance.now()));
                if(b.measured&&measuredStart===undefined){measuredStart=performance.now();cpuStart=process.cpuUsage();eluStart=performance.eventLoopUtilization();hist.reset();}
                if(b.measured)arrivalLags.push(performance.now()-target);
                for(const r of b.requests){const n=sequence++;requests.push(new Promise((resolve,reject)=>{
                    const request=http.get({hostname:'127.0.0.1',port:server.address().port,agent,headers:{'x-fixture-sequence':String(n)}},res=>{
                        let body='';res.on('data',x=>body+=x);res.on('end',()=>{try{assert.equal(res.statusCode,200);assert.equal(body,'paired-fixture-response');if(b.measured&&request.reusedSocket)reused++;resolve();}catch(e){reject(e);}});
                    }).on('error',reject);
                }));}
            }
            await Promise.all(requests);await Promise.all(block.jobs);assert.equal(await block.mirror.waitForIdle(1000),true);
            const end=performance.now(),cpu=process.cpuUsage(cpuStart),elu=performance.eventLoopUtilization(eluStart);
            const rows=block.rows.filter(s=>s.measured);assert.equal(rows.length,200);
            const execs=rows.filter(s=>s.v5ExecutionStart!==null),intervals=execs.flatMap(s=>s.http);
            assert.ok(intervals.every(x=>x.end!==null));assert.equal(intervals.length,execs.length);
            let cross=0;for(const s of execs)if(rows.some(f=>f.id!==s.id&&overlap(s.v5ExecutionStart,s.v5ExecutionEnd,f.requestStart,f.v4ResponseCommit)>0))cross++;
            // Drain observer delivery outside the user latency metric.
            await new Promise(r=>setImmediate(r));hist.disable();observer.disconnect();
            modes.push({mode,schedule_hash:hash(JSON.stringify(plan)),warmup:24,measured:200,latency:stats(rows.map(s=>s.v4ResponseCommit-s.requestStart)),
                completion:stats(execs.map(s=>s.v5ExecutionEnd-s.v5ExecutionStart)),cross_request_overlap_count:cross,max_internal_http_concurrency:maximum(intervals),
                own_pre_finish:execs.filter(s=>s.v5ExecutionStart<s.v4ResponseCommit).length,
                execution_count:execs.length,allExecutionCount:block.rows.filter(s=>s.v5ExecutionStart!==null).length,
                scheduler:block.mirror.snapshot(),foregroundKeepAliveReused:reused,arrivalLagMs:stats(arrivalLags),
                eventLoopDelayMs:{median:hist.percentile(50)/1e6,p95:hist.percentile(95)/1e6,max:hist.max/1e6},
                cpuOneCorePercent:(cpu.user+cpu.system)/1000/(end-measuredStart)*100,eventLoopUtilization:elu.utilization,
                gc:gc.filter(g=>g.start>=measuredStart&&g.start<=end),timings:rows});
        }
        block=null;afterSanity=await sanity();
    }finally{
        execution.runReadExecutionShadow=real;dc.unsubscribe('undici:request:create',onCreate);dc.unsubscribe('undici:request:trailers',onEnd);dc.unsubscribe('undici:request:error',onEnd);
        agent.destroy();await new Promise(r=>server.close(r));fixtureSafety=await fixture.close();
    }
    assert.ok(fixtureSafety.unchanged);assert.ok(fixture.calls.every(c=>c.method==='GET'));
    const off=modes.find(m=>m.mode==='OFF'),on=modes.find(m=>m.mode==='ON');assert.equal(off.schedule_hash,on.schedule_hash);
    const result={trial_id:`load-${width}-trial-${trial}`,load_level:width,mode_order:order,schedule_hash:off.schedule_hash,
        off_median_ms:off.latency.median,on_median_ms:on.latency.median,median_delta_ms:on.latency.median-off.latency.median,
        median_overhead_percent:(on.latency.median/off.latency.median-1)*100,
        off_p95_ms:off.latency.p95,on_p95_ms:on.latency.p95,p95_delta_ms:on.latency.p95-off.latency.p95,
        p95_overhead_percent:(on.latency.p95/off.latency.p95-1)*100,cross_request_overlap_count:on.cross_request_overlap_count,
        max_internal_http_concurrency:on.max_internal_http_concurrency,validity:'VALID',reasonCodes:[],modes,
        beforeSanity,afterSanity,fixtureSafety,realModelCalls:0,writes:0,businessMutationCalls:0,businessApiReadCalls:fixture.calls.length};
    result.gate=result.median_overhead_percent<=5&&result.p95_overhead_percent<=10?'PASS':'FAIL';
    assert.ok(!JSON.stringify(result).includes(source.mention),'PRIVACY_FAILURE');
    console.log('PAIRED_RESULT='+JSON.stringify(result));
}
async function main(root,mainRoot){
    root=path.resolve(root);mainRoot=path.resolve(mainRoot);const output=path.join(mainRoot,'docs/ai-governance/data/v5-f1c-paired-performance-certification.json');
    assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root}).toString().trim(),BASE);
    assert.equal(execFileSync('git',['diff','--name-only','HEAD'],{cwd:root}).toString().trim(),'');assert.ok(!fs.existsSync(output),'CERTIFICATION_ALREADY_STARTED');
    const before=database(mainRoot),preHash=filesHash(root),scriptHash=hash(fs.readFileSync(__filename));
    const data={status:'STARTED',baselineCommit:BASE,node:process.version,scriptHash,plan:{trialsPerLoad:10,loads:[2,4,8],warmup:24,measuredPerMode:200,
        processStrategy:'fresh process per pair, same process and snapshot for OFF/ON',modeOrder:'seeded shuffle, exactly 5 OFF_ON and 5 ON_OFF per load',
        arrival:'fixed 80-ms burst offsets; foreground 20+2*position ms; identical hashed schedule per pair',
        admission:'all foreground requests offer a shadow; unchanged production sample=1 and capacity=4; capacity skips retained',
        connection:'same keepAlive agent maxSockets=8 and fixture server through pair; internal fetch unchanged; warmup both modes',
        onlyFlagDifference:'AI_V5_EXECUTION_SHADOW_ENABLED',interpreterShadow:'true in both modes; same fixture interpreter, no model calls',
        percentile:'nearest rank ceil(n*p)',gate:{medianPercent:5,p95Percent:10},outlierPolicy:'no exclusions for latency; only infrastructure failure INVALID_TRIAL; no replacement trials'},trials:[]};
    fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n',{flag:'wx'});
    for(let t=1;t<=10;t++)for(const width of [2,4,8]){
        const order=orders(width)[t-1];
        const result=await new Promise(resolve=>{
            const child=spawn(process.execPath,[__filename,'--worker',root,String(width),String(t),order.join(',')],{cwd:root,env:process.env,windowsHide:true});
            let stdout='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',()=>{});
            const timer=setTimeout(()=>child.kill(),180000);
            child.on('error',()=>{clearTimeout(timer);resolve(null);});child.on('exit',code=>{clearTimeout(timer);try{const line=stdout.split('\n').find(s=>s.startsWith('PAIRED_RESULT='));resolve(code===0&&line?JSON.parse(line.slice(14)):null);}catch{resolve(null);}});
        });
        data.trials.push(result||{trial_id:`load-${width}-trial-${t}`,load_level:width,mode_order:order,validity:'INVALID_TRIAL',reasonCodes:['WORKER_OR_FIXTURE_FAILURE']});
        fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n');
        console.log(JSON.stringify(result?{trial:result.trial_id,order,median:result.median_overhead_percent,p95:result.p95_overhead_percent,gate:result.gate}:{trial:t,width,status:'INVALID_TRIAL'}));
        if(!result){data.status='INCOMPLETE';break;}
    }
    data.after=database(mainRoot);data.before=before;data.databaseUnchanged=JSON.stringify(before)===JSON.stringify(data.after);
    data.productionUnchanged=preHash===filesHash(root);data.scriptUnchanged=scriptHash===hash(fs.readFileSync(__filename));
    data.status=data.trials.length===30&&data.trials.every(t=>t.validity==='VALID')&&data.databaseUnchanged&&data.productionUnchanged&&data.scriptUnchanged?'COMPLETE':'INCOMPLETE';
    data.gate=data.status==='COMPLETE'&&data.trials.every(t=>t.gate==='PASS')?'PASS':'FAIL';
    data.realModelCalls=0;data.writes=0;
    fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n');console.log(JSON.stringify({status:data.status,gate:data.gate,databaseUnchanged:data.databaseUnchanged}));
}
if(require.main===module){const a=process.argv.slice(2);if(a[0]==='--self-test')selfTest();
    else (a[0]==='--worker'?worker(a[1],Number(a[2]),Number(a[3]),a[4].split(',')):main(a[0],a[1])).catch(()=>{console.error('PAIRED_INFRASTRUCTURE_FAILURE');process.exitCode=1;});}
