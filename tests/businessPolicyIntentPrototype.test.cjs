'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { contextProfiles } = require('../scripts/ai-experiments/business-policy-intent/contracts.cjs');
const { messagesForBusiness } = require('../scripts/ai-experiments/business-policy-intent/businessAgent.cjs');
const { messagesForPolicy } = require('../scripts/ai-experiments/business-policy-intent/policyAgent.cjs');
const { messagesForUtteranceExtractor } = require('../scripts/ai-experiments/business-policy-intent/intentAgent.cjs');
const { runPipeline } = require('../scripts/ai-experiments/business-policy-intent/pipeline.cjs');
const { evaluateMemo } = require('../scripts/ai-experiments/business-policy-intent/evaluatorR9.cjs');
const { CASES } = require('../scripts/ai-experiments/business-policy-intent/run-smoke.cjs');

function caseById(id) { return CASES.find(item => item.id === id); }
function output(utteranceMemo, overrides = {}) { return { businessMemo: '业务对象说明。', policyMemo: '业务规则说明。', utteranceMemo, ...overrides }; }

test('Business, Utterance Extractor, and Policy prompts have their fully isolated inputs', () => {
    const business = messagesForBusiness({ userInput: 'V750成本多少？', businessModel: 'BUSINESS_MODEL_ONLY', recentConversation: 'RECENT_FOR_BUSINESS' });
    const policy = messagesForPolicy({ userInput: 'V750成本多少？', domainPolicy: 'DOMAIN_POLICY_ONLY', recentConversation: 'RECENT_FOR_POLICY' });
    const utterance = messagesForUtteranceExtractor({ userInput: 'V750成本多少？', recentConversation: 'RECENT_MUST_NOT_APPEAR', businessMemo: 'MEMO_MUST_NOT_APPEAR', domainPolicy: 'POLICY_MUST_NOT_APPEAR' });
    assert.match(business[0].content, /BUSINESS_MODEL_ONLY|RECENT_FOR_BUSINESS/);
    assert.match(policy[0].content, /DOMAIN_POLICY_ONLY|RECENT_FOR_POLICY/);
    assert.doesNotMatch(utterance[0].content, /RECENT_MUST_NOT_APPEAR|MEMO_MUST_NOT_APPEAR|POLICY_MUST_NOT_APPEAR/);
    assert.deepEqual(contextProfiles().utterance, { rawUserInputIncluded: true, recentUserWordingIncluded: false, businessMemoIncluded: false, policyMemoIncluded: false, rawCompanyBusinessModelIncluded: false, rawDomainPolicyIncluded: false, ontologyIncluded: false, toolsExposed: 0 });
});

test('pipeline starts the three agents in parallel and gives Utterance Extractor only the current message', async () => {
    const started = [];
    const result = await runPipeline({ userInput: '当前原话', recentConversation: '上一轮不可见', businessModel: 'MODEL', domainPolicy: 'POLICY' }, {
        runBusinessAgent: async input => { started.push('business'); assert.equal(input.recentConversation, '上一轮不可见'); return 'Business'; },
        runPolicyAgent: async input => { started.push('policy'); assert.equal(input.recentConversation, '上一轮不可见'); return 'Policy'; },
        runUtteranceExtractor: async input => { started.push('utterance'); assert.deepEqual(input, { userInput: '当前原话' }); return '提到：当前原话（证据：“当前原话”）。条件/描述：无。想知道：未表达。保存表达：未表达。'; },
    });
    assert.deepEqual(started.sort(), ['business', 'policy', 'utterance']);
    assert.equal(result.utteranceMemo.includes('上一轮不可见'), false);
    assert.equal('intentMemo' in result, false);
});

test('Utterance Extractor has exactly four duties and no context-resolution input', () => {
    const source = fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'scripts/ai-experiments/business-policy-intent/intentAgent.cjs'), 'utf8');
    assert.match(source, /只看到当前 Owner 原话/);
    assert.match(source, /提到、条件\/描述、想知道、保存表达/);
    assert.doesNotMatch(source, /input\.recentConversation|最近用户原话：|明确变化/);
});

test('R9 preserves conditions, multi-condition descriptions, multi-goals, and explicit save signals', () => {
    const results = [
        evaluateMemo(caseById('CASE-06'), output('提到：V750、电缆5米、木箱（证据：“V750电缆5米，木箱”）。条件/描述：电缆5米、木箱、先算一下（证据：“电缆5米，木箱，先算一下”）。想知道：先算一下（证据：“先算一下”）。保存表达：明确不保存（证据：“不保存”）。')),
        evaluateMemo(caseById('CASE-07'), output('提到：V750正式配方、包装、木箱（证据：“V750正式配方包装改成木箱”）。条件/描述：包装改木箱（证据：“包装改成木箱”）。想知道：未表达。保存表达：明确保存（证据：“并保存”）。')),
        evaluateMemo(caseById('CASE-14'), output('提到：V750、线圈（证据：“V750成本，还有它现在用哪个线圈”）。条件/描述：无。想知道：成本、当前使用哪个线圈（证据：“成本”“现在用哪个线圈”）。保存表达：没有表达保存或不保存。')),
    ];
    for (const result of results) assert.equal(result.overall, 'PASS');
});

