'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const { isFatalRecord, verifyHashes, enforceFatalExit } = require('./lib/v5TwoStageEvaluationControl.cjs');
const { interpretCandidateSetTask } = require('../api/services/ai-v5/candidateSetTwoStageInterpreter.cjs');
const { runV5IndependentShadow, evaluateIndependentShadow } = require('../api/services/ai-v5/independentShadow.cjs');
const { createV5InterpreterInputEnvelope } = require('../api/services/ai-v5/taskInterpreterInput.cjs');
const { createV5SourceSpanCatalog, getSourceSpan } = require('../api/services/ai-v5/sourceSpanCatalog.cjs');
const { SPAN_SELECTOR_PROMPT } = require('../api/services/ai-v5/sourceSpanSelector.cjs');
const { LOCAL_INTENT_PROMPT } = require('../api/services/ai-v5/localIntentSelector.cjs');
const { V5_INTERPRETER_MODEL_SETTINGS } = require('../api/services/ai-v5/taskInterpreter.cjs');
const { V5_TASK_CLASS_CATALOG } = require('../api/services/ai-v5/taskClassCatalog.cjs');
const { withAgentSpan, withV5InterpreterStage, initializeObservability, safeForceFlush, safeShutdown, getActiveTraceContext } = require('../api/services/observability.cjs');
const output = path.join(root,'docs/ai-governance/data/v5-e4r-candidate-set-two-stage-valid-evaluation.json');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const moduleFiles = ['twoStageModel','sourceSpanSelector','sourceSpanSelectionContract','candidateSet','localTaskClassCatalog','localIntentSelector','localIntentContract','entityFinalization','candidateSetTwoStageInterpreter', 'independentShadow','shadowMirror','typeIndependentEntityResolver','sourceSpanCatalog','sourceAnchoredEntity','taskClassCatalog','taskClassSemantics','capabilityRegistry','capabilityRouter','toolExposure','taskInterpreterInput','taskInterpretationContract','contracts','taskState','controlledRuntime','policy','evidenceLedger'];
function freezeHashes() {
    const files = moduleFiles.map(name => `api/services/ai-v5/${name}.cjs`).filter(file => fs.existsSync(path.join(root,file)));
    files.push('api/services/entityLookupService.cjs','api/routes/entityLookup.cjs','api/routes/ai/internalApiClient.cjs','api/services/observability.cjs','scripts/run-ai-v5e4r-two-stage-evaluation.cjs','scripts/lib/v5TwoStageEvaluationControl.cjs','scripts/run-ai-v5e4r-two-stage-json-preflight.cjs');
    return { spanSelectorPrompt:hash(SPAN_SELECTOR_PROMPT), localIntentPrompt:hash(LOCAL_INTENT_PROMPT), modelSettings:hash(JSON.stringify(V5_INTERPRETER_MODEL_SETTINGS)),
        ...Object.fromEntries(files.map(file => [file,hash(fs.readFileSync(path.join(root,file)))])),
        frozenCorpus:hash(JSON.stringify(read('docs/ai-observability/data/p06-failure-cases.json'))),
        frozenExpected:hash(JSON.stringify(read('docs/ai-governance/data/v5-e4r-entity-first-architecture-audit.json').cases)),
    };
}
function dbSnapshot() {
    const file = path.join(root,'pump.db'); const stat = fs.statSync(file);
    const walk = dir => !fs.existsSync(dir) ? 0 : fs.readdirSync(dir,{withFileTypes:true}).reduce((n,e)=>n+(e.isDirectory()?walk(path.join(dir,e.name)):1),0);
    return { hash:hash(fs.readFileSync(file)),mtimeMs:stat.mtimeMs,size:stat.size,backups:walk(path.join(root,'backups'))+walk(path.join(root,'api/backups')) };
}
function percentile(values,p) { const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b); return sorted.length?sorted[Math.min(sorted.length-1,Math.ceil(p*sorted.length)-1)]:null; }
const ratio=(correct,total)=>({correct,total,rate:total?correct/total:null});
function summarize(paths) {
    const metric = (key, rows=paths) => ratio(rows.filter(p=>p[key]===true).length,rows.length);
    const stage2=paths.filter(p=>p.stage2Calls===1);
    const consistency=(rows,input,signature)=>{ const groups=[...new Set(rows.map(p=>p[input]).filter(Boolean))]; return ratio(groups.filter(g=>new Set(rows.filter(p=>p[input]===g).map(p=>p[signature])).size===1).length,groups.length); };
    const keys=['spanMatch','candidateCoverage','expectedClassSurvives','taskClassMatch','finalEntityUnique','finalEntityCorrect','domainMatch','operationMatch','entityTypeMatch','capabilityMatch','expectedToolExposed'];
    const groups=[...new Set(paths.map(p=>p.source_group_id))], fps=[...new Set(paths.map(p=>p.inputFingerprint))];
    const grouped=(set,field)=>Object.fromEntries(keys.map(key=>[key,ratio(set.filter(g=>paths.filter(p=>p[field]===g).every(p=>p[key])).length,set.length)]));
    return { paths:paths.length, ...Object.fromEntries(keys.map(key=>[key,metric(key)])),
        sourceGroups:grouped(groups,'source_group_id'), inputFingerprints:grouped(fps,'inputFingerprint'),
        stage1Valid:paths.filter(p=>p.stage1Status==='VALID').length, stage1Invalid:paths.filter(p=>p.stage1Status==='INVALID').length,
        stage1Noncompliance:paths.filter(p=>p.stage1Status==='INVALID').length,
        stage2Valid:stage2.filter(p=>p.stage2Status==='VALID').length,stage2Invalid:stage2.filter(p=>p.stage2Status==='INVALID').length,
        stage2Noncompliance:stage2.filter(p=>p.stage2Status==='INVALID').length,
        localIntentAccuracy:metric('taskClassMatch',stage2),
        stage1Consistency:consistency(paths,'inputFingerprint','stage1Signature'),stage2Consistency:consistency(stage2,'stage2InputFingerprint','stage2Signature'),finalConsistency:consistency(paths,'inputFingerprint','finalSignature'),
        lookupComplete:paths.filter(p=>p.complete).length,initialUnique:paths.filter(p=>p.lookupStatus==='RESOLVED').length,initialAmbiguous:paths.filter(p=>p.lookupStatus==='AMBIGUOUS').length,
        notFound:paths.filter(p=>p.lookupStatus==='NOT_FOUND').length,resolverErrors:paths.filter(p=>p.lookupStatus==='ERROR').length,
        falseUnique:paths.filter(p=>p.finalEntityUnique&&!p.finalEntityCorrect).length,
        medianLocalClasses:percentile(paths.map(p=>p.localClassCount),0.5),maxLocalClasses:Math.max(0,...paths.map(p=>p.localClassCount)),
        singleton:paths.filter(p=>p.localSelectionMode==='DETERMINISTIC_SELECT').length,stage2Applicable:stage2.length,
        stage1Calls:paths.reduce((n,p)=>n+p.stage1Calls,0),stage2Calls:paths.reduce((n,p)=>n+p.stage2Calls,0),
        totalModelCalls:paths.reduce((n,p)=>n+p.stage1Calls+p.stage2Calls,0),maxModelCalls:Math.max(0,...paths.map(p=>p.stage1Calls+p.stage2Calls)),
        businessApiCalls:paths.reduce((n,p)=>n+p.businessApiCalls,0),
        comparisons:Object.fromEntries(['AGREE','V5_FALSE_BLOCK','V5_BLOCKS_V4_FAILURE','V5_INSUFFICIENT_DATA'].map(s=>[s,paths.filter(p=>p.overallComparison===s).length])),
        special:Object.fromEntries(['COIL','FLATBLADE','EXACT'].map(f=>{const selected=paths.filter(p=>p.case_id.startsWith(`P06-${f}-001`));return [f,{paths:selected.length,...Object.fromEntries(keys.map(key=>[key,metric(key,selected)])),falseBlocks:selected.filter(p=>p.overallComparison==='V5_FALSE_BLOCK').length}];})),
        r02WrongToolExclusion:metric('wrongToolExcluded',paths.filter(p=>p.r02)),
        latency:Object.fromEntries(['completionMs','stage1DurationMs','lookupDurationMs','stage2DurationMs'].map(key=>[key,{median:percentile(paths.map(p=>p[key]),0.5),p95:percentile(paths.map(p=>p[key]),0.95)}])),
    };
}
async function main() {
    require('dotenv').config({quiet:true});
    if (fs.existsSync(output)) throw new Error('FORMAL_EVALUATION_ALREADY_STARTED');
    if (!process.env.DEEPSEEK_API_KEY) throw new Error('PROVIDER_UNAVAILABLE');
    const { verifyFreezeHashes,computeFreezeHashes }=require('./run-ai-v5e4r-task-class-semantics-v1_1-evaluation.cjs');
    verifyFreezeHashes(computeFreezeHashes());
    const preflight=read('docs/ai-governance/data/v5-e4r-two-stage-json-preflight.json');
    if(preflight.stage1?.status!=='VALID'||preflight.stage2?.status!=='VALID') throw new Error('PREFLIGHT_CANARY_FAILED');
    verifyHashes(freezeHashes(),preflight.freezeHashes);
    const before=dbSnapshot(), pre=freezeHashes();
    const Database=require('better-sqlite3');
    // Harness-only source fixture recovery. Runtime data authority remains HTTP API.
    // Read-only connection also backs the unchanged Business API route in this isolated server.
    const db=new Database(path.join(root,'pump.db'),{readonly:true,fileMustExist:true});
    const frozen=read('docs/ai-observability/data/p06-failure-cases.json');
    const expected=read('docs/ai-governance/data/v5-e4r-entity-first-architecture-audit.json').cases;
    const fingerprints=new Map(read('docs/ai-governance/data/v5-e4r-task-class-semantics-v1_1-evaluation.json').paths.map(p=>[p.source_group_id,p.input_fingerprint]));
    const definitions={
        COIL_INVENTORY:{query:'SELECT id,scheme_code AS identity FROM coils',suffix:'当前库存是多少'},
        EXACT_RECIPE_COST:{query:'SELECT id,name AS identity FROM recipes WHERE deleted_at IS NULL',suffix:'现在的完整成本是多少'},
        FLAT_BLADE_PRICE:{query:'SELECT id,model AS identity FROM parts WHERE deleted_at IS NULL',suffix:'现在多少钱'},
        PART_INVENTORY_PRIMARY:{query:'SELECT id,model AS identity FROM parts WHERE deleted_at IS NULL',suffix:'当前库存是多少'},
        PART_INVENTORY_REPEAT:{query:'SELECT id,model AS identity FROM parts WHERE deleted_at IS NULL',suffix:'当前库存是多少'},
    };
    const fixtures=new Map();
    for (const [group,def] of Object.entries(definitions)) {
        const rows=db.prepare(def.query).all();
        const found=rows.find(row=>createV5InterpreterInputEnvelope({rawUserRequest:`${row.identity}${def.suffix}`,pageContext:null}).inputFingerprint===fingerprints.get(group));
        if(!found) throw new Error('FROZEN_FIXTURE_UNAVAILABLE');
        fixtures.set(group,{source:`${found.identity}${def.suffix}`,mention:found.identity,id:String(found.id)});
    }
    if(expected.length!==15||fixtures.size!==5||new Set(fingerprints.values()).size!==4) throw new Error('FROZEN_CORPUS_CHANGED');
    const express=require('express'),http=require('node:http');
    const app=express(); app.use(express.json());
    const secret=crypto.randomUUID();
    app.use((req,res,next)=>req.headers['x-internal-secret']===secret?next():res.sendStatus(401));
    app.use('/api/entity-lookup',require('../api/routes/entityLookup.cjs').createEntityLookupRouter({db}));
    const server=http.createServer(app); await new Promise(resolve=>server.listen(0,resolve));
    const savedPort=process.env.PORT,savedSecret=process.env.INTERNAL_SECRET;
    process.env.PORT=String(server.address().port);process.env.INTERNAL_SECRET=secret;
    const {createInternalFetch}=require('../api/routes/ai/internalApiClient.cjs');
    initializeObservability({env:{...process.env,AI_OBSERVABILITY_ENABLED:'true',AI_TRACE_CONTENT:'metadata',AI_OBSERVABILITY_PROJECT:'pump-ai-v5-candidate-set-v3'}});
    const dataset={version:1,architectureVersion:3,priorInfrastructureAbortedRuns:1,formalRealEvaluationRuns:1,v4TrajectorySource:'FROZEN_P06_ARTIFACT_NO_V4_MODEL_RERUN',preEvalHashes:pre,paths:[],metrics:null};
    fs.writeFileSync(output,JSON.stringify(dataset,null,2)+'\n',{flag:'wx'});
    try {
        for(const oracle of expected) {
            const item=frozen.find(p=>p.case_id===oracle.case_id),fixture=fixtures.get(oracle.source_group);
            const envelope=createV5InterpreterInputEnvelope({rawUserRequest:fixture.source,pageContext:null});
            const taskId=`v3-${crypto.randomUUID()}`;
            const record=await withAgentSpan({requestId:taskId,route:'v5-shadow-v3'},async()=>{
                const traceId=getActiveTraceContext()?.traceId||null;
                const result=await interpretCandidateSetTask(envelope,{shadowTaskId:taskId,internalFetch:createInternalFetch({operationId:taskId})});
                const shadow=await withV5InterpreterStage('capability-route',{shadowTaskId:taskId},()=>runV5IndependentShadow({interpreterEnvelope:envelope,shadowTaskId:taskId},{interpret:async()=>result}));
                const comparison=await withV5InterpreterStage('shadow-comparison',{shadowTaskId:taskId},()=>evaluateIndependentShadow(shadow,item.expected,{v4Result:item.result,rootCauseClass:item.failure_class,toolNames:item.safe_structural_metadata.tools}));
                const selectedSpan=getSourceSpan(createV5SourceSpanCatalog(fixture.source),result.sourceSpanRefs?.[0]);
                const meta=result.architectureMetadata;
                const local=V5_TASK_CLASS_CATALOG.filter(c=>c.entityTypes.some(t=>meta.candidateTypes.includes(t)));
                return {case_id:oracle.case_id,source_group_id:oracle.source_group,inputFingerprint:envelope.inputFingerprint,
                    ...meta,spanMatch:selectedSpan?.text===fixture.mention,
                    candidateCoverage:meta.complete&&meta.candidateTypes.includes(oracle.expected_entity_type),
                    expectedClassSurvives:local.some(c=>c.classRef===oracle.expected_class),taskClassMatch:result.taskClassRef===oracle.expected_class,
                    finalEntityUnique:meta.finalEntityStatus==='FINAL_ENTITY_RESOLVED',
                    finalEntityCorrect:result.resolvedIdentity?.entityType===oracle.expected_entity_type&&result.resolvedIdentity?.canonicalId===fixture.id,
                    domainMatch:comparison.domainMatch,operationMatch:comparison.operationMatch,entityTypeMatch:comparison.entityTypeMatch,
                    capabilityMatch:comparison.capabilityMatch,expectedToolExposed:comparison.expectedToolExposed,wrongToolExcluded:comparison.wrongToolExcluded,r02:item.failure_class==='R02',
                    overallComparison:comparison.overallComparison,reasonCodes:shadow.reasonCodes,
                    traceId,shadowTaskId:taskId,completionMs:result.durationMs,
                    stage1Signature:hash(JSON.stringify([meta.stage1Status,result.sourceSpanRefs])),
                    stage2Signature:hash(JSON.stringify([meta.stage2Status,result.taskClassRef])),
                    finalSignature:hash(JSON.stringify([shadow.domain,shadow.operation,shadow.entityTypes,shadow.sourceSpanRefs,shadow.capabilityId,meta.finalEntityStatus])),
                };
            });
            dataset.paths.push(record);fs.writeFileSync(output,JSON.stringify(dataset,null,2)+'\n');
            console.log(JSON.stringify({case_id:record.case_id,stage1:record.stage1Status,classMatch:record.taskClassMatch,finalEntity:record.finalEntityCorrect}));
            if(isFatalRecord(record)) throw new Error('FORMAL_EVALUATION_INFRASTRUCTURE_FATAL');
        }
        dataset.metrics=summarize(dataset.paths);
    } catch(error) { dataset.fatalReason='FORMAL_EVALUATION_INFRASTRUCTURE_FATAL'; }
    finally {
        dataset.postEvalHashes=freezeHashes();dataset.hashesMatch=JSON.stringify(pre)===JSON.stringify(dataset.postEvalHashes);
        dataset.databaseBefore=before;dataset.databaseAfter=dbSnapshot();dataset.databaseUnchanged=JSON.stringify(before)===JSON.stringify(dataset.databaseAfter);
        if(!dataset.hashesMatch||!dataset.databaseUnchanged) dataset.fatalReason='FORMAL_EVALUATION_INVARIANT_FAILURE';
        dataset.metrics=summarize(dataset.paths);
        fs.writeFileSync(output,JSON.stringify(dataset,null,2)+'\n');
        await safeForceFlush();await safeShutdown(); await new Promise(resolve=>server.close(resolve));db.close();
        if(savedPort===undefined)delete process.env.PORT;else process.env.PORT=savedPort;
        if(savedSecret===undefined)delete process.env.INTERNAL_SECRET;else process.env.INTERNAL_SECRET=savedSecret;
    }
    console.log(JSON.stringify({paths:dataset.paths.length,metrics:dataset.metrics,hashesMatch:dataset.hashesMatch,databaseUnchanged:dataset.databaseUnchanged}));
    enforceFatalExit(dataset);
}
if(require.main===module)main().catch(()=>{console.error('V3_EVALUATION_FAILED');process.exitCode=1;});
module.exports={freezeHashes,dbSnapshot,summarize};
