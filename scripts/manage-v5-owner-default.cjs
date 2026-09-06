'use strict';
// Explicit operator control; existing credentials are read only in memory.
const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto');
const LEGACY='/Users/dan/pump-cost-accounting-system',OPS='/Users/dan/pump-v5-owner-ops-p16h';
const CANDIDATE='/Users/dan/pump-v5-candidate-594b206-final';
const REVISION='594b20637827ec8664ee741226479f8eac6f3bdc';
const gateFile=OPS+'/owner-default.json';
function atomic(file,value){const temp=file+'.p16i-final';fs.writeFileSync(temp,JSON.stringify(value,null,2),{mode:0o600,flag:'wx'});fs.renameSync(temp,file);}
function gate(enabled){atomic(gateFile,{AI_V5_OWNER_READ_DEFAULT_ENABLED:enabled});return {ownerDefaultEnabled:enabled};}
function snapshot(){const file=LEGACY+'/pump.db',st=fs.statSync(file);return {hash:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),mtimeMs:st.mtimeMs,size:st.size,backups:fs.readdirSync(LEGACY+'/backups').length};}
async function health(){const e=require(LEGACY+'/node_modules/dotenv').parse(fs.readFileSync(LEGACY+'/.env'));
 const l=await fetch('http://127.0.0.1:3002/api/health/ready').then(r=>r.json());
 const c=await fetch('http://127.0.0.1:3102/api/health/ready',{headers:{'x-internal-secret':e.INTERNAL_SECRET},signal:AbortSignal.timeout(2000)}).then(r=>r.json()).catch(()=>null);
 return {legacyReady:l.data?.ready===true,legacyPid:l.data?.runtime?.pid,candidateReady:c?.data?.ready===true};}
async function ingress(enable){
 const pem=fs.readFileSync('/Users/dan/.cloudflared/cert.pem','utf8');
 const cert=JSON.parse(Buffer.from(pem.match(/-----BEGIN ARGO TUNNEL TOKEN-----([\s\S]*?)-----END/)[1].replace(/\s/g,''),'base64'));
 const plist=JSON.parse(cp.execFileSync('plutil',['-convert','json','-o','-','/Library/LaunchDaemons/com.cloudflare.cloudflared.plist']));
 const args=plist.ProgramArguments,tunnel=JSON.parse(Buffer.from(args[args.indexOf('--token')+1],'base64'));
 const url='https://api.cloudflare.com/client/v4/accounts/'+cert.accountID+'/cfd_tunnel/'+tunnel.t+'/configurations';
 async function cf(config){const r=await fetch(url,{method:config?'PUT':'GET',headers:{Authorization:'Bearer '+cert.apiToken,'Content-Type':'application/json',Accept:'application/json;version=1'},...(config?{body:JSON.stringify({config})}:{}),signal:AbortSignal.timeout(20000)});const j=await r.json();if(!r.ok||!j.success)throw Error('INGRESS_CONTROL_FAILED');return j.result.config;}
 const before=await cf(),ours=r=>r.hostname==='xuxinqi.xin'&&r.path==='^/api/ai/chat$';
 if(before.ingress.filter(ours).some(r=>r.service!=='http://127.0.0.1:3103'))throw Error('INGRESS_CONFLICT');
 const other=before.ingress.filter(r=>!ours(r));
 if(!other.some(r=>r.hostname==='xuxinqi.xin'&&!r.path&&r.service==='http://localhost:3002'))throw Error('LEGACY_INGRESS_MISSING');
 await cf({...before,ingress:[...(enable?[{hostname:'xuxinqi.xin',path:'^/api/ai/chat$',service:'http://127.0.0.1:3103'}]:[]),...other]});
 const after=await cf();if(JSON.stringify(other)!==JSON.stringify(after.ingress.filter(r=>!ours(r)))||after.ingress.filter(ours).length!==(enable?1:0))throw Error('INGRESS_VERIFY_FAILED');
 return {ordinaryGatewayIngress:enable,otherIngressPreserved:true};
}
async function prepare(){
 if(cp.execFileSync('git',['-C',LEGACY,'rev-parse','HEAD'],{encoding:'utf8'}).trim()!=='12fee179b6074215cf359bcc1a789ce1a345b9ba')throw Error('LEGACY_REVISION_MISMATCH');
 const archive=CANDIDATE+'/source.tar.gz';
 if(crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')!=='1fe9334ec2628976b91e02d79ce1a8182be0f92de869c5ae406a7e5a0d69e2a7')throw Error('ARCHIVE_IDENTITY_MISMATCH');
 if(fs.existsSync(CANDIDATE+'/CERTIFIED_REVISION'))throw Error('ARTIFACT_ALREADY_PREPARED');
 cp.execFileSync('tar',['-xzf',archive,'-C',CANDIDATE],{stdio:'ignore'});
 fs.symlinkSync('/Users/dan/pump-v5-candidate-15091c9-r4p-deps/node_modules',CANDIDATE+'/node_modules');
 fs.writeFileSync(CANDIDATE+'/CERTIFIED_REVISION',REVISION+'\n',{flag:'wx'});
 const before=snapshot(),hb=await health(),config=JSON.parse(fs.readFileSync(OPS+'/runtime.json','utf8'));
 if(fs.existsSync(OPS+'/pre-p16i-final-runtime.json'))throw Error('PREPARE_ALREADY_RUN');
 fs.writeFileSync(OPS+'/pre-p16i-final-runtime.json',JSON.stringify(config),{flag:'wx',mode:0o600});gate(false);
 cp.execFileSync('launchctl',['bootout','gui/501/org.pump.v5-owner-candidate'],{stdio:'ignore'});
 atomic(OPS+'/runtime.json',{...config,candidateDirectory:CANDIDATE});
 cp.execFileSync('launchctl',['bootstrap','gui/501','/Users/dan/Library/LaunchAgents/org.pump.v5-owner-candidate.plist'],{stdio:'ignore'});
 cp.execFileSync('launchctl',['kill','SIGTERM','gui/501/org.pump.v5-owner-gateway'],{stdio:'ignore'});
 let afterHealth;
 for(let i=0;i<40;i++){afterHealth=await health();if(afterHealth.candidateReady)break;await new Promise(r=>setTimeout(r,250));}
 const unchanged=JSON.stringify(before)===JSON.stringify(snapshot());
 if(!unchanged||!afterHealth.candidateReady||hb.legacyPid!==afterHealth.legacyPid)throw Error('PREPARE_SAFETY_FAILED');
 return {candidateRevision:REVISION,healthBefore:hb,healthAfter:afterHealth,dbUnchanged:unchanged,ownerDefaultEnabled:false};
}
async function main(command){if(process.getuid?.()!==501)throw Error('OWNER_UID_MISMATCH');
 if(command==='prepare')return prepare();if(command==='gate-on')return gate(true);if(command==='gate-off')return gate(false);
 if(command==='enable-ingress')return ingress(true);if(command==='disable-ingress')return ingress(false);
 if(command==='status')return {health:await health(),candidateDirectory:JSON.parse(fs.readFileSync(OPS+'/runtime.json')).candidateDirectory,gate:fs.existsSync(gateFile)?JSON.parse(fs.readFileSync(gateFile)):false};
 throw Error('UNKNOWN_COMMAND');}
if(require.main===module)main(process.argv[2]).then(x=>console.log(JSON.stringify(x))).catch(()=>{console.error('OWNER_DEFAULT_OPERATION_FAILED');process.exitCode=1;});
module.exports={main,gate,snapshot,health,LEGACY,OPS,CANDIDATE,REVISION};
