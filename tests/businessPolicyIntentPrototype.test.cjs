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
const { evaluateMemo, invalidMarkedEvidence } = require('../scripts/ai-experiments/business-policy-intent/evaluatorR6.cjs');
const { CASES } = require('../scripts/ai-experiments/business-policy-intent/run-smoke.cjs');

function caseById(id) { return CASES.find(item => item.id === id); }
function output(intentMemo, overrides = {}) { return { businessMemo: '业务对象说明。', policyMemo: '业务规则说明。', intentMemo, ...overrides }; }

test('Business, Intent and Policy prompts have fully isolated source boundaries', () => {
    const business = messagesForBusiness({ userInput: 'V750成本多少？', businessModel: 'BUSINESS_MODEL_ONLY' });
    const policy = messagesForPolicy({ userInput: 'V750成本多少？', domainPolicy: 'DOMAIN_POLICY_ONLY' });
    const intent = messagesForIntent({ userInput: 'V750成本多少？', recentConversation: 'RECENT_USER_WORDING_ONLY', businessMemo: 'BUSINESS_MEMO_MUST_NOT_APPEAR', policyMemo: 'POLICY_MEMO_MUST_NOT_APPEAR', businessModel: 'BUSINESS_MODEL_MUST_NOT_APPEAR', domainPolicy: 'DOMAIN_POLICY_MUST_NOT_APPEAR' });
    assert.match(business[0].content, /BUSINESS_MODEL_ONLY/);
    assert.doesNotMatch(business[0].content, /DOMAIN_POLICY_ONLY/);
    assert.match(policy[0].content, /DOMAIN_POLICY_ONLY/);
    assert.doesNotMatch(policy[0].content, /BUSINESS_MODEL_ONLY/);
    assert.match(intent[0].content, /RECENT_USER_WORDING_ONLY/);
    assert.doesNotMatch(intent[0].content, /BUSINESS_MEMO_MUST_NOT_APPEAR|POLICY_MEMO_MUST_NOT_APPEAR|BUSINESS_MODEL_MUST_NOT_APPEAR|DOMAIN_POLICY_MUST_NOT_APPEAR|DOMAIN_POLICY_ONLY|BUSINESS_MODEL_ONLY/);
    assert.deepEqual(contextProfiles().intent, { rawUserInputIncluded: true, recentUserWordingIncluded: true, businessMemoIncluded: false, policyMemoIncluded: false, rawCompanyBusinessModelIncluded: false, rawDomainPolicyIncluded: false, ontologyIncluded: false, toolsExposed: 0 });
});
test('pipeline starts all three agents in parallel and passes no memo to Intent', async () => {
    let releaseBusiness;
    let releasePolicy;
    const businessBarrier = new Promise(resolve => { releaseBusiness = resolve; });
    const policyBarrier = new Promise(resolve => { releasePolicy = resolve; });
    let releaseIntent;
    const intentBarrier = new Promise(resolve => { releaseIntent = resolve; });
    const started = [];
    const pipeline = runPipeline({ userInput: '测试', businessModel: 'MODEL', domainPolicy: 'POLICY' }, {
        runBusinessAgent: async () => { started.push('business'); await businessBarrier; return 'Business memo'; },
        runPolicyAgent: async () => { started.push('policy'); await policyBarrier; return 'Policy memo'; },
        runIntentClerk: async input => { started.push('intent'); assert.deepEqual(input, { userInput: '测试', recentConversation: undefined }); await intentBarrier; return '对象：测试（证据：“测试”）。保存意图：不涉及保存。需要澄清：否。'; },
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(started.sort(), ['business', 'intent', 'policy']);
    releaseBusiness();
    releasePolicy();
    releaseIntent();
    const result = await pipeline;
    assert.equal(result.policyMemo, 'Policy memo');
});
test('Intent Clerk is natural language only and has no memo or raw-source input', () => {
    const source = fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'scripts/ai-experiments/business-policy-intent/intentAgent.cjs'), 'utf8');
    assert.doesNotMatch(source, /JSON\.parse|validateIntent|enum|Policy Memo：|Business Memo：/i);
    assert.match(source, /Evidence-First Intent Clerk/);
    assert.match(source, /没有任何公司业务知识、规则、实体资料或背景 Memo/);
});
test('R5 preserves user-evidenced multi-change, multi-goal, save, do-not-save and unspecified persistence', () => {
    const noSave = evaluateMemo(caseById('CASE-06'), output('对象：V750（证据：“V750”）。变化：电缆5米（证据：“电缆5米”）、木箱（证据：“木箱”）。想知道：试算（证据：“先算一下”）。保存意图：明确不保存（证据：“不保存”）。需要澄清：否。'));
    const save = evaluateMemo(caseById('CASE-07'), output('对象：V750正式配方（证据：“V750正式配方”）。变化：包装改木箱（证据：“包装改成木箱”）。保存意图：明确要求保存（证据：“并保存”）。需要澄清：否。'));
    const unspecified = evaluateMemo(caseById('CASE-04'), output('对象：V750（证据：“V750”）。变化：包装改木箱（证据：“包装改木箱”）。保存意图：用户没有表达是否保存。需要澄清：否。'));
    const multiGoal = evaluateMemo(caseById('CASE-14'), output('对象：V750（证据：“V750”）。想知道：成本（证据：“成本”）及当前线圈（证据：“现在用哪个线圈”）。保存意图：纯查询，不涉及保存。需要澄清：否。'));
    for (const result of [noSave, save, unspecified, multiGoal]) assert.equal(result.overall, 'PASS');
});
test('evidence validator rejects memo context as Owner evidence and invented source values', () => {
    const item = caseById('CASE-15');
    assert.deepEqual(invalidMarkedEvidence('对象：12-120（证据：“12-120”）。', item), []);
    assert.deepEqual(invalidMarkedEvidence('对象：V750-通用款（证据：“V750-通用款”）。', item), ['V750-通用款']);
    const stainless = evaluateMemo(caseById('CASE-05'), output('对象：V750（证据：“V750”）。变化：从45#钢改成不锈钢接轴（证据：“做不锈钢接轴”）。想知道：成本差额（证据：“成本差多少”）。保存意图：未表达。需要澄清：否。'));
    const packageOnly = evaluateMemo(caseById('CASE-04'), output('对象：V750（证据：“V750”）。变化：从纸箱改木箱（证据：“包装改木箱”）。保存意图：未表达。需要澄清：否。'));
    assert.ok(stainless.intentFailures.includes('UNSUPPORTED_INTENT_INFERENCE'));
    assert.ok(packageOnly.intentFailures.includes('UNSUPPORTED_INTENT_INFERENCE'));
});
test('R5 rejects unknown-referent invention and preserves a recent user reference', () => {
    const reference = evaluateMemo(caseById('CASE-15'), output('对象：刚才那个线圈，指向上一轮12-120（证据：“刚才那个线圈”；上一轮：“12-120”）。想知道：成本（证据：“多少钱”）。保存意图：纯查询。需要澄清：否。'));
    const unknown = evaluateMemo(caseById('CASE-20'), output('对象：“这个”，具体指代未知（证据：“这个”）。变化：换成木箱（证据：“换木箱”）。想知道：多少钱（证据：“多少钱”）。保存意图：未表达。需要澄清：对象未知。'));
    const invented = evaluateMemo(caseById('CASE-20'), output('对象：V750（证据：“这个”）。变化：从纸箱换木箱（证据：“换木箱”）。想知道：多少钱（证据：“多少钱”）。保存意图：未表达。需要澄清：对象未知。'));
    assert.equal(reference.overall, 'PASS');
    assert.equal(unknown.overall, 'PASS');
    assert.ok(invented.intentFailures.includes('UNSUPPORTED_OBJECT_INFERENCE'));
});
test('R5 rejects Policy and Grounding wording in Intent while scoring Policy independently', () => {
    const policyLeak = evaluateMemo(caseById('CASE-03'), output('对象：V750（证据：“V750”）。变化：纸箱换木箱（证据：“纸箱换木箱”）。想知道：成本差额（证据：“差多少钱”）。保存意图：未表达。按规则应当视为预览。需要澄清：否。'));
    const grounding = evaluateMemo(caseById('CASE-02'), output('对象：12-120（证据：“12-120”）。想知道：成本（证据：“多少钱”）。保存意图：纯查询。需要澄清：否。需要身份解析。'));
    const policyBoundary = evaluateMemo(caseById('CASE-03'), output('对象：V750（证据：“V750”）。变化：纸箱换木箱（证据：“纸箱换木箱”）。想知道：成本（证据：“差多少钱”）。保存意图：未表达。', { policyMemo: '应该调用 /api/preview。' }));
    assert.ok(policyLeak.intentFailures.includes('POLICY_TO_INTENT_LEAK'));
    assert.ok(grounding.intentFailures.includes('GROUNDING_LEAK'));
    assert.equal(policyBoundary.policy, 'FAIL');
});
test('R5 uses REVIEW_REQUIRED instead of failing uncertain natural language', () => {
    const assessment = evaluateMemo(caseById('CASE-03'), output('对象：V750（证据：“V750”）。变化：纸箱换木箱（证据：“纸箱换木箱”）。想知道：成本差额（证据：“差多少钱”）。保存意图：尚待确认。需要澄清：否。'));
    assert.equal(assessment.evaluator, 'REVIEW_REQUIRED');
    assert.equal(assessment.intent, 'PARTIAL');
});
test('R5 accepts explicit no-clarification and rejects a real language omission', () => {
    const clear = evaluateMemo(caseById('CASE-05'), output('对象：V750（证据：“V750”）。变化：不锈钢接轴（证据：“做不锈钢接轴”）。想知道：成本差额（证据：“成本差多少”）。保存意图：未表达。需要澄清：没有发现语言上缺失的信息。'));
    const unclear = evaluateMemo(caseById('CASE-16'), output('对象：V750（证据：“V750”）。保存意图：未表达。需要澄清：没有说明改什么或改成什么。'));
    assert.equal(clear.overall, 'PASS');
    assert.equal(unclear.overall, 'PASS');
});
test('R5 permits a scope exclusion while rejecting an actual database-access recommendation', () => {
    const scopeOnly = evaluateMemo(caseById('CASE-01'), output('对象：12-120（证据：“12-120”）。想知道：含义（证据：“是什么”）。保存意图：纯解释，不涉及保存。需要澄清：否。', { businessMemo: '业务模型不定义数据库当前事实。' }));
    const accessLeak = evaluateMemo(caseById('CASE-01'), output('对象：12-120（证据：“12-120”）。想知道：含义（证据：“是什么”）。保存意图：纯解释，不涉及保存。需要澄清：否。', { businessMemo: '应查询数据库确认。' }));
    assert.equal(scopeOnly.business, 'PASS');
    assert.equal(accessLeak.business, 'FAIL');
});
test('R6 accepts literal-only Intent records for complete language and rejects only actual leakage', () => {
    const price = evaluateMemo(caseById('CASE-02'), output('提到：12-120（证据：“12-120”）。想知道：多少钱（证据：“多少钱”）。明确变化：无。保存表达：用户没有表达。语言缺失：无。'));
    const template = evaluateMemo(caseById('CASE-13'), output('提到：通用款模板（证据：“通用款模板”）。想知道：有哪些固定件（证据：“有哪些固定件”）。明确变化：无。保存表达：用户没有表达。语言缺失：无。'));
    const reference = evaluateMemo(caseById('CASE-15'), output('提到：“刚才那个线圈”语言上指向上一轮的12-120（证据：“刚才那个线圈”；上一轮：“12-120”）。想知道：多少钱（证据：“多少钱”）。保存表达：用户没有表达。语言缺失：无。'));
    for (const result of [price, template, reference]) assert.equal(result.intent, 'PASS');
});
test('prototype has no Ontology imports or production-runtime imports', () => {
    const root = path.resolve(__dirname, '..');
    const productionEntrypoints = ['api/services/ai-assistant/runtime.cjs', 'api/services/ai-assistant/judge.cjs', 'api/services/ai-assistant/mainAgent.cjs', 'api/services/ai-assistant/capabilityBroker.cjs'];
    for (const relativePath of productionEntrypoints) assert.doesNotMatch(fs.readFileSync(path.join(root, relativePath), 'utf8'), /business-policy-intent/);
    const prototype = path.join(root, 'scripts/ai-experiments/business-policy-intent');
    for (const file of fs.readdirSync(prototype)) assert.doesNotMatch(fs.readFileSync(path.join(prototype, file), 'utf8'), /require\([^)]*ontology|api\/ontology/i);
});
