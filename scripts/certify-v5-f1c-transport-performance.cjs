'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process');
const {AsyncLocalStorage}=require('node:async_hooks'),dc=require('node:diagnostics_channel');
const {performance,monitorEventLoopDelay,PerformanceObserver}=require('node:perf_hooks');
const BASE='0da12765b351cf8bfb43013224c9ab3579793491';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const quantile=(a,p)=>[...a].sort((x,y)=>x-y)[Math.ceil(a.length*p)-1]??null;
const stats=a=>({count:a.length,median:quantile(a,.5),p95:quantile(a,.95)});
function schedule(width){let seed=0x163c+width;return Array.from({length:(24+200)/width},(_,batch)=>{
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    return {offsetMs:batch*80+(seed%3),measured:batch>=24/width,
        requests:Array.from({length:width},(_,index)=>({index,foregroundMs:20+2*index}))};});}
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
        if(req.url==='/precondition'){res.end('paired-fixture-response');return;}
        const n=Number(req.headers['x-fixture-sequence']),planned=block.flat[n];
        if(planned.measured&&block.measuredStart===undefined){block.measuredStart=performance.now();block.cpuStart=process.cpuUsage();block.eluStart=performance.eventLoopUtilization();block.hist.reset();}
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
    server.keepAliveTimeout=60000;
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
            block.hist=hist;
            const transport=await childResult(['--client',String(server.address().port),String(width)],root,'TRANSPORT_RESULT=');
            await Promise.all(block.jobs);assert.equal(await block.mirror.waitForIdle(1000),true);
            const measuredStart=block.measuredStart,end=performance.now(),cpu=process.cpuUsage(block.cpuStart),elu=performance.eventLoopUtilization(block.eluStart);
            const rows=block.rows.filter(s=>s.measured);assert.equal(rows.length,200);
            const execs=rows.filter(s=>s.v5ExecutionStart!==null),intervals=execs.flatMap(s=>s.http);
            assert.ok(intervals.every(x=>x.end!==null));assert.equal(intervals.length,execs.length);
            let cross=0;for(const s of execs)if(rows.some(f=>f.id!==s.id&&overlap(s.v5ExecutionStart,s.v5ExecutionEnd,f.requestStart,f.v4ResponseCommit)>0))cross++;
            // Drain observer delivery outside the user latency metric.
            await new Promise(r=>setImmediate(r));hist.disable();observer.disconnect();
            modes.push({mode,schedule_id:`transport-load-${width}`,schedule_seed:0x163c+width,schedule_hash:hash(JSON.stringify(plan)),warmup:24,measured:200,latency:stats(rows.map(s=>s.v4ResponseCommit-s.requestStart)),
                completion:stats(execs.map(s=>s.v5ExecutionEnd-s.v5ExecutionStart)),cross_request_overlap_count:cross,max_internal_http_concurrency:maximum(intervals),
                own_pre_finish:execs.filter(s=>s.v5ExecutionStart<s.v4ResponseCommit).length,
                execution_count:execs.length,allExecutionCount:block.rows.filter(s=>s.v5ExecutionStart!==null).length,
                scheduler:block.mirror.snapshot(),transport,foregroundProfile:profile(rows),
                eventLoopDelayMs:{median:hist.percentile(50)/1e6,p95:hist.percentile(95)/1e6,max:hist.max/1e6},
                cpuOneCorePercent:(cpu.user+cpu.system)/1000/(end-measuredStart)*100,eventLoopUtilization:elu.utilization,
                gc:gc.filter(g=>g.start>=measuredStart&&g.start<=end),timings:rows});
        }
        block=null;afterSanity=await sanity();
    }finally{
        execution.runReadExecutionShadow=real;dc.unsubscribe('undici:request:create',onCreate);dc.unsubscribe('undici:request:trailers',onEnd);dc.unsubscribe('undici:request:error',onEnd);
        server.closeAllConnections();await new Promise(r=>server.close(r));fixtureSafety=await fixture.close();
    }
    assert.ok(fixtureSafety.unchanged);assert.ok(fixture.calls.every(c=>c.method==='GET'));
    const result={mode:modes[0],beforeSanity,afterSanity,fixtureSafety,realModelCalls:0,writes:0,businessMutationCalls:0,businessApiReadCalls:fixture.calls.length};
    assert.ok(!JSON.stringify(result).includes(source.mention),'PRIVACY_FAILURE');
    console.log('BLOCK_RESULT='+JSON.stringify(result));
}

