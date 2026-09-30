'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { runAiAssistant, confirmAiAssistantPartStockProposal } = require('../api/services/ai-assistant/runtime.cjs');
const { PROTECTED_PROPOSAL_TOOLS } = require('../api/services/ai-assistant/agentTools.cjs');

const judge = Object.freeze({ mode: 'PERSIST_MUTATION', goal: '将零件 P-100 库存增加 3 并保存', questions: ['把 P-100 库存增加 3'], constraints: ['P-100', '增加 3', '正式保存'], persistentMutation: true, needsClarification: false, clarificationReason: null, appliedPolicyIds: ['RULE-02', 'RULE-04'], domains: ['part', 'inventory'] });
const response = message => ({ choices: [{ message }] });
const call = (name, args, id) => response({ content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const finalEnvelope = (messages, answer) => {
    const factIds = messages.filter(message => message.role === 'tool').flatMap(message => JSON.parse(message.content).factRefs || []);
    return JSON.stringify({ answer, claims: [{ text: answer, factIds }], goals: [{ questionIndex: 0, status: 'COMPLETED', factIds }] });
};

test('M2-B keeps the model on a proposal-only, uniquely grounded part-stock path', async () => {
    const formalCalls = [];
    let mainRound = 0;
    const result = await runAiAssistant({ userMessage: '把 P-100 库存增加 3 并保存。', confirmationSubject: 'owner-test' }, {
        writeAllowed: true,
        judgeModelCall: async () => response({ content: JSON.stringify(judge) }),
        mainModelCall: async (messages, options) => {
            assert.deepEqual(options.tools.map(item => item.function.name), ['resolve_entity', 'prepare_part_stock_adjustment']);
            mainRound += 1;
            if (mainRound === 1) return call('resolve_entity', { entityType: 'part', mention: 'P-100' }, 'part');
            if (mainRound === 2) {
                const identity = JSON.parse(messages.at(-1).content);
                assert.equal(identity.data.canonicalId, '9');
                return call('prepare_part_stock_adjustment', { partId: 9, delta: 3 }, 'proposal');
            }
            const answer = '已为 P-100 准备库存从 8 增加到 11 的提案；请由 Owner 在受保护确认步骤中批准。';
            return response({ content: finalEnvelope(messages, answer) });
        },
        executeToolCall: async (name, args, options) => {
            formalCalls.push({ name, args, options });
            assert.equal(name, 'adjust_part_stock');
            assert.deepEqual(args, { items: [{ model: 'P-100', changeQty: 3 }] });
            assert.equal(options.allowWrite, false);
            assert.equal(options.confirmationSubject, 'owner-test');
            return { success: true, requiresConfirmation: true, confirmation: { confirmationToken: 'A'.repeat(43), operationId: 'confirmation-op', expiresAt: '2026-10-01T00:00:00.000Z', proposal: { capabilityId: 'inventory.parts.batch_adjust_stock', items: [{ partId: 9, model: 'P-100', currentStock: 8, delta: 3, nextStock: 11, clampedToZero: false }] } } };
        },
        resolveAgentEntity: async () => ({ entityType: 'part', mention: 'P-100', status: 'RESOLVED', canonicalId: '9', canonicalName: 'P-100', candidates: [], source: 'formal', verified: true, matchKind: 'EXACT' }),
    });
    assert.equal(result.status, 'PROPOSAL_READY');
    assert.deepEqual(formalCalls.map(item => item.name), ['adjust_part_stock']);
    assert.deepEqual(result.proposal, { capability: 'adjust_part_stock', part: { id: 9, model: 'P-100' }, currentStock: 8, delta: 3, nextStock: 11, clampedToZero: false, expiresAt: '2026-10-01T00:00:00.000Z' });
    assert.equal(result.confirmation.confirmationToken, 'A'.repeat(43));
    const proposalTool = result.toolResults.at(-1);
    assert.equal(JSON.stringify(proposalTool).includes('confirmationToken'), false);
    assert.equal(JSON.stringify(proposalTool).includes('privateRow'), false);
    assert.equal(JSON.stringify(result.toolResults[0]).includes('confirmationToken'), false);
});

test('M2-B rejects ambiguous part identity and does not issue a proposal', async () => {
    const context = { resolvedPartBindings: new Map(), confirmationSubject: 'owner-test' };
    const { executeAgentTool } = require('../api/services/ai-assistant/agentTools.cjs');
    const found = await executeAgentTool('find_part', { keyword: 'P-100' }, context, { executeToolCall: async () => ({ success: true, parts: [{ id: 1, model: 'P-100' }, { id: 2, model: 'P-100' }] }) });
    assert.equal(found.data.length, 2);
    await assert.rejects(() => executeAgentTool('prepare_part_stock_adjustment', { partRef: 'part_1', delta: 1 }, context, {}), error => error.code === 'AGENT_TOOL_IDENTITY_UNVERIFIED');
});

test('M2-B confirmation consumes only the protected token and preserves formal receipt/readback', async () => {
    let invoked = 0;
    const result = await confirmAiAssistantPartStockProposal({ confirmationToken: 'token', confirmationSubject: 'owner-test' }, {
        writeAllowed: true,
        executeConfirmedAiTool: async input => {
            invoked += 1;
            assert.equal(input.expectedToolName, 'adjust_part_stock');
            return { name: 'adjust_part_stock', operationId: 'formal-op', auditIds: [77], idempotentReplay: false, result: { readback: [{ id: 9, model: 'P-100', stock: 11 }] } };
        },
    });
    assert.equal(invoked, 1);
    assert.deepEqual(result.receipt, { operationId: 'formal-op', auditIds: [77], idempotentReplay: false, readback: [{ id: 9, model: 'P-100', stock: 11 }] });
    await assert.rejects(() => confirmAiAssistantPartStockProposal({ confirmationToken: 'token' }, { writeAllowed: true }), error => error.code === 'AI_ASSISTANT_CONFIRMATION_SUBJECT_REQUIRED');
});

test('M2-B-R1 server write gate is dependency-only and fails closed before Main Agent or proposal', async () => {
    let mainCalls = 0; let formalCalls = 0;
    const result = await runAiAssistant({ userMessage: '把 P-100 库存增加 3 并保存。', confirmationSubject: 'owner-test', writeAllowed: true }, {
        writeAllowed: false,
        judgeModelCall: async () => response({ content: JSON.stringify(judge) }),
        mainModelCall: async () => { mainCalls += 1; throw new Error('must not run'); },
        executeToolCall: async () => { formalCalls += 1; throw new Error('must not run'); },
    });
    assert.equal(result.status, 'WRITE_DISABLED');
    assert.equal(mainCalls, 0); assert.equal(formalCalls, 0); assert.deepEqual(result.toolResults, []);
});

test('M2-B-R1 confirmation gate rejects before token consumption or execution', async () => {
    let executed = 0;
    await assert.rejects(() => confirmAiAssistantPartStockProposal({ confirmationToken: 'valid-token', confirmationSubject: 'owner-a' }, {
        writeAllowed: false,
        executeConfirmedAiTool: async () => { executed += 1; },
    }), error => error.code === 'AI_ASSISTANT_WRITE_DISABLED');
    assert.equal(executed, 0);
});

test('M2-B-R1 post-admission uncertainty is manual-review UNKNOWN_EFFECT without retry', async () => {
    let executions = 0;
    await assert.rejects(() => confirmAiAssistantPartStockProposal({ confirmationToken: 'valid-token', confirmationSubject: 'owner-a' }, {
        writeAllowed: true,
        executeConfirmedAiTool: async () => { executions += 1; const error = new Error('response lost'); error.operationId = 'formal-op-unknown'; throw error; },
    }), error => error.code === 'UNKNOWN_EFFECT' && error.operationId === 'formal-op-unknown' && error.manualReviewRequired === true);
    assert.equal(executions, 1);
});

test('M2-B-R1 pre-admission rejection stays ordinary and is never UNKNOWN_EFFECT', async () => {
    await assert.rejects(() => confirmAiAssistantPartStockProposal({ confirmationToken: 'bad-token', confirmationSubject: 'owner-a' }, {
        writeAllowed: true,
        executeConfirmedAiTool: async () => { const error = new Error('bad token'); error.code = 'confirmation_token_invalid'; throw error; },
    }), error => error.code === 'confirmation_token_invalid');
});

test('M2-B runtime imports no Task V2, command route, semantic router, or old fallback', () => {
    for (const filename of ['agentTools.cjs', 'mainAgent.cjs', 'runtime.cjs', 'protectedPartStock.cjs']) {
        const source = fs.readFileSync(path.join(__dirname, '..', 'api/services/ai-assistant', filename), 'utf8');
        assert.doesNotMatch(source, /aiTaskSemanticsV2|aiTaskControllerV2|aiTaskAnswerV2|GoalKind|TaskEnvelopeV2|aiProtectedCommandRoute|aiTaskWriteBridgeV2/);
    }
    assert.deepEqual(PROTECTED_PROPOSAL_TOOLS.map(item => item.function.name), ['resolve_entity', 'prepare_part_stock_adjustment']);
});
