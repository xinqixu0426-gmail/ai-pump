'use strict';
// Frozen original L30/M30 wording. Only L09/L29 have explicitly changed interaction oracles.
const fs=require('node:fs'),crypto=require('node:crypto');
const OUTPUT='docs/ai-governance/data/p16m-choice-existing-read-regression-v2.json';
const FILES=fs.readdirSync('api/services/ai-v5').filter(p=>p.endsWith('.cjs')).map(p=>'api/services/ai-v5/'+p)
 .concat(['api/services/collectionReadContract.cjs','api/services/collectionReadService.cjs','api/services/candidateRiskEnvelope.cjs',__filename]);
const hashes=()=>Object.fromEntries(FILES.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
async function main(){
 if(fs.existsSync(OUTPUT))throw Error('ONE_SHOT_EXISTS');
 const env={...require('dotenv').parse(fs.readFileSync('.env')),PUMP_V5_CANDIDATE_RUNTIME:'true',AI_V5_READ_CANARY_ENABLED:'true',
  AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED:'true',AI_V5_MULTI_READ_ENABLED:'true'};
 const emit=console.log.bind(console);for(const k of ['log','info','warn','error','debug'])console[k]=()=>{};
 const data={stage:'P16-M-choice-existing-read',mode:'REAL_MODEL_LOCAL_HTTP_FIXTURE',before:hashes(),retries:0,productionCalls:0,
  changedOracles:{'L-09':'Verified missing customer opens explicit candidate discovery; never infer an empty order set',
   'L-29':'Two exact coil identities open explicit choice; never bind longest/first'},cases:[]};
 fs.writeFileSync(OUTPUT,JSON.stringify(data,null,2),{flag:'wx'});const save=()=>fs.writeFileSync(OUTPUT,JSON.stringify(data,null,2));
 const db=require('../tests/helpers/investigationCorpus.cjs').fixture();
 const before=db.prepare('SELECT total_changes() n').get().n;
 const app=require('express')();app.use(require('express').json());
 for(const [path,module,factory]of [['collections','collectionRead','createCollectionReadRouter'],['relations','relationRead','createRelationReadRouter'],
  ['entity-lookup','entityLookup','createEntityLookupRouter'],['entity-span-candidates','entitySpanCandidates','createEntitySpanCandidateRouter']])
  app.use('/api/'+path,require('../api/routes/'+module+'.cjs')[factory]({db}));
 const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
 const old={PORT:process.env.PORT,PUMP_V5_CANDIDATE_RUNTIME:process.env.PUMP_V5_CANDIDATE_RUNTIME};
 process.env.PORT=String(server.address().port);process.env.PUMP_V5_CANDIDATE_RUNTIME='true';
 const store=require('../api/services/ai-v5/collectionContinuation.cjs').createContinuationStore();
 const {runCandidateRead}=require('../api/services/ai-v5/candidateRead.cjs'),{withConversationContext}=require('../api/services/conversationContext.cjs');
 const execute=require('../api/routes/ai/executor.cjs').executeToolCall;
 try{
  const groups=['orders','customers','parts','recipes','coils'];
  const corpus=[...require('./certify-v5-collections.cjs').cases().map(c=>({...c,kind:'L'})),
   ...require('../tests/helpers/investigationCorpus.cjs').cases().map(c=>({...c,kind:'M'}))];
  for(const c of corpus){
   const ctx={version:1,contextKey:'a'.repeat(64),conversationId:'chat-'+(c.kind==='L'?groups.indexOf(c.resource)+100:Number(c.id.slice(2))+200)};
   if(c.prior){
    const scope={taskId:'seed-'+c.id,contextKey:ctx.contextKey};
    const result=await require('../api/services/ai-v5/investigationExecution.cjs').executeInvestigation(
     require('../api/services/ai-v5/investigationPlan.cjs').createPlan(c.prior),{...scope,execute});
    store.setVerifiedRelation(ctx,c.prior,result.handle,scope);
   }
   let text='';const calls=[];
   const run=async(name,args,opts)=>{const result=await execute(name,args,opts);calls.push({name,args,result});return result;};
   const out=await withConversationContext(ctx,()=>runCandidateRead({sourceRequest:c.question,previewOptIn:true,internalAuthorized:true,collectionOnly:true,
    deliver:t=>{text=t;return true;}},{env,continuationStore:store,collectionExecute:run,investigationExecute:run}));
   let oracle=false;
   if(c.kind==='L'){
    if(c.id==='L-09')oracle=out.choicePending===true&&store.peekCertified(ctx)?.query.purpose.kind==='customer.orders'&&calls.length===1
     &&calls[0].result.collection?.totalCount===0;
    else if(c.id==='L-29')oracle=out.choicePending===true&&JSON.stringify([...(store.peekCertified(ctx)?.rowIds||[])].sort())===JSON.stringify(['6','63'])&&calls.length===2;
    else{
     const p=calls[0]?.result.collection,continuation=['L-02','L-07','L-12','L-17','L-22','L-27'].includes(c.id);
     const active=['L-06','L-07'].includes(c.id),closed=c.id==='L-10';
     const ids=c.operation==='detail'?[c.id==='L-03'?'41':'63']:c.operation==='count'?[]:
      Array.from({length:c.returned},(_,i)=>String((closed?62:63)-(continuation?20:0)*(active?2:1)-i*(active||closed?2:1)));
     oracle=calls.length===1&&p?.resourceType===c.resource&&p.operation===c.operation&&p.totalCount===c.total&&p.returnedCount===c.returned
      &&JSON.stringify(p.items.map(x=>x.canonicalId))===JSON.stringify(ids);
    }
   }else if(c.operation==='ordinal')oracle=calls.length===1&&calls[0].args.operation==='detail';
   else{
    const r=calls.at(-1)?.result.relation;
    // Every rooted relation page authoritatively rereads its root, including continuation.
    oracle=!!r&&r.relation===c.relation&&calls.length===(c.relation==='parts.stock'?1:2)
     &&(c.relation==='parts.stock'||calls.at(-1).args.rootId===(c.identity?Number(c.identity.match(/[0-9]+$/)[0]):c.prior.rootId));
   }
   const record={id:c.id,pass:out.delivered===true&&out.validationPass===true&&oracle,oracleMatch:oracle,
    delivered:out.delivered,choicePending:out.choicePending===true,failureClass:out.failureClass,toolCalls:calls.length,
    technicalLeakage:/canonicalId|targetId|pageSize|afterId|read_collection|\/api\//.test(text)};
   data.cases.push(record);save();emit({id:c.id,pass:record.pass,failureClass:record.failureClass});
  }
  data.businessMutationDelta=db.prepare('SELECT total_changes() n').get().n-before;
  data.after=hashes();data.hashesMatch=JSON.stringify(data.before)===JSON.stringify(data.after);
  data.passed=data.cases.filter(c=>c.pass&&!c.technicalLeakage).length;
  data.status=data.passed===data.cases.length&&!data.businessMutationDelta&&data.hashesMatch?'PASS':'REWORK';save();emit({status:data.status,passed:data.passed,total:data.cases.length});
 }finally{for(const [k,v]of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;
  await new Promise(r=>server.close(r));db.close();}
}
if(require.main===module)main().catch(()=>{process.stdout.write('EXISTING_READ_CERTIFICATION_FAILED\n');process.exitCode=1;});