test('R9 rejects invented sources, unsupported inference, and extractor scope leakage', () => {
    const invented = evaluateMemo(caseById('CASE-04'), output('提到：V750（证据：“V750”）。条件/描述：从纸箱改木箱（证据：“包装改木箱”）。想知道：未表达。保存表达：没有表达保存或不保存。'));
    const identity = evaluateMemo(caseById('CASE-02'), output('提到：12-120（证据：“12-120”）。条件/描述：无。想知道：多少钱（证据：“多少钱”）。保存表达：不涉及保存。需要确认正式身份。'));
    const baseline = evaluateMemo(caseById('CASE-05'), output('提到：V750、不锈钢接轴（证据：“V750如果做不锈钢接轴”）。条件/描述：做不锈钢接轴（证据：“做不锈钢接轴”）。想知道：成本差多少（证据：“成本差多少”）。保存表达：没有表达保存或不保存。比较基准缺失。'));
    assert.ok(invented.utteranceFailures.includes('UNSUPPORTED_INFERENCE'));
    assert.ok(identity.utteranceFailures.includes('UTTERANCE_SCOPE_LEAK'));
    assert.ok(baseline.utteranceFailures.includes('UTTERANCE_SCOPE_LEAK'));
});

test('R9 does not confuse a negative Business boundary disclaimer with an implementation leak', () => {
    const result = evaluateMemo(caseById('CASE-01'), output('提到：12-120（证据：“12-120”）。条件/描述：无。想知道：是什么（证据：“是什么”）。保存表达：不涉及保存。', {
        businessMemo: '业务模型只解释概念，不提供 API 或工具判断。',
    }));
    assert.equal(result.business, 'PASS');
});

test('R9 retains literal references and absent targets without reference recovery or clarification', () => {
    const literalReference = evaluateMemo(caseById('CASE-15'), output('提到：刚才那个线圈（证据：“刚才那个线圈”）。条件/描述：无。想知道：多少钱（证据：“多少钱”）。保存表达：不涉及保存。'));
    const incompleteDescription = evaluateMemo(caseById('CASE-16'), output('提到：V750（证据：“V750”）。条件/描述：改一下，但未表达具体内容（证据：“改一下”）。想知道：未表达。保存表达：没有表达保存或不保存。'));
    const noTarget = evaluateMemo(caseById('CASE-19'), output('提到：没有明确对象。条件/描述：无。想知道：贵多少（证据：“贵多少”）。保存表达：不涉及保存。'));
    const unknownReference = evaluateMemo(caseById('CASE-20'), output('提到：这个、木箱（证据：“这个换木箱”）。条件/描述：换木箱（证据：“换木箱”）。想知道：多少钱（证据：“多少钱”）。保存表达：没有表达保存或不保存。'));
    for (const result of [literalReference, incompleteDescription, noTarget, unknownReference]) assert.equal(result.overall, 'PASS');
});

test('R9 accepts literal do-not-save but does not let a mention replace a required condition', () => {
    const noSave = evaluateMemo(caseById('CASE-06'), output('提到：V750、电缆5米、木箱（证据：“V750电缆5米，木箱”）。条件/描述：电缆5米、木箱、先算一下（证据：“电缆5米，木箱，先算一下”）。想知道：先算一下（证据：“先算一下”）。保存表达：不保存（证据：“不保存”）。'));
    const omittedCondition = evaluateMemo(caseById('CASE-06'), output('提到：V750、电缆5米、木箱（证据：“V750电缆5米，木箱”）。条件/描述：无。想知道：先算一下（证据：“先算一下”）。保存表达：不保存（证据：“不保存”）。'));
    assert.equal(noSave.overall, 'PASS');
    assert.ok(omittedCondition.utteranceFailures.includes('CONDITION_DESCRIPTION_OMITTED'));
});

test('R9 uses only current-message evidence and has no reference-recovery requirement', () => {
    const recovered = evaluateMemo(caseById('CASE-15'), output('提到：刚才那个线圈，也就是12-120（证据：“12-120”）。条件/描述：无。想知道：多少钱（证据：“多少钱”）。保存表达：不涉及保存。'));
    assert.ok(recovered.utteranceFailures.includes('UNSUPPORTED_INFERENCE'));
    const runner = fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'scripts/ai-experiments/business-policy-intent/run-smoke.cjs'), 'utf8');
    assert.doesNotMatch(runner, /clarificationExpectation|clarificationReason|needsClarification|requiredChanges/);
});

test('legacy M4-2M pipeline stays separate from Ontology while production runtime imports no experiment', () => {
    const root = path.resolve(__dirname, '..');
    for (const relativePath of ['api/services/ai-assistant/runtime.cjs', 'api/services/ai-assistant/judge.cjs', 'api/services/ai-assistant/mainAgent.cjs', 'api/services/ai-assistant/capabilityBroker.cjs']) {
        assert.doesNotMatch(fs.readFileSync(path.join(root, relativePath), 'utf8'), /business-policy-intent/);
    }
    for (const file of ['businessAgent.cjs', 'policyAgent.cjs', 'intentAgent.cjs', 'pipeline.cjs', 'run-smoke.cjs']) {
        assert.doesNotMatch(fs.readFileSync(path.join(root, 'scripts/ai-experiments/business-policy-intent', file), 'utf8'), /require\([^)]*ontology|api\/ontology/i);
    }
});
