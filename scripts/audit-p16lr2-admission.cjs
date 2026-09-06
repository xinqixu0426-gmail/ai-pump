'use strict';
// One diagnostic pass, not the formal 30-question UAT. No Tool/API/business data access.
const fs=require('node:fs');
const output='docs/ai-governance/data/p16lr2-admission-audit.json';
async function main(){
    if(fs.existsSync(output))throw Error('AUDIT_ALREADY_EXISTS');
    const env={...require('dotenv').parse(fs.readFileSync('.env')),AI_PROVIDER:'deepseek',DEEPSEEK_MODEL:'deepseek-v4-flash'};
    const emit=console.log.bind(console);for(const k of ['log','warn','error','info','debug'])console[k]=()=>{};
    const {classifyCandidateRisk}=require('../api/services/candidateRiskEnvelope.cjs');
    const {resolveAiProviderRoute,fetchProviderWithRetry}=require('../api/services/aiProvider.cjs');
    const cases=[['L-07','orders','下一页','continue','orders'],['L-12','customers','再看后20条','continue','customers'],
        ['L-13','customers','现在共有多少客户','count',null],['L-28','coils','现在共有多少线圈','count',null]];
    const data={stage:'P16-L-R2',kind:'PRE_IMPLEMENTATION_DIAGNOSTIC_NOT_HISTORICAL_RECONSTRUCTION',retries:0,toolCalls:0,businessApiCalls:0,cases:[]};
    fs.writeFileSync(output,JSON.stringify(data,null,2),{flag:'wx'});
    for(const [id,resource,source,operation,active]of cases){
        let diagnostic=null;
        const result=await classifyCandidateRisk(source,{env,collectionContext:active?{resourceType:active}:null,
            request:async(messages,options)=>{
                const config=resolveAiProviderRoute(messages,{env,attachmentMode:'metadata'});
                const response=await fetchProviderWithRetry(`${config.baseUrl}/chat/completions`,{
                    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.apiKey}`},
                    body:JSON.stringify({model:config.model,stream:false,messages,...(config.provider==='deepseek'?{thinking:{type:'disabled'}}:{})})
                },{config,env,signal:options.signal,timeoutMs:30000,maxAttempts:1});
                const body=await response.json(),m=body.choices?.[0]?.message;
                if(!response.ok||body.error||m?.tool_calls?.length||typeof m?.content!=='string')throw Error('RISK_MODEL_FAILED');
                const raw=JSON.parse(m.content);
                const allowed=(x,list)=>list.includes(x)?x:'INVALID';
                diagnostic={mode:allowed(raw.mode,['query','analysis','command','conversation']),
                    contextMode:allowed(raw.contextMode,['current_turn','previous_turn','page_context']),
                    confidence:allowed(raw.confidence,['high','medium','low']),
                    needsBusinessData:typeof raw.needsBusinessData==='boolean'?raw.needsBusinessData:null,
                    requiresClarification:typeof raw.requiresClarification==='boolean'?raw.requiresClarification:null,
                    ambiguityCount:Array.isArray(raw.ambiguities)?raw.ambiguities.length:null};
                return raw;
            }});
        data.cases.push({case_id:id,resourceType:resource,expectedOperation:operation,riskFields:diagnostic,
            admitted:result.eligible,contractValid:result.contractValid,failureClass:result.failureClass});
        fs.writeFileSync(output,JSON.stringify(data,null,2));emit(data.cases.at(-1));
    }
}
if(require.main===module)main().catch(()=>{process.stdout.write('ADMISSION_AUDIT_FAILED\n');process.exitCode=1;});
