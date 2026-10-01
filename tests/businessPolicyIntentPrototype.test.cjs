'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { contextProfiles } = require('../scripts/ai-experiments/business-policy-intent/contracts.cjs');
const { messagesForBusiness } = require('../scripts/ai-experiments/business-policy-intent/businessAgent.cjs');
const { messagesForPolicy } = require('../scripts/ai-experiments/business-policy-intent/policyAgent.cjs');
const { messagesForIntent } = require('../scripts/ai-experiments/business-policy-intent/intentAgent.cjs');
const { runPipeline } = require('../scripts/ai-experiments/business-policy-intent/pipeline.cjs');
const { evaluateMemo } = require('../scripts/ai-experiments/business-policy-intent/evaluatorR8.cjs');
const { CASES } = require('../scripts/ai-experiments/business-policy-intent/run-smoke.cjs');

function caseById(id) { return CASES.find(item => item.id === id); }
function output(intentMemo, overrides = {}) { return { businessMemo: '业务对象说明。', policyMemo: '业务规则说明。', intentMemo, ...overrides }; }

test('Business, Minimal Intent, and Policy prompts have the required isolated inputs', () => {
    const business = messagesForBusiness({ userInput: 'V750成本多少？', businessModel: 'BUSINESS_MODEL_ONLY', recentConversation: 'RECENT_FOR_BUSINESS' });
    const policy = messagesForPolicy({ userInput: 'V750成本多少？', domainPolicy: 'DOMAIN_POLICY_ONLY', recentConversation: 'RECENT_FOR_POLICY' });
    const intent = messagesForIntent({ userInput: 'V750成本多少？', recentConversation: 'RECENT_MUST_NOT_APPEAR', businessMemo: 'MEMO_MUST_NOT_APPEAR', domainPolicy: 'POLICY_MUST_NOT_APPEAR' });
    assert.match(business[0].content, /BUSINESS_MODEL_ONLY|RECENT_FOR_BUSINESS/);
    assert.match(policy[0].content, /DOMAIN_POLICY_ONLY|RECENT_FOR_POLICY/);
    assert.doesNotMatch(intent[0].content, /RECENT_MUST_NOT_APPEAR|MEMO_MUST_NOT_APPEAR|POLICY_MUST_NOT_APPEAR/);
    assert.deepEqual(contextProfiles().intent, { rawUserInputIncluded: true, recentUserWordingIncluded: false, businessMemoIncluded: false, policyMemoIncluded: false, rawCompanyBusinessModelIncluded: false, rawDomainPolicyIncluded: false, ontologyIncluded: false, toolsExposed: 0 });
});

test('pipeline starts the three agents in parallel and gives Intent only the current message', async () => {
    const started = [];
    const result = await runPipeline({ userInput: '当前原话', recentConversation: '上一轮不可见', businessModel: 'MODEL', domainPolicy: 'POLICY' }, {
        runBusinessAgent: async input => { started.push('business'); assert.equal(input.recentConversation, '上一轮不可见'); return 'Business'; },
        runPolicyAgent: async input => { started.push('policy'); assert.equal(input.recentConversation, '上一轮不可见'); return 'Policy'; },
        runIntentClerk: async input => { started.push('intent'); assert.deepEqual(input, { userInput: '当前原话' }); return '提到：当前原话（证据：“当前原话”）。明确变化：无。想知道：未表达。保存表达：未表达。'; },
    });
    assert.deepEqual(started.sort(), ['business', 'intent', 'policy']);
    assert.equal(result.intentMemo.includes('上一轮不可见'), false);
});

test('Minimal Intent prompt has four duties and removes clarification and reference resolution', () => {
    const source = fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'scripts/ai-experiments/business-policy-intent/intentAgent.cjs'), 'utf8');
    assert.match(source, /只看到当前 Owner 原话/);
    assert.match(source, /提到、明确变化、想知道、保存表达/);
    assert.doesNotMatch(source, /input\.recentConversation|最近用户原话：/);
});

test('R8 preserves four duties, multi-change, multi-goal, and explicit persistence', () => {
    const results = [
        evaluateMemo(caseById('CASE-06'), output('提到：V750、电缆5米、木箱（证据：“V750电缆5米，木箱”）。明确变化：电缆5米、木箱（证据：“电缆5米，木箱”）。想知道：先算一下（证据：“先算一下”）。保存表达：明确不保存（证据：“不保存”）。')),
        evaluateMemo(caseById('CASE-07'), output('提到：V750正式配方、包装、木箱（证据：“V750正式配方包装改成木箱”）。明确变化：包装改木箱（证据：“包装改成木箱”）。想知道：未表达。保存表达：明确保存（证据：“并保存”）。')),
        evaluateMemo(caseById('CASE-14'), output('提到：V750、线圈（证据：“V750成本，还有它现在用哪个线圈”）。明确变化：无。想知道：成本、当前使用哪个线圈（证据：“成本”“现在用哪个线圈”）。保存表达：未表达。')),
    ];
    for (const result of results) assert.equal(result.overall, 'PASS');
});

