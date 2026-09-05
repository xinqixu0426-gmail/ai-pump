'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{AsyncLocalStorage}=require('node:async_hooks');
const root=path.resolve(__dirname,'..'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const {openFixture,fixtures}=require('./run-ai-v5f1b-read-certification.cjs');
const {dbSnapshot}=require('./run-ai-v5e4r-nested-refinement-evaluation.cjs');
const {required}=require('./run-ai-v5f2b-answer-formal.cjs');
const {comparator,stageFreeze}=require('./run-ai-v5-p16c-certification.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const freeze=()=>({...stageFreeze(),...Object.fromEntries(['api/services/ai-v5/readAuthorityMux.cjs','scripts/run-ai-v5-p16d-certification.cjs','tests/aiV5ReadAuthority.test.cjs'].map(p=>[p,hash(fs.readFileSync(path.join(root,p)))]))});
async function main(){
    require('dotenv').config({quiet:true});
    const output=path.join(root,'docs/ai-governance/data/p16d-authoritative-response-certification.json');
    assert.equal(fs.existsSync(output),false,'P16D_EVALUATION_ALREADY_STARTED');
    const before=dbSnapshot(),pre=freeze(),data={version:1,frozenPaths:15,preHashes:pre,modes:[],writes:0,allowWriteEnablingCalls:0,businessMutationCalls:0,
        legacyMethod:'ACTUAL_CHAT_HANDLER_DETERMINISTIC_LEGACY_DISPATCHER_SEAM',v5Method:'REAL_FROZEN_INTERPRETER_READS_AND_ANSWER_MODEL',
        timingMethod:'HANDLER_INVOCATION_TO_FINAL_DONE_EXCLUDES_ORACLE_PREPARATION',priorRun:'p16d-authoritative-certification.json'};
    const saved=Object.fromEntries(['log','warn','error','info','debug'].map(k=>[k,console[k]])),logs=[],spans=[],als=new AsyncLocalStorage();
    for(const k of Object.keys(saved))console[k]=(...a)=>logs.push(a.map(v=>typeof v==='string'?v:JSON.stringify(v)).join(' '));
    const obs=require('../api/services/observability.cjs');let fixture,sources;
    try{
        fixture=await openFixture();sources=fixtures(fixture.db);
        const oracle=read('docs/ai-governance/data/v5-e4r-entity-first-architecture-audit.json').cases;assert.equal(oracle.length,15);
        const {handleAiChat}=require('../api/routes/ai/chat.cjs');
        obs.initializeObservability({env:{AI_OBSERVABILITY_ENABLED:'true',AI_TRACE_CONTENT:'metadata'},phoenixModule:{register:()=>({getTracer:()=>({startActiveSpan(name,options,fn){
            const parent=als.getStore(),record={id:crypto.randomUUID(),parent:parent?.id||null,root:parent?.root||null,name,attributes:{...options.attributes}};
            if(!parent)record.root=record.id;spans.push(record);
            return als.run(record,()=>fn({setAttributes(a){Object.assign(record.attributes,a);},setAttribute(k,v){record.attributes[k]=v;},setStatus(){},end(){},updateName(){}}));
        }}),forceFlush:async()=>{},shutdown:async()=>{}})},logger:{warn(){}}});
        fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n',{flag:'wx'});
        const modes=[['DEFAULT_OFF',false,false,false,true],['BASE_ONLY_USE',true,false,true,true],['AUTHORITY_FLAG_ONLY',false,true,true,true],
            ['REQUEST_ONLY',false,false,true,true],['BOTH_NO_MARKER',true,true,false,true],['MISSING_AUTH',true,true,true,false],['BOTH_ON',true,true,true,true]];
        for(const[name,base,authority,use,auth]of modes){
            const mode={name,paths:[]};data.modes.push(mode);
            for(const p of oracle){
                const source=sources.get(p.source_group),env={...process.env,AI_V5_READ_CANARY_ENABLED:String(base),AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED:String(authority),AI_V5_SHADOW_ENABLED:'false'};
                const req=Object.assign(new EventEmitter(),{requestId:crypto.randomUUID(),headers:{'x-pump-v5-use':String(use),'x-pump-v5-fact':required[p.source_group],
                    ...(auth?{'x-internal-secret':env.INTERNAL_SECRET}:{})},body:{messages:[{role:'user',content:source.source}]}});
                let contentCount=0,done=0,legacyFinal=false,v5Final=false,rawExposed=0,preview=0,outcome=null,modelCalls=0,finalLatency=null;
                let start;
                const res=Object.assign(new EventEmitter(),{setHeader(){},flushHeaders(){},write(s){
                    if(!s.startsWith('data: '))return true;const e=JSON.parse(s.slice(6));
                    if(e.type==='content'){contentCount++;legacyFinal=e.content==='legacy-synthetic-authoritative';v5Final=!legacyFinal&&typeof e.content==='string'&&e.content.length>0;
                        if(typeof e.content!=='string'||e.content.startsWith('{')||e.content.includes('evidenceRefs'))rawExposed++;}
                    if(e.type==='done'){done++;finalLatency=performance.now()-start;}
                    if(e.type==='v5_preview')preview++;
                    // No response body survives this callback or enters data/logs.
                    return true;
                },end(){this.writableEnded=true;}});
                const authorityOptions={onAuthorityOutcome:o=>{outcome=o;}};
                if(name==='BOTH_ON'){
                    authorityOptions.executionOptions={compare:await comparator(p,source)};
                    const real=require('../api/services/ai-v5/taskInterpreter.cjs').requestConfiguredInterpreterModel;
                    authorityOptions.answerOptions={modelRequest:(...a)=>{modelCalls++;return real(...a);}};
                }else authorityOptions.interpret=()=>{throw Error('BLOCKED_GATE_EXECUTION');};
                const startCalls=fixture.calls.length;
                start=performance.now();
                await handleAiChat(req,res,{env,authorityOptions,telemetry:{record(){}},runAiDispatcherV3:async({emit})=>{
                    emit('content',{content:'legacy-synthetic-authoritative'});emit('done',{});
                    return{intent:{mode:'query'},telemetry:{outcome:'completed',toolSteps:[{capabilityName:'search_parts',success:true}]}};
                }});
                mode.paths.push({case_id:p.case_id,sourceGroup:p.source_group,factKey:required[p.source_group],legacyFinal,v5Final,contentCount,done,preview,rawExposed,
                    finalLatency,actualAnswerCalls:modelCalls,businessCalls:fixture.calls.length-startCalls,...outcome});
                fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n');
                saved.log(JSON.stringify({mode:name,case_id:p.case_id,finalSource:outcome?.finalSource,failureClass:outcome?.failureClass}));
                if(name==='BOTH_ON'&&(!v5Final||outcome?.finalSource!=='v5-authoritative-canary'||modelCalls!==1))throw Error('FINAL_RESPONSE_CERTIFICATION_FAILED');
            }
        }
        const children=spans.filter(s=>s.name!=='invoke_agent pump_factory_assistant');
        data.trace={spanCount:spans.length,orphanCount:children.filter(s=>!s.parent||!spans.some(p=>p.id===s.parent)).length,
            crossRequestCount:spans.filter(s=>s.attributes['pump.ai.v5.shadow_task_id']).filter(s=>spans.find(p=>p.id===s.root)?.attributes['pump.request.id']!==s.attributes['pump.ai.v5.shadow_task_id']).length};
        const visible=JSON.stringify({data,spans,logs});
        data.privacy={sourceLeaks:[...sources.values()].filter(s=>visible.includes(s.mention)||visible.includes(s.source)).length,
            forbiddenFields:(visible.match(/"(?:answerText|numericValue|runtimeValue|canonicalId|stock|currentTotalCost|price)"\s*:/gu)||[]).length};
        data.businessMutationCalls=fixture.calls.filter(c=>c.method!=='GET'&&!c.lookup).length;
    }catch{data.fatalReason='P16D_CERTIFICATION_STOPPED';}
    finally{
        if(fixture)data.fixtureSafety=await fixture.close();await obs.safeShutdown();for(const[k,v]of Object.entries(saved))console[k]=v;
        data.databaseUnchanged=JSON.stringify(before)===JSON.stringify(dbSnapshot());data.hashesMatch=JSON.stringify(pre)===JSON.stringify(freeze());
        const on=data.modes.find(m=>m.name==='BOTH_ON')?.paths||[],q=p=>on.map(r=>r.finalLatency).sort((a,b)=>a-b)[Math.ceil(on.length*p)-1]??null;
        data.finalLatency={median:q(.5),p95:q(.95)};
        data.pass=!data.fatalReason&&data.modes.length===7&&data.modes.every(m=>m.paths.length===15&&m.paths.every(p=>p.contentCount===1&&p.done===1&&p.rawExposed===0&&p.preview===0))
            &&data.modes.filter(m=>m.name!=='BOTH_ON').every(m=>m.paths.every(p=>!p.attempted&&p.legacyFinal&&p.businessCalls===0))
            &&on.every(p=>p.v5Final&&p.validationPass&&p.read.resultEquivalence==='MATCH'&&p.read.evidenceVerification==='PASS'
                &&['contractValid','evidenceRefsValid','groundingValid','requiredFactCoverage','numericValid','entityValid'].every(k=>p.read[k]===true))
            &&data.trace?.orphanCount===0&&data.trace?.crossRequestCount===0&&data.privacy?.sourceLeaks===0&&data.privacy?.forbiddenFields===0
            &&data.databaseUnchanged&&data.fixtureSafety?.unchanged&&data.hashesMatch;
        if(fs.existsSync(output))fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n');
        console.log(JSON.stringify({pass:data.pass,trace:data.trace,privacy:data.privacy,finalLatency:data.finalLatency,fatalReason:data.fatalReason}));if(!data.pass)process.exitCode=1;
    }
}
if(require.main===module)main().catch(()=>{console.error('P16D_PREFLIGHT_FAILED');process.exitCode=1;});
