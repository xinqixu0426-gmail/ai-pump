'use strict';
// Fixed five diagnostic requests, unchanged fixture question; not runtime retries.
const fs=require('node:fs');
async function main({entryV6=false}={}){
 const output=entryV6?'docs/ai-governance/data/p16m-entry-v6-risk-availability.json':'docs/ai-governance/data/p16m-risk-availability.json';if(fs.existsSync(output))throw Error('ALREADY_RUN');
 const env=require('dotenv').parse(fs.readFileSync('.env')),source=require('../tests/helpers/investigationCorpus.cjs').cases().find(c=>c.id===(entryV6?'M-24':'M-18')).question;
 const {resolveAiProviderRoute,fetchProviderWithRetry}=require('../api/services/aiProvider.cjs');
 const {classifyCandidateRisk,normalizeCandidateRisk}=require('../api/services/candidateRiskEnvelope.cjs');
 const emit=console.log.bind(console);for(const k of ['log','warn','error','info','debug'])console[k]=()=>{};
 const data={repeatCount:5,requests:[],productionCalls:0,runtimeRetriesAdded:0};
 fs.writeFileSync(output,JSON.stringify(data,null,2),{flag:'wx'});
 for(let i=1;i<=5;i++){
  const meta={repeat:i,phase:'NOT_STARTED'};
  const result=await classifyCandidateRisk(source,{env,request:async(messages,options)=>{
   const config=resolveAiProviderRoute(messages,{env,attachmentMode:'metadata'});meta.phase='TRANSPORT';
   const response=await fetchProviderWithRetry(`${config.baseUrl}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.apiKey}`},
    body:JSON.stringify({model:config.model,stream:false,messages,...(config.provider==='deepseek'?{thinking:{type:'disabled'}}:{})})},{config,env,signal:options.signal,timeoutMs:30000,maxAttempts:1});
   const payload=await response.json(),message=payload.choices?.[0]?.message;meta.httpStatus=response.status;
   if(!response.ok||payload.error||message?.tool_calls?.length||typeof message?.content!=='string'){meta.phase='ENVELOPE_INVALID';throw Error('RISK_MODEL_FAILED');}
   meta.phase='JSON_PARSE';meta.fencedJSON=/^\s*```/.test(message.content);
   const raw=JSON.parse(message.content);meta.phase='SCHEMA_VALIDATION';normalizeCandidateRisk(raw);meta.phase='VALID';return raw;
  }});
  data.requests.push({...meta,riskClass:result.riskClass,contractValid:result.contractValid});fs.writeFileSync(output,JSON.stringify(data,null,2));emit(data.requests.at(-1));
 }
}
if(require.main===module)main().catch(()=>{process.stdout.write('RISK_DIAGNOSTIC_FAILED\n');process.exitCode=1;});
module.exports={main};