test('R8 rejects invented sources, identity reasoning, and scope leakage', () => {
    const invented = evaluateMemo(caseById('CASE-04'), output('提到：V750（证据：“V750”）。明确变化：从纸箱改木箱（证据：“包装改木箱”）。想知道：未表达。保存表达：未表达。'));
    const identity = evaluateMemo(caseById('CASE-02'), output('提到：12-120（证据：“12-120”）。明确变化：无。想知道：多少钱（证据：“多少钱”）。保存表达：未表达。需要澄清正式身份。'));
    const baseline = evaluateMemo(caseById('CASE-05'), output('提到：V750、不锈钢接轴（证据：“V750如果做不锈钢接轴”）。明确变化：做不锈钢接轴（证据：“做不锈钢接轴”）。想知道：成本差多少（证据：“成本差多少”）。保存表达：未表达。比较基准缺失。'));
    assert.ok(invented.intentFailures.includes('UNSUPPORTED_INTENT_INFERENCE'));
    assert.ok(identity.intentFailures.includes('INTENT_SCOPE_LEAK'));
    assert.ok(baseline.intentFailures.includes('INTENT_SCOPE_LEAK'));
});

test('R8 treats literal references and absent targets as records, not clarification decisions', () => {
    const literalReference = evaluateMemo(caseById('CASE-15'), output('提到：刚才那个线圈（证据：“刚才那个线圈”）。明确变化：无。想知道：多少钱（证据：“多少钱”）。保存表达：未表达。'));
    const incompleteChange = evaluateMemo(caseById('CASE-16'), output('提到：V750（证据：“V750”）。明确变化：改一下，但未表达具体修改内容（证据：“改一下”）。想知道：未表达。保存表达：未表达。'));
    const noTarget = evaluateMemo(caseById('CASE-19'), output('提到：没有明确对象。明确变化：无。想知道：贵多少（证据：“贵多少”）。保存表达：未表达。'));
    const unknownReference = evaluateMemo(caseById('CASE-20'), output('提到：这个、木箱（证据：“这个换木箱”）。明确变化：换木箱（证据：“换木箱”）。想知道：多少钱（证据：“多少钱”）。保存表达：未表达。'));
    for (const result of [literalReference, incompleteChange, noTarget, unknownReference]) assert.equal(result.overall, 'PASS');
});

test('R8 accepts literal do-not-save but does not let a mention replace a required change', () => {
    const noSave = evaluateMemo(caseById('CASE-06'), output('提到：V750、电缆5米、木箱（证据：“V750电缆5米，木箱”）。明确变化：电缆5米、木箱（证据：“电缆5米，木箱”）。想知道：先算一下（证据：“先算一下”）。保存表达：不保存（证据：“不保存”）。'));
    const omittedChange = evaluateMemo(caseById('CASE-06'), output('提到：V750、电缆5米、木箱（证据：“V750电缆5米，木箱”）。明确变化：无。想知道：先算一下（证据：“先算一下”）。保存表达：不保存（证据：“不保存”）。'));
    assert.equal(noSave.overall, 'PASS');
    assert.ok(omittedChange.intentFailures.includes('EXPLICIT_CHANGE_OMITTED'));
});

test('R8 uses only current-message evidence and has no clarification oracle', () => {
    const recovered = evaluateMemo(caseById('CASE-15'), output('提到：刚才那个线圈，也就是12-120（证据：“12-120”）。明确变化：无。想知道：多少钱（证据：“多少钱”）。保存表达：未表达。'));
    assert.ok(recovered.intentFailures.includes('UNSUPPORTED_INTENT_INFERENCE'));
    const runner = fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'scripts/ai-experiments/business-policy-intent/run-smoke.cjs'), 'utf8');
    assert.doesNotMatch(runner, /clarificationExpectation|clarificationReason|needsClarification/);
});

test('prototype has no Ontology imports or production-runtime imports', () => {
    const root = path.resolve(__dirname, '..');
    for (const relativePath of ['api/services/ai-assistant/runtime.cjs', 'api/services/ai-assistant/judge.cjs', 'api/services/ai-assistant/mainAgent.cjs', 'api/services/ai-assistant/capabilityBroker.cjs']) {
        assert.doesNotMatch(fs.readFileSync(path.join(root, relativePath), 'utf8'), /business-policy-intent/);
    }
    const prototype = path.join(root, 'scripts/ai-experiments/business-policy-intent');
    for (const file of fs.readdirSync(prototype)) assert.doesNotMatch(fs.readFileSync(path.join(prototype, file), 'utf8'), /require\([^)]*ontology|api\/ontology/i);
});
