'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SemanticEligibilityBoundaryV1, semanticEligibility } = require('../api/business-semantics/eligibilityBoundary.cjs');
const { classifyQuestion } = require('../api/business-semantics/questionSemantics.cjs');
const { buildBusinessEvidencePlan } = require('../api/business-semantics/evidencePlanner.cjs');

const PRODUCTION_FAILURE_PROBE = '请用一句话说明你能帮我做什么';
const NEGATIVE_CORPUS = Object.freeze([
    PRODUCTION_FAILURE_PROBE,
    '你好',
    '你是谁',
    '帮我写一封邮件',
    '今天天气怎么样',
    '给我讲讲人工智能',
    '水泵的工作原理是什么',
    '帮我总结这句话',
    '1+1等于多少',
    '最近有什么订单',
]);

test('SemanticEligibilityBoundaryV1 is a bounded immutable admission contract', () => {
    assert.equal(SemanticEligibilityBoundaryV1.version, 1);
    assert.equal(Object.isFrozen(SemanticEligibilityBoundaryV1), true);
    assert.deepEqual(SemanticEligibilityBoundaryV1.authorities, ['BUSINESS_SEMANTIC_V1', 'LEGACY']);
    assert.ok(SemanticEligibilityBoundaryV1.limits.maxSignals <= 8);
});

test('BUS-P5R frozen negative corpus remains OUT_OF_SCOPE before evidence planning', () => {
    for (const userText of NEGATIVE_CORPUS) {
        const decision = semanticEligibility({ userText });
        assert.equal(decision.eligible, false, userText);
        assert.equal(decision.kind, 'OUT_OF_SCOPE', userText);
        assert.equal(decision.authority, 'LEGACY', userText);
        assert.equal(classifyQuestion(userText).kind, 'OUT_OF_SCOPE', userText);
        assert.equal(buildBusinessEvidencePlan({ userText, eligibility: decision }), null, userText);
    }
});

test('BUS-P5R-NEG-01 freezes the exact production failure probe', () => {
    assert.equal(PRODUCTION_FAILURE_PROBE, '请用一句话说明你能帮我做什么');
    assert.deepEqual(semanticEligibility({ userText: PRODUCTION_FAILURE_PROBE }), {
        version: 1,
        eligible: false,
        kind: 'OUT_OF_SCOPE',
        reason: 'NO_SUPPORTED_BUSINESS_SIGNAL',
        signals: [],
        authority: 'LEGACY',
    });
});

test('all 11 frozen Benchmark V2 requests remain positively admitted with their supported kinds', () => {
    const definition = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/business-understanding-benchmark-v2.json'), 'utf8'));
    const expectedKinds = {
        'BU-01': 'COST_QUERY', 'BU-02': 'COST_QUERY', 'BU-03': 'COST_QUERY',
        'BU-04': 'HYPOTHETICAL_COST_QUERY', 'BU-05': 'HYPOTHETICAL_COST_QUERY',
        'BU-06': 'CONFIGURATION_OVERRIDE', 'BU-07': 'COST_QUERY', 'BU-08': 'INVENTORY_QUERY',
        'BU-09': 'COST_QUERY', 'BU-10': 'CONFIGURATION_OVERRIDE', 'BU-11': 'HYPOTHETICAL_COST_QUERY',
    };
    for (const item of definition.coreCases) {
        const decision = semanticEligibility({ userText: item.question });
        assert.equal(decision.eligible, true, item.caseKey);
        assert.equal(decision.authority, 'BUSINESS_SEMANTIC_V1', item.caseKey);
        assert.equal(decision.kind, expectedKinds[item.caseKey], item.caseKey);
        assert.notEqual(buildBusinessEvidencePlan({ userText: item.question, eligibility: decision }), null, item.caseKey);
    }
});

test('positive catalog lookup requires deterministic catalog identity or resource lookup structure', () => {
    for (const userText of ['找一下 V550', 'V800 是什么型号', '查一下 12-200', '这个配方是什么', '这个线圈方案有哪些']) {
        const decision = semanticEligibility({ userText });
        assert.equal(decision.eligible, true, userText);
        assert.equal(decision.kind, 'CATALOG_LOOKUP', userText);
        assert.equal(decision.reason, 'SUPPORTED_CATALOG_LOOKUP', userText);
    }
    for (const userText of ['成本是什么', '线圈的工作原理是什么', '水泵成本怎么计算']) {
        assert.equal(semanticEligibility({ userText }).eligible, false, userText);
    }
});

test('only a server-trusted supported canonical page context can contribute admission', () => {
    assert.equal(semanticEligibility({ userText: '这个是什么', trustedPageContext: {
        trusted: true, resourceType: 'recipe', resourceId: 12,
    } }).reason, 'TRUSTED_SUPPORTED_PAGE_CONTEXT');
    assert.equal(semanticEligibility({ userText: '这个是什么', trustedPageContext: {
        resourceType: 'recipe', resourceId: 12,
    } }).eligible, false);
    assert.equal(semanticEligibility({ userText: '这个是什么', trustedPageContext: {
        trusted: true, resourceType: 'order', resourceId: 1,
    } }).eligible, false);
});

test('protected writes always remain under Legacy confirmation authority', () => {
    const decision = semanticEligibility({ userText: '请把零件轴承-201的单价设置为1.1', protectedWriteRoute: true });
    assert.deepEqual(decision, {
        version: 1, eligible: false, kind: 'OUT_OF_SCOPE', reason: 'PROTECTED_WRITE_ROUTE', signals: [], authority: 'LEGACY',
    });
});

test('runtime evaluates negative eligibility before planning and performs zero semantic reads', async () => {
    const { runAiAssistant } = require('../api/services/aiAssistantRuntime.cjs');
    async function run(flag) {
        let providerCalls = 0;
        let toolExecutions = 0;
        const response = await runAiAssistant({
            messages: [{ role: 'user', content: PRODUCTION_FAILURE_PROBE }],
            env: { AI_BUSINESS_SEMANTIC_ENFORCEMENT_CANARY_ENABLED: flag },
        }, {
            loadMemory: async () => ({ items: [] }),
            loadCorrections: () => '',
            executeToolCall: async () => { toolExecutions += 1; throw new Error('unexpected business read'); },
            fetchAiProvider: async () => {
                providerCalls += 1;
                return { json: async () => ({ choices: [{ message: { content: '我可以协助查询工厂资料和处理日常问题。' } }] }) };
            },
        });
        return { response, providerCalls, toolExecutions };
    }
    const off = await run('false');
    const on = await run('true');
    assert.equal(on.response.telemetry.businessSemanticEligibility.eligible, false);
    assert.equal(on.response.telemetry.businessSemanticEligibility.authority, 'LEGACY');
    assert.equal(on.response.telemetry.businessSemanticEnforcement, null);
    assert.equal(on.response.toolResults.filter(item => item.planningSource === 'BUSINESS_SEMANTIC_EVIDENCE_PLAN').length, 0);
    assert.equal(on.toolExecutions, 0);
    assert.equal(on.providerCalls, off.providerCalls);
});
