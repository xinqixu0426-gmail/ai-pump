'use strict';
const fs=require('node:fs');
async function main(){
    const output='docs/ai-governance/data/p16lr2-target-audit.json';if(fs.existsSync(output))throw Error('AUDIT_ALREADY_EXISTS');
    const env={...require('dotenv').parse(fs.readFileSync('.env'))};
    const emit=console.log.bind(console);for(const k of ['log','warn','error','info','debug'])console[k]=()=>{};
    const {selectCollectionIntent}=require('../api/services/ai-v5/collectionIntent.cjs');
    const {requestConfiguredInterpreterModel}=require('../api/services/ai-v5/taskInterpreter.cjs');
    const cases=require('./certify-v5-collections.cjs').cases().filter(c=>['L-08','L-14','L-19','L-24','L-29','L-09'].includes(c.id));
    const data={stage:'P16-L-R2',kind:'PRE_IMPLEMENTATION_DIAGNOSTIC',retries:0,toolCalls:0,cases:[]};
    fs.writeFileSync(output,JSON.stringify(data,null,2),{flag:'wx'});
    for(const c of cases){let wire=null,result=null,error=null;
        try{result=await selectCollectionIntent(c.question,null,{env,modelRequest:async(m,o)=>{
            const r=await requestConfiguredInterpreterModel(m,o);wire=JSON.parse(r.content);return r;
        }});}catch{error='COLLECTION_INTENT_INVALID';}
        const expected=c.id==='L-09'?'不存在':({orders:'ORD-63',customers:'客户-63',parts:'零件-63',recipes:'配方-63',coils:'线圈-63'})[c.resource];
        const span=c.id==='L-09'?wire?.customerSpan:wire?.identitySpan;
        const safe={case_id:c.id,parseValid:!error,expectedStart:c.question.indexOf(expected),expectedLength:expected.length,
            selectedStart:Number.isInteger(span?.start)?span.start:null,selectedEnd:Number.isInteger(span?.end)?span.end:null,
            exactTargetMatch:(c.id==='L-09'?result?.customerName:result?.identity)===expected,error};
        data.cases.push(safe);fs.writeFileSync(output,JSON.stringify(data,null,2));emit(safe);
    }
}
if(require.main===module)main().catch(()=>{process.stdout.write('TARGET_AUDIT_FAILED\n');process.exitCode=1;});
