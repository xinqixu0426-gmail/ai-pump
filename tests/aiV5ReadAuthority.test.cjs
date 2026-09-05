'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
const { handleAiChat } = require('../api/routes/ai/chat.cjs');
const env = { AI_V5_READ_CANARY_ENABLED: 'true', AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED: 'true', INTERNAL_SECRET: 'synthetic-only' };
function fake(messages) {
    const v = JSON.parse(messages[1].content);
    return { content: JSON.stringify({ version: 1, answerStatus: 'ANSWERED', answerText: v.facts.map(f => f.realization).join('\n'),
        claims: v.facts.map((f,i) => ({ claimId: 'c'+(i+1), claimType: 'FACT', factKey: f.factKey, numericValue: f.numericValue, evidenceRefs: [f.evidenceRef], entityRef: v.entityRef })) }) };
}
async function chat(settings = {}) {
    const ownEnv = { ...env, ...settings.env }, headers = settings.headers || { 'x-internal-secret': env.INTERNAL_SECRET, 'x-pump-v5-use': 'true', 'x-pump-v5-fact': 'inventory.quantity' };
    const req = Object.assign(new EventEmitter(), { headers, body: { messages: [{ role: 'user', content: 'synthetic request' }] } });
    const events = [], responseHeaders = {}; let outcome, calls = 0, reads = 0, legacyCalls = 0;
    const label = 'synthetic-part-' + (settings.id || 'one'), stock = settings.stock || 19.375;
    const res = Object.assign(new EventEmitter(), { setHeader(k,v) { responseHeaders[k]=v; }, flushHeaders() {},
        write(s) { if(s.startsWith('data: ')) events.push(JSON.parse(s.slice(6))); return true; }, end() { this.writableEnded=true; } });
    const runtime = { interpret: async () => ({ status:'VALID', interpretation: { domain:'catalog', operation:settings.operation || 'read_inventory', needsClarification:false,
        entityCandidates:[{entityType:'part', candidateText:label}] }, resolvedIdentity:{entityType:'part',canonicalId:'123'},
        architectureMetadata:{complete:true,finalEntityStatus:'FINAL_ENTITY_RESOLVED'} }),
        executionOptions:{execute:async (tool,args,ctx) => { reads++; assert.equal(tool,'search_parts'); assert.equal(ctx.allowWrite,false);
            return { success:true,truncated:false,count:1,parts:[{id:'123',stock}], executionEvidence:{verified:settings.failure!=='evidence',kind:'formal_api_query',calls:[{method:'GET',path:'/api/parts'}]} }; }},
        answerOptions:{timeoutMs:10,modelRequest:async m => { calls++; if(settings.failure==='error') throw Error('private-model-error');
            if(settings.failure==='timeout') return new Promise(()=>{});
            const d=JSON.parse(fake(m).content);
            if(settings.failure==='contract') d.extra=true;
            if(settings.failure==='numeric') d.claims[0].numericValue++;
            if(settings.failure==='entity') d.claims[0].entityRef='wrong';
            return {content:JSON.stringify(d)};
        }} };
    const started=performance.now();
    await handleAiChat(req,res,{ env:ownEnv,telemetry:{record(){}}, authorityOptions:{...runtime,onAuthorityOutcome:o=>{outcome=o;}},canaryOptions:runtime,
        runAiDispatcherV3:async ({emit,onProvider})=>{legacyCalls++; onProvider({provider:'synthetic',model:'legacy'});
            emit('content',{content:'legacy-synthetic'});emit('done',{});
            return {intent:{mode:settings.write?'command':'query'},telemetry:{outcome:'completed',toolSteps:[{capabilityName:'search_parts',success:true}]}};
        }});
    return {events,outcome,calls,reads,legacyCalls,latency:performance.now()-started,responseHeaders,label,stock};
}
const baseHeaders={'x-internal-secret':env.INTERNAL_SECRET,'x-pump-v5-use':'true','x-pump-v5-fact':'inventory.quantity'};
test('seven gate cases plus invalid identity preserve exact final-source separation',async()=>{
    const cases=[
        {env:{AI_V5_READ_CANARY_ENABLED:'false',AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED:'false'},headers:{}},
        {env:{AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED:'false'},headers:{...baseHeaders,'x-pump-v5-use':'false','x-pump-v5-preview':'true'},preview:true},
        {env:{AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED:'false'}},
        {env:{AI_V5_READ_CANARY_ENABLED:'false'}},
        {headers:{...baseHeaders,'x-pump-v5-use':'false'}},
        {headers:{...baseHeaders,'x-internal-secret':''}},
        {headers:baseHeaders,authority:true},
        {headers:{...baseHeaders,'x-internal-secret':'invalid'}},
    ];
    for(const c of cases){const r=await chat(c);assert.equal(r.legacyCalls,1);
        assert.equal(r.outcome.attempted,c.authority===true);
        assert.equal(r.outcome.finalSource,c.authority?'v5-authoritative-canary':'legacy/current');
        const content=r.events.filter(e=>e.type==='content');assert.equal(content.length,1);
        assert.equal(content[0].content==='legacy-synthetic',!c.authority);
        assert.equal(r.events.filter(e=>e.type==='done').length,1);
        assert.equal(r.events.some(e=>e.type==='v5_preview'),c.preview===true);
        assert.equal(r.calls,c.authority||c.preview?1:0);
    }
});
test('validated V5 occupies normal content/done only, not raw structured output',async()=>{
    const r=await chat(); assert.equal(r.outcome.validationPass,true);assert.equal(r.calls,1);assert.equal(r.reads,1);
    assert.deepEqual(r.events.map(e=>e.type),['provider','content','done']);
    assert.equal(r.events[1].content,require('../api/services/ai-v5/readAnswerContract.cjs').renderFact(r.label,'inventory.quantity',r.stock));
    assert.equal(JSON.stringify(r.events).includes('numericValue'),false);assert.equal(JSON.stringify(r.events).includes('evidenceRefs'),false);
    assert.equal(r.responseHeaders['Cache-Control'],'no-store');
});
test('failure matrix falls back on actual final mux without raw/partial body or second call',async t=>{
    t.diagnostic(JSON.stringify({latencyCase:'ordinary',ms:(await chat({headers:{}})).latency}));
    for(const failure of ['error','timeout','contract','evidence','numeric','entity']){
        const r=await chat({failure});assert.equal(r.outcome.finalSource,'legacy/current');assert.equal(r.outcome.fallback,true);
        assert.equal(r.calls,failure==='evidence'?0:1);assert.equal(r.events.filter(e=>e.type==='content')[0].content,'legacy-synthetic');
        assert.equal(r.events.filter(e=>e.type==='content').length,1);assert.equal(r.events.filter(e=>e.type==='done').length,1);
        assert.equal(r.events.some(e=>e.type==='v5_preview'),false);
        for(const raw of ['private-model-error','19.375','answerText','numericValue'])assert.equal(JSON.stringify(r.outcome).includes(raw),false);
        t.diagnostic(JSON.stringify({latencyCase:failure,ms:r.latency,finalSource:r.outcome.finalSource}));
    }
});
test('write intent and finalized mutation routing cannot execute V5 reads or writes',async()=>{
    for(const settings of [{write:true},{operation:'update'}]){const r=await chat(settings);
        assert.equal(r.reads,0);assert.equal(r.calls,0);assert.equal(r.outcome.finalSource,'legacy/current');}
});
test('no sticky authority and no duplicate answer when both request markers supplied',async()=>{
    const first=await chat({headers:{...baseHeaders,'x-pump-v5-preview':'true'}});assert.equal(first.calls,1);assert.equal(first.events.some(e=>e.type==='v5_preview'),false);
    const next=await chat({headers:{}});assert.equal(next.calls,0);assert.equal(next.outcome.finalSource,'legacy/current');
});
test('concurrent final mux bodies stay isolated and are unavailable after completion',async()=>{
    const rows=await Promise.all(Array.from({length:10},(_,i)=>chat({id:String(i),stock:40.25+i})));
    for(const r of rows){assert.equal(r.events[1].content,require('../api/services/ai-v5/readAnswerContract.cjs').renderFact(r.label,'inventory.quantity',r.stock));
        assert.equal(Object.hasOwn(r.outcome,'content'),false);assert.equal(JSON.stringify(r.outcome).includes(r.label),false);}
});
