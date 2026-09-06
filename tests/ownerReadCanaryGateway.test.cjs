'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOwnerReadCanaryServer, candidateFinal, OWNER_CANARY_PATH } = require('../api/services/ownerReadCanaryGateway.cjs');
const sse = content => 'data: '+JSON.stringify({type:'content',content})+'\n\ndata: {"type":"done"}\n\n';
async function scenario(t, overrides = {}) {
    const calls=[], outcomes=[];
    const server=createOwnerReadCanaryServer({env:{INTERNAL_SECRET:'synthetic-test-only',AI_V5_OWNER_CANARY_ENABLED:'true'},
        fetch:async(url,opts)=>{calls.push({url,opts});return new Response(sse('fixture legacy'),{headers:{'content-type':'text/event-stream'}});},
        candidateFetch:async(url,opts)=>{calls.push({url,opts});return new Response(sse('fixture candidate'),{headers:{'content-type':'text/event-stream'}});},
        onOutcome:o=>outcomes.push(o),...overrides});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    t.after(()=>new Promise(r=>server.close(r)));
    const request=async(headers={},body={messages:[{role:'user',content:'synthetic read'}]})=>{
        const r=await fetch('http://127.0.0.1:'+server.address().port+OWNER_CANARY_PATH,{method:'POST',headers:{'content-type':'application/json',
            'x-internal-secret':'synthetic-test-only','x-pump-v5-use':'true','x-pump-v5-fact':'inventory.quantity',...headers},body:JSON.stringify(body)});
        return {status:r.status,text:await r.text()};
    };
    return {calls,outcomes,request};
}
test('explicit authenticated request returns one buffered frozen Candidate final only',async t=>{
    const s=await scenario(t);const r=await s.request();assert.equal(r.text,sse('fixture candidate'));
    assert.equal(s.calls.length,1);assert.equal(s.outcomes[0].finalSource,'v5-candidate');
});
for(const [name,headers] of [['missing',{'x-internal-secret':''}],['spoof',{'x-internal-secret':'wrong'}]])
test(name+' authentication cannot enter either backend',async t=>{const s=await scenario(t);assert.equal((await s.request(headers)).status,401);assert.equal(s.calls.length,0);});
test('default OFF forwards to real legacy contract without V5/write flags',async t=>{
    const s=await scenario(t,{env:{INTERNAL_SECRET:'synthetic-test-only'}});assert.equal((await s.request()).text,sse('fixture legacy'));
    assert.equal(s.calls.length,1);assert.ok(s.calls[0].url.endsWith(':3002/api/ai/chat'));
    assert.deepEqual(Object.keys(s.calls[0].opts.headers).sort(),['Content-Type','x-internal-secret']);
});
for(const [name,headers] of [['no marker',{'x-pump-v5-use':''}],['unknown fact',{'x-pump-v5-fact':'unknown'}]])
test(name+' stays legacy and opt-in is not sticky',async t=>{const s=await scenario(t);assert.equal((await s.request(headers)).text,sse('fixture legacy'));
    assert.equal(s.outcomes[0].candidateAttempted,false);assert.equal((await s.request()).text,sse('fixture candidate'));});
for(const failure of ['RISK_NOT_ELIGIBLE','RISK_UNAVAILABLE','ANSWER_VALIDATION_FAILED','INCOMPLETE','THROW','WRONG_HTTP','EXTRA_EVENTS'])
test(failure+' discards Candidate body and forwards once to legacy',async t=>{
    let attempts=0;const s=await scenario(t,{candidateFetch:async()=>{attempts++;
        if(failure==='THROW')throw Error('synthetic connection refusal');
        const body=failure==='INCOMPLETE'?'data: {"type":"content","content":"private candidate"}\n\n'
            :failure==='EXTRA_EVENTS'?sse('private candidate')+'data: {"type":"error"}\n\n'
            :'data: '+JSON.stringify({type:'error',code:failure})+'\n\ndata: {"type":"done"}\n\n';
        return new Response(body,{status:failure==='WRONG_HTTP'?503:200,headers:{'content-type':'text/event-stream'}});
    }});
    const r=await s.request();assert.equal(r.text,sse('fixture legacy'));assert.equal(attempts,1);assert.equal(s.calls.length,1);
    assert.equal(s.outcomes[0].safeLegacyFallback,true);assert.equal(s.outcomes[0].finalSource,'legacy');
    assert.ok(!JSON.stringify(s.outcomes).includes('synthetic read'));assert.ok(!JSON.stringify(s.outcomes).includes('private candidate'));
});
test('timeout fails over without Candidate retry',async t=>{
    const s=await scenario(t,{candidateTimeoutMs:10,candidateFetch:async(_u,o)=>new Promise((_r,j)=>o.signal.addEventListener('abort',()=>j(Error('TIMEOUT')),{once:true}))});
    assert.equal((await s.request()).text,sse('fixture legacy'));assert.equal(s.outcomes[0].safeLegacyFallback,true);
});
test('request extras cannot enter Candidate and do not enable writes',async t=>{
    const s=await scenario(t);await s.request({}, {messages:[{role:'user',content:'fixture'}],allowWrite:true});
    assert.equal(s.outcomes[0].candidateAttempted,false);assert.equal(s.calls.length,1);
    assert.equal(s.calls[0].opts.headers.allowWrite,undefined);
});
test('strict transport contract rejects raw JSON, partial, duplicate and extra fields',()=>{
    for(const value of ['{}',sse('x')+sse('y'),'data: {"type":"content","content":"x","raw":true}\n\ndata: {"type":"done"}\n\n'])assert.equal(candidateFinal(value),null);
});
test('non-loopback origins and missing auth are forbidden',()=>{
    assert.throws(()=>createOwnerReadCanaryServer({env:{}}),/AUTH_REQUIRED/);
    assert.throws(()=>createOwnerReadCanaryServer({candidateOrigin:'https://example.com',env:{INTERNAL_SECRET:'x'}}),/ORIGIN_INVALID/);
    assert.throws(()=>createOwnerReadCanaryServer({env:{INTERNAL_SECRET:'x'},candidateTimeoutMs:60001}),/TIMEOUT_INVALID/);
});
test('10 concurrent requests keep Candidate bodies and final source task-local',async t=>{
    const s=await scenario(t,{candidateFetch:async(_url,opts)=>{
        const text=JSON.parse(opts.body).messages[0].content;
        await new Promise(r=>setTimeout(r,(Number(text.split('-').at(-1))*3)%8));
        return new Response(sse(text),{headers:{'content-type':'text/event-stream'}});
    }});
    await Promise.all(Array.from({length:10},async(_,i)=>{
        const text='synthetic-task-'+i;const r=await s.request({}, {messages:[{role:'user',content:text}]});
        assert.equal(r.text,sse(text));
    }));
    assert.equal(s.calls.length,0);assert.equal(s.outcomes.length,10);
    assert.equal(new Set(s.outcomes.map(o=>o.requestId)).size,10);
    assert.ok(s.outcomes.every(o=>o.candidateSuccess&&o.finalSource==='v5-candidate'));
});
