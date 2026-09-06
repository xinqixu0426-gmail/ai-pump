'use strict';
// Operator-only, one-shot certification in disposable code + native readonly Candidate.
// No raw identities, requests, model responses or tool values leave this process.
const fs = require('node:fs'), crypto = require('node:crypto'), path = require('node:path'), assert = require('node:assert/strict');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const snapshot = file => { const s = fs.statSync(file); return { hash:hash(fs.readFileSync(file)),size:s.size,mtimeMs:s.mtimeMs }; };
const protectedFiles = ['api/services/entitySpanCandidates.cjs','api/routes/entitySpanCandidates.cjs','api/routes/ai/internalApiClient.cjs',
    'api/services/ai-v5/sourceSpanCatalog.cjs','api/services/ai-v5/candidateSetTwoStageInterpreter.cjs','api/services/ai-v5/candidateRead.cjs',
    'api/services/ai-v5/sourceSpanSelector.cjs','api/services/ai-v5/localIntentSelector.cjs','api/services/entityLookupService.cjs',
    'api/services/ai-v5/typeIndependentEntityResolver.cjs','api/services/ai-v5/nestedSpanRefinement.cjs'];
const hashes = () => Object.fromEntries(protectedFiles.map(p => [p,hash(fs.readFileSync(path.join(__dirname,'..',p)))]));
async function main() {
    assert.equal(process.env.PUMP_V5_CANDIDATE_RUNTIME,'true');
    const root='/Users/dan/pump-cost-accounting-system', envPath=root+'/.env';
    const env=require('dotenv').parse(fs.readFileSync(envPath));
    for(const k of ['INTERNAL_SECRET','DEEPSEEK_API_KEY']) { assert.ok(env[k]);process.env[k]=env[k]; }
    process.env.AI_V5_READ_CANARY_ENABLED='true';process.env.AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED='true';process.env.AI_OBSERVABILITY_ENABLED='false';
    const dbFile=process.env.PUMP_V5_CANDIDATE_DATABASE,before=snapshot(dbFile),eb=snapshot(envPath),bc=fs.readdirSync(root+'/backups').length;
    const logs=[],savedLog=console.log;
    for(const m of ['log','warn','error','info','debug']) console[m]=(...a)=>logs.push(a.map(String).join(' '));
    const data={stage:'P16-I-R8',formalRuns:1,retry:0,paths:[],spanPreflight:[],writes:0,ownerDefaultEnabled:false,preHashes:hashes()};
    const privateValues=[];let selected,last,checks;
    const runtime=await require('./start-v5-candidate.cjs').startCandidate({readOptions:async()=>({
        interpret:async(envelope,options)=>{
            const r=await require('../api/services/ai-v5/candidateSetTwoStageInterpreter.cjs').interpretCandidateSetTask(envelope,options);
            const m=r.architectureMetadata;
            checks={interpreterStatus:r.status,interpreterReason:r.reasonCode,stage1Status:m.stage1Status,stage2Status:m.stage2Status,
                lookupStatus:m.lookupStatus,complete:m.complete,selectedClass:r.taskClassRef,
                identityMatch:r.resolvedIdentity?.canonicalId===selected.id,entityTypeMatch:r.resolvedIdentity?.entityType==='coil',
                exactIdentityMatch:r.interpretation?.entityCandidates?.[0]?.candidateText===selected.mention,
                interpreterCalls:r.modelCalls,spanSupplyCount:m.spanSupplyCount,spanSupplyComplete:m.spanSupplyComplete,
                spanSupplyDurationMs:m.spanSupplyDurationMs,catalogCountBefore:m.catalogCountBefore,catalogCountAfter:m.catalogCountAfter};
            return r;
        },executionOptions:{compare:await require('./run-ai-v5-p16c-certification.cjs').comparator({expected_entity_type:'coil'},selected)}
    }),onOutcome:o=>{last={...o,...checks};}});
    const origin='http://127.0.0.1:'+process.env.PUMP_V5_CANDIDATE_PORT,headers={'x-internal-secret':env.INTERNAL_SECRET,'content-type':'application/json'};
    const get=async p=>{const r=await fetch(origin+p,{headers});assert.equal(r.status,200);return (await r.json()).data;};
    const post=async(p,body)=>{const r=await fetch(origin+p,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(r.status,200);return(await r.json()).data;};
    const lookup=mention=>post('/api/entity-lookup',{version:1,mention,entityTypes:['coil','customer','order','part','recipe','template'],matchPolicy:'EXACT_OR_APPROVED_ALIAS'});
    try {
        const rows=(await get('/api/coils')).filter(r=>typeof r.schemeName==='string'&&r.schemeName.length).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
        let row;
        for(const item of rows.slice(0,20)) {const r=await lookup(item.schemeName);if(r.complete&&r.candidateCount===1&&r.candidates[0].entityType==='coil'&&r.candidates[0].canonicalId===String(item.id)){row=item;break;}}
        assert.ok(row);
        const a=await lookup(row.schemeName),b=await lookup(row.schemeCode);
        data.canonicalEquivalent=a.complete&&b.complete&&a.candidateCount===1&&b.candidateCount===1&&a.candidates[0].canonicalId===b.candidates[0].canonicalId;
        assert.ok(data.canonicalEquivalent);
        const original=row.schemeName+'的当前库存数量是多少？',code=row.schemeCode+'当前库存是多少';
        assert.equal(hash(original),'4bcee3f5ce85c030d611641a0ad1f0f7e0f21137a6693bd233d5bd3966cd5221');
        const scenarios=[{source:original,mention:row.schemeName,kind:'schemeName'},
            {source:code,mention:row.schemeCode,kind:'schemeCode'},{source:code,mention:row.schemeCode,kind:'schemeCode'}]
            .map((s,i)=>({...s,ordinal:i+1,type:'coil',id:String(row.id)}));
        privateValues.push(original,code,row.schemeName,row.schemeCode);
        data.frozenSet=scenarios.map(s=>({ordinal:s.ordinal,kind:s.kind,inputDigest:hash(s.source)}));
        for(const s of scenarios) {
            const start=performance.now(),r=await post('/api/entity-span-candidates',{version:1,sourceText:s.source,entityScope:'coil'});
            const exactPresent=r.complete&&r.candidates.some(c=>s.source.slice(c.start,c.end)===s.mention);
            data.spanPreflight.push({ordinal:s.ordinal,status:r.status,complete:r.complete,count:r.candidateCount,identityScanCount:r.identityScanCount,exactPresent,durationMs:performance.now()-start});
            assert.ok(exactPresent);
        }
        process.stdout.write(JSON.stringify({stage:'FROZEN_BEFORE_MODEL_CALLS',frozenSet:data.frozenSet,preHashes:data.preHashes})+'\n');
        for(const s of scenarios) {
            selected=s;last=null;checks=null;
            const r=await fetch(origin+'/api/ai/chat',{method:'POST',headers:{...headers,'x-pump-v5-use':'true'},body:JSON.stringify({messages:[{role:'user',content:s.source}]})});
            const body=await r.text();privateValues.push(body);
            data.paths.push({ordinal:s.ordinal,kind:s.kind,...last,
                finalBody:require('../api/services/ownerReadCanaryGateway.cjs').candidateFinal(body)!==null,
                mappingMatch:last?.derivedFactKey==='coil.inventory'&&last?.selectedTaskClassRef==='tc_004'});
        }
        data.candidateReady=(await get('/api/health/ready')).ready;
    } catch {data.error='CERTIFICATION_OR_PREFLIGHT_FAILED';}
    finally {
        await runtime.close();data.postHashes=hashes();data.hashesMatch=JSON.stringify(data.preHashes)===JSON.stringify(data.postHashes);
        data.dbUnchanged=JSON.stringify(before)===JSON.stringify(snapshot(dbFile));data.envUnchanged=JSON.stringify(eb)===JSON.stringify(snapshot(envPath));
        data.backupCountUnchanged=bc===fs.readdirSync(root+'/backups').length;
        data.portClosed=await fetch(origin+'/api/health/ready').then(()=>false,()=>true);
        const visible=JSON.stringify(logs);data.privateValueLeaks=privateValues.filter(x=>x&&visible.includes(x)).length;
        data.credentialLeaks=[env.INTERNAL_SECRET,env.DEEPSEEK_API_KEY].filter(x=>visible.includes(x)).length;
        data.pass=!data.error&&data.paths.length===3&&data.paths.every(p=>p.mappingMatch&&p.identityMatch&&p.entityTypeMatch&&p.exactIdentityMatch
            &&p.validationPass&&p.resultEquivalence==='MATCH'&&p.evidenceVerification==='PASS'&&p.finalBody)
            &&data.hashesMatch&&data.dbUnchanged&&data.envUnchanged&&data.backupCountUnchanged&&data.portClosed&&data.privateValueLeaks===0&&data.credentialLeaks===0;
        savedLog(JSON.stringify(data));if(!data.pass)process.exitCode=1;
    }
}
if(require.main===module)main().catch(()=>{process.stdout.write('{"error":"CERTIFICATION_START_FAILED"}\n');process.exitCode=1;});
