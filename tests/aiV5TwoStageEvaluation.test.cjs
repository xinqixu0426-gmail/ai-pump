'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {freezeHashes,summarize}=require('../scripts/run-ai-v5e4r-two-stage-evaluation.cjs');
test('V3 freeze includes both protocols, authority and frozen expectations',()=>{
    const value=freezeHashes();assert.deepEqual(value,freezeHashes());
    for(const file of ['sourceSpanSelectionContract','localIntentContract','candidateSet','entityFinalization','typeIndependentEntityResolver','sourceAnchoredEntity','capabilityRouter'])assert.ok(value[`api/services/ai-v5/${file}.cjs`]);
    assert.ok(value.frozenCorpus);assert.ok(value.frozenExpected);
});
test('V3 metrics keep Stage 2 denominator separate from singleton paths',()=>{
    const rows=[{case_id:'synthetic-1',source_group_id:'s',inputFingerprint:'f',stage1Calls:1,stage2Calls:0,businessApiCalls:1,localClassCount:1,taskClassMatch:true,stage1Status:'VALID',localSelectionMode:'DETERMINISTIC_SELECT'},
        {case_id:'synthetic-2',source_group_id:'s2',inputFingerprint:'f2',stage1Calls:1,stage2Calls:1,businessApiCalls:1,localClassCount:2,taskClassMatch:false,stage1Status:'VALID',stage2Status:'VALID',localSelectionMode:'MODEL_SELECT'}];
    const result=summarize(rows);assert.equal(result.localIntentAccuracy.total,1);assert.equal(result.localIntentAccuracy.correct,0);
    assert.equal(result.taskClassMatch.total,2);assert.equal(result.singleton,1);assert.equal(result.totalModelCalls,3);
});
