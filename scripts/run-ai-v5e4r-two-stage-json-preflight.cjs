'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {freezeHashes,dbSnapshot}=require('./run-ai-v5e4r-two-stage-evaluation.cjs');
const {selectSourceSpan}=require('../api/services/ai-v5/sourceSpanSelector.cjs');
const {selectLocalIntent}=require('../api/services/ai-v5/localIntentSelector.cjs');
const {createV5SourceSpanCatalog}=require('../api/services/ai-v5/sourceSpanCatalog.cjs');
const output=path.resolve(__dirname,'../docs/ai-governance/data/v5-e4r-two-stage-json-preflight.json');
async function main(){
    if(fs.existsSync(output))throw new Error('PREFLIGHT_ALREADY_STARTED');
    require('dotenv').config({quiet:true});
    const evidence={stage1Calls:0,stage2Calls:0,freezeHashes:freezeHashes(),databaseBefore:dbSnapshot()};
    fs.writeFileSync(output,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
    const safe=result=>({status:result.status,reasonCode:result.reasonCode||null,errorMetadata:result.errorMetadata||null});
    try{
        evidence.stage1Calls=1;
        evidence.stage1=safe(await selectSourceSpan('alpha',createV5SourceSpanCatalog('alpha'),{}));
        if(evidence.stage1.status!=='VALID')throw new Error('STAGE1_CANARY_FAILED');
        const catalog=[['tc_901','Return the count of characters.'],['tc_902','Return the characters in reverse order.']].map(([classRef,primaryMeaning])=>({classRef,semanticDescription:primaryMeaning,primaryMeaning,localAlternatives:[],entitySlots:[]}));
        evidence.stage2Calls=1;
        evidence.stage2=safe(await selectLocalIntent('Count the characters in the synthetic token.','sp_001',[],catalog,{}));
        if(evidence.stage2.status!=='VALID')throw new Error('STAGE2_CANARY_FAILED');
    }finally{
        evidence.databaseAfter=dbSnapshot();evidence.databaseUnchanged=JSON.stringify(evidence.databaseBefore)===JSON.stringify(evidence.databaseAfter);
        evidence.postHashes=freezeHashes();evidence.hashesMatch=JSON.stringify(evidence.freezeHashes)===JSON.stringify(evidence.postHashes);
        fs.writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');
        console.log(JSON.stringify({stage1:evidence.stage1,stage2:evidence.stage2,stage1Calls:evidence.stage1Calls,stage2Calls:evidence.stage2Calls,hashesMatch:evidence.hashesMatch,databaseUnchanged:evidence.databaseUnchanged}));
        assert.ok(evidence.hashesMatch&&evidence.databaseUnchanged);
    }
}
if(require.main===module)main().catch(()=>{console.error('PREFLIGHT_BLOCKED');process.exitCode=1;});
