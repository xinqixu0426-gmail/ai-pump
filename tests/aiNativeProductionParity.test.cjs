'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { SAFE_VALIDATION_ANSWER } = require('../api/services/ai-assistant/answerValidator.cjs');
const {
    NATIVE_FACT_LEDGER_OPTIONS,
    runNativeAgentCore,
} = require('../api/services/ai-assistant/nativeAgentCore.cjs');
const { runAiAssistant } = require('../api/services/ai-assistant/runtime.cjs');
const { runApiNativeAgentCandidate } = require('../scripts/ai-experiments/api-native-agent/apiNativeAgentCandidate.cjs');

function modelToolCall(id, name, args) {
    return {
        choices: [{ message: {
            content: null,
            tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
        } }],
    };
}

function nativeKnowledgePlan() {
    const markNotApplicable = (id, toolName) => modelToolCall(id, 'mark_domain_api_not_applicable', {
        toolName,
        reason: 'MISSING_SAFE_INPUT',
        missingInput: 'knowledgeId',
        source: 'search_factory_knowledge returned zero results',
    });
    const safeUnavailable = '当前正式业务能力无法可靠完成该请求；不会把未应用的配置、零差额或未核验数据当作结果。';
    return [
        modelToolCall('domains', 'select_business_domains', { domains: ['knowledge'] }),
        modelToolCall('load', 'load_tools', { toolNames: ['search_factory_knowledge', 'get_factory_knowledge_detail', 'get_order_knowledge_package'] }),
        modelToolCall('search', 'search_factory_knowledge', { query: '查询知识库' }),
        markNotApplicable('detail-na', 'get_factory_knowledge_detail'),
        markNotApplicable('order-na', 'get_order_knowledge_package'),
        { choices: [{ message: { content: '调查完成。' } }] },
        { choices: [{ message: { content: '开始整理最终答复。' } }] },
        { choices: [{ message: { content: JSON.stringify({
            answer: safeUnavailable,
            claims: [],
            goals: [{ questionIndex: 0, status: 'UNAVAILABLE', factIds: [] }],
        }) } }] },
    ];
}

function nativeProcurementPlan() {
    return [
        modelToolCall('domains', 'select_business_domains', { domains: ['procurement'] }),
        modelToolCall('load', 'load_tools', { toolNames: ['get_purchase_overview', 'search_factory_knowledge'] }),
        modelToolCall('purchases', 'get_purchase_overview', {}),
        modelToolCall('knowledge', 'search_factory_knowledge', { query: '待处理采购' }),
        { choices: [{ message: { content: '调查完成。' } }] },
        { choices: [{ message: { content: '开始整理最终答复。' } }] },
        { choices: [{ message: { content: JSON.stringify({
            answer: '当前没有待处理采购任务。',
            claims: [{ text: '当前没有待处理采购任务。', factIds: ['F-002'] }],
            goals: [{ questionIndex: 0, status: 'COMPLETED', factIds: ['F-002'] }],
        }) } }] },
    ];
}

test('Native production parity: acceptance wrapper and read runtime share the exact Native core and formal ledger contract', async () => {
    assert.equal(runNativeAgentCore, runApiNativeAgentCandidate);
    assert.deepEqual(NATIVE_FACT_LEDGER_OPTIONS, {
        includeRecipeComparisonFacts: true,
        includeScenarioComparisonFacts: true,
        includeCoilDirectoryCostFacts: true,
        includeRecipeDetailCurrentCostFacts: true,
        includeOperationalEvidenceFacts: true,
    });

    const plan = nativeKnowledgePlan();
    const modelTools = [];
    let modelCalls = 0;
    const result = await runAiAssistant({ userMessage: '查询知识库' }, {
        forceNativeCore: true,
        policySnapshot: { policyVersion: 1, policyContent: '只读正式业务规则。' },
        mainModelCall: async (_messages, options) => {
            modelTools.push(options.tools.map(item => item.function.name));
            const next = plan[modelCalls++];
            assert.ok(next, 'Native core must remain bounded');
            return next;
        },
        executeToolCall: async name => {
            assert.equal(name, 'search_factory_knowledge');
            return {
                success: true,
                verified: true,
                executionEvidence: { verified: true },
                data: { items: [], queryReceipt: { returnedCount: 0, totalCount: 0, truncated: false, possiblyTruncated: false } },
                provenance: { kind: 'controlled_knowledge' },
            };
        },
    });

    assert.equal(result.answerValidation.valid, true);
    assert.equal(result.answerValidation.code, 'ANSWER_VERIFIED');
    assert.notEqual(result.answer, SAFE_VALIDATION_ANSWER);
    assert.deepEqual(result.capabilityBroker.domains, ['knowledge']);
    assert.equal(result.capabilityBroker.capabilities.length, 3);
    assert.equal(result.metrics.actualToolCalls, 1);
    assert.equal(result.factLedger.facts.some(fact => fact.source?.tool === 'search_factory_knowledge'), true);
    assert.equal(result.answerValidation.goals[0].status, 'UNAVAILABLE');
    assert.equal(modelTools[0].includes('select_business_domains'), true);
    assert.equal(modelTools.flat().some(name => /^update_|^create_|^delete_/.test(name)), false);
});

test('Native production parity: a bounded unsupported outcome stays validator-verified rather than becoming an ungrounded universal fallback', async () => {
    const plan = nativeKnowledgePlan();
    let modelCalls = 0;
    const result = await runAiAssistant({ userMessage: '查询知识库' }, {
        forceNativeCore: true,
        policySnapshot: { policyVersion: 1, policyContent: '只读正式业务规则。' },
        mainModelCall: async () => plan[modelCalls++],
        executeToolCall: async () => ({
            success: true,
            verified: true,
            executionEvidence: { verified: true },
            data: { items: [], queryReceipt: { returnedCount: 0, totalCount: 0, truncated: false, possiblyTruncated: false } },
            provenance: { kind: 'controlled_knowledge' },
        }),
    });
    assert.equal(result.answerValidation.valid, true);
    assert.equal(result.answerValidation.code, 'ANSWER_VERIFIED');
    assert.equal(result.goalStatuses[0].status, 'UNAVAILABLE');
    assert.equal(result.metrics.writeProposalCreated, false);
});

test('Native production parity: a normal read completes from formal procurement evidence after bounded finalization', async () => {
    const plan = nativeProcurementPlan();
    let modelCalls = 0;
    const result = await runAiAssistant({ userMessage: '采购总览里所有待处理物料有哪些？' }, {
        forceNativeCore: true,
        policySnapshot: { policyVersion: 1, policyContent: '只读正式业务规则。' },
        mainModelCall: async () => plan[modelCalls++],
        executeToolCall: async name => ({
            success: true,
            verified: true,
            executionEvidence: { verified: true },
            ...(name === 'get_purchase_overview' ? {
                queryReceipt: { returnedCount: 0, totalCount: 0, truncated: false, possiblyTruncated: false },
                data: { tasks: [] },
            } : { data: [], provenance: { kind: 'controlled_knowledge' } }),
        }),
    });
    assert.equal(result.answer, '当前没有待处理采购任务。');
    assert.equal(result.answerValidation.valid, true);
    assert.equal(result.answerValidation.code, 'ANSWER_VERIFIED');
    assert.equal(result.answerValidation.goals[0].status, 'COMPLETED');
    assert.deepEqual(result.capabilityBroker.domains, ['procurement']);
    assert.equal(result.factLedger.facts.some(fact => fact.predicate === 'collection_completeness'), true);
    assert.equal(result.metrics.actualToolCalls, 2);
    assert.equal(result.metrics.writeProposalCreated, false);
});
