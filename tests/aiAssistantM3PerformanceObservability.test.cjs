'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'm3-performance-observability-test-jwt-secret';
process.env.ACCESS_PASSWORD = 'm3-performance-observability-test-access-password';
process.env.PUMP_OWNER_ACCESS_PASSWORD = 'm3-performance-observability-owner-password-0123456789';
process.env.PUMP_OWNER_SUBJECT = 'm3_performance_owner_subject_001';
process.env.AI_V5_OWNER_SUBJECTS = '["m3_performance_owner_subject_001"]';
const { classifyRoute, runAiAssistant } = require('../api/services/ai-assistant/runtime.cjs');
const { runMainAgent } = require('../api/services/ai-assistant/mainAgent.cjs');
const { buildInvestigationContext } = require('../api/services/ai-assistant/context.cjs');
const { progressEvent, publicMetrics } = require('../api/routes/ai/chat.cjs');
const { createAiChatRouter } = require('../api/routes/ai/chat.cjs');
const { issueOwnerToken } = require('../api/services/ownerAuthentication.cjs');
const { MAX_MODEL_PROJECTION_BYTES, modelProjection } = require('../api/services/ai-assistant/factLedger.cjs');
const express = require('express');
const cookieParser = require('cookie-parser');

const judge = Object.freeze({ mode: 'READ', goal: '读取当前成本', questions: ['读取当前成本'], constraints: [], persistentMutation: false, needsClarification: false, clarificationReason: null, appliedPolicyIds: [], domains: ['recipe', 'cost'] });
function response(message) { return { choices: [{ message }] }; }
function toolCall(name, args, id) { return response({ content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }); }

test('SIMPLE_READ admission is structural, while mutation and multi-goal forms retain Judge', () => {
    assert.equal(classifyRoute({ userMessage: 'V550现在成本多少' }), 'SIMPLE_READ');
    assert.equal(classifyRoute({ userMessage: 'V550现在成本多少？' }), 'SIMPLE_READ');
    assert.equal(classifyRoute({ userMessage: '把库存增加1并保存' }), 'GENERAL');
    assert.equal(classifyRoute({ userMessage: 'V550成本多少，顺便看库存' }), 'GENERAL');
    assert.equal(classifyRoute({ userMessage: '这个成本多少', recentConversation: [{ role: 'assistant', content: '候选' }] }), 'GENERAL');
});

test('SIMPLE_READ skips Judge, preserves formal-tool/fact/validator gates, and records request metrics', async () => {
    let judgeCalls = 0; let mainCalls = 0;
    const result = await runAiAssistant({ userMessage: 'V550现在成本多少', requestId: 'm3-5-fast-read-001' }, {
        policySnapshot: { policyVersion: 7, policyContent: '规则' },
        judgeModelCall: async () => { judgeCalls += 1; return response({ content: JSON.stringify(judge) }); },
        mainModelCall: async _messages => {
            mainCalls += 1;
            if (mainCalls === 1) return toolCall('resolve_entity', { entityType: 'recipe', mention: 'V550' }, 'resolve');
            if (mainCalls === 2) return toolCall('get_recipe_detail', { recipeId: 12 }, 'cost');
            throw new Error('fast answer must compose after a verified scalar fact');
        },
        resolveAgentEntity: async () => ({ entityType: 'recipe', mention: 'V550', status: 'RESOLVED', canonicalId: '12', canonicalName: 'V550', candidates: [], source: 'formal', verified: true }),
        executeToolCall: async (name, args) => {
            assert.equal(name, 'get_recipe_detail'); assert.equal(args.recipeId, 12);
            return { success: true, data: { currentTotalCost: 288.76, costBasis: 'CURRENT_REBUILT' }, executionEvidence: { verified: true } };
        },
    });
    assert.equal(judgeCalls, 0);
    assert.equal(result.routeClass, 'SIMPLE_READ');
    assert.equal(result.metrics.judgeUsed, false);
    assert.equal(result.metrics.mainModelCalls, 2);
    assert.equal(result.metrics.actualToolCalls, 2);
    assert.equal(result.metrics.factCount > 0, true);
    assert.equal(result.answerValidation.valid, true);
    assert.match(result.answer, /288\.76/);
    assert.deepEqual(result.referenceEntities, [{ entityType: 'recipe', canonicalName: 'V550' }]);
});