const RULES=Object.freeze({reuse:200,newConnections:0,sendMedianDifferenceMs:2,sendP95DifferenceMs:5,foregroundArrivalHistogramTV:.05,
    warmup:24,measured:200,burstMs:80,maxTransportReplacementAttemptsPerLoad:10});
function profile(rows){
    const points=rows.flatMap(r=>[[r.requestStart,1],[r.v4ResponseCommit,-1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const arrivals={},duration={};let active=0,last=points[0][0];
    const windows=[];
    for(const [t,d]of points){duration[active]=(duration[active]||0)+t-last;windows.push({start:last,end:t,active});active+=d;
        if(d===1)arrivals[active]=(arrivals[active]||0)+1;last=t;}
    return {arrivalHistogram:arrivals,durationHistogramMs:duration,windows,hash:hash(JSON.stringify(arrivals)),max:maximum(rows.map(r=>({start:r.requestStart,end:r.v4ResponseCommit})))};
}
function variation(a,b){return [...new Set([...Object.keys(a),...Object.keys(b)])].reduce((sum,k)=>sum+Math.abs((a[k]||0)/200-(b[k]||0)/200),0)/2;}
function validatePair(off,on){
    const connection=off.transport.reused===RULES.reuse&&on.transport.reused===RULES.reuse&&off.transport.newConnections===0&&on.transport.newConnections===0;
    const scheduling=off.schedule_hash===on.schedule_hash&&Math.abs(off.transport.deviation.median-on.transport.deviation.median)<=RULES.sendMedianDifferenceMs&&
        Math.abs(off.transport.deviation.p95-on.transport.deviation.p95)<=RULES.sendP95DifferenceMs;
    const foreground=variation(off.foregroundProfile.arrivalHistogram,on.foregroundProfile.arrivalHistogram)<=RULES.foregroundArrivalHistogramTV;
    return {connection,scheduling,foreground,valid:connection&&scheduling&&foreground};
}
async function childResult(args,cwd,marker){
    return new Promise((resolve,reject)=>{
        const child=spawn(process.execPath,[__filename,...args],{cwd,env:process.env,windowsHide:true});
        let stdout='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',()=>{});
        const timer=setTimeout(()=>child.kill(),180000);
        child.on('error',()=>{clearTimeout(timer);reject(new Error('CHILD_START_FAILURE'));});
        child.on('close',code=>{clearTimeout(timer);try{const line=stdout.split('\n').find(x=>x.startsWith(marker));assert.equal(code,0);assert.ok(line);resolve(JSON.parse(line.slice(marker.length)));}catch{reject(new Error('CHILD_OR_FIXTURE_FAILURE'));}});
    });
}
async function client(port,width){
    const agents=Array.from({length:width},()=>new http.Agent({keepAlive:true,maxSockets:1,maxFreeSockets:1,scheduling:'fifo'}));
    const records=[];let origin;
    async function request(slot,sequence,planned,precondition=false){
        const record={slot,sequence,plannedSendTime:planned,actualSendTime:null,sendDeviation:null,reused:false};
        return new Promise((resolve,reject)=>{
            const r=http.request({hostname:'127.0.0.1',port,path:precondition?'/precondition':'/',agent:agents[slot],
                headers:precondition?{}:{'x-fixture-sequence':String(sequence)}},res=>{
                let body='';res.on('data',d=>body+=d);res.on('end',()=>{try{assert.equal(res.statusCode,200);assert.equal(body,'paired-fixture-response');
                    record.reused=r.reusedSocket;if(!precondition)records.push(record);resolve();}catch(e){reject(e);}});
            });
            r.on('socket',()=>{if(!precondition){record.actualSendTime=performance.now()-origin;record.sendDeviation=record.actualSendTime-planned;}r.end();});
            r.on('error',reject);
        });
    }
    try{
        await Promise.all(agents.map((_,i)=>request(i,-1,0,true)));
        // Allow sockets to reach the free pool before warmup; identical both modes.
        await delay(50);
        origin=performance.now();let sequence=0;const pending=[];
        for(const burst of schedule(width)){
            await delay(Math.max(0,origin+burst.offsetMs-performance.now()));
            for(const r of burst.requests)pending.push(request(r.index,sequence++,burst.offsetMs));
        }
        await Promise.all(pending);
        const measured=records.filter(r=>r.sequence>=24).sort((a,b)=>a.sequence-b.sequence);
        const abs=measured.map(r=>Math.abs(r.sendDeviation));
        console.log('TRANSPORT_RESULT='+JSON.stringify({policy:'FIXED_KEEP_ALIVE_PER_SLOT',poolSize:width,maxSocketsPerAgent:1,
            connectionAttempts:measured.filter(r=>!r.reused).length,reused:measured.filter(r=>r.reused).length,newConnections:measured.filter(r=>!r.reused).length,
            precreatedConnections:width,deviation:{...stats(abs),max:Math.max(...abs)},records:measured}));
    }finally{agents.forEach(a=>a.destroy());}
}
async function main(root,mainRoot){
    root=path.resolve(root);mainRoot=path.resolve(mainRoot);
    const output=path.join(mainRoot,'docs/ai-governance/data/v5-f1c-transport-controlled-performance-certification.json');
    assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root}).toString().trim(),BASE);
    assert.equal(execFileSync('git',['diff','--name-only','HEAD'],{cwd:root}).toString().trim(),'');
    assert.ok(!fs.existsSync(output),'ONE_SESSION_ONLY');
    const before=database(mainRoot),preHash=filesHash(root),scriptHash=hash(fs.readFileSync(__filename));
    const data={baselineCommit:BASE,node:process.version,status:'STARTED',rules:RULES,scriptHash,preHash,before,
        plan:{process:'fresh server/execution process AND separate client per mode block',order:'seeded; five OFF_ON and five ON_OFF valid pairs per load',
            schedule:'80ms bursts plus seeded0..2ms jitter,24 warmup +200 measured,foreground20+2*slot; schedule seed=0x163c+load; order seed=0x163b+load; no execution-dependent delay',
            profileValidity:'arrival-event occupancy histogram total variation <=0.05; duration histogram descriptive, never reject solely for longer response duration',
            tolerancesBasis:'prior loopback burst p95 lag14-22ms with shared process; external client target pairwise median2ms,p955ms; no absolute latency invalidation',
            replacement:'transport orchestration parity invalid only; retain all attempts; same order replacement; max10 extra/load; fatal fixture errors stop',
            onlyBusinessVariable:'AI_V5_EXECUTION_SHADOW_ENABLED',interpreterShadow:true,concurrency:4},trials:[]};
    const save=()=>fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n');
    fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n',{flag:'wx'});
    let stopped=false;
    outer:for(let t=1;t<=10;t++)for(const width of [2,4,8]){
        const order=orders(width)[t-1];let accepted=false;
        do{
            const attempt=data.trials.filter(x=>x.load_level===width).length+1;
            const trial={trial_id:`load-${width}-slot-${t}-attempt-${attempt}`,load_level:width,mode_order:order};
            try{
                const blocks=[];for(const mode of order)blocks.push(await childResult(['--worker',root,String(width),String(t),mode],root,'BLOCK_RESULT='));
                const off=blocks.find(b=>b.mode.mode==='OFF').mode,on=blocks.find(b=>b.mode.mode==='ON').mode;
                Object.assign(trial,{blocks,parity:validatePair(off,on),schedule_hash:off.schedule_hash,
                    off_median_ms:off.latency.median,on_median_ms:on.latency.median,median_delta_ms:on.latency.median-off.latency.median,
                    median_overhead_percent:(on.latency.median/off.latency.median-1)*100,
                    off_p95_ms:off.latency.p95,on_p95_ms:on.latency.p95,p95_delta_ms:on.latency.p95-off.latency.p95,
                    p95_overhead_percent:(on.latency.p95/off.latency.p95-1)*100,
                    pairedRequestDelta:stats(off.timings.map(r=>{const other=on.timings.find(o=>o.sequence===r.sequence);return(other.v4ResponseCommit-other.requestStart)-(r.v4ResponseCommit-r.requestStart);}))});
                trial.trial_validity=trial.parity.valid?'VALID':'INVALID_TRIAL';
                trial.reasonCodes=Object.entries(trial.parity).filter(([k,v])=>k!=='valid'&&!v).map(([k])=>'TRANSPORT_'+k.toUpperCase()+'_PARITY');
                trial.gate=trial.median_overhead_percent<=5&&trial.p95_overhead_percent<=10?'PASS':'FAIL';accepted=trial.parity.valid;
            }catch{trial.trial_validity='INVALID_TRIAL';trial.reasonCodes=['FATAL_FIXTURE_OR_HARNESS_FAILURE'];stopped=true;}
            data.trials.push(trial);save();
            console.log(JSON.stringify({trial:trial.trial_id,validity:trial.trial_validity,gate:trial.gate,median:trial.median_overhead_percent,p95:trial.p95_overhead_percent,reasons:trial.reasonCodes}));
            const invalid=data.trials.filter(x=>x.load_level===width&&x.trial_validity!=='VALID').length;
            if(stopped||invalid>=RULES.maxTransportReplacementAttemptsPerLoad){stopped=true;break outer;}
        }while(!accepted);
    }
    data.after=database(mainRoot);data.databaseUnchanged=JSON.stringify(before)===JSON.stringify(data.after);
    data.productionUnchanged=preHash===filesHash(root);data.scriptUnchanged=scriptHash===hash(fs.readFileSync(__filename));
    data.status=!stopped&&data.trials.filter(t=>t.trial_validity==='VALID').length===30?'COMPLETE':'INCOMPLETE';
    data.gate=data.status==='COMPLETE'&&data.trials.filter(t=>t.trial_validity==='VALID').every(t=>t.gate==='PASS')&&data.databaseUnchanged&&data.productionUnchanged&&data.scriptUnchanged?'PASS':'FAIL';
    save();console.log(JSON.stringify({status:data.status,gate:data.gate,databaseUnchanged:data.databaseUnchanged}));
}
function transportTests(){
    selfTest();
    const mode={schedule_hash:'same',transport:{reused:200,newConnections:0,deviation:{median:1,p95:2}},foregroundProfile:{arrivalHistogram:{1:100,2:100}}};
    assert.equal(validatePair(mode,mode).valid,true);
    assert.equal(validatePair(mode,{...mode,transport:{...mode.transport,reused:199}}).valid,false);
    assert.equal(validatePair(mode,{...mode,transport:{...mode.transport,deviation:{median:1,p95:8}}}).valid,false);
    assert.equal(validatePair(mode,{...mode,foregroundProfile:{arrivalHistogram:{1:200}}}).valid,false);
    console.log('TRANSPORT_RULE_TESTS_PASS');
}
if(require.main===module){const a=process.argv.slice(2);
    if(a[0]==='--self-test')transportTests();
    else(a[0]==='--client'?client(Number(a[1]),Number(a[2])):a[0]==='--worker'?worker(a[1],Number(a[2]),Number(a[3]),[a[4]]):main(a[0],a[1]))
        .catch(()=>{console.error('TRANSPORT_CERTIFICATION_INFRASTRUCTURE_FAILURE');process.exitCode=1;});
}
