'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const jwt = require('jsonwebtoken');
const c = require('../api/services/conversationContext.cjs');
const a = require('../api/services/ownerAuthentication.cjs');
const { createOwnerReadCanaryServer } = require('../api/services/ownerReadCanaryGateway.cjs');
const env = { INTERNAL_SECRET:'fixture-secret', JWT_SECRET:'fixture-jwt', ACCESS_PASSWORD:'shared',
    PUMP_OWNER_ACCESS_PASSWORD:'fixture-owner-password-32-characters', PUMP_OWNER_SUBJECT:'fixture_owner_subject_001',
    AI_V5_OWNER_SUBJECTS:'["fixture_owner_subject_001"]', AI_V5_OWNER_READ_DEFAULT_ENABLED:'true', AI_V5_OWNER_CANARY_ENABLED:'true' };
const token = a.issueOwnerToken(env.PUMP_OWNER_ACCESS_PASSWORD, env);
const auth = () => a.verifyAuthentication(token, env);

test('existing persisted chat identity is stable through reload and distinct across chats/tabs', () => {
    const ts = require('../apps/web-next/node_modules/typescript');
    const source = fs.readFileSync('apps/web-next/lib/conversation-context.ts','utf8');
    const load = () => { const exports = {}; vm.runInNewContext(ts.transpile(source,{module:ts.ModuleKind.CommonJS}),{exports}); return exports.conversationTransportId; };
    const tabA = load(), tabB = load();
    assert.equal(tabA(31),tabA(31)); assert.equal(tabA(31),load()(31)); assert.equal(tabA(31),tabB(31));
    assert.notEqual(tabA(31),tabB(32));
    for (const id of [0,-1,NaN,Infinity,1.5,'31']) assert.throws(()=>tabA(id));
    assert.ok(c.validConversationId(tabA(Number.MAX_SAFE_INTEGER)));
    const view = fs.readFileSync('apps/web-next/components/ai-view.tsx','utf8');
    assert.ok(view.includes('conversationTransportId(conversationId!)'));
    assert.ok(fs.readFileSync('apps/web-next/lib/ai.ts','utf8').includes('...(conversationId === undefined ? {} : { conversationId })'));
});
test('strict bounded IDs and service signature; no owner escalation', () => {
    for(const id of [null,{},[],31,'','chat-0','chat-01','chat-1.2','chat-9007199254740992','x'.repeat(10000)]) {
        assert.equal(c.validConversationId(id),false); assert.equal(c.signConversationContext(auth(),id,env),null);
    }
    assert.equal(c.signConversationContext({sub:env.PUMP_OWNER_SUBJECT},'chat-1',env),null);
    const signed = c.signConversationContext(auth(),'chat-1',env);
    assert.equal(c.verifyConversationContext(signed,env.INTERNAL_SECRET).conversationId,'chat-1');
    for(const bad of [signed+'x','malformed','',{},'x'.repeat(513)]) assert.throws(()=>c.verifyConversationContext(bad,env.INTERNAL_SECRET),/CONVERSATION_CONTEXT_INVALID/);
    assert.throws(()=>c.verifyConversationContext(signed,'wrong'),/CONVERSATION_CONTEXT_INVALID/);
});
test('principal/conversation namespace is independent and deterministic; no account last-query state', async () => {
    const context = id => c.verifyConversationContext(c.signConversationContext(auth(),id,env),env.INTERNAL_SECRET);
    assert.equal(context('chat-1').contextKey,context('chat-1').contextKey);
    assert.notEqual(context('chat-1').contextKey,context('chat-2').contextKey);
    const other = {...env,PUMP_OWNER_SUBJECT:'fixture_owner_subject_002',AI_V5_OWNER_SUBJECTS:'["fixture_owner_subject_002"]'};
    const otherAuth = a.verifyAuthentication(a.issueOwnerToken(other.PUMP_OWNER_ACCESS_PASSWORD,other),other);
    assert.notEqual(context('chat-1').contextKey,c.verifyConversationContext(c.signConversationContext(otherAuth,'chat-1',other),env.INTERNAL_SECRET).contextKey);
    await Promise.all(Array.from({length:10},(_,i)=>c.withConversationContext(context(`chat-${i+1}`),async()=>{
        await new Promise(r=>setImmediate(r)); assert.equal(c.getConversationContext().conversationId,`chat-${i+1}`);
    })));
    assert.equal(c.getConversationContext(),null);
});
test('HTTP owner binding, shared/anonymous exclusion, malformed context fallback, Legacy stripping, no logs', async t => {
    const calls=[],meta=[]; let fail=false;
    const sse='data: {"type":"content","content":"fixture answer"}\n\ndata: {"type":"done"}\n\n';
    const server=createOwnerReadCanaryServer({env,onOutcome:x=>meta.push(x),
        candidateFetch:async(_u,o)=>{calls.push(['candidate',o]); if(fail)throw Error('fixture'); return new Response(sse,{headers:{'content-type':'text/event-stream'}});},
        fetch:async(_u,o)=>{calls.push(['legacy',o]);return new Response(sse,{headers:{'content-type':'text/event-stream'}});}});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
    const req=async(identity,id)=>{
        const r=await fetch(`http://127.0.0.1:${server.address().port}/api/ai/chat`,{method:'POST',headers:{'content-type':'application/json',...(identity?{cookie:'token='+identity}:{}),[c.HEADER]:'client-forgery'},
            body:JSON.stringify({messages:[{role:'user',content:'fixture read'}],conversationId:id})});
        assert.equal(await r.text(),sse);return calls.at(-1);
    };
    let [route,opts]=await req(token,'chat-11');assert.equal(route,'candidate');
    const one=c.verifyConversationContext(opts.headers[c.HEADER],env.INTERNAL_SECRET);assert.equal(one.conversationId,'chat-11');
    assert.deepEqual(Object.keys(JSON.parse(opts.body)),['messages']);
    const two=await req(token,'chat-12');assert.notEqual(one.contextKey,c.verifyConversationContext(two[1].headers[c.HEADER],env.INTERNAL_SECRET).contextKey);
    for(const identity of [undefined,jwt.sign({role:'admin'},env.JWT_SECRET,{expiresIn:'1h'})]) {
        const [r,o]=await req(identity,'chat-11');assert.equal(r,'legacy');assert.equal(o.headers[c.HEADER],undefined);assert.equal(meta.at(-1).candidateAttempted,false);
    }
    for(const id of ['bad',null,{},'chat-0']) { const [r,o]=await req(token,id);assert.equal(r,'legacy');assert.equal(JSON.parse(o.body).conversationId,undefined);assert.equal(meta.at(-1).candidateAttempted,false); }
    fail=true; [route,opts]=await req(token,'chat-11');assert.equal(route,'legacy');assert.equal(JSON.parse(opts.body).conversationId,undefined);
    assert.ok(!JSON.stringify(meta).includes('chat-11'));assert.ok(!JSON.stringify(meta).includes(token));assert.ok(!JSON.stringify(meta).includes('fixture read'));
});
test('Candidate pipeline receives no control-plane values in model input or output', async () => {
    const {runCandidateRead}=require('../api/services/ai-v5/candidateRead.cjs');
    const ctx=c.verifyConversationContext(c.signConversationContext(auth(),'chat-772991',env),env.INTERNAL_SECRET);
    let calls=0;
    const result=await c.withConversationContext(ctx,()=>runCandidateRead({previewOptIn:true,internalAuthorized:true,
        sourceRequest:'synthetic request',deliver:()=>assert.fail('no delivery for rejected risk')},{
        env:{PUMP_V5_CANDIDATE_RUNTIME:'true',AI_V5_READ_CANARY_ENABLED:'true',AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED:'true'},
        riskOptions:{request:async(...args)=>{calls++;assert.equal(c.getConversationContext(),ctx);
            assert.ok(!JSON.stringify(args).includes(ctx.conversationId));assert.ok(!JSON.stringify(args).includes(ctx.contextKey));
            return {goal:'synthetic',mode:'command',domains:['catalog'],needsBusinessData:true,contextMode:'current_turn',answerShape:'direct',entityScope:'single',requiresClarification:false,ambiguities:[],confidence:'high'};}}
    }));
    assert.equal(calls,1);assert.equal(result.attempted,false);assert.ok(!JSON.stringify(result).includes(ctx.conversationId));
    assert.equal(c.getConversationContext(),null);
    const entry=fs.readFileSync('scripts/start-v5-candidate.cjs','utf8');
    assert.ok(entry.includes('context.withConversationContext(conversationContext, () => runCandidateRead'));
});
