'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),jwt=require('jsonwebtoken');
const {createOwnerReadCanaryServer}=require('../api/services/ownerReadCanaryGateway.cjs');
const {issueOwnerToken}=require('../api/services/ownerAuthentication.cjs');
const env={INTERNAL_SECRET:'fixture-service',JWT_SECRET:'fixture-key',ACCESS_PASSWORD:'shared',PUMP_OWNER_ACCESS_PASSWORD:'a'.repeat(32),PUMP_OWNER_SUBJECT:'fixture_owner_subject',AI_V5_OWNER_SUBJECTS:'["fixture_owner_subject"]',AI_V5_OWNER_CANARY_ENABLED:'true'};
const owner=issueOwnerToken(env.PUMP_OWNER_ACCESS_PASSWORD,env),admin=jwt.sign({role:'admin'},env.JWT_SECRET,{expiresIn:'1h'});
const sse=v=>'data: '+JSON.stringify({type:'content',content:v})+'\n\ndata: {"type":"done"}\n\n';
test('ordinary owner default matrix, dynamic rollback, exact principal and no identity elevation',async t=>{
    let gate=false,fail=false;const outcomes=[],calls=[];
    const server=createOwnerReadCanaryServer({env,readConfig:()=>({...env,AI_V5_OWNER_READ_DEFAULT_ENABLED:String(gate)}),
        candidateFetch:async(_u,o)=>{calls.push(['candidate',o]);if(fail)throw Error('PRIVATE');return new Response(sse('verified fixture'),{headers:{'content-type':'text/event-stream'}});},
        fetch:async(_u,o)=>{calls.push(['legacy',o]);return new Response(sse('legacy fixture'),{headers:{'content-type':'text/event-stream'}});},onOutcome:o=>outcomes.push(o)});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
    async function request(token,headers={}){const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/ai/chat',{method:'POST',headers:{'content-type':'application/json',...(token?{cookie:'token='+token}:{}),...headers},body:JSON.stringify({messages:[{role:'user',content:'private fixture query'}]})});return r.text();}
    assert.equal(await request(owner),sse('legacy fixture'));assert.equal(outcomes.at(-1).candidateAttempted,false);
    gate=true;assert.equal(await request(owner),sse('verified fixture'));assert.equal(outcomes.at(-1).ownerAuthenticated,true);
    assert.equal(Object.hasOwn(calls.at(-1)[1].headers,'x-pump-v5-fact'),false);
    for(const token of [admin,undefined,jwt.sign({role:'admin',sub:env.PUMP_OWNER_SUBJECT,authn:'owner_credential_v1'},'wrong-key',{expiresIn:'1h'})]){
        assert.equal(await request(token,{'x-owner':'true','x-pump-v5-use':'true'}),sse('legacy fixture'));
        assert.equal(outcomes.at(-1).candidateAttempted,false);assert.equal(outcomes.at(-1).ownerAuthenticated,false);
        assert.equal(calls.at(-1)[1].headers['x-internal-secret'],undefined);
    }
    fail=true;assert.equal(await request(owner),sse('legacy fixture'));assert.equal(outcomes.at(-1).safeLegacyFallback,true);
    fail=false;assert.equal(await request(owner),sse('verified fixture'));
    gate=false;assert.equal(await request(owner),sse('legacy fixture'));assert.equal(outcomes.at(-1).candidateAttempted,false);
    assert.ok(!JSON.stringify(outcomes).includes('private fixture'));assert.ok(!JSON.stringify(outcomes).includes(owner));
});
