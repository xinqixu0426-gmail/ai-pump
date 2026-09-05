'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {freezeHashes,dbSnapshot}=require('./run-ai-v5e4r-top2-evaluation.cjs');
const {selectSourceSpan}=require('../api/services/ai-v5/sourceSpanSelector.cjs');
const {createV5SourceSpanCatalog}=require('../api/services/ai-v5/sourceSpanCatalog.cjs');
const output=path.resolve(__dirname,'../docs/ai-governance/data/v5-e4r-top2-preflight.json');
async function main(){
    if(fs.existsSync(output))throw Error('CANARY_ALREADY_STARTED');
    const baseline=require('../docs/ai-governance/data/v5-e4r-candidate-set-two-stage-valid-evaluation.json').postEvalHashes;
    const hashes=freezeHashes();
    const allowed=new Set(['spanSelectorPrompt','api/services/ai-v5/sourceSpanSelector.cjs','api/services/ai-v5/sourceSpanSelectionContract.cjs','api/services/ai-v5/candidateSetTwoStageInterpreter.cjs','api/services/observability.cjs']);
    for(const [key,value]of Object.entries(baseline))if(!allowed.has(key))assert.equal(hashes[key],value,key);
    require('dotenv').config({quiet:true});
    const evidence={stage1Calls:1,freezeHashes:hashes,databaseBefore:dbSnapshot()};
    fs.writeFileSync(output,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
    try{
        const result=await selectSourceSpan('Identify synthetic token ALPHA-7.',createV5SourceSpanCatalog('Identify synthetic token ALPHA-7.'),{});
        evidence.stage1={status:result.status,selectedSpanCount:result.selection?.spanRefs.length||0,reasonCode:result.reasonCode||null,errorMetadata:result.errorMetadata||null};
        assert.equal(result.status,'VALID');assert.equal(result.selection.needsClarification,false);assert.equal(result.selection.spanRefs.length,2);
    } finally {
        evidence.databaseAfter=dbSnapshot();evidence.postHashes=freezeHashes();
        evidence.hashesMatch=JSON.stringify(evidence.freezeHashes)===JSON.stringify(evidence.postHashes);
        evidence.databaseUnchanged=JSON.stringify(evidence.databaseBefore)===JSON.stringify(evidence.databaseAfter);
        fs.writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');
        console.log(JSON.stringify({stage1:evidence.stage1,hashesMatch:evidence.hashesMatch,databaseUnchanged:evidence.databaseUnchanged}));
        assert.ok(evidence.hashesMatch&&evidence.databaseUnchanged);
    }
}
if(require.main===module)main().catch(()=>{console.error('TOP2_CANARY_BLOCKED');process.exitCode=1;});
