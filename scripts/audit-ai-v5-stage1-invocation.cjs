'use strict';
// Audit only: never runs a frozen case, lookup, Tool, or evaluator main().
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs/ai-governance/data/v5-e4r-stage1-invocation-failure-audit.json');
const { freezeHashes, dbSnapshot } = require('./run-ai-v5e4r-two-stage-evaluation.cjs');
const original = require('../docs/ai-governance/data/v5-e4r-candidate-set-two-stage-evaluation.json');
const { selectSourceSpan, SPAN_SELECTOR_PROMPT } = require('../api/services/ai-v5/sourceSpanSelector.cjs');
const { createV5SourceSpanCatalog, sourceSpanModelView } = require('../api/services/ai-v5/sourceSpanCatalog.cjs');
const { requestConfiguredInterpreterModel, V5_TASK_INTERPRETER_INSTRUCTION } = require('../api/services/ai-v5/taskInterpreter.cjs');
function safeError(e) {
  return { errorClass: ['AiProviderHttpError','AiProviderNetworkError','AiProviderTimeoutError','TypeError','Error'].includes(e?.name) ? e.name : 'OTHER',
    code: /^AI_PROVIDER_[A-Z_]+$/.test(e?.code || '') ? e.code : 'OTHER',
    httpStatus: Number.isInteger(e?.statusCode) ? e.statusCode : null, retryable: e?.retryable === true, causePresent: !!e?.cause };
}
async function main() {
  if (fs.existsSync(output)) throw new Error('AUDIT_CANARY_ALREADY_RECORDED');
  assert.deepEqual(freezeHashes(), original.preEvalHashes);
  const before = dbSnapshot();
  require('dotenv').config({quiet:true});
  const nativeFetch = global.fetch;
  const evidence = { failedCaseId: original.paths[0].case_id, syntheticCalls: 0, canaryB: 'NOT_RUN', wire: null, underlying: null };
  // Source is arbitrary non-business lexical material; never a corpus fixture.
  const source = 'alpha';
  const catalog = createV5SourceSpanCatalog(source);
  fs.writeFileSync(output, JSON.stringify({status:'STARTED',syntheticCallBudget:1}), {flag:'wx'});
  global.fetch = async (url, init) => {
    assert.equal(++evidence.syntheticCalls, 1);
    const body = JSON.parse(init.body);
    evidence.wire = { provider:'deepseek', model:body.model, endpointHost:new URL(url).hostname,
      endpointPath:new URL(url).pathname, temperature:body.temperature, topP:'top_p' in body ? 'PRESENT' : 'OMITTED',
      responseFormat:body.response_format, maxTokens:body.max_tokens, roles:body.messages.map(m=>m.role),
      stringContents:body.messages.every(m=>typeof m.content==='string'), toolsPresent:'tools' in body,
      stream:body.stream, thinking:body.thinking, signalPresent:!!init.signal,
      messageHasJsonToken:body.messages.some(m=>/json/i.test(m.content)), historicalInstructionHasJsonToken:/json/i.test(V5_TASK_INTERPRETER_INSTRUCTION) };
    const response = await nativeFetch(url, init);
    evidence.httpStatus = response.status;
    if (!response.ok) {
      const raw = await response.clone().json().catch(()=>null);
      const message = String(raw?.error?.message || '');
      // Never retain provider free text. Only an audited semantic reason category.
      evidence.providerReason = /json/i.test(message) && /messages/i.test(message) && /contain/i.test(message)
        ? 'JSON_MODE_REQUIRES_JSON_TOKEN_IN_MESSAGES' : 'UNCLASSIFIED_PROVIDER_REJECTION';
      evidence.providerErrorType = raw?.error?.type === 'invalid_request_error' ? 'invalid_request_error' : 'OTHER';
    }
    return response;
  };
  try {
    const result = await selectSourceSpan(source, catalog, { modelRequest:async (messages, options) => {
      try { return await requestConfiguredInterpreterModel(messages, options); }
      catch(e) { evidence.underlying = safeError(e); throw e; }
    }});
    evidence.canaryA = result.status === 'VALID' ? 'PASS' : 'FAIL';
    evidence.canaryStatus = result.status;
    evidence.wrapperPreservedCode = Object.hasOwn(result,'code');
    evidence.wrapperPreservedCause = Object.hasOwn(result,'cause');
  } finally {
    global.fetch = nativeFetch;
    evidence.hashesUnchanged = JSON.stringify(freezeHashes()) === JSON.stringify(original.preEvalHashes);
    evidence.databaseBefore = before;
    evidence.databaseAfter = dbSnapshot();
    evidence.databaseUnchanged = JSON.stringify(before) === JSON.stringify(evidence.databaseAfter);
    // Execute the exact catch clause extracted from frozen evaluator, without its main().
    const runner = fs.readFileSync(path.join(root,'scripts/run-ai-v5e4r-two-stage-evaluation.cjs'),'utf8');
    const clause = runner.match(/catch\(error\) \{ dataset\.fatalReason=error\.message; \}/)?.[0];
    assert.ok(clause);
    const child = spawnSync(process.execPath, ['-e', `async function main(){const dataset={};try{throw new Error('FORMAL_EVALUATION_INFRASTRUCTURE_FATAL');}${clause};console.log(JSON.stringify(dataset));}main().catch(()=>{process.exitCode=1;});`], {encoding:'utf8'});
    evidence.fatalControlFlowReproduction = {exitCode:child.status,fatalRecorded:child.stdout.includes('FORMAL_EVALUATION_INFRASTRUCTURE_FATAL')};
    fs.writeFileSync(output, JSON.stringify(evidence,null,2)+'\n');
  }
  console.log(JSON.stringify(evidence));
}
async function canaryB() {
  const evidence = JSON.parse(fs.readFileSync(output,'utf8'));
  assert.equal(evidence.syntheticCalls,1); assert.equal(evidence.canaryB,'NOT_RUN');
  assert.deepEqual(freezeHashes(),original.preEvalHashes);
  evidence.canaryB='STARTED'; fs.writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');
  require('dotenv').config({quiet:true});
  const env={...process.env,AI_PROVIDER:'deepseek',DEEPSEEK_MODEL:'deepseek-v4-flash'};
  const source='alpha', catalog=createV5SourceSpanCatalog(source);
  const messages=[{role:'system',content:SPAN_SELECTOR_PROMPT},{role:'user',content:JSON.stringify({request:source,spans:sourceSpanModelView(catalog)})}];
  let calls=0;
  try {
    await requestConfiguredInterpreterModel(messages,{env,timeoutMs:20000,signal:new AbortController().signal,fetchImpl:async(url,init)=>{
      assert.equal(++calls,1); evidence.syntheticCalls++;
      const response=await fetch(url,init);
      if(!response.ok){
        const raw=await response.clone().json().catch(()=>null), message=String(raw?.error?.message||'');
        evidence.canaryBReasonFeatures={json:/json/i.test(message),prompt:/prompt/i.test(message),messages:/messages/i.test(message),contain:/contain/i.test(message),word:/word/i.test(message),required:/must|require/i.test(message)};
        evidence.canaryBProviderReason=/json/i.test(message)&&/prompt|messages/i.test(message)&&/contain|must|require/i.test(message)?'JSON_MODE_REQUIRES_JSON_TOKEN_IN_MESSAGES':'UNCLASSIFIED_PROVIDER_REJECTION';
      }
      return response;
    }});
    evidence.canaryB='PASS';
  } catch(e){evidence.canaryB='FAIL';evidence.canaryBUnderlying=safeError(e);}
  evidence.databaseAfter=dbSnapshot();evidence.databaseUnchanged=JSON.stringify(evidence.databaseBefore)===JSON.stringify(evidence.databaseAfter);
  evidence.hashesUnchanged=JSON.stringify(freezeHashes())===JSON.stringify(original.preEvalHashes);
  fs.writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}
if (require.main===module) (process.argv.includes('--canary-b')?canaryB():main()).catch(()=>{console.error('AUDIT_FAILED_SAFE');process.exitCode=1;});
