const root=require('node:path').resolve(__dirname,'..');
process.chdir(root);
const req=require('module').createRequire(root+'/package.json');
const cp=require('child_process'),M=require('module').Module,assert=require('assert/strict');
const cur=req('./api/services/ai-v5/taskClassCatalog.cjs');
function prior(file,override){const mod=new M(req.resolve(file));mod.filename=req.resolve(file);mod.paths=M._nodeModulePaths(root+'/api/services/ai-v5');const native=mod.require.bind(mod);mod.require=p=>override?.[p]||native(p);mod._compile(cp.execFileSync('git',['show','442119c:'+file.replace('./','')],{encoding:'utf8'}),mod.filename);return mod.exports;}
const oldS=prior('./api/services/ai-v5/taskClassSemantics.cjs');
const oldC=prior('./api/services/ai-v5/taskClassCatalog.cjs',{'./taskClassSemantics.cjs':oldS});
for(const ref of ['tc_003','tc_004'])assert.deepEqual(cur.getV5TaskClass(ref),oldC.getV5TaskClass(ref));
const view=c=>c.taskClassModelView().filter(x=>['tc_003','tc_004'].includes(x.classRef));assert.deepEqual(view(cur),view(oldC));
const protectedFiles=['capabilityRegistry','capabilityRouter','entityFinalization','sourceSpanSelector','readArgumentBinder','candidateSet','nestedSpanRefinement','typeIndependentEntityResolver','readExecutionRegistry'];
assert.equal(cp.execFileSync('git',['diff','--name-only','442119c','HEAD','--',...protectedFiles.map(f=>'api/services/ai-v5/'+f+'.cjs')],{encoding:'utf8'}).trim(),'');
async function main(){
 const D=req('better-sqlite3'),db=new D(root+'/pump.db',{readonly:true});let sources;try{sources=req('./scripts/run-ai-v5f1b-read-certification.cjs').fixtures(db);}finally{db.close();}
 const corpus=req('./docs/ai-governance/data/v5-e4r-entity-first-architecture-audit.json').cases;
 const {required}=req('./scripts/run-ai-v5f2b-answer-formal.cjs');
 const {createV5SourceSpanCatalog}=req('./api/services/ai-v5/sourceSpanCatalog.cjs');
 const {createV5InterpreterInputEnvelope}=req('./api/services/ai-v5/taskInterpreterInput.cjs');
 const {interpretCandidateSetTask}=req('./api/services/ai-v5/candidateSetTwoStageInterpreter.cjs');
 const {deriveRequiredFactKey}=req('./api/services/ai-v5/requiredFactScope.cjs');
 const paths=[];
 for(const c of corpus){
  const s=sources.get(c.source_group),cat=createV5SourceSpanCatalog(s.source),exact=cat.spans.find(x=>x.text===s.mention);assert.ok(exact);
  const ref=required[c.source_group]==='price.current'?'tc_028':c.expected_class;let calls=0;
  const out=await interpretCandidateSetTask(createV5InterpreterInputEnvelope({rawUserRequest:s.source,pageContext:null}),{
   supplySpanCandidates:async()=>({version:1,status:'OK',complete:true,identityScanCount:0,candidateCount:0,candidates:[]}),
   modelRequest:async()=>({content:JSON.stringify(++calls===1?{version:2,spanRefs:[exact.spanRef,cat.spans.find(x=>x.spanRef!==exact.spanRef).spanRef],needsClarification:false}:{version:1,localTaskClassRef:ref})}),
   lookupEntities:async(_f,input)=>{const candidates=input.mention===s.mention?[{entityType:c.expected_entity_type,canonicalId:s.id,matchKind:'EXACT'}]:[];return {version:1,status:'OK',complete:true,attemptedEntityTypes:6,candidateCount:candidates.length,candidates};}
  });
  assert.equal(out.status,'VALID');assert.equal(out.taskClassRef,ref);assert.equal(deriveRequiredFactKey(out),required[c.source_group]);
  paths.push({caseId:c.case_id,fact:required[c.source_group],pass:true});
 }
 console.log(JSON.stringify({coilClassesIdentical:true,coilModelViewIdentical:true,protectedFilesUnchanged:true,mode:'DETERMINISTIC_FROZEN_FIXTURE_NO_REAL_MODEL_OR_API',paths}));
}
main().catch(()=>{console.error('STATIC_CHECK_FAILED');process.exitCode=1;});
