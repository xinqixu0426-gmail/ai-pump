'use strict';
// One supplemental end-to-end request. Never replaces the original 30-case result.
const fs=require('node:fs');
const OUTPUT='docs/ai-governance/data/p16m-m18-focused.json';
async function main(){
 if(fs.existsSync(OUTPUT))throw Error('FOCUSED_CERTIFICATION_ALREADY_EXISTS');
 const env={...require('dotenv').parse(fs.readFileSync('.env')),PUMP_V5_CANDIDATE_RUNTIME:'true',
  AI_V5_READ_CANARY_ENABLED:'true',AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED:'true',AI_V5_MULTI_READ_ENABLED:'true'};
 const emit=console.log.bind(console);for(const k of ['log','warn','error','info','debug'])console[k]=()=>{};
 const {fixture,cases}=require('../tests/helpers/investigationCorpus.cjs');
 const db=fixture(),express=require('express'),app=express();app.use(express.json());
 app.use('/api/collections',require('../api/routes/collectionRead.cjs').createCollectionReadRouter({db}));
 app.use('/api/relations',require('../api/routes/relationRead.cjs').createRelationReadRouter({db}));
 app.use('/api/entity-lookup',require('../api/routes/entityLookup.cjs').createEntityLookupRouter({db}));
 const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
 const old={PORT:process.env.PORT,PUMP_V5_CANDIDATE_RUNTIME:process.env.PUMP_V5_CANDIDATE_RUNTIME};
 process.env.PORT=String(server.address().port);process.env.PUMP_V5_CANDIDATE_RUNTIME='true';
 const data={caseId:'M-18',mode:'REAL_MODELS_REAL_INTERNAL_HTTP_ISOLATED_DB',plannedRequests:1,retries:0,status:'STARTED',productionCalls:0};
 fs.writeFileSync(OUTPUT,JSON.stringify(data,null,2),{flag:'wx'});
 try{
  const {executeToolCall}=require('../api/routes/ai/executor.cjs');
  const {withConversationContext}=require('../api/services/conversationContext.cjs');
  const {runCandidateRead}=require('../api/services/ai-v5/candidateRead.cjs');
  const before=db.prepare('SELECT total_changes() AS n').get().n;
  let toolCalls=0,deliveries=0,answer='',canonicalMatch=false,fieldMatch=false;
  const execute=async(name,q,o)=>{toolCalls++;const r=await executeToolCall(name,q,o);
   if(name==='read_relation'){const p=r.relation;canonicalMatch=p?.relation==='part.facts'&&p.items.length===1&&p.items[0].canonicalId==='1';
    fieldMatch=canonicalMatch&&p.items[0].display.stock===0&&p.items[0].display.price===3;}
   return r;};
  const started=performance.now();
  const out=await withConversationContext({version:1,contextKey:'a'.repeat(64),conversationId:'chat-18'},()=>runCandidateRead({
   sourceRequest:cases().find(c=>c.id==='M-18').question,internalAuthorized:true,previewOptIn:true,
   deliver:t=>{deliveries++;answer=t;return true;}
  },{env,investigationExecute:execute}));
  Object.assign(data,{riskClass:out.risk?.riskClass,riskCalls:out.risk?.invoked===false?0:1,
   failureClass:out.failureClass,toolCalls,deliveries,canonicalMatch,fieldMatch,validationPass:out.validationPass===true,
   answerFieldsMatch:answer.includes('库存：0')&&answer.includes('目录单价：3元'),
   technicalLeakage:/afterId|pageSize|canonicalId|read_relation|read_collection|\/api\/|offset|cursor/.test(answer),
   dbMutations:db.prepare('SELECT total_changes() AS n').get().n-before,durationMs:performance.now()-started});
  data.status=out.delivered&&data.validationPass&&canonicalMatch&&fieldMatch&&data.answerFieldsMatch&&toolCalls===2&&deliveries===1&&!data.technicalLeakage&&!data.dbMutations?'PASS':'REWORK';
  answer='';fs.writeFileSync(OUTPUT,JSON.stringify(data,null,2));emit(data);
 }finally{await new Promise(r=>server.close(r));db.close();for(const[k,v]of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;}
}
if(require.main===module)main().catch(()=>{process.stdout.write('P16M_FOCUSED_CERTIFICATION_FAILED\n');process.exitCode=1;});
module.exports={main};
