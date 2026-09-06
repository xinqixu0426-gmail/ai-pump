'use strict';
// One-shot public owner-path certification. Bodies and credentials stay in memory.
const fs=require('node:fs'),cp=require('node:child_process'),assert=require('node:assert/strict');
const {gate,snapshot,health,LEGACY,OPS}=require('./manage-v5-owner-default.cjs');
const parse=require(LEGACY+'/node_modules/dotenv').parse;
async function certify(){
 if(process.getuid?.()!==501)throw Error('OWNER_UID_MISMATCH');
 const env=parse(fs.readFileSync(LEGACY+'/.env')),before=snapshot(),hb=await health();
 const privateValues=[env.INTERNAL_SECRET,env.JWT_SECRET,env.ACCESS_PASSWORD,env.PUMP_OWNER_ACCESS_PASSWORD];
 const result={stage:'P16-I-FINAL',runs:1,retry:0,paths:[],healthBefore:hb};
 const metadata=role=>JSON.parse(fs.readFileSync(OPS+'/'+role+'-metadata.json','utf8'));
 const header={'content-type':'application/json','x-internal-secret':env.INTERNAL_SECRET};
 const get=async route=>{const r=await fetch('http://127.0.0.1:3102/api/'+route,{headers:header});assert.equal(r.status,200);return(await r.json()).data;};
 const lookup=async mention=>{const r=await fetch('http://127.0.0.1:3102/api/entity-lookup',{method:'POST',headers:header,body:JSON.stringify({version:1,mention,entityTypes:['coil','customer','order','part','recipe','template'],matchPolicy:'EXACT_OR_APPROVED_ALIAS'})});assert.equal(r.status,200);return(await r.json()).data;};
 const sorted=rows=>rows.sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 async function select(rows,field,type){for(const row of sorted(rows).slice(0,20)){if(typeof row[field]!=='string'||!row[field])continue;const found=await lookup(row[field]);if(found.complete&&found.candidates.filter(c=>c.entityType===type).length===1&&found.candidates.some(c=>c.entityType===type&&c.canonicalId===String(row.id)))return row;}throw Error('PRODUCTION_SCOPE_UNAVAILABLE');}
 const base='https://xuxinqi.xin';
 async function login(password){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password}),signal:AbortSignal.timeout(10000)});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);privateValues.push(cookie);return cookie;}
 async function check(cookie){const r=await fetch(base+'/api/auth/check',{headers:{cookie},signal:AbortSignal.timeout(10000)});assert.equal(r.status,200);return(await r.json()).owner;}
 async function request(category,source,cookie,extra={}){
   const cb=metadata('candidate').completedRequests,start=performance.now();
   const r=await fetch(base+(extra.explicit?'/api/ai/owner-read-canary':'/api/ai/chat'),{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{}),...(extra.explicit?{'x-internal-secret':env.INTERNAL_SECRET,'x-pump-v5-use':'true'}:{})},body:JSON.stringify({messages:[{role:'user',content:source}]}),signal:AbortSignal.timeout(190000)});
   const body=await r.text();privateValues.push(source,body);
   const id=r.headers.get('x-request-id');
   let gm;
   for(let i=0;i<20;i++){gm=metadata('gateway').events.find(e=>e.requestId===id);if(gm)break;await new Promise(x=>setTimeout(x,25));}
   assert.ok(gm,'GATEWAY_METADATA_MISSING');
   const cm=metadata('candidate'),delta=cm.completedRequests-cb;
   const events=body.replace(/\r\n/g,'\n').split('\n\n').filter(x=>x.startsWith('data: ')).map(x=>{try{return JSON.parse(x.slice(6));}catch{return {};}});
   const done=events.filter(x=>x.type==='done').length,errors=events.filter(x=>x.type==='error').length;
   const item={category,httpStatus:r.status,...gm,clientDurationMs:performance.now()-start,candidateRequests:delta,
     candidate:delta===1?cm.events.at(-1):null,doneCount:done,errorCount:errors,hasAnswer:events.some(x=>x.type==='content'&&x.content),
     privateCandidateErrorExposed:/CANDIDATE_|ANSWER_VALIDATION_FAILED/.test(body)};
   result.paths.push(item);return item;
 }
 let stopped=false;
 try{
   gate(false);
   const parts=await get('parts'),recipes=await get('recipes'),coils=await get('coils');
   result.historicalApplicability={flatBlade:parts.some(x=>x.model==='800平刀'),exactRecipe:recipes.some(x=>x.name==='v750-tokoy-')};
   const part=await select(parts,'model','part'),recipe=await select(recipes,'name','recipe'),coil=await select(coils,'schemeName','coil');
   const cases=[['price',part.model+'现在多少钱','price.current'],['inventory',part.model+'当前库存是多少','inventory.quantity'],
    ['coilName',coil.schemeName+'的当前库存数量是多少？','coil.inventory'],['coilCode',coil.schemeCode+'当前库存是多少','coil.inventory'],
    ['exactRecipe',recipe.name+'现在的完整成本是多少','recipe.cost.preview']];
   result.projectedCoverage=cases.map(([category,,factKey])=>({category,factKey}));
   const owner=await login(env.PUMP_OWNER_ACCESS_PASSWORD),shared=await login(env.ACCESS_PASSWORD);
   result.ownerVerified=await check(owner);result.sharedOwner=await check(shared);assert.equal(result.ownerVerified,true);assert.equal(result.sharedOwner,false);
   const off=await request('offControl',cases[1][1],owner);assert.equal(off.candidateAttempted,false);assert.equal(off.finalSource,'legacy');
   gate(true);
   for(const [category,source,fact] of cases){const r=await request(category,source,owner);r.mappingMatch=r.candidate?.factKey===fact;}
   await request('sharedAdmin',cases[1][1],shared);
   await request('unauthenticated',cases[1][1],null);
   await request('writeRisk','请删除一个订单',owner);
   cp.execFileSync('launchctl',['bootout','gui/501/org.pump.v5-owner-candidate'],{stdio:'ignore'});stopped=true;
   await request('candidateUnavailable',cases[1][1],owner);
   cp.execFileSync('launchctl',['bootstrap','gui/501','/Users/dan/Library/LaunchAgents/org.pump.v5-owner-candidate.plist'],{stdio:'ignore'});stopped=false;
   for(let i=0;i<40;i++){if((await health()).candidateReady)break;await new Promise(x=>setTimeout(x,250));}
   await request('restored',cases[1][1],owner);
   await request('explicitCanary',cases[1][1],null,{explicit:true});
   gate(false);
   await request('rollback',cases[1][1],owner);
   const named=category=>result.paths.find(p=>p.category===category),reads=result.paths.filter(p=>cases.some(c=>c[0]===p.category));
   result.readsPass=reads.length===5&&reads.every(p=>p.finalSource==='v5-candidate'&&p.mappingMatch&&p.candidate?.validated&&p.candidate?.numericValid&&p.candidate?.entityValid&&p.doneCount===1&&p.errorCount===0);
   result.isolationPass=['sharedAdmin','unauthenticated','offControl','rollback'].every(c=>!named(c)?.candidateAttempted)&&named('sharedAdmin').finalSource==='legacy'&&named('unauthenticated').httpStatus===401;
   result.writePass=named('writeRisk')?.candidate?.attempted===false&&named('writeRisk').candidate.toolCalls===0&&named('writeRisk').candidate.answerCalls===0&&named('writeRisk').finalSource==='legacy';
   result.fallbackPass=named('candidateUnavailable')?.safeLegacyFallback&&named('candidateUnavailable').finalSource==='legacy'&&named('candidateUnavailable').doneCount===1&&named('restored')?.candidateSuccess;
   result.rollbackPass=!named('rollback')?.candidateAttempted&&named('rollback').finalSource==='legacy';
   result.explicitPass=named('explicitCanary')?.candidateSuccess===true;
 }catch{result.error='CERTIFICATION_INCOMPLETE';}
 finally{
   gate(false);
   if(stopped)cp.execFileSync('launchctl',['bootstrap','gui/501','/Users/dan/Library/LaunchAgents/org.pump.v5-owner-candidate.plist'],{stdio:'ignore'});
   result.healthAfter=await health();result.dbUnchanged=JSON.stringify(before)===JSON.stringify(snapshot());
   result.legacyUnchanged=result.healthAfter.legacyPid===hb.legacyPid;
   const c=metadata('candidate');result.orphans=c.orphans;result.crossRequest=c.crossRequest;
   result.privateMetadataLeaks=privateValues.filter(v=>v&&JSON.stringify(result).includes(v)).length;
   result.pass=!result.error&&result.readsPass&&result.isolationPass&&result.writePass&&result.fallbackPass&&result.rollbackPass&&result.explicitPass&&result.dbUnchanged&&result.legacyUnchanged&&result.healthAfter.candidateReady&&result.orphans===0&&result.crossRequest===0&&result.privateMetadataLeaks===0&&result.paths.every(p=>!p.privateCandidateErrorExposed&&p.doneCount<=1);
   if(result.pass)gate(true);
   result.ownerDefaultEnd=result.pass?'ON':'OFF';
   fs.writeFileSync(OPS+'/p16i-final-certification.json',JSON.stringify(result),{mode:0o600,flag:'wx'});
   console.log(JSON.stringify(result));if(!result.pass)process.exitCode=1;
 }
}
if(require.main===module)certify().catch(()=>{gate(false);console.error('OWNER_DEFAULT_CERTIFICATION_FAILED');process.exitCode=1;});
