'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const reportPath=path.resolve('logs/ont-p6r-r1-real-results.json');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const stable=o=>Array.isArray(o)?o.map(stable):o&&typeof o==='object'?Object.fromEntries(Object.keys(o).sort().map(k=>[k,stable(o[k])])):o;
async function main(){
 const root=process.env.ONT_SHADOW_CONFIG_ROOT||process.cwd();
 const env={...process.env,...require('dotenv').parse(fs.readFileSync(path.join(root,'.env')))};
 const Database=require('better-sqlite3'),configDb=new Database(path.join(root,'pump.db'),{readonly:true,fileMustExist:true});
 const config=require('../api/services/runtimeConfig.cjs');
 try{const s=config.effectiveValues({env,dbAccessors:{db:configDb}});for(const [k,v]of Object.entries(s.values))env[config.DEFINITIONS[k].env]=v;}finally{configDb.close();}
 env.AI_PROVIDER='local-first';
 const registry=require('../api/services/aiProviderRegistry.cjs'),initial=registry.resolveAiProviderConfig(env),cloud=registry.resolveProviderConfig('deepseek',env);
 if(initial.provider!=='local'||initial.routingMode!=='local-first'||!cloud.apiKey)throw Error('PROVIDER_PREREQUISITE_FAILED');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'p6r-r1-real-')),filename=path.join(directory,'fixture.db');
 let server,db;
 const prior=fs.existsSync(reportPath)?JSON.parse(fs.readFileSync(reportPath,'utf8')):null;
 const report={version:1,startCommit:'6d9abde6f75e14388669cc9975797a1b6e803efc',runtimeMode:'local-first',cloudModel:cloud.model,localServerStarted:false,status:'RUNNING',fallbackChainVerified:false,cases:prior?.cases||[],pairs:[],resumedAfterFixtureCorrection:Boolean(prior),priorInterruptedAttemptLog:prior?'logs/ont-p6r-r1-real-before-fixture-correction.log':null};
 const save=()=>{fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');};
 try{
  require('../tests/helpers/ontologyShadowFixture.cjs').fixture(filename).close();
  Object.assign(process.env,{NODE_ENV:'test',NODE_TEST_CONTEXT:'p6r-r1-real-controlled',PUMP_TEST_DATABASE_PATH:filename,KNOWLEDGE_AUTO_SYNC_ENABLED:'false',KNOWLEDGE_VECTOR_ENABLED:'false'});
  const app=require('express')();app.use(require('express').json());
  const previews=[/^\/api\/coils\/calculate$/, /^\/api\/cost\/(?:full-estimate|dynamic|parts)$/, /^\/api\/recipes\/(?:bom-draft|cost-draft|[1-9][0-9]*\/cost-preview)$/, /^\/api\/templates\/[1-9][0-9]*\/cost-preview$/];
  app.use((req,res,next)=>req.method==='GET'||req.method==='POST'&&previews.some(p=>p.test(req.path))?next():res.status(403).json({success:false,code:'CONTROLLED_READ_ONLY'}));
  for(const r of ['recipes','coils','orders','quotations','customers','parts','templates','knowledge'])app.use(`/api/${r}`,require(`../api/routes/${r}.cjs`));
  app.use('/api',require('../api/routes/cost.cjs'));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});process.env.PORT=String(server.address().port);db=require('../api/db.cjs').db;
  const {runAiAssistant,requiredCoilRecipeToolCall}=require('../api/services/aiAssistantRuntime.cjs');
  const {fetchAiProvider}=require('../api/services/aiProvider.cjs'),{executeToolCall}=require('../api/routes/ai/executor.cjs');
  const {beginAssistantSession}=require('../api/services/aiAssistantSession.cjs');
  const {bindRelation}=require('../api/ontology/relationBinder.cjs'),{currentFactsForBinding}=require('../api/ontology/bindingCurrentFacts.cjs');
  const {buildEvidenceBundle}=require('../api/services/aiEvidenceBundle.cjs'),{createTaskEnvelope}=require('../api/services/aiTaskEnvelope.cjs');
  const shortlist=require('../api/services/aiToolShortlist.cjs'),{cases}=require('../tests/helpers/ontologyRoutingCorpus.cjs');
  const before=db.serialize(),changes=db.prepare('SELECT total_changes() n').get().n;
  async function seed(c){const types=c.sessionType?[c.sessionType]:['coil','recipe'];const out=[];for(const t of types){const name=t==='coil'?'search_coils':'get_all_recipes',args=t==='coil'?{spec:'12',sheets:120}:{keyword:'Shadow配方甲'};out.push({name,args,result:await executeToolCall(name,args,{allowWrite:false})});}return out;}
  async function run(c,round,on){
   const caseId=`r${round}-${c.caseId}-${on?'on':'off'}`;
   const cached=report.cases.find(e=>e.caseId===caseId);if(cached)return cached;
   const conversationId=`r1-${crypto.randomUUID()}`,subject='p6r-r1-controlled-owner';
   const seeds=await seed(c);beginAssistantSession(subject,conversationId).finish({toolResults:seeds});
   const binding=bindRelation({ontologyVersion:1,userText:c.userText,verifiedToolResults:seeds,subject,conversationId,trustedSession:{subject,conversationId,observedAt:Date.now(),toolResults:seeds}});
   const entry={caseId,category:c.category,round,canaryOn:on,runtimeMode:'local-first',bindingStatus:binding.status,root:binding.root||null,relationId:binding.relationId||null,providerEvents:[],networkFailures:[],modelCalls:0,providerFallbacks:0,providerFallbackFailures:0,legacyDetectorCalls:0,legacyRepairCalls:0,catalogs:[],routing:null};
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(Object.assign(Error('CASE_TIMEOUT'),{code:'CONTROLLED_TIMEOUT'})),180000);
   console.log('RUN '+caseId);
   try{
    const result=await runAiAssistant({messages:[{role:'user',content:c.userText}],confirmationSubject:subject,conversationId,signal:controller.signal,requestId:caseId,
     env:{...env,AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED:String(on),AI_ONTOLOGY_RELATION_SHADOW_ENABLED:'false',AI_ONTOLOGY_RELATION_BINDING_SHADOW_ENABLED:'false',AI_ONTOLOGY_2HOP_SHADOW_ENABLED:'false'}},{
     loadMemory:async()=>({items:[]}),loadCorrections:()=>'',ontologyRouting:{record:r=>{entry.routing=r;}},
     legacyRelationDetector:text=>{entry.legacyDetectorCalls++;return shortlist.isCoilRecipeRelationQuery(text);},
     legacyRelationRepair:(name,text)=>{entry.legacyRepairCalls++;return requiredCoilRecipeToolCall(name,text);},
     fetchAiProvider:async(m,o)=>{entry.modelCalls++;entry.catalogs.push(o.tools.map(t=>t.function.name));let fallback=false;
      try{const response=await fetchAiProvider(m,{...o,onProvider:i=>{entry.providerEvents.push(i);if(i.fallback){fallback=true;entry.providerFallbacks++;}o.onProvider?.(i);},
       fetchImpl:async(url,init)=>{try{return await fetch(url,init);}catch(e){entry.networkFailures.push({provider:String(url).startsWith(initial.baseUrl)?'local':'deepseek',causeCode:e.cause?.code||e.name});throw e;}}});return response;
      }catch(e){if(fallback)entry.providerFallbackFailures++;throw e;}},
    });
    entry.formalResults=result.toolResults;entry.outcome=result.telemetry.outcome;entry.tools=result.toolResults.map(t=>({name:t.name,args:t.args,success:t.result?.success!==false,code:t.result?.code||null}));
    entry.evidence=buildEvidenceBundle(createTaskEnvelope(c.userText),result.toolResults);entry.answer=result.finalContent;
    const facts=binding.status==='BOUND'?currentFactsForBinding(binding,result.toolResults):null;
    entry.canonicalTargets=facts?.canonicalTargetIds||null;entry.canonicalComplete=facts?.complete===true&&facts?.canonical===true;
    entry.expectedTargets=c.category==='positive'?(c.root.entityType==='coil'?['301']:['501']):null;
    entry.correctBinding=c.category!=='positive'||equal(binding.root,c.root)&&binding.relationId===c.relationId;
    entry.correctTargets=c.category!=='positive'||entry.canonicalComplete&&equal(entry.canonicalTargets,entry.expectedTargets);
    const answer=result.finalContent;
    entry.answerFacts=c.category==='positive'?{recipeIdentity:/Shadow配方甲|301/u.test(answer),coilIdentity:/Shadow线圈甲|SHADOW-501|501|12[-—~]120/u.test(answer),relationConclusion:/使用|用了|用的是|用到|采用|配的|配有|线圈|绕组/u.test(answer),extraRecipeIdentity:/Shadow空配方|Shadow旧配方|Shadow歧义配方/u.test(answer),extraCoilIdentity:/Shadow空线圈|SHADOW-502/u.test(answer)}:null;
    entry.completed=true;
   }catch(e){entry.completed=false;entry.errorCode=/^[A-Z0-9_]{1,64}$/.test(e.code||'')?e.code:'REAL_RUNTIME_FAILURE';}finally{clearTimeout(timer);}
   report.cases.push(entry);save();console.log(JSON.stringify({caseId,completed:entry.completed,routingSource:entry.routing?.routingSource,modelCalls:entry.modelCalls,providerFallbacks:entry.providerFallbacks,targets:entry.canonicalTargets}));return entry;
  }
  const first=cases.find(c=>c.category==='positive'),firstOff=await run(first,1,false);
  const events=firstOff.providerEvents;
  report.fallbackChainVerified=firstOff.completed&&events[0]?.provider==='local'&&events.some(e=>e.provider==='local'&&e.failed&&e.fallbackEligible)&&events.some(e=>e.provider==='deepseek'&&e.fallback&&e.routeReason==='local_fallback')&&firstOff.networkFailures.some(e=>e.provider==='local'&&e.causeCode==='ECONNRESET')&&firstOff.routing?.routingSource==='LEGACY_RELATION_SPECIAL_CASE'&&firstOff.legacyDetectorCalls>0&&equal(firstOff.catalogs[0],['get_all_recipes','search_coils']);
  save();console.log(JSON.stringify({fallbackChainVerified:report.fallbackChainVerified,firstCase:firstOff.caseId,events:firstOff.providerEvents}));
  if(!report.fallbackChainVerified){report.status='BLOCKED';report.primaryBlocker='LOCAL_FIRST_FALLBACK_CHAIN_NOT_VERIFIED';save();return;}
  const results=new Map([[firstOff.caseId,firstOff]]),jobs=[];
  for(let round=1;round<=2;round++)for(const c of cases.filter(c=>c.category==='positive'))for(const on of [false,true])if(!(round===1&&c===first&&!on))jobs.push({c,round,on});
  for(const c of cases.filter(c=>c.category==='negative'&&c.caseId!=='ambiguous-root'))for(const on of [false,true])jobs.push({c,round:1,on});
  let cursor=0;await Promise.all(Array.from({length:4},async()=>{while(cursor<jobs.length){const job=jobs[cursor++],r=await run(job.c,job.round,job.on);results.set(r.caseId,r);}}));
  report.baseFixtureUnchanged=db.serialize().equals(before)&&changes===db.prepare('SELECT total_changes() n').get().n;
  // Separate ambiguous-root fixture setup, after other cases; never a runtime write.
  db.prepare("INSERT INTO coils(id,scheme_name,scheme_code,spec,material,sheets) VALUES(503,'Shadow重名线圈','SHADOW-503','12','冷轧',120)").run();
  const ambiguousBefore=db.serialize(),ambiguousChanges=db.prepare('SELECT total_changes() n').get().n,c=cases.find(c=>c.caseId==='ambiguous-root');
  for(const on of [false,true]){const r=await run(c,1,on);results.set(r.caseId,r);}
  report.ambiguousFixtureUnchanged=db.serialize().equals(ambiguousBefore)&&ambiguousChanges===db.prepare('SELECT total_changes() n').get().n;
  for(const c of cases)for(let round=1;round<=(c.category==='positive'?2:1);round++){
   const off=results.get(`r${round}-${c.caseId}-off`),on=results.get(`r${round}-${c.caseId}-on`);
   report.pairs.push({caseId:c.caseId,round,category:c.category,completed:off?.completed===true&&on?.completed===true,
    rootEquivalent:equal(off?.root,on?.root),directionEquivalent:off?.relationId===on?.relationId,
    toolSequenceEquivalent:equal(off?.tools?.map(t=>t.name),on?.tools?.map(t=>t.name)),
    requiredToolsEquivalent:c.category==='positive'?['search_coils','get_all_recipes'].every(n=>off?.tools?.some(t=>t.name===n&&t.success)&&on?.tools?.some(t=>t.name===n&&t.success)):equal(off?.catalogs?.[0],on?.catalogs?.[0]),
    toolArgsEquivalent:equal(stable(off?.tools?.map(t=>({name:t.name,args:t.args}))),stable(on?.tools?.map(t=>({name:t.name,args:t.args})))),
    canonicalEquivalent:c.category==='positive'?off?.correctTargets===true&&on?.correctTargets===true&&equal(off.canonicalTargets,on.canonicalTargets):null,
    evidenceEquivalent:equal(off?.evidence,on?.evidence),answerFactsEquivalent:c.category==='positive'?equal(off?.answerFacts,on?.answerFacts)&&Object.entries(on?.answerFacts||{}).every(([k,v])=>k.startsWith('extra')?!v:v):null,
    modelCallsEquivalent:off?.modelCalls===on?.modelCalls,
   });
  }
  const positives=report.cases.filter(c=>c.category==='positive'),negatives=report.cases.filter(c=>c.category==='negative'),pairs=report.pairs.filter(c=>c.category==='positive');
  report.metrics={completed:report.cases.filter(c=>c.completed).length,total:report.cases.length,positiveEligible:positives.filter(c=>c.canaryOn&&c.routing?.eligible).length,ontologyRouted:positives.filter(c=>c.routing?.routingSource==='ONTOLOGY_RELATION_BINDING').length,legacyRouted:positives.filter(c=>c.routing?.routingSource==='LEGACY_RELATION_SPECIAL_CASE').length,negativeFalseRoutes:negatives.filter(c=>c.routing?.routingSource==='ONTOLOGY_RELATION_BINDING').length,wrongBinding:positives.filter(c=>!c.correctBinding).length,ontologyUnexpectedFallback:report.cases.filter(c=>c.routing?.fallback).length,eligibleLegacyParticipation:positives.filter(c=>c.canaryOn&&(c.legacyDetectorCalls||c.legacyRepairCalls||c.routing?.legacyDetectorUsed||c.routing?.legacyRepairUsed)).length,providerFallbackCount:report.cases.reduce((n,c)=>n+c.providerFallbacks,0),providerFallbackFailures:report.cases.reduce((n,c)=>n+c.providerFallbackFailures,0),positiveEquivalentCounts:Object.fromEntries(['rootEquivalent','directionEquivalent','requiredToolsEquivalent','toolSequenceEquivalent','toolArgsEquivalent','canonicalEquivalent','evidenceEquivalent','answerFactsEquivalent','modelCallsEquivalent'].map(k=>[k,pairs.filter(p=>p[k]).length])),positivePairs:pairs.length};
  report.status=report.metrics.completed===72&&report.metrics.positiveEligible===16&&report.metrics.ontologyRouted===16&&report.metrics.legacyRouted===16&&!report.metrics.negativeFalseRoutes&&!report.metrics.wrongBinding&&!report.metrics.ontologyUnexpectedFallback&&!report.metrics.eligibleLegacyParticipation&&report.baseFixtureUnchanged&&report.ambiguousFixtureUnchanged&&pairs.every(p=>p.completed&&p.canonicalEquivalent&&p.answerFactsEquivalent&&p.requiredToolsEquivalent&&p.toolArgsEquivalent&&p.modelCallsEquivalent)?'PASS':'REWORK';
  report.primaryBlocker=report.status==='PASS'?null:'REAL_AI_EQUIVALENCE_GATE_NOT_MET';save();console.log(JSON.stringify({status:report.status,metrics:report.metrics,databaseUnchanged:report.baseFixtureUnchanged&&report.ambiguousFixtureUnchanged}));
 }finally{if(server)await new Promise(resolve=>server.close(resolve));if(db?.open)db.close();const resolved=path.resolve(directory);if(!resolved.startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('INVALID_FIXTURE_DIRECTORY');fs.rmSync(resolved,{recursive:true,force:true});}
}
main().catch(()=>{console.error('P6R_R1_REAL_SETUP_FAILED');process.exitCode=1;});
