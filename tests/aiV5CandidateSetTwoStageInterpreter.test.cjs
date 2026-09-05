'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createV5SourceSpanCatalog } = require('../api/services/ai-v5/sourceSpanCatalog.cjs');
const { parseSpanSelection } = require('../api/services/ai-v5/sourceSpanSelectionContract.cjs');
const { parseLocalIntent } = require('../api/services/ai-v5/localIntentContract.cjs');
const { buildLocalTaskClassCatalog, localModelView } = require('../api/services/ai-v5/localTaskClassCatalog.cjs');
const { acquireCandidateSet } = require('../api/services/ai-v5/candidateSet.cjs');
const { finalizeEntity } = require('../api/services/ai-v5/entityFinalization.cjs');
const { interpretCandidateSetTask } = require('../api/services/ai-v5/candidateSetTwoStageInterpreter.cjs');
const { createV5InterpreterInputEnvelope } = require('../api/services/ai-v5/taskInterpreterInput.cjs');
const { runV5IndependentShadow } = require('../api/services/ai-v5/independentShadow.cjs');
const { callStage } = require('../api/services/ai-v5/twoStageModel.cjs');
const response = candidates => ({ version: 1, status: 'OK', complete: true, attemptedEntityTypes: 6, candidateCount: candidates.length, candidates });
const candidate = (entityType, canonicalId = 'PRIVATE_ID') => ({ entityType, canonicalId, matchKind: 'EXACT' });
const lookup = candidates => async () => response(candidates);
function fixture(source, mention, candidates, ref = 'tc_002') {
    const span = createV5SourceSpanCatalog(source).spans.find(item => item.text === mention);
    let calls = 0;
    return { lookupEntities: async (fetcher,input)=>response(input.mention===mention?candidates:[]), modelRequest: async messages => {
        const text = JSON.stringify(messages);
        assert.ok(!text.includes('PRIVATE_ID'));
        calls++;
        if (calls === 1) { assert.ok(!text.includes('tc_')); return { content: JSON.stringify({ version: 2, spanRefs: [span.spanRef,createV5SourceSpanCatalog(source).spans.find(s=>s.spanRef!==span.spanRef).spanRef], needsClarification: false }) }; }
        const input = JSON.parse(messages[1].content);
        assert.ok(input.classes.length <= 4);
        return { content: JSON.stringify({ version: 1, localTaskClassRef: ref }) };
    } };
}
for (const mention of ['v750-tokoy-', 'V750-A', '800平刀', 'abc-', '-a-', 'a/b', 'a.b', 'a_b', 'a+b', '800']) {
    test(`source identity remains exact: ${mention}`, async () => {
        const source = `查 ${mention} 库存`;
        const result = await interpretCandidateSetTask(createV5InterpreterInputEnvelope({ rawUserRequest: source, pageContext: null }), fixture(source, mention, [candidate('part')]));
        assert.equal(result.status, 'VALID');
        assert.equal(result.interpretation.entityCandidates[0].candidateText, mention);
        assert.equal(result.modelCalls, 1);
        assert.equal(result.architectureMetadata.businessApiCalls, 2);
    });
}
test('quoted numeric source selects the source-backed string content', async () => {
    const source = '查 "800" 库存';
    const result = await interpretCandidateSetTask(createV5InterpreterInputEnvelope({rawUserRequest:source,pageContext:null}),fixture(source,'800',[candidate('part')]));
    assert.equal(result.interpretation.entityCandidates[0].candidateText,'800');
});
test('strict stage 1 rejects invented refs, extra fields and invalid JSON', () => {
    const catalog = createV5SourceSpanCatalog('SYNTH-1');
    for (const bad of ['{', JSON.stringify({ version: 1, spanRef: 'sp_fake', needsClarification: false }), JSON.stringify({ version: 1, spanRef: 'sp_001', needsClarification: false, taskClassRef: 'tc_002' })]) assert.throws(() => parseSpanSelection(bad, catalog));
    assert.equal(parseSpanSelection(JSON.stringify({ version: 2, spanRefs: [], needsClarification: true }), catalog).needsClarification, true);
});
test('candidate sets preserve both cross-type and same-type ambiguity', async () => {
    for (const candidates of [[candidate('part')], [candidate('part'), candidate('template')], [candidate('part','PRIVATE_ID_A'), candidate('part','PRIVATE_ID_B')]]) {
        const set = await acquireCandidateSet('SYNTH-1', { lookupEntities: lookup(candidates) });
        assert.equal(set.eligible, true); assert.equal(set.candidates.length, candidates.length);
        assert.equal(set.businessApiCalls, 1);
    }
});
test('zero/incomplete/error/timeout cannot enter local selection', async () => {
    for (const fn of [lookup([]), async () => ({ ...response([candidate('part')]), status: 'INCOMPLETE', complete: false }), async () => { throw new Error('secret'); }, () => new Promise(() => {})]) {
        const keepAlive = setInterval(() => {}, 100);
        try { const set = await acquireCandidateSet('SYNTH-1', { lookupEntities: fn, lookupTimeoutMs: 10 }); assert.equal(set.eligible, false); }
        finally { clearInterval(keepAlive); }
    }
});
test('local union and contrasts contain only request-local refs', () => {
    for (const [types, count] of [[['part'],1],[['coil'],2],[['recipe'],4],[['part','template'],2],[[],0]]) {
        const local = buildLocalTaskClassCatalog(types.map(type => candidate(type)));
        assert.equal(local.length, count);
        assert.equal(new Set(local.map(item => item.classRef)).size, count);
        for (const item of localModelView(local)) for (const alt of item.localAlternatives) assert.ok(local.some(c => c.classRef === alt.classRef));
    }
});
test('stage 2 rejects global-but-not-local, unknown refs and all free authority fields', () => {
    const local = buildLocalTaskClassCatalog([candidate('part')]);
    assert.equal(parseLocalIntent('{"version":1,"localTaskClassRef":"tc_002"}',local).localTaskClassRef,'tc_002');
    for (const ref of ['tc_003','invented']) assert.throws(() => parseLocalIntent(JSON.stringify({version:1,localTaskClassRef:ref}),local));
    for (const field of ['toolName','entityType','canonicalId','reasoning']) assert.throws(() => parseLocalIntent(JSON.stringify({version:1,localTaskClassRef:'tc_002',[field]:'forbidden'}),local));
    assert.throws(() => parseLocalIntent('{',local));
});
test('software finalization is unique, mismatch, or ambiguous without top-1', () => {
    const cls = { entityTypes: ['part'] };
    for (const [candidates,status] of [[[candidate('part'),candidate('template')],'FINAL_ENTITY_RESOLVED'],[[candidate('template')],'CLASS_ENTITY_MISMATCH'],[[candidate('part','a'),candidate('part','b')],'FINAL_ENTITY_AMBIGUOUS']]) {
        assert.equal(finalizeEntity({eligible:true,complete:true,candidates},cls).status,status);
    }
});
test('cross-type synthetic selection uses two calls and hides canonical identity', async () => {
    const source = '查 SYNTH-A 库存';
    const outcome = await runV5IndependentShadow({sourceRequest:source,shadowTaskId:'v3-test'},fixture(source,'SYNTH-A',[candidate('part'),candidate('template')]));
    assert.equal(outcome.capabilityId,'inventory.read'); assert.equal(outcome.modelCalls,2);
    assert.equal(outcome.v5BusinessApiCalls,2); assert.equal(outcome.v5ToolCalls,0);
    assert.ok(!JSON.stringify(outcome).includes('PRIVATE_ID')); assert.ok(!JSON.stringify(outcome).includes('SYNTH-A'));
});
test('wrong-but-valid class is never corrected', async () => {
    const source = '查 SYNTH-B 库存';
    const result = await interpretCandidateSetTask(createV5InterpreterInputEnvelope({rawUserRequest:source,pageContext:null}),fixture(source,'SYNTH-B',[candidate('coil')],'tc_003'));
    assert.equal(result.taskClassRef,'tc_003'); assert.equal(result.interpretation.operation,'cost');
});
test('ten concurrent requests keep spans/candidates/finalization private and isolated', async () => {
    const results = await Promise.all(Array.from({length:10},async (_,i) => {
        const mention=`SYNTH-${i}`, source=`查 ${mention} 库存`;
        const result=await interpretCandidateSetTask(createV5InterpreterInputEnvelope({rawUserRequest:source,pageContext:null}),fixture(source,mention,[candidate('part',`PRIVATE_ID_${i}`),candidate('template',`OTHER_${i}`)]));
        assert.equal(result.resolvedIdentity.canonicalId,`PRIVATE_ID_${i}`);
        assert.equal(result.interpretation.entityCandidates[0].candidateText,mention); return result;
    }));
    assert.equal(results.length,10);
});
test('stage timeout/error do not retry and model settings remain request-local', async () => {
    const env = { AI_PROVIDER: 'kimi', DEEPSEEK_MODEL: 'unchanged-v4-model' };
    const before = JSON.stringify(env);
    let calls=0;
    const timed = await callStage([], { env, timeoutMs: 5, modelRequest: async (messages, options) => {
        calls++; assert.equal(options.selected.model,'deepseek-v4-flash');
        assert.equal(options.selected.provider,'deepseek'); return new Promise(()=>{});
    } });
    assert.equal(timed.status,'TIMEOUT'); assert.equal(calls,1); assert.equal(JSON.stringify(env),before);
    assert.equal((await callStage([], {modelRequest:async()=>{throw new Error('PRIVATE_ERROR')}})).status,'ERROR');
});
