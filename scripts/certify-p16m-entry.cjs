'use strict';
const fs=require('fs'),crypto=require('crypto');
const OUTPUT='docs/ai-governance/data/p16m-entry-v6-certification.json';
async function main(){
 if(fs.existsSync(OUTPUT))throw Error('ONE_SHOT_EXISTS');
 const env=require('dotenv').parse(fs.readFileSync('.env')),emit=console.log.bind(console);
 for(const k of ['log','info','warn','debug','error'])console[k]=()=>{};
 const {cases,fixture}=require('../tests/helpers/investigationCorpus.cjs'),db=fixture();
 const corpus=[...cases(),...['列出所有订单','现在一共有多少订单','看看订单 ORD-1 的详细信息','有哪些客户','有哪些零件','有哪些配方','有哪些线圈','零件-1现在多少钱','零件-1当前库存是多少','配方-1现在的完整成本是多少'].map((question,i)=>({id:'L-'+i,question,none:true})),
  ...cases().filter(c=>['M-01','M-03','M-05','M-17'].includes(c.id)).map(c=>({...c,id:'U-'+c.id,question:c.question.replace(/[「」]/g,''),unquoted:true}))];
 const files=['api/services/ai-v5/investigationIntent.cjs','api/services/ai-v5/investigationRuntime.cjs','api/services/ai-v5/sourceSpanSelector.cjs','api/services/ai-v5/candidateUnion.cjs','api/services/candidateRiskEnvelope.cjs'];
 const hashes=()=>Object.fromEntries(files.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
 const data={stage:'P16-M-entry',mode:'SEMANTIC_ONLY_REAL_MODEL_WITH_FROZEN_CONTROL_CONTEXT',repeats:3,questions:corpus.length,decisions:[],retries:0,before:hashes()};
 fs.writeFileSync(OUTPUT,JSON.stringify(data,null,2),{flag:'wx'});const save=()=>fs.writeFileSync(OUTPUT,JSON.stringify(data,null,2));
 const C=require('../api/services/collectionReadService.cjs').createCollectionReadService({db}),R=require('../api/services/relationReadService.cjs').createRelationReadService({db});
 const execute=async(name,q)=>{const c=name==='read_collection';return {success:true,[c?'collection':'relation']:(c?C:R).read(q),executionEvidence:{verified:true,kind:'formal_api_query',calls:[{method:'POST',path:c?'/api/collections/read':'/api/relations/read'}]}};};
 try{
  for(let repeat=1;repeat<=3;repeat++)for(const c of corpus){
   let intent=null,failure=null;const started=performance.now();
   try{
    if(c.prior){
     const ctx={version:1,contextKey:'a'.repeat(64),conversationId:'chat-1'},scope={taskId:'prior',contextKey:ctx.contextKey};
     const store=require('../api/services/ai-v5/collectionContinuation.cjs').createContinuationStore();
     const result=await require('../api/services/ai-v5/investigationExecution.cjs').executeInvestigation(require('../api/services/ai-v5/investigationPlan.cjs').createPlan(c.prior),{...scope,execute});
     store.setVerifiedRelation(ctx,c.prior,result.handle,scope);
     const control=require('../api/services/ai-v5/collectionControlPreRouter.cjs');intent=control.continuationControl(c.question,ctx,store)||control.ordinalDetailControl(c.question,ctx,store);
    }else intent=await require('../api/services/ai-v5/investigationIntent.cjs').selectInvestigationIntent(c.question,{env});
   }catch(e){failure=/^[A-Z_]+$/.test(e.message)?e.message:'UNAVAILABLE';}
   const correct=!!intent&&!failure&&(c.none?intent.operation==='NONE':c.operation?intent.operation===c.operation:
    intent.relation===c.relation&&(c.unquoted?intent.sourceSpans?.some(s=>s.text===c.identity):intent.identity===c.identity)&&intent.pageSize===c.pageSize&&(intent.stockStatus??null)===(c.stockStatus??null));
   data.decisions.push({id:c.id,repeat,correct,operation:intent?.operation??null,relation:intent?.relation??null,delegate:intent?.delegate??null,modelCalls:intent?.modelCalls??0,failure:failure||(!correct?'ORACLE_MISMATCH':null),ms:performance.now()-started});save();
   if(!correct)emit(data.decisions.at(-1));
  }
  data.after=hashes();data.hashMatch=JSON.stringify(data.before)===JSON.stringify(data.after);
  data.correct=data.decisions.filter(d=>d.correct).length;data.status=data.correct===corpus.length*3&&data.hashMatch?'PASS':'REWORK';save();emit({status:data.status,correct:data.correct,total:data.decisions.length});
 }finally{db.close();}
}
if(require.main===module)main().catch(()=>{process.stdout.write('ENTRY_CERTIFICATION_FAILED\n');process.exitCode=1;});
