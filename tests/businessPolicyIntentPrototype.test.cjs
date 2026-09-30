'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { contextProfiles, validateIntentResult } = require('../scripts/ai-experiments/business-policy-intent/contracts.cjs');
const { messagesForBusiness } = require('../scripts/ai-experiments/business-policy-intent/businessAgent.cjs');
const { messagesForPolicy } = require('../scripts/ai-experiments/business-policy-intent/policyAgent.cjs');
const { messagesForIntent } = require('../scripts/ai-experiments/business-policy-intent/intentAgent.cjs');
const { runPipeline } = require('../scripts/ai-experiments/business-policy-intent/pipeline.cjs');
const { evaluateCase } = require('../scripts/ai-experiments/business-policy-intent/evaluatorR2.cjs');
const { CASES } = require('../scripts/ai-experiments/business-policy-intent/run-smoke.cjs');

function caseById(id) { return CASES.find(item => item.id === id); }
function intent(overrides = {}) {
    return validateIntentResult({ objectMentions: [], requestedChanges: [], requestedInformation: [], persistence: 'NOT_APPLICABLE', needsClarification: false, clarificationReason: null, ...overrides });
}
function output(value) { return { businessMemo: '业务说明。', policyMemo: '规则说明。', intent: value }; }

test('business, policy and intent prompts isolate their source documents', () => {
    const business = messagesForBusiness({ userInput: 'V750成本多少？', businessModel: 'BUSINESS_MODEL_ONLY' });
    const policy = messagesForPolicy({ userInput: 'V750成本多少？', domainPolicy: 'DOMAIN_POLICY_ONLY' });
    const intentMessages = messagesForIntent({ userInput: 'V750成本多少？', businessMemo: 'BUSINESS_MEMO_ONLY', policyMemo: 'POLICY_MEMO_ONLY' });
    assert.match(business[0].content, /BUSINESS_MODEL_ONLY/);
    assert.doesNotMatch(business[0].content, /DOMAIN_POLICY_ONLY/);
    assert.match(policy[0].content, /DOMAIN_POLICY_ONLY/);
    assert.doesNotMatch(policy[0].content, /BUSINESS_MODEL_ONLY/);
    assert.match(intentMessages[0].content, /BUSINESS_MEMO_ONLY.*POLICY_MEMO_ONLY/s);
    assert.doesNotMatch(intentMessages[0].content, /BUSINESS_MODEL_ONLY|DOMAIN_POLICY_ONLY/);
    assert.deepEqual(contextProfiles().intent, { rawUserInputIncluded: true, businessMemoIncluded: true, policyMemoIncluded: true, rawCompanyBusinessModelIncluded: false, rawDomainPolicyIncluded: false, ontologyIncluded: false, toolsExposed: 0 });
});
test('pipeline starts Business and Policy calls before waiting for Intent', async () => {
    const started = [];
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    const pipeline = runPipeline({ userInput: '测试', businessModel: 'MODEL', domainPolicy: 'POLICY' }, {
        runBusinessAgent: async () => { started.push('business'); await barrier; return 'Business memo'; },
        runPolicyAgent: async () => { started.push('policy'); await barrier; return 'Policy memo'; },
        runIntentAgent: async ({ businessMemo, policyMemo }) => {
            assert.deepEqual(started.sort(), ['business', 'policy']);
            assert.equal(businessMemo, 'Business memo');
            assert.equal(policyMemo, 'Policy memo');
            return intent();
        },
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(started.sort(), ['business', 'policy']);
    release();
    await pipeline;
});
test('Evaluator R2 rejects fabricated evidence and invented source values', () => {
    const assessment = evaluateCase(caseById('BP-03'), output(intent({
        objectMentions: ['V750'], persistence: 'UNSPECIFIED',
        requestedChanges: [{ subject: '包装', from: '泡沫箱', to: '木箱', delta: null, evidence: '纸箱换成木箱' }],
        requestedInformation: [{ value: '成本差额', evidence: '差多少钱' }],
    })));
    assert.equal(assessment.evaluator, 'FAIL');
    assert.ok(assessment.deterministicFailures.includes('INVENTED_CHANGE_FROM'));
});
test('Evaluator R2 retains explicit SAVE, DO_NOT_SAVE, unspecified, multi-change and multi-goal signals', () => {
    const save = evaluateCase(caseById('BP-06'), output(intent({ objectMentions: ['V750'], persistence: 'SAVE', requestedChanges: [{ subject: '包装', from: null, to: '木箱', delta: null, evidence: '包装改成木箱' }] })));
    const noSave = evaluateCase(caseById('BP-05'), output(intent({ objectMentions: ['V750'], persistence: 'DO_NOT_SAVE', requestedChanges: [
        { subject: '电缆', from: null, to: '5米', delta: null, evidence: '电缆5米' },
        { subject: '包装', from: null, to: '木箱', delta: null, evidence: '木箱' },
    ], requestedInformation: [{ value: '成本试算', evidence: '先算一下' }] })));
    const unspecified = evaluateCase(caseById('BP-07'), output(intent({ objectMentions: ['V750'], persistence: 'UNSPECIFIED', requestedChanges: [{ subject: '包装', from: null, to: '木箱', delta: null, evidence: '包装改木箱' }] })));
    const multiGoal = evaluateCase(caseById('BP-14'), output(intent({ objectMentions: ['V750'], persistence: 'NOT_APPLICABLE', requestedInformation: [
        { value: '成本', evidence: '成本' }, { value: '当前线圈', evidence: '线圈' },
    ] })));
    assert.equal(save.evaluator, 'PASS');
    assert.equal(noSave.evaluator, 'PASS');
    assert.equal(unspecified.evaluator, 'PASS');
    assert.equal(multiGoal.evaluator, 'PASS');
});
test('Evaluator R2 asks for review when wording is semantically plausible but outside its small case oracle', () => {
    const assessment = evaluateCase(caseById('BP-03'), output(intent({ objectMentions: ['V750'], persistence: 'UNSPECIFIED', requestedChanges: [{ subject: '包装配置', from: '纸箱', to: '木箱', delta: null, evidence: '纸箱换成木箱' }], requestedInformation: [{ value: '费用波动', evidence: '差多少钱' }] })));
    assert.equal(assessment.evaluator, 'REVIEW_REQUIRED');
    assert.equal(assessment.intent, 'PARTIAL');
});
test('prototype does not use Ontology and production modules do not import it', () => {
    const root = path.resolve(__dirname, '..');
    const productionEntrypoints = ['api/services/ai-assistant/runtime.cjs', 'api/services/ai-assistant/judge.cjs', 'api/services/ai-assistant/mainAgent.cjs', 'api/services/ai-assistant/capabilityBroker.cjs'];
    for (const relativePath of productionEntrypoints) assert.doesNotMatch(fs.readFileSync(path.join(root, relativePath), 'utf8'), /business-policy-intent/);
    const prototypeSource = fs.readFileSync(path.join(root, 'scripts/ai-experiments/business-policy-intent/run-smoke.cjs'), 'utf8');
    assert.doesNotMatch(prototypeSource, /require\([^)]*ontology|api\/ontology/i);
});
