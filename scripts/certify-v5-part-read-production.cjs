'use strict';
// Narrow operator certification. Runs only in a disposable isolated code directory,
// with the existing native readonly Candidate lifecycle and no public ingress.
const fs = require('node:fs'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
function snapshot(file) { const s=fs.statSync(file); return {hash:hash(fs.readFileSync(file)),size:s.size,mtimeMs:s.mtimeMs}; }
async function main() {
    assert.equal(process.env.PUMP_V5_CANDIDATE_RUNTIME, 'true');
    const envPath = '/Users/dan/pump-cost-accounting-system/.env';
    const env = require('dotenv').parse(fs.readFileSync(envPath));
    for (const k of ['DEEPSEEK_API_KEY','INTERNAL_SECRET']) { assert.ok(env[k]); process.env[k]=env[k]; }
    process.env.AI_V5_READ_CANARY_ENABLED='true'; process.env.AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED='true';
    process.env.AI_OBSERVABILITY_ENABLED='false';
    const file=process.env.PUMP_V5_CANDIDATE_DATABASE, before=snapshot(file), envBefore=snapshot(envPath);
    const backupDir='/Users/dan/pump-cost-accounting-system/backups';
    const backupsBefore=fs.readdirSync(backupDir).length;
    const logs=[], saved={...console};
    for(const method of ['log','error','warn','info','debug']) console[method]=(...args)=>logs.push(args.map(String).join(' '));
    let selected=null, last=null, checks=null;
    const runtime=await require('./start-v5-candidate.cjs').startCandidate({
        readOptions: async()=>({
            interpret:async(envelope,opts)=>{
                const result=await require('../api/services/ai-v5/candidateSetTwoStageInterpreter.cjs').interpretCandidateSetTask(envelope,opts);
                checks={identityMatch:result.resolvedIdentity?.canonicalId===selected.id,
                    entityTypeMatch:result.resolvedIdentity?.entityType===selected.type,
                    exactIdentityMatch:result.interpretation?.entityCandidates?.[0]?.candidateText===selected.mention,
                    interpreterCalls:result.modelCalls}; return result;
            },
            executionOptions:{compare:await require('./run-ai-v5-p16c-certification.cjs').comparator({expected_entity_type:selected.type},selected)}
        }), onOutcome:o=>{last={...o,...checks};}
    });
    const origin='http://127.0.0.1:'+process.env.PUMP_V5_CANDIDATE_PORT;
    const headers={'x-internal-secret':env.INTERNAL_SECRET,'content-type':'application/json'};
    const get=async path=>{const r=await fetch(origin+path,{headers});assert.equal(r.status,200);const body=await r.json();return body.data??body;};
    const lookup=async(type,mention)=>{const r=await fetch(origin+'/api/entity-lookup',{method:'POST',headers,
        body:JSON.stringify({version:1,mention,entityTypes:['coil','customer','order','part','recipe','template'],matchPolicy:'EXACT_OR_APPROVED_ALIAS'})});
        assert.equal(r.status,200); const body=await r.json(); return body.data || body;};
    const data={mode:'TEMPORARY_LOOPBACK_CANDIDATE',factHeaderSent:false,paths:[],ownerDefaultEnabled:false,writes:0};
    const privateTexts=[];
    try {
        // Applicability preflight uses formal APIs only; no model-result-based selection.
        const parts=await get('/api/parts'), coils=await get('/api/coils'), recipes=await get('/api/recipes');
        const choose=async(type,rows,field)=>{
            assert.ok(Array.isArray(rows));
            const ordered=[...rows].filter(r=>typeof r[field]==='string'&&r[field].length).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
            for(const row of ordered.slice(0,20)) {
                const result=await lookup(type,row[field]);
                if(result.complete&&result.candidates?.length===1&&result.candidates[0].entityType===type
                    && result.candidates[0].canonicalId===String(row.id)) {
                    privateTexts.push(row[field]); return {type,mention:row[field],id:String(row.id)};
                }
            }
            throw Error('PRODUCTION_APPLICABILITY_UNAVAILABLE');
        };
        const part=await choose('part',parts,'model');
        const coil=await choose('coil',coils,'schemeName');
        const recipe=await choose('recipe',recipes,'name');
        const scenarios=[{...part,fact:'price.current',ref:'tc_028',suffix:'当前目录单价是多少'},
            {...part,fact:'inventory.quantity',ref:'tc_002',suffix:'当前库存数量是多少'},
            {...coil,fact:'coil.inventory',ref:'tc_004',suffix:'当前库存数量是多少'},
            {...recipe,fact:'recipe.cost.preview',ref:'tc_024',suffix:'当前成本预览是多少'}];
        data.applicableTypes=3;
        for(const scenario of scenarios){
            selected=scenario;last=null;checks=null;
            const source=scenario.mention+'的'+scenario.suffix+'？'; privateTexts.push(source);
            const r=await fetch(origin+'/api/ai/chat',{method:'POST',headers:{...headers,'x-pump-v5-use':'true'},
                body:JSON.stringify({messages:[{role:'user',content:source}]})});
            const body=await r.text(); privateTexts.push(body);
            data.paths.push({fact:scenario.fact,expectedClass:scenario.ref,...last,
                finalBody:require('../api/services/ownerReadCanaryGateway.cjs').candidateFinal(body)!==null,
                mappingMatch:last?.derivedFactKey===scenario.fact&&last?.selectedTaskClassRef===scenario.ref});
        }
        data.candidateReady=(await get('/api/health/ready')).ready;
    } catch {data.error='PRODUCTION_CERTIFICATION_FAILED';}
    finally {
        await runtime.close();
        data.dbUnchanged=JSON.stringify(before)===JSON.stringify(snapshot(file));
        data.envUnchanged=JSON.stringify(envBefore)===JSON.stringify(snapshot(envPath));
        data.backupCountUnchanged=backupsBefore===fs.readdirSync(backupDir).length;
        data.portClosed=await fetch(origin+'/api/health/ready').then(()=>false,()=>true);
        const visible=JSON.stringify(logs);data.privateTextLeaks=privateTexts.filter(s=>s&&visible.includes(s)).length;
        data.credentialLeaks=[env.INTERNAL_SECRET,env.DEEPSEEK_API_KEY].filter(s=>visible.includes(s)).length;
        data.pass=!data.error&&data.paths.length===4&&data.paths.every(p=>p.mappingMatch&&p.identityMatch&&p.entityTypeMatch
            &&p.exactIdentityMatch&&p.validationPass&&p.resultEquivalence==='MATCH'&&p.evidenceVerification==='PASS'&&p.finalBody)
            &&data.dbUnchanged&&data.envUnchanged&&data.backupCountUnchanged&&data.portClosed&&data.privateTextLeaks===0&&data.credentialLeaks===0;
        saved.log(JSON.stringify(data));if(!data.pass)process.exitCode=1;
    }
}
if(require.main===module) main().catch(()=>{process.stdout.write('{"pass":false,"error":"PRODUCTION_PREFLIGHT_FAILED"}\n');process.exitCode=1;});
