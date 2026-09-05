'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {spawnSync,execFileSync}=require('node:child_process');
const {callStage,safeModelError}=require('../api/services/ai-v5/twoStageModel.cjs');
const {SPAN_SELECTOR_PROMPT,V5_SPAN_SELECTOR_PROMPT_VERSION,selectSourceSpan}=require('../api/services/ai-v5/sourceSpanSelector.cjs');
const {LOCAL_INTENT_PROMPT,V5_LOCAL_INTENT_PROMPT_VERSION}=require('../api/services/ai-v5/localIntentSelector.cjs');
const {createV5SourceSpanCatalog}=require('../api/services/ai-v5/sourceSpanCatalog.cjs');
const frozen=require('../docs/ai-governance/data/v5-e4r-candidate-set-two-stage-evaluation.json').preEvalHashes;
const prefix='Return the result as a valid JSON object. ';
for(const [label,prompt,version,key] of [['stage1',SPAN_SELECTOR_PROMPT,V5_SPAN_SELECTOR_PROMPT_VERSION,'spanSelectorPrompt'],['stage2',LOCAL_INTENT_PROMPT,V5_LOCAL_INTENT_PROMPT_VERSION,'localIntentPrompt']])test(`${label}: only JSON format prefix changes semantic body`,()=>{
    assert.ok(prompt.startsWith(prefix));
    if(label==='stage1') { assert.equal(version,2); assert.ok(prompt.includes('exactly two distinct')); }
    else { assert.equal(version,1.1);assert.equal(crypto.createHash('sha256').update(prompt.slice(prefix.length)).digest('hex'),frozen[key]); }
});
for(const [code,status,category] of [['AI_PROVIDER_REQUEST_ERROR',400,'MODEL_PROVIDER_REQUEST_ERROR'],['AI_PROVIDER_AUTH_ERROR',401,'MODEL_PROVIDER_AUTH_ERROR'],['AI_PROVIDER_TIMEOUT',408,'MODEL_PROVIDER_TIMEOUT'],['AI_PROVIDER_UPSTREAM_ERROR',503,'MODEL_PROVIDER_RESPONSE_ERROR']])test(`safe diagnostic ${code}`,async()=>{
    const result=await callStage([],{modelRequest:async()=>{throw Object.assign(new Error('SECRET raw prompt'),{name:'AiProviderHttpError',code,statusCode:status,retryable:false,cause:new TypeError('PRIVATE')});}});
    assert.equal(result.reasonCode,category);assert.equal(result.errorMetadata.internalCode,code);assert.equal(result.errorMetadata.httpStatus,status);assert.deepEqual(result.errorMetadata.causeCategories,['TypeError']);assert.ok(!/SECRET|PRIVATE|raw prompt/.test(JSON.stringify(result)));
});
test('untrusted codes and cause cycles never leak',()=>{
    const error=Object.assign(new Error('SENTINEL'),{code:'SECRET',name:'PRIVATE'});error.cause=error;
    const result=safeModelError(error);assert.equal(result.internalCode,'UNKNOWN');assert.ok(!/SECRET|PRIVATE|SENTINEL/.test(JSON.stringify(result)));assert.ok(result.causeCategories.length<=3);
});
test('protocol errors are distinct from provider failures',async()=>{
    const result=await selectSourceSpan('alpha',createV5SourceSpanCatalog('alpha'),{modelRequest:async()=>({content:'not json'})});assert.equal(result.status,'INVALID');assert.equal(result.reasonCode,'MODEL_PROTOCOL_ERROR');
});
for(const [name,record,hashMismatch,exit] of [
    ['complete success',{stage1Status:'VALID'},false,0],['semantic miss',{stage1Status:'INVALID'},false,0],
    ['fatal stage1',{stage1Status:'ERROR'},false,1],['fatal stage2',{stage2Status:'ERROR'},false,1],
    ['fatal lookup',{lookupStatus:'ERROR'},false,1],['frozen mismatch',{},true,1],
])test(`evaluator exit ${name}`,()=>{
    const modulePath=require.resolve('../scripts/lib/v5TwoStageEvaluationControl.cjs');
    const code=`const c=require(${JSON.stringify(modulePath)});async function main(){const d={};try{c.verifyHashes({},${hashMismatch?'{changed:true}':'{}'});if(c.isFatalRecord(${JSON.stringify(record)}))throw Error('fatal');}catch{d.fatalReason='fatal';}finally{d.saved=true;}c.enforceFatalExit(d);}main().catch(()=>{process.exitCode=1;});`;
    assert.equal(spawnSync(process.execPath,['-e',code]).status,exit);
});
test('forbidden frozen components unchanged',()=>{
    const fs=require('node:fs');
    for(const [file,hash] of Object.entries(frozen))if(/candidateSet\.cjs|localTaskClassCatalog|entityFinalization|entityLookup|typeIndependentEntityResolver|sourceSpanCatalog|sourceAnchoredEntity|taskClassCatalog|taskClassSemantics|capabilityRegistry|capabilityRouter|toolExposure|localIntentContract/.test(file))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),hash,file);
});