test('fast formal composition accepts corroborated scalar fields but refuses conflicting formal values', () => {
    const { fastFormalAnswer } = require('../api/services/ai-assistant/mainAgent.cjs');
    const judge = { mode: 'READ', questions: ['成本'] };
    const facts = [
        { factId: 'F-1', verified: true, predicate: 'current_cost', value: 288.76, unit: 'CNY', entity: { type: 'recipe', id: 12, canonicalName: 'PX410' } },
        { factId: 'F-2', verified: true, predicate: 'unit_cost', value: 288.76, unit: 'CNY', entity: { type: 'recipe', id: 12, canonicalName: 'PX410' } },
    ];
    assert.match(fastFormalAnswer({ facts }, judge), /288\.76/);
    assert.equal(fastFormalAnswer({ facts: [...facts, { ...facts[1], factId: 'F-3', value: 299 }], observations: [] }, judge), null);
});

test('SIMPLE_READ expands from compact generic tools only after formal entity resolution', async () => {
    const result = await runAiAssistant({ userMessage: 'V550现在成本多少' }, {
        policySnapshot: { policyVersion: 7, policyContent: '规则' },
        mainModelCall: async (_messages, options) => {
            if (options.tools.some(tool => tool.function.name === 'get_recipe_detail')) return toolCall('get_recipe_detail', { recipeId: 12 }, 'cost');
            return toolCall('resolve_entity', { entityType: 'recipe', mention: 'V550' }, 'resolve');
        },
        resolveAgentEntity: async () => ({ entityType: 'recipe', mention: 'V550', status: 'RESOLVED', canonicalId: '12', canonicalName: 'V550', candidates: [], source: 'formal', verified: true }),
        executeToolCall: async () => ({ success: true, data: { currentTotalCost: 288.76, costBasis: 'CURRENT_REBUILT' }, executionEvidence: { verified: true } }),
    });
    assert.equal(result.capabilityBroker.domains.includes('recipe'), true);
    assert.equal(result.capabilityBroker.capabilities.some(item => item.toolName === 'get_recipe_detail'), true);
});

test('conversation candidates stay names only and must be formally re-resolved on the next turn', () => {
    const context = buildInvestigationContext({ recentConversation: [{ role: 'assistant', content: 'V550 当前成本已核验。', referenceEntities: [{ entityType: 'recipe', canonicalName: 'V550', id: 12 }, { entityType: 'recipe', canonicalName: 'V750', id: 13 }] }] });
    assert.deepEqual(context.conversationReferences, [{ entityType: 'recipe', canonicalName: 'V550' }, { entityType: 'recipe', canonicalName: 'V750' }]);
    assert.doesNotMatch(JSON.stringify(context), /"id"/);
});

test('public progress and metrics are high-level metadata only', () => {
    assert.deepEqual(progressEvent({ stage: 'resolving_entity' }), { status: 'resolving_entity', message: '正在确认业务对象' });
    const metrics = publicMetrics({ policyVersion: 7, routeClass: 'SIMPLE_READ', metrics: { requestId: 'safe-request', policyVersion: 7, routeClass: 'SIMPLE_READ', judgeUsed: false, judgeModelCalls: 0, mainModelCalls: 2, actualToolCalls: 2, selectedDomains: ['recipe'], selectedCapabilities: ['ai.get_recipe_detail'], exposedToolCount: 3, ontologyResolutionCount: 1, factCount: 2, goalCount: 1, goalStatuses: ['COMPLETED'], validatorResult: 'ANSWER_VERIFIED', writeProposalCreated: false, writeExecuted: false, timings: { totalLatencyMs: 12, toolMs: 3, judgeMs: 0, mainAgentMs: 9 } } });
    assert.equal(metrics.durationMs, 12); assert.equal(metrics.modelRequestCount, 2);
    assert.doesNotMatch(JSON.stringify(metrics), /prompt|arguments|confirmationToken|operationId|canonicalId/i);
});

test('model-facing formal tool projections are bounded while preserving fact references', () => {
    const projected = modelProjection({ success: true, data: { rows: Array.from({ length: 100 }, (_, index) => ({ label: `row-${index}`, detail: 'x'.repeat(800) })), confirmationToken: 'must-not-leak' } }, ['F-001', 'F-002']);
    assert.deepEqual(projected.factRefs, ['F-001', 'F-002']);
    assert.equal(projected.data.rows.length > 12, true);
    assert.deepEqual(projected.projection.collections.find(item => item.path === '$.data.rows'), {
        path: '$.data.rows', totalCount: 100, returnedCount: projected.data.rows.length,
        hasMore: true, complete: false,
    });
    assert.equal(JSON.stringify(projected).length <= MAX_MODEL_PROJECTION_BYTES * 2, true);
    assert.doesNotMatch(JSON.stringify(projected), /must-not-leak/);
});

