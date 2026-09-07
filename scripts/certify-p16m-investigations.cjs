'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const OUTPUT='docs/ai-governance/data/p16m-investigation-certification.json';
async function main(){
 const semantic=JSON.parse(fs.readFileSync('docs/ai-governance/data/p16m-semantic-v3-certification.json','utf8'));
 if(semantic.status!=='PASS'||semantic.correct!==90)throw Error('SEMANTIC_GATE_FAILED');
 for(const [p,h]of Object.entries(semantic.freezeAfter))if(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==h)throw Error('SEMANTIC_CODE_CHANGED');
 if(fs.existsSync(OUTPUT))throw Error('CERTIFICATION_ALREADY_EXISTS');
 const env={...require('dotenv').parse(fs.readFileSync('.env')),PUMP_V5_CANDIDATE_RUNTIME:'true',AI_V5_READ_CANARY_ENABLED:'true',
  AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED:'true',AI_V5_MULTI_READ_ENABLED:'true'};
 const emit=console.log.bind(console);for(const k of ['log','warn','error','info','debug'])console[k]=()=>{};
 const {cases,fixture}=require('../tests/helpers/investigationCorpus.cjs'),db=fixture(),express=require('express'),app=express();
 app.use(express.json());
 app.use('/api/collections',require('../api/routes/collectionRead.cjs').createCollectionReadRouter({db}));
 app.use('/api/relations',require('../api/routes/relationRead.cjs').createRelationReadRouter({db}));
 app.use('/api/entity-lookup',require('../api/routes/entityLookup.cjs').createEntityLookupRouter({db}));
 const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
 const old={PORT:process.env.PORT,PUMP_V5_CANDIDATE_RUNTIME:process.env.PUMP_V5_CANDIDATE_RUNTIME};
 process.env.PORT=String(server.address().port);process.env.PUMP_V5_CANDIDATE_RUNTIME='true';
 const {executeToolCall}=require('../api/routes/ai/executor.cjs');
 const {createContinuationStore}=require('../api/services/ai-v5/collectionContinuation.cjs');
 const {withConversationContext}=require('../api/services/conversationContext.cjs');
 const {executeInvestigation}=require('../api/services/ai-v5/investigationExecution.cjs');
 const {createPlan}=require('../api/services/ai-v5/investigationPlan.cjs');
 const {runCandidateRead}=require('../api/services/ai-v5/candidateRead.cjs');
 const obs=require('../api/services/observability.cjs'),capture=require('../tests/helpers/collectionTraceCapture.cjs')();
 obs.initializeObservability({env:{AI_OBSERVABILITY_ENABLED:'true'},phoenixModule:capture.phoenixModule});
 const data={stage:'P16-M',mode:'REAL_MODELS_REAL_INTERNAL_HTTP_ISOLATED_DB',status:'RUNNING',cases:[],negatives:[],productionCalls:0,retries:0};
 fs.writeFileSync(OUTPUT,JSON.stringify(data,null,2),{flag:'wx'});const save=()=>fs.writeFileSync(OUTPUT,JSON.stringify(data,null,2));
 const desc=(start,n)=>Array.from({length:n},(_,i)=>String(start-i));
 function oracle(c){
  if(c.operation==='ordinal')return {ids:[c.relation==='recipe.parts'?'1':'63'],total:null,steps:1};
  let ids,total;const size=c.pageSize||20,start=c.operation==='continue'?43:63;
  if(['customer.orders','part.recipes'].includes(c.relation)){ids=desc(start,size);total=63;}
  else if(c.relation==='order.customer'||c.relation==='order.lines'){ids=['1'];total=1;}
  else if(c.relation==='recipe.parts'){ids=['2','1'];total=2;}
  else if(c.relation==='part.facts'){ids=[c.identity.split('-').at(-1)];total=1;}
  else{const status=c.stockStatus||c.prior.stockStatus;total={attention:63,low:53,out:10,ok:0}[status];ids=desc(status==='out'?10:start,Math.min(size,total));}
  return {ids,total,steps:c.relation==='parts.stock'?1:2};
 }
 try{
  const before=db.prepare('SELECT total_changes() AS n').get().n;
  for(const c of cases()){
   const ctx={version:1,contextKey:'a'.repeat(64),conversationId:'chat-'+Number(c.id.slice(2))},continuationStore=createContinuationStore();
   if(c.prior){const scope={taskId:c.id+'-prior',contextKey:ctx.contextKey};const prior=await executeInvestigation(createPlan(c.prior),{...scope,execute:executeToolCall});continuationStore.setVerifiedRelation(ctx,c.prior,prior.handle,scope);}
   const expected=oracle(c);let answer='',calls=0,canonicalMatch=false;const started=performance.now();
   const execute=async(name,q,o)=>{calls++;const r=await executeToolCall(name,q,o),p=r.relation||r.collection;
    if(name==='read_relation'||c.operation==='ordinal')canonicalMatch=!!p&&JSON.stringify(p.items.map(i=>i.canonicalId))===JSON.stringify(expected.ids)&&p.totalCount===expected.total;
    return r;};
   const out=await withConversationContext(ctx,()=>runCandidateRead({sourceRequest:c.question,internalAuthorized:true,previewOptIn:true,deliver:t=>{answer=t;return true;}},
    {env,continuationStore,investigationExecute:execute,collectionExecute:execute}));
   const leakage=/afterId|pageSize|canonicalId|read_relation|read_collection|\/api\/|offset|cursor/.test(answer);
   const pass=out.delivered===true&&out.validationPass===true&&canonicalMatch&&calls===expected.steps&&calls<=4&&answer.length>0&&!leakage;
   const row={caseId:c.id,pass,canonicalMatch,toolCalls:calls,expectedSteps:expected.steps,semanticCalls:out.semanticModelCalls??null,
    riskCalls:out.risk?.invoked===false?0:1,failureClass:out.failureClass,leakage:leakage?1:0,durationMs:performance.now()-started,resultBytes:out.resultBytes??null};
   data.cases.push(row);save();emit(row);answer='';
  }
  for(const source of ['删除订单','修改客户','更改零件库存','修改配方','修改线圈','继续并删除第1个']){
   let tools=0,answers=0,semanticCalls=0;
   const out=await withConversationContext({version:1,contextKey:'b'.repeat(64),conversationId:'chat-99'},()=>runCandidateRead({sourceRequest:source,internalAuthorized:true,previewOptIn:true,deliver:()=>{answers++;return true;}},
    {env,continuationStore:createContinuationStore(),investigationModelRequest:()=>{semanticCalls++;throw Error('NEGATIVE_REACHED_ROUTER');},investigationExecute:()=>{tools++;throw Error('NEGATIVE_REACHED_TOOL');}}));
   data.negatives.push({riskClass:out.risk?.riskClass,tools,answers,semanticCalls,pass:!out.delivered&&!tools&&!answers&&!semanticCalls});save();
  }
  data.dbMutations=db.prepare('SELECT total_changes() AS n').get().n-before;
  data.passed=data.cases.filter(c=>c.pass).length;data.failed=30-data.passed;
  const spans=capture.spans;data.orphanSpans=spans.filter(s=>s.parentId&&!spans.some(p=>p.id===s.parentId)).length;
  data.crossRequestContamination=spans.filter(s=>s.parentId&&spans.find(p=>p.id===s.parentId)?.rootId!==s.rootId).length;
  data.traceQuestionLeakage=cases().filter(c=>JSON.stringify(spans).includes(c.question)).length;
  data.status=data.passed===30&&data.negatives.every(n=>n.pass)&&!data.dbMutations&&!data.orphanSpans&&!data.crossRequestContamination&&!data.traceQuestionLeakage?'PASS':'REWORK';save();emit({status:data.status,passed:data.passed,failed:data.failed});
 }finally{await obs.resetObservabilityForTesting();await new Promise(r=>server.close(r));db.close();for(const[k,v]of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;}
}
if(require.main===module)main().catch(()=>{process.stdout.write('P16M_UAT_FAILED\n');process.exitCode=1;});
module.exports={main};
