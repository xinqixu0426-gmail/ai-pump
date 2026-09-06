'use strict';
// Explicit Mac mini operator actions. Never invokes the Legacy deploy/restart command.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const ROOT='/Users/dan/pump-p16lr1-transport',SRC=ROOT+'/source',LEGACY='/Users/dan/pump-cost-accounting-system',OPS='/Users/dan/pump-v5-owner-ops-p16h';
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function snapshot(){const p=LEGACY+'/pump.db',s=fs.statSync(p);return {hash:hash(p),mtime:s.mtimeMs,size:s.size,backups:fs.readdirSync(LEGACY+'/backups').length};}
function environment(){return require(LEGACY+'/node_modules/dotenv').parse(fs.readFileSync(LEGACY+'/.env'));}
async function health(){const e=environment();const l=await fetch('http://127.0.0.1:3002/api/health/ready').then(r=>r.json());const c=await fetch('http://127.0.0.1:3102/api/health/ready',{headers:{'x-internal-secret':e.INTERNAL_SECRET},signal:AbortSignal.timeout(3000)}).then(r=>r.json()).catch(()=>null);return {legacyPid:l.data?.runtime?.pid,legacyReady:l.data?.ready===true,candidateReady:c?.data?.ready===true,webPid:Number(fs.readFileSync(LEGACY+'/logs/web-launchd.pid','utf8'))};}
function save(name,data){fs.writeFileSync(ROOT+'/'+name,JSON.stringify(data,null,2),{mode:0o600,flag:'wx'});}
function replaceConfig(data){const p=OPS+'/runtime.json',temp=p+'.p16lr1';fs.writeFileSync(temp,JSON.stringify(data),{mode:0o600,flag:'wx'});fs.renameSync(temp,p);}
async function activate(){
    if(fs.existsSync(ROOT+'/before.json'))throw Error('ACTIVATION_ALREADY_ATTEMPTED');
    const before={health:await health(),db:snapshot(),runtime:JSON.parse(fs.readFileSync(OPS+'/runtime.json'))};
    if(!before.health.legacyReady||!before.health.candidateReady)throw Error('BASELINE_NOT_READY');
    if(cp.execFileSync('git',['-C',LEGACY,'rev-parse','HEAD'],{encoding:'utf8'}).trim()!=='12fee179b6074215cf359bcc1a789ce1a345b9ba')throw Error('LEGACY_BASELINE_CHANGED');
    if(!fs.existsSync(SRC+'/apps/web-next/.next/BUILD_ID'))throw Error('WEB_BUILD_MISSING');
    save('before.json',before);
    replaceConfig({...before.runtime,candidateDirectory:SRC,gatewayDirectory:SRC+'/api/services'});
    for(const role of ['candidate','gateway'])cp.execFileSync('launchctl',['kill','SIGTERM','gui/501/org.pump.v5-owner-'+role],{stdio:'ignore'});
    let after;
    for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,500));after=await health();if(after.candidateReady)break;}
    if(!after.candidateReady||after.legacyPid!==before.health.legacyPid||JSON.stringify(snapshot())!==JSON.stringify(before.db))throw Error('CANDIDATE_ACTIVATION_FAILED');
    // Independent Web build switch. The API process and all backend source files are untouched.
    fs.renameSync(LEGACY+'/apps/web-next/.next',ROOT+'/previous-next');
    fs.cpSync(SRC+'/apps/web-next/.next',LEGACY+'/apps/web-next/.next',{recursive:true});
    // The installed Web KeepAlive supervisor restarts its own child; never signal API.
    process.kill(before.health.webPid,'SIGTERM');
    let webReady=false;
    for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,500));try{if((await fetch('http://127.0.0.1:3000/login',{signal:AbortSignal.timeout(1000)})).ok){webReady=true;break;}}catch{}}
    after=await health();
    const result={before:before.health,after,dbUnchanged:JSON.stringify(snapshot())===JSON.stringify(before.db),webBuildMatch:fs.readFileSync(SRC+'/apps/web-next/.next/BUILD_ID','utf8')===fs.readFileSync(LEGACY+'/apps/web-next/.next/BUILD_ID','utf8')};
    if(!webReady||!after.legacyReady||!after.candidateReady||after.webPid===before.health.webPid||after.legacyPid!==before.health.legacyPid||!result.dbUnchanged||!result.webBuildMatch)throw Error('ACTIVATION_VERIFICATION_FAILED');
    save('activation.json',result);return result;
}
async function rollback(){
    const b=JSON.parse(fs.readFileSync(ROOT+'/before.json'));replaceConfig(b.runtime);
    for(const role of ['candidate','gateway'])cp.execFileSync('launchctl',['kill','SIGTERM','gui/501/org.pump.v5-owner-'+role],{stdio:'ignore'});
    if(fs.existsSync(ROOT+'/previous-next')){const h=await health();fs.renameSync(LEGACY+'/apps/web-next/.next',ROOT+'/rejected-next');fs.renameSync(ROOT+'/previous-next',LEGACY+'/apps/web-next/.next');process.kill(h.webPid,'SIGTERM');}
    return {rollbackRequested:true,legacyRestarted:false};
}
async function certify(){
    if(fs.existsSync(ROOT+'/certification.json'))throw Error('CERTIFICATION_ALREADY_RUN');
    const e=environment(),before=snapshot(),hb=await health(),base='https://xuxinqi.xin';
    const privateValues=[e.INTERNAL_SECRET,e.JWT_SECRET,e.PUMP_OWNER_ACCESS_PASSWORD,e.ACCESS_PASSWORD];
    const login=async password=>{const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password}),signal:AbortSignal.timeout(20000)});const cookie=r.headers.get('set-cookie')?.split(';')[0];if(!r.ok||!cookie)throw Error('LOGIN_FAILED');privateValues.push(cookie);return cookie;};
    const headers={'x-internal-secret':e.INTERNAL_SECRET,'content-type':'application/json'};
    const r=await fetch('http://127.0.0.1:3102/api/parts',{headers});if(!r.ok)throw Error('SOURCE_UNAVAILABLE');
    const rows=(await r.json()).data;let source;
    for(const part of rows.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id))).slice(0,20)){
        const r=await fetch('http://127.0.0.1:3102/api/entity-lookup',{method:'POST',headers,body:JSON.stringify({version:1,mention:part.model,entityTypes:['part'],matchPolicy:'EXACT'})});
        const d=(await r.json()).data;if(d?.complete&&d.candidates?.length===1&&d.candidates[0].canonicalId===String(part.id)){source=part.model+'当前库存是多少';break;}
    }
    if(!source)throw Error('EXACT_SOURCE_UNAVAILABLE');privateValues.push(source);
    const owner=await login(e.PUMP_OWNER_ACCESS_PASSWORD),shared=await login(e.ACCESS_PASSWORD),paths=[];
    for(const [kind,cookie,question,explicit] of [['owner',owner,source,false],['shared',shared,'你好',false],['anonymous',null,'你好',false],['explicit',null,source,true]]){
        const r=await fetch(base+(explicit?'/api/ai/owner-read-canary':'/api/ai/chat'),{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{}),...(explicit?{...headers,'x-pump-v5-use':'true'}:{})},body:JSON.stringify({messages:[{role:'user',content:question}],conversationId:'chat-731001'}),signal:AbortSignal.timeout(190000)});
        const text=await r.text();privateValues.push(text);const id=r.headers.get('x-request-id');let m;
        for(let i=0;i<20;i++){m=JSON.parse(fs.readFileSync(OPS+'/gateway-metadata.json')).events.find(x=>x.requestId===id);if(m)break;await new Promise(r=>setTimeout(r,25));}
        paths.push({kind,status:r.status,candidateAttempted:m?.candidateAttempted===true,source:m?.finalSource||'UNKNOWN',candidateSuccess:m?.candidateSuccess===true});
    }
    const ha=await health(),cm=JSON.parse(fs.readFileSync(OPS+'/candidate-metadata.json'));
    const result={paths,legacyPidUnchanged:ha.legacyPid===hb.legacyPid,health:ha,dbUnchanged:JSON.stringify(before)===JSON.stringify(snapshot()),orphans:cm.orphans,crossRequest:cm.crossRequest};
    result.privacyLeaks=privateValues.filter(v=>v&&JSON.stringify(result).includes(v)).length;
    result.pass=paths[0].candidateSuccess&&paths[1].source==='legacy'&&!paths[1].candidateAttempted&&!paths[2].candidateAttempted&&paths[2].status===401&&paths[3].candidateSuccess&&result.legacyPidUnchanged&&result.dbUnchanged&&result.privacyLeaks===0&&cm.orphans===0&&cm.crossRequest===0;
    save('certification.json',result);return result;
}
async function publicBuild(){
    const root=LEGACY+'/apps/web-next/.next/static';
    const hits=fs.readdirSync(root,{recursive:true}).filter(x=>x.endsWith('.js')&&fs.readFileSync(root+'/'+x,'utf8').includes('CONVERSATION_ID_INVALID'));
    const results=[];
    for(const file of hits){const r=await fetch('https://xuxinqi.xin/_next/static/'+file,{signal:AbortSignal.timeout(20000)});const b=Buffer.from(await r.arrayBuffer());results.push({status:r.status,hashMatch:crypto.createHash('sha256').update(b).digest('hex')===hash(root+'/'+file)});}
    return {markerChunks:hits.length,results,pass:hits.length>0&&results.every(x=>x.status===200&&x.hashMatch)};
}
async function main(){if(process.getuid?.()!==501||!fs.existsSync(ROOT))throw Error('OPERATOR_SCOPE_INVALID');const cmd=process.argv[2];if(cmd==='activate')return activate();if(cmd==='rollback')return rollback();if(cmd==='certify')return certify();if(cmd==='public-build')return publicBuild();if(cmd==='status')return {health:await health(),db:snapshot()};throw Error('COMMAND_INVALID');}
if(require.main===module)main().then(x=>console.log(JSON.stringify(x))).catch(()=>{console.error('CONVERSATION_TRANSPORT_OPERATION_FAILED');process.exitCode=1;});