test('repeated or exhausted investigation is a grounded partial answer, not an exposed runtime failure', async () => {
    let calls = 0;
    const quotationJudge = { ...judge, domains: ['quotation'] };
    const result = await runMainAgent({ userMessage: '查正式资料', judge: quotationJudge, domainPolicy: '规则', policyVersion: 7 }, {
        modelCall: async () => {
            calls += 1;
            return toolCall('search_quotations', {}, `tool-${calls}`);
        },
        executeToolCall: async () => ({ success: true, data: [], executionEvidence: { verified: true } }),
    });
    assert.equal(calls, 2);
    assert.equal(result.answerValidation.valid, true);
    assert.deepEqual(result.goalStatuses.map(goal => goal.status), ['PARTIAL']);
});

test('an early Main Agent draft is repaired into a formal read before validation', async () => {
    let calls = 0;
    const result = await runMainAgent({ userMessage: 'V550成本多少', judge, domainPolicy: '规则', policyVersion: 7, routeClass: 'SIMPLE_READ' }, {
        modelCall: async () => {
            calls += 1;
            if (calls === 1) return toolCall('resolve_entity', { entityType: 'recipe', mention: 'V550' }, 'resolve');
            if (calls === 2) return response({ content: JSON.stringify({ answer: 'V550 成本未知。', claims: [], goals: [{ questionIndex: 0, status: 'UNAVAILABLE', factIds: [] }] }) });
            if (calls === 3) return toolCall('get_recipe_detail', { recipeId: 12 }, 'cost');
            throw new Error(`fast composition must finish after verified formal cost (call ${calls})`);
        },
        resolveAgentEntity: async () => ({ entityType: 'recipe', mention: 'V550', status: 'RESOLVED', canonicalId: '12', canonicalName: 'V550', candidates: [], source: 'formal', verified: true }),
        executeToolCall: async () => ({ success: true, data: { currentTotalCost: 288.76, costBasis: 'CURRENT_REBUILT' }, executionEvidence: { verified: true } }),
    });
    assert.equal(calls, 3);
    assert.equal(result.answerValidation.valid, true);
    assert.match(result.answer, /288\.76/);
});

test('Owner SSE carries high-level progress and bounded runtime metrics without tool arguments', async () => {
    const env = { ACCESS_PASSWORD: process.env.ACCESS_PASSWORD, JWT_SECRET: process.env.JWT_SECRET, PUMP_OWNER_ACCESS_PASSWORD: process.env.PUMP_OWNER_ACCESS_PASSWORD, PUMP_OWNER_SUBJECT: process.env.PUMP_OWNER_SUBJECT, AI_V5_OWNER_SUBJECTS: process.env.AI_V5_OWNER_SUBJECTS };
    const app = express(); app.use(express.json()); app.use(cookieParser());
    app.use(createAiChatRouter({ env, writeAllowed: () => false, runAiAssistant: async (_input, deps) => {
        deps.onProgress({ stage: 'resolving_entity' }); deps.onProgress({ stage: 'reading_formal_data' });
        return { status: 'COMPLETED', answer: '已核验。', policyVersion: 7, routeClass: 'SIMPLE_READ', referenceEntities: [{ entityType: 'recipe', canonicalName: 'V550' }], metrics: { requestId: 'safe-request', policyVersion: 7, routeClass: 'SIMPLE_READ', judgeUsed: false, judgeModelCalls: 0, mainModelCalls: 2, actualToolCalls: 2, selectedDomains: ['recipe'], selectedCapabilities: ['ai.get_recipe_detail'], exposedToolCount: 3, ontologyResolutionCount: 1, factCount: 2, goalCount: 1, goalStatuses: ['COMPLETED'], validatorResult: 'ANSWER_VERIFIED', writeProposalCreated: false, writeExecuted: false, timings: { totalLatencyMs: 12, toolMs: 3, judgeMs: 0, mainAgentMs: 9 } } };
    } }));
    const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    try {
        const token = issueOwnerToken(env.PUMP_OWNER_ACCESS_PASSWORD, env);
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ai/chat`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `token=${token}` }, body: JSON.stringify({ messages: [{ role: 'user', content: 'V550成本多少' }] }) });
        const body = await response.text();
        assert.equal(response.status, 200);
        assert.match(body, /"type":"status"/); assert.match(body, /"type":"metrics"/); assert.match(body, /"type":"reference_context"/);
        assert.doesNotMatch(body, /tool_call|arguments|confirmationToken|operationId|canonicalId/i);
    } finally { await new Promise(resolve => server.close(resolve)); }
});
