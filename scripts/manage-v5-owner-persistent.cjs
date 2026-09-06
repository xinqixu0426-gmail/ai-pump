'use strict';
const fs=require('fs'),cp=require('child_process');
const OPS='/Users/dan/pump-v5-owner-ops-p16h',LEGACY='/Users/dan/pump-cost-accounting-system';
const uid=process.getuid(),domain='gui/'+uid;
if(uid!==501)throw Error('OWNER_UID_MISMATCH');
const labels={candidate:'org.pump.v5-owner-candidate',gateway:'org.pump.v5-owner-gateway'};
const plist=r=>'/Users/dan/Library/LaunchAgents/'+labels[r]+'.plist';
const run=args=>{const p=cp.spawnSync('launchctl',args,{encoding:'utf8'});return p.status===0;};
function cloudflareControl() {
    const pem=fs.readFileSync('/Users/dan/.cloudflared/cert.pem','utf8');
    const cert=JSON.parse(Buffer.from(pem.match(/-----BEGIN ARGO TUNNEL TOKEN-----([\s\S]*?)-----END/)[1].replace(/\s/g,''),'base64').toString());
    const plist=JSON.parse(cp.execFileSync('plutil',['-convert','json','-o','-','/Library/LaunchDaemons/com.cloudflare.cloudflared.plist'],{encoding:'utf8'}));
    const args=plist.ProgramArguments;
    const tunnel=JSON.parse(Buffer.from(args[args.indexOf('--token')+1],'base64').toString());
    const url='https://api.cloudflare.com/client/v4/accounts/'+cert.accountID+'/cfd_tunnel/'+tunnel.t+'/configurations';
    return async config=>{
        const r=await fetch(url,{method:config?'PUT':'GET',headers:{Authorization:'Bearer '+cert.apiToken,'Content-Type':'application/json',Accept:'application/json;version=1'},
            ...(config?{body:JSON.stringify({config})}:{}),signal:AbortSignal.timeout(20000)});
        const j=await r.json();if(!r.ok||!j.success)throw Error('INGRESS_CONTROL_FAILED');
        return j.result;
    };
}


async function route(enable){
 const cf=cloudflareControl(),before=(await cf()).config;
 const ours=r=>r.hostname==='xuxinqi.xin'&&r.path==='^/api/ai/owner-read-canary$';
 const rows=before.ingress.filter(ours);
 if(rows.some(r=>r.service!=='http://127.0.0.1:3103'))throw Error('ROUTE_CONFLICT');
 if(enable&&!rows.length){
  if(!before.ingress.some(r=>r.hostname==='xuxinqi.xin'&&r.service==='http://localhost:3002'&&!r.path))throw Error('LEGACY_INGRESS_MISSING');
  await cf({...before,ingress:[{hostname:'xuxinqi.xin',path:'^/api/ai/owner-read-canary$',service:'http://127.0.0.1:3103'},...before.ingress]});
 }else if(!enable&&rows.length)await cf({...before,ingress:before.ingress.filter(r=>!ours(r))});
 const after=(await cf()).config;
 if(after.ingress.some(ours)!==enable)throw Error('ROUTE_STATE_FAILED');
 return {ownerRouteEnabled:enable,otherIngressPreserved:JSON.stringify(before.ingress.filter(r=>!ours(r)))===JSON.stringify(after.ingress.filter(r=>!ours(r)))};
}
function install(){
 const config={enabled:true,legacyDirectory:LEGACY,candidateDirectory:'/Users/dan/pump-v5-candidate-15091c9-r4p',gatewayDirectory:OPS,stateDirectory:OPS};
 if(fs.existsSync(OPS+'/runtime.json')){if(JSON.stringify(JSON.parse(fs.readFileSync(OPS+'/runtime.json')))!==JSON.stringify(config))throw Error('CONFIG_CONFLICT');}
 else fs.writeFileSync(OPS+'/runtime.json',JSON.stringify(config,null,2),{flag:'wx',mode:0o600});
 for(const role of Object.keys(labels)){
  const p={Label:labels[role],ProgramArguments:['/opt/homebrew/bin/node',OPS+'/v5-owner-persistent-runtime.cjs',OPS+'/runtime.json',role],
   WorkingDirectory:OPS,RunAtLoad:true,KeepAlive:true,ThrottleInterval:5,ProcessType:'Background',
   StandardOutPath:'/dev/null',StandardErrorPath:'/dev/null',
   EnvironmentVariables:{NODE_PATH:LEGACY+'/node_modules:/Users/dan/pump-v5-candidate-15091c9-r4p-deps/node_modules',PATH:'/opt/homebrew/bin:/usr/bin:/bin'}};
  const xml=cp.execFileSync('plutil',['-convert','xml1','-o','-','--','-'],{input:JSON.stringify(p)});
  fs.writeFileSync(plist(role),xml,{flag:'wx',mode:0o600});
 }
 return {installed:true,nonRoot:true};
}
async function status(){
 const env=require(LEGACY+'/node_modules/dotenv').parse(fs.readFileSync(LEGACY+'/.env'));
 const result={roles:{},uid};
 for(const role of Object.keys(labels)){
  const p=cp.spawnSync('launchctl',['print',domain+'/'+labels[role]],{encoding:'utf8'});
  const text=p.stdout||'';
  result.roles[role]={loaded:p.status===0,pid:Number(text.match(/\bpid = (\d+)/)?.[1])||null,state:text.match(/\bstate = (\w+)/)?.[1]||null};
  const f=OPS+'/'+role+'-metadata.json';
  if(fs.existsSync(f))result.roles[role].metadata=JSON.parse(fs.readFileSync(f));
 }
 result.legacy=await fetch('http://127.0.0.1:3002/api/health/ready').then(r=>r.json()).then(j=>({ready:j.data?.ready,pid:j.data?.runtime?.pid}));
 result.candidateReady=await fetch('http://127.0.0.1:3102/api/health/ready',{headers:{'x-internal-secret':env.INTERNAL_SECRET},signal:AbortSignal.timeout(2000)}).then(r=>r.json()).then(j=>j.data?.ready===true).catch(()=>false);
 return result;
}
async function main(){
 const command=process.argv[2];
 let result;
 if(command==='install')result=install();
 else if(command==='start'){
  for(const r of Object.keys(labels)){run(['enable',domain+'/'+labels[r]]);if(!run(['bootstrap',domain,plist(r)]))throw Error('BOOTSTRAP_FAILED');}
  result={started:true};
 }else if(command==='stop-candidate'){if(!run(['bootout',domain+'/'+labels.candidate]))throw Error('BOOTOUT_FAILED');result={stopped:true};}
 else if(command==='start-candidate'){if(!run(['bootstrap',domain,plist('candidate')]))throw Error('BOOTSTRAP_FAILED');result={started:true};}
 else if(command==='restart-candidate'){if(!run(['kill','SIGTERM',domain+'/'+labels.candidate]))throw Error('RESTART_FAILED');result={restartRequested:true};}
 else if(command==='enable-route')result=await route(true);
 else if(command==='disable-route')result=await route(false);
 else if(command==='rollback'){
  result=await route(false);
  for(const r of ['gateway','candidate']){run(['bootout',domain+'/'+labels[r]]);run(['disable',domain+'/'+labels[r]]);}
  result.supervisorsDisabled=true;
 }else if(command==='status')result=await status();
 else throw Error('UNKNOWN_COMMAND');
 console.log(JSON.stringify(result));
}
main().catch(()=>{console.error('P16H_OPERATION_FAILED');process.exitCode=1;});
