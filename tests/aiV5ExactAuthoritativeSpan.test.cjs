'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createV5SourceSpanCatalog}=require('../api/services/ai-v5/sourceSpanCatalog.cjs');
const {selectExactAuthoritativeSpan}=require('../api/services/ai-v5/exactAuthoritativeSpan.cjs');
const {interpretCandidateSetTask}=require('../api/services/ai-v5/candidateSetTwoStageInterpreter.cjs');
const {createV5InterpreterInputEnvelope}=require('../api/services/ai-v5/taskInterpreterInput.cjs');
const source='Alpha-ID and Beta-ID';
const candidate=(start,end,identityKind='schemeName')=>({start,end,entityType:'coil',identityKind});
const supply=candidates=>({version:1,status:'OK',complete:true,identityScanCount:4,candidateCount:candidates.length,candidates});
const decide=candidates=>selectExactAuthoritativeSpan(source,createV5SourceSpanCatalog(source),supply(candidates));
test('only governed exact coil spans qualify; identical compatible occurrences dedupe, distinct do not',()=>{
    assert.equal(decide([]).status,'NO_AUTHORITATIVE_SPAN');
    assert.equal(decide([candidate(0,8)]).span.text,'Alpha-ID');
    assert.equal(decide([candidate(0,8),candidate(0,8,'schemeCode')]).candidateCount,1);
    assert.equal(decide([candidate(0,8),candidate(13,20)]).status,'AUTHORITATIVE_SPAN_AMBIGUOUS');
    for(const bad of [{...candidate(0,8),entityType:'part'},candidate(-1,8),candidate(0,99),candidate(0,8,'description'),{...candidate(0,8),canonicalId:'private'}]) assert.equal(decide([bad]).status,'SPAN_SUPPLY_INVALID');
});
const envelope=()=>createV5InterpreterInputEnvelope({rawUserRequest:source,pageContext:null});
test('multiple authority spans stop before model and lookup',async()=>{
    let calls=0;
    const out=await interpretCandidateSetTask(envelope(),{supplySpanCandidates:async()=>supply([candidate(0,8),candidate(13,20)]),modelRequest:async()=>{calls++;},lookupEntities:async()=>{calls++;}});
    assert.equal(out.reasonCode,'AUTHORITATIVE_SPAN_AMBIGUOUS');assert.equal(out.modelCalls,0);assert.equal(calls,0);
});
test('zero candidates preserve existing Stage1 byte-for-byte model input',async()=>{
    const seen=[];
    for(const extra of [{},{supplySpanCandidates:async()=>supply([])}]) {
        let count=0;
        const out=await interpretCandidateSetTask(envelope(),{...extra,modelRequest:async messages=>{count++;seen.push(messages);return {content:'invalid'};}});
        assert.equal(count,1);assert.equal(out.architectureMetadata.exactAuthoritativeFastPath,false);
    }
    assert.deepEqual(seen[0],seen[1]);
});
test('unique source span still requires lookup; notfound/error never trigger refinement or Stage2',async()=>{
    for(const error of [false,true]) {
        let lookups=0,models=0;
        const out=await interpretCandidateSetTask(envelope(),{supplySpanCandidates:async()=>supply([candidate(0,8)]),modelRequest:async()=>{models++;},lookupEntities:async(_f,p)=>{
            lookups++;assert.equal(p.mention,'Alpha-ID');if(error)throw Error('private');
            return {version:1,status:'OK',complete:true,attemptedEntityTypes:6,candidateCount:0,candidates:[]};
        }});
        assert.equal(out.status,'INVALID');assert.equal(lookups,1);assert.equal(models,0);assert.equal(out.architectureMetadata.refinementTriggered,false);
        assert.equal(out.architectureMetadata.lookupStatus,error?'ERROR':'NOT_FOUND');
    }
});
test('duplicate business identities are not deduped by the source fast path',async()=>{
    const out=await interpretCandidateSetTask(envelope(),{supplySpanCandidates:async()=>supply([candidate(0,8)]),
        modelRequest:async()=>({content:JSON.stringify({version:1,localTaskClassRef:'tc_004'})}),
        lookupEntities:async()=>({version:1,status:'OK',complete:true,attemptedEntityTypes:6,candidateCount:2,candidates:['a','b'].map(canonicalId=>({entityType:'coil',canonicalId,matchKind:'EXACT'}))})});
    assert.equal(out.status,'INVALID');assert.equal(out.architectureMetadata.lookupStatus,'AMBIGUOUS');assert.equal(out.architectureMetadata.candidateCount,2);
    assert.equal(out.architectureMetadata.stage1Calls,0);assert.equal(out.architectureMetadata.finalEntityStatus,'FINAL_ENTITY_AMBIGUOUS');
});
test('bounded deterministic selection overhead',()=>{
    const cat=createV5SourceSpanCatalog(source),s=supply([candidate(0,8)]),times=[];
    for(let i=0;i<1100;i++){const start=performance.now();assert.equal(selectExactAuthoritativeSpan(source,cat,s).status,'EXACT_AUTHORITATIVE_SPAN');if(i>=100)times.push(performance.now()-start);}
    times.sort((a,b)=>a-b);console.log(JSON.stringify({metric:'exactSelectionSyntheticMs',measured:1000,median:times[499],p95:times[949]}));
});
test('Candidate risk precedes supply; multiple exact spans expose no answer or Tool',async()=>{
    const {runCandidateRead}=require('../api/services/ai-v5/candidateRead.cjs');
    const env={PUMP_V5_CANDIDATE_RUNTIME:'true',AI_V5_READ_CANARY_ENABLED:'true',AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED:'true'};
    for(const mode of ['query','command']) {
        let supplies=0,models=0,tools=0,answers=0,exposures=0,lookups=0;
        const out=await runCandidateRead({previewOptIn:true,internalAuthorized:true,sourceRequest:source,deliver:()=>{exposures++;return true;}},{env,
            riskOptions:{request:async()=>({goal:'synthetic',mode,domains:['coil'],needsBusinessData:true,contextMode:'current_turn',answerShape:'direct',entityScope:'single',requiresClarification:false,ambiguities:[],confidence:'high'})},
            supplySpanCandidates:async()=>{supplies++;return supply([candidate(0,8),candidate(13,20)]);},
            interpreterModelRequest:async()=>{models++;},lookupEntities:async()=>{lookups++;},
            executionOptions:{execute:async()=>{tools++;}},answerOptions:{modelRequest:async()=>{answers++;}}});
        assert.equal(supplies,mode==='query'?1:0);assert.equal(models,0);assert.equal(lookups,0);assert.equal(tools,0);assert.equal(answers,0);assert.equal(exposures,0);
        assert.equal(out.eligible,false);assert.equal(out.delivered,false);
    }
});
