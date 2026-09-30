'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { issueAiToolConfirmation, resetAiToolConfirmationsForTests } = require('../api/services/aiToolConfirmation.cjs');
const { assertPreflightIdentity, executeProtectedWriteConfirmation, publicProposal, protectedToolDefinitions } = require('../api/services/ai-assistant/protectedWriteBroker.cjs');
const { protectedProposalTools } = require('../api/services/ai-assistant/agentTools.cjs');
const { validateAnswer } = require('../api/services/ai-assistant/answerValidator.cjs');
const { buildExecuteRequestBody, createWriteCard, isAiAssistantWriteProposalEvent, successModelFromOutcome } = require('../apps/web-next/lib/ai-assistant-write-proposal.cjs');

test('protected write broker is registry-bounded and projects no internal part identity', () => {
    assert.deepEqual(protectedToolDefinitions().map(item => item.toolName).sort(), [
        'adjust_coil_stock', 'adjust_part_stock', 'update_order_status', 'update_recipe',
    ]);
    const proposal = publicProposal('adjust_part_stock', {
        proposal: { items: [{ partId: 201, model: '通用零件', currentStock: 3, delta: 2, nextStock: 5 }] },
        executionContext: { warnings: [] },
    });
    assert.equal(proposal.target.displayName, '通用零件');
    assert.equal(JSON.stringify(proposal).includes('201'), false);
    const exposed = protectedProposalTools({ domains: ['coil'] }).map(item => item.function.name);
    assert.deepEqual(exposed.sort(), ['prepare_coil_stock_adjustment', 'resolve_entity'].sort());
    assert.equal(exposed.includes('adjust_coil_stock'), false);
});

test('protected confirmation executes frozen formal args once and returns bounded verified readback', async () => {
    resetAiToolConfirmationsForTests();
    const issued = issueAiToolConfirmation({
        toolName: 'adjust_part_stock', subject: 'owner:1', args: { items: [{ model: '通用零件', changeQty: 2 }] },
        executionContext: { kind: 'part_stock_preview' },
    });
    let executions = 0;
    const execute = async () => {
        executions += 1;
        return { success: true, readback: [{ id: 201, model: '通用零件', stock: 5 }], executionEvidence: {
            verified: true, kind: 'formal_api_command', receipts: [{ operationId: 'formal-op', capabilityId: 'inventory.parts.batch_adjust_stock', status: 'completed', auditIds: ['audit-1'] }],
        } };
    };
    const input = { confirmationToken: issued.confirmationToken, confirmationSubject: 'owner:1' };
    const first = await executeProtectedWriteConfirmation(input, { writeAllowed: true, executeToolCall: execute });
    const replay = await executeProtectedWriteConfirmation(input, { writeAllowed: true, executeToolCall: execute });
    assert.equal(first.outcome.verified, true);
    assert.deepEqual(first.outcome.state, { stock: 5 });
    assert.equal(JSON.stringify(first.outcome).includes('201'), false);
    assert.equal(replay.outcome.idempotentReplay, true);
    assert.equal(executions, 1);
});

test('unadmitted confirmation tokens cannot use the Assistant protected endpoint', async () => {
    resetAiToolConfirmationsForTests();
    const issued = issueAiToolConfirmation({ toolName: 'delete_recipe', subject: 'owner:1', args: { recipeName: 'X' } });
    await assert.rejects(
        () => executeProtectedWriteConfirmation({ confirmationToken: issued.confirmationToken, confirmationSubject: 'owner:1' }, { writeAllowed: true }),
        error => error.code === 'UNSUPPORTED_WRITE'
    );
});

test('a formal preflight must match the already verified write identity', () => {
    assert.throws(() => assertPreflightIdentity('adjust_part_stock', { type: 'part', id: 9 }, {
        proposal: { items: [{ partId: 10 }] }, executionContext: {},
    }), error => error.code === 'AI_ASSISTANT_IDENTITY_PREVIEW_MISMATCH');
});

test('stale frozen proposal is rejected without a second command attempt', async () => {
    resetAiToolConfirmationsForTests();
    const issued = issueAiToolConfirmation({ toolName: 'adjust_part_stock', subject: 'owner:1', args: { items: [{ model: '通用零件', changeQty: 2 }] } });
    let executions = 0;
    await assert.rejects(() => executeProtectedWriteConfirmation({ confirmationToken: issued.confirmationToken, confirmationSubject: 'owner:1' }, {
        writeAllowed: true,
        executeToolCall: async () => { executions += 1; const error = new Error('resource version conflict'); error.code = 'resource_version_conflict'; throw error; },
    }), error => error.code === 'STALE_PROPOSAL');
    assert.equal(executions, 1);
});

test('answer validator refuses a proposal-only success claim', () => {
    const result = validateAnswer(JSON.stringify({ answer: '已经修改成功。', claims: [{ text: '已经修改成功。', factIds: ['F-001'] }], goals: [{ questionIndex: 0, status: 'COMPLETED', factIds: ['F-001'] }] }), {
        proposalOnly: true, judge: { questions: ['修改库存'], mode: 'PERSIST_MUTATION' }, ledger: { facts: [{ factId: 'F-001', verified: true, predicate: 'stock', value: 5, unit: 'COUNT' }] }, mode: 'PERSIST_MUTATION',
    });
    assert.equal(result.code, 'PROPOSAL_SUCCESS_CLAIM');
});

test('generic protected write card keeps opaque confirmation transport and does not reconstruct arguments', () => {
    const event = { type: 'write_proposal', stage: 'AI_ASSISTANT_WRITE_PROPOSAL', proposal: {
        capabilityId: 'orders.change_status', target: { entityType: 'order', displayName: 'HT-2026-01' },
        changes: [{ field: 'status', current: '待采购', proposed: '已关闭' }], currentState: { status: '待采购' }, proposedState: { status: '已关闭' }, warnings: [],
    }, confirmation: { confirmationToken: 'opaque-token' } };
    assert.equal(isAiAssistantWriteProposalEvent(event), true);
    const card = createWriteCard(event);
    assert.deepEqual(buildExecuteRequestBody(card), { confirmationToken: 'opaque-token' });
    assert.equal(successModelFromOutcome({ verified: true, target: { displayName: 'HT-2026-01' }, state: { status: '已关闭' } }, event.proposal)?.title, '正式修改完成');
});
