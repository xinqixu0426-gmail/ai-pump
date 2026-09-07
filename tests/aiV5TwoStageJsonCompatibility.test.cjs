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
    // P16-A2 explicitly approves the additive authority reference and its strict reader.
    // Keep exact pins rather than removing either component from freeze protection.
    const approved = {
        // P16-M: additive closed READ relation capability; frozen entity capabilities are unchanged.
        'api/services/ai-v5/capabilityRegistry.cjs': 'c7ddcf34f048c4166848914dd0426402c637638298ac7c14f223bc308dfa84fa',
        // P16-I-R8: bounded authoritative span merge, original structural generation retained.
        'api/services/ai-v5/sourceSpanCatalog.cjs': 'd3407426ad4fdc77b2dab966ef8566db5b61212ecf82e4f1def020d75a13c85f',
        // P16-I-R4 authorized only the part quantity/price semantic split.
        'api/services/ai-v5/taskClassCatalog.cjs': 'ccf1649bbec0b0504eec01b661af4492b05d0e13c732cc70e207d85f7a644dc8',
        'api/services/ai-v5/taskClassSemantics.cjs': '1f45f5d68222f6169b926150dadb9ebcc591f1f4373e97c453d418ebd4bb887f',
        'api/services/entityLookupService.cjs': '46ea401bd05e8aa5da61e6440b43f373bce12958f6cdcbfa9f619ac93a443d72',
        'api/services/ai-v5/typeIndependentEntityResolver.cjs': '8223782e35ea827999b507275c480ee792d796cba540299c0c6eaf5cfb811f58',
    };
    for(const [file,hash] of Object.entries(frozen))if(/candidateSet\.cjs|localTaskClassCatalog|entityFinalization|entityLookup|typeIndependentEntityResolver|sourceSpanCatalog|sourceAnchoredEntity|taskClassCatalog|taskClassSemantics|capabilityRegistry|capabilityRouter|toolExposure|localIntentContract/.test(file))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),approved[file] || hash,file);
});
