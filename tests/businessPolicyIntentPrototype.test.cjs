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
const { evaluateMemo, invalidMarkedEvidence } = require('../scripts/ai-experiments/business-policy-intent/evaluatorR4.cjs');
const { CASES } = require('../scripts/ai-experiments/business-policy-intent/run-smoke.cjs');

function caseById(id) { return CASES.find(item => item.id === id); }
function output(intentMemo, overrides = {}) { return { businessMemo: '业务对象说明。', policyMemo: '业务规则说明。', intentMemo, ...overrides }; }

test('Business, Policy and Intent prompts isolate their source documents', () => {
    const business = messagesForBusiness({ userInput: 'V750成本多少？', businessModel: 'BUSINESS_MODEL_ONLY' });
    const policy = messagesForPolicy({ userInput: 'V750成本多少？', domainPolicy: 'DOMAIN_POLICY_ONLY' });
    const intent = messagesForIntent({ userInput: 'V750成本多少？', businessMemo: 'BUSINESS_MEMO_ONLY', policyMemo: 'POLICY_MEMO_ONLY' });
    assert.match(business[0].content, /BUSINESS_MODEL_ONLY/);
    assert.doesNotMatch(business[0].content, /DOMAIN_POLICY_ONLY/);
    assert.match(policy[0].content, /DOMAIN_POLICY_ONLY/);
    assert.doesNotMatch(policy[0].content, /BUSINESS_MODEL_ONLY/);
    assert.match(intent[0].content, /BUSINESS_MEMO_ONLY.*POLICY_MEMO_ONLY/s);
    assert.doesNotMatch(intent[0].content, /BUSINESS_MODEL_ONLY|DOMAIN_POLICY_ONLY|必须且只能有/);
    assert.deepEqual(contextProfiles().intent, { rawUserInputIncluded: true, businessMemoIncluded: true, policyMemoIncluded: true, rawCompanyBusinessModelIncluded: false, rawDomainPolicyIncluded: false, ontologyIncluded: false, toolsExposed: 0 });
});
test('pipeline starts Business and Policy calls before waiting for natural-language Intent Memo', async () => {
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
            return '对象：测试。保存意图：不涉及保存。';
        },
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(started.sort(), ['business', 'policy']);
    release();
    const result = await pipeline;
    assert.equal(typeof result.intentMemo, 'string');
});
test('Evidence-First Intent Clerk has no JSON decoder or schema requirement', () => {
    const root = path.resolve(__dirname, '..');
    const source = fs.readFileSync(path.join(root, 'scripts/ai-experiments/business-policy-intent/intentAgent.cjs'), 'utf8');
    assert.doesNotMatch(source, /JSON\.parse|validateIntent|enum/i);
    assert.doesNotMatch(source, /只输出 JSON|必须且只能有/);
    assert.match(source, /Evidence-First Intent Clerk/);
    assert.match(source, /绝不是 Owner 原话的证据/);
});
test('Evaluator R4 preserves multi-change, multi-goal, save, do-not-save and unspecified meanings', () => {
    const noSave = evaluateMemo(caseById('BP-05'), output('对象：V750（证据：“V750”）。明确变化：电缆5米（证据：“电缆5米”），包装改为木箱（证据：“木箱”）。想知道：成本试算（证据：“先算一下”）。保存意图：明确不保存（证据：“不保存”）。需要澄清：否。'));
    const save = evaluateMemo(caseById('BP-06'), output('对象：V750（证据：“V750”）。明确变化：包装改成木箱（证据：“包装改成木箱”）。保存意图：明确要求保存（证据：“并保存”）。需要澄清：否。'));
    const unspecified = evaluateMemo(caseById('BP-07'), output('对象：V750（证据：“V750”）。明确变化：包装改成木箱（证据：“包装改木箱”）。保存意图：用户没有说明是否保存。需要澄清：否。'));
    const multiGoal = evaluateMemo(caseById('BP-14'), output('对象：V750（证据：“V750”）。想知道：当前成本（证据：“成本”），以及当前使用的线圈（证据：“现在用哪个线圈”）。保存意图：纯查询，不涉及保存。需要澄清：否。'));
    assert.equal(noSave.evaluator, 'PASS');
    assert.equal(save.evaluator, 'PASS');
    assert.equal(unspecified.evaluator, 'PASS');
    assert.equal(multiGoal.evaluator, 'PASS');
});
test('Evaluator R4 rejects inferred source values and Policy implementation language', () => {
    const sourceInference = evaluateMemo(caseById('BP-04'), output('对象：V750。变化：从45#钢改成不锈钢接轴。想知道：成本差额。保存意图：没有明确保存。'));
    const policyBoundary = evaluateMemo(caseById('BP-03'), output('对象：V750。变化：纸箱换木箱。想知道：成本差额。保存意图：未表达保存。', { policyMemo: '应该调用 /api/preview。' }));
    assert.ok(sourceInference.deterministicFailures.includes('UNSUPPORTED_INTENT_INFERENCE'));
    assert.equal(policyBoundary.policy, 'FAIL');
});
test('Evaluator R4 returns REVIEW_REQUIRED instead of failing unknown equivalent prose', () => {
    const assessment = evaluateMemo(caseById('BP-03'), output('对象：V750。变化：纸箱换木箱。想知道：成本差额。保存意图：尚待确认。需要澄清：否。'));
    assert.equal(assessment.evaluator, 'REVIEW_REQUIRED');
    assert.equal(assessment.intent, 'PARTIAL');
});
test('Evaluator R4 preserves conversation references and rejects an invented referent', () => {
    const reference = evaluateMemo(caseById('BP-15'), output('对象：刚才提到的12-120（证据：“刚才那个线圈”；上一轮：“12-120”）。想知道：它的成本（证据：“多少钱”）。保存意图：纯查询，不涉及保存。需要澄清：否。'));
    const invented = evaluateMemo(caseById('ADV-04'), output('对象：V750。变化：包装从纸箱换成木箱。想知道：成本。保存意图：未表达。需要澄清：对象缺失。'));
    assert.equal(reference.evaluator, 'PASS');
    assert.ok(invented.deterministicFailures.includes('UNSUPPORTED_OBJECT_INFERENCE'));
});
test('Policy boundary forbids every implementation-language family used by R4', () => {
    for (const term of ['/api/', 'POST', 'Tool', 'executor', 'database', 'SQL', 'internalApiClient']) {
        const assessment = evaluateMemo(caseById('BP-03'), output('对象：V750。变化：纸箱换木箱。想知道：成本差额。保存意图：未表达。', { policyMemo: `建议使用 ${term}。` }));
        assert.equal(assessment.policy, 'FAIL', term);
    }
});
test('Evidence validator accepts only current or recent user wording as marked evidence', () => {
    const item = caseById('BP-15');
    assert.deepEqual(invalidMarkedEvidence('对象：12-120（证据：“12-120”）。', item), []);
    assert.deepEqual(invalidMarkedEvidence('对象：V750-通用款（证据：“V750-通用款”）。', item), ['V750-通用款']);
});
test('Evaluator R4 rejects grounding discussion and BP-07 or ADV-04 invention', () => {
    const grounding = evaluateMemo(caseById('BP-02'), output('对象：12-120（证据：“12-120”）。想知道：成本（证据：“多少钱”）。保存意图：纯查询。需要澄清：否。后续需要身份解析。'));
    const packaging = evaluateMemo(caseById('BP-07'), output('对象：V750（证据：“V750”）。变化：从纸箱改木箱（证据：“包装改木箱”）。保存意图：未表达。需要澄清：否。'));
    const referent = evaluateMemo(caseById('ADV-04'), output('对象：V750（证据：“这个”）。变化：改木箱（证据：“换木箱”）。想知道：成本（证据：“多少钱”）。保存意图：未表达。需要澄清：对象未知。'));
    assert.ok(grounding.deterministicFailures.includes('GROUNDING_LEAK'));
    assert.ok(packaging.deterministicFailures.includes('UNSUPPORTED_INTENT_INFERENCE'));
    assert.ok(referent.deterministicFailures.includes('UNSUPPORTED_OBJECT_INFERENCE'));
});
test('Evaluator R4 distinguishes an explicit no-clarification statement from a real missing referent', () => {
    const clear = evaluateMemo(caseById('BP-04'), output('对象：V750（证据：“V750”）。变化：采用不锈钢接轴（证据：“做不锈钢接轴”）。想知道：成本差额（证据：“成本差多少”）。保存意图：没有表达。需要澄清：没有发现语言上缺失的信息。'));
    const missing = evaluateMemo(caseById('ADV-04'), output('对象：“这个”，具体指代未知（证据：“这个”）。变化：改为木箱（证据：“换木箱”）。想知道：成本（证据：“多少钱”）。保存意图：没有表达。需要澄清：对象未知。'));
    assert.equal(clear.evaluator, 'PASS');
    assert.ok(missing.deterministicFailures.includes('CLARIFICATION_BOUNDARY_BREACH') === false);
});
test('Evaluator R4 does not reverse an explicit no-clarification statement with Chinese negation', () => {
    const assessment = evaluateMemo(caseById('BP-05'), output('对象：V750（证据：“V750”）。变化：电缆5米、木箱（证据：“电缆5米，木箱”）。想知道：试算（证据：“先算一下”）。保存意图：明确不保存（证据：“不保存”）。需要澄清：没有明显缺少的语言信息。'));
    assert.equal(assessment.evaluator, 'PASS');
});
test('Evaluator R4 recognizes a no answer in a clarification field', () => {
    const assessment = evaluateMemo(caseById('BP-04'), output('对象：V750（证据：“V750”）。变化：采用不锈钢接轴（证据：“做不锈钢接轴”）。想知道：成本差额（证据：“成本差多少”）。保存意图：用户没有表达。是否需要澄清：无。'));
    assert.equal(assessment.evaluator, 'PASS');
});
test('Evaluator R4 scopes persistence to persistence wording, not an unrelated omitted source value', () => {
    const assessment = evaluateMemo(caseById('BP-06'), output('对象：V750（证据：“V750”）。变化：包装改为木箱（证据：“包装改成木箱”）。保存意图：用户明确要求保存（证据：“并保存”）。用户没有说明改之前是什么包装。需要澄清：否。'));
    assert.equal(assessment.evaluator, 'PASS');
});
test('prototype excludes Ontology and production runtime imports', () => {
    const root = path.resolve(__dirname, '..');
    const productionEntrypoints = ['api/services/ai-assistant/runtime.cjs', 'api/services/ai-assistant/judge.cjs', 'api/services/ai-assistant/mainAgent.cjs', 'api/services/ai-assistant/capabilityBroker.cjs'];
    for (const relativePath of productionEntrypoints) assert.doesNotMatch(fs.readFileSync(path.join(root, relativePath), 'utf8'), /business-policy-intent/);
    const prototype = path.join(root, 'scripts/ai-experiments/business-policy-intent');
    for (const file of fs.readdirSync(prototype)) assert.doesNotMatch(fs.readFileSync(path.join(prototype, file), 'utf8'), /require\([^)]*ontology|api\/ontology/i);
});
