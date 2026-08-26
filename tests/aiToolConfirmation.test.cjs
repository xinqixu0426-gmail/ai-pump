const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    AiToolConfirmationError,
    completeAiToolConfirmation,
    consumeAiToolConfirmation,
    issueAiToolConfirmation,
    resetAiToolConfirmationsForTests,
} = require('../api/services/aiToolConfirmation.cjs');
const { executeToolCall } = require('../api/routes/ai/executor.cjs');
const { executeConfirmedAiTool } = require('../api/services/aiConfirmedToolExecution.cjs');

test.beforeEach(() => {
    resetAiToolConfirmationsForTests();
});

function issue(overrides = {}) {
    return issueAiToolConfirmation({
        toolName: 'update_part',
        args: { model: 'A-1', price: 12.5 },
        subject: 'session-a',
        now: 1_000,
        ...overrides,
    });
}

test('AI 确认协议：token 绑定能力、服务端参数和 operationId', () => {
    const confirmation = issue();
    const consumed = consumeAiToolConfirmation({
        confirmationToken: confirmation.confirmationToken,
        subject: 'session-a',
        now: 2_000,
    });

    assert.equal(consumed.replay, false);
    assert.equal(consumed.capabilityId, 'ai.update_part');
    assert.equal(consumed.toolName, 'update_part');
    assert.deepEqual(consumed.args, { model: 'A-1', price: 12.5 });
    assert.equal(consumed.argsHash, confirmation.argsHash);
    assert.equal(consumed.operationId, confirmation.operationId);
});

test('AI 确认协议：服务端预览上下文随 token 绑定但不暴露给确认卡调用方', () => {
    const confirmation = issue({
        executionContext: {
            kind: 'part_stock_preview',
            confirmationToken: 'formal-preview-token',
            idempotencyKey: 'formal-idempotency-key',
        },
    });

    assert.equal(
        Object.prototype.hasOwnProperty.call(confirmation, 'executionContext'),
        false
    );
    const consumed = consumeAiToolConfirmation({
        confirmationToken: confirmation.confirmationToken,
        subject: 'session-a',
        now: 2_000,
    });
    assert.deepEqual(consumed.executionContext, {
        kind: 'part_stock_preview',
        confirmationToken: 'formal-preview-token',
        idempotencyKey: 'formal-idempotency-key',
    });
});

test('AI 确认协议：参数或工具名被篡改时拒绝且原 token 仍可正确消费', () => {
    const confirmation = issue();

    assert.throws(
        () => consumeAiToolConfirmation({
            confirmationToken: confirmation.confirmationToken,
            subject: 'session-a',
            expectedToolName: 'delete_part',
            expectedArgs: { model: 'A-1', price: 999 },
            now: 2_000,
        }),
        error => error instanceof AiToolConfirmationError
            && error.code === 'confirmation_payload_mismatch'
    );

    const consumed = consumeAiToolConfirmation({
        confirmationToken: confirmation.confirmationToken,
        subject: 'session-a',
        expectedToolName: 'update_part',
        expectedArgs: { price: 12.5, model: 'A-1' },
        now: 2_100,
    });
    assert.equal(consumed.replay, false);
});

test('AI 确认协议：换登录主体和过期 token 均拒绝', () => {
    const subjectBound = issue();
    assert.throws(
        () => consumeAiToolConfirmation({
            confirmationToken: subjectBound.confirmationToken,
            subject: 'session-b',
            now: 2_000,
        }),
        error => error.code === 'confirmation_subject_mismatch' && error.statusCode === 403
    );

    const expiring = issue({ now: 10_000, ttlMs: 30_000 });
    assert.throws(
        () => consumeAiToolConfirmation({
            confirmationToken: expiring.confirmationToken,
            subject: 'session-a',
            now: 40_001,
        }),
        error => error.code === 'confirmation_token_expired'
    );
});

test('AI 确认协议：并发重复消费被阻止，完成后重放只返回原回执', () => {
    const confirmation = issue();
    consumeAiToolConfirmation({
        confirmationToken: confirmation.confirmationToken,
        subject: 'session-a',
        now: 2_000,
    });

    assert.throws(
        () => consumeAiToolConfirmation({
            confirmationToken: confirmation.confirmationToken,
            subject: 'session-a',
            now: 2_001,
        }),
        error => error.code === 'confirmation_in_progress'
    );

    const receipt = {
        name: 'update_part',
        result: { success: true, data: { id: 7 } },
        operationId: confirmation.operationId,
        idempotentReplay: false,
    };
    completeAiToolConfirmation({
        confirmationToken: confirmation.confirmationToken,
        subject: 'session-a',
        receipt,
        now: 2_500,
    });

    const replay = consumeAiToolConfirmation({
        confirmationToken: confirmation.confirmationToken,
        subject: 'session-a',
        now: 3_000,
    });
    assert.equal(replay.replay, true);
    assert.deepEqual(replay.receipt, receipt);
});

test('AI 确认协议：Web 与 MCP 复用同一确认执行服务和正式回执门', async () => {
    const confirmation = issue({ now: Date.now() });
    const calls = [];
    const receipt = await executeConfirmedAiTool({
        confirmationToken: confirmation.confirmationToken,
        subject: 'session-a',
        expectedToolName: 'update_part',
        expectedArgs: { price: 12.5, model: 'A-1' },
        execute: async (name, args, options) => {
            calls.push({ name, args, options });
            return {
                success: true,
                auditId: 90,
                auditIds: [90],
                changes: [{ field: 'price', from: 10, to: 12.5 }],
                executionEvidence: {
                    verified: true,
                    receipts: [{
                        operationId: 'formal-operation-91',
                        capabilityId: 'parts.update',
                        status: 'completed',
                        auditIds: [91],
                    }],
                },
            };
        },
        verifyWriteExecution: result => result.executionEvidence?.verified === true,
    });

    assert.equal(receipt.status, 'completed');
    assert.equal(receipt.auditId, 90);
    assert.deepEqual(receipt.auditIds, [90, 91]);
    assert.equal(receipt.operationId, 'formal-operation-91');
    assert.equal(receipt.confirmationOperationId, confirmation.operationId);
    assert.deepEqual(receipt.formalCapabilityIds, ['parts.update']);
    assert.deepEqual(receipt.formalOperationIds, ['formal-operation-91']);
    assert.deepEqual(calls, [{
        name: 'update_part',
        args: { model: 'A-1', price: 12.5 },
        options: {
            allowWrite: true,
            operationId: confirmation.operationId,
            confirmationContext: null,
        },
    }]);

    const replay = await executeConfirmedAiTool({
        confirmationToken: confirmation.confirmationToken,
        subject: 'session-a',
        execute: async () => {
            throw new Error('重放不应再次执行');
        },
    });
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.auditId, 90);
    assert.deepEqual(replay.auditIds, [90, 91]);
});

test('AI 确认协议：业务失败与正式回执证据缺失使用不同错误码', async () => {
    const businessFailure = issue({ now: Date.now() });
    await assert.rejects(
        executeConfirmedAiTool({
            confirmationToken: businessFailure.confirmationToken,
            subject: 'session-a',
            execute: async () => ({ success: false, error: '订单不存在' }),
        }),
        error => error.code === 'ai_write_execution_failed'
            && error.message === '订单不存在'
    );

    const evidenceFailure = issue({ now: Date.now() });
    await assert.rejects(
        executeConfirmedAiTool({
            confirmationToken: evidenceFailure.confirmationToken,
            subject: 'session-a',
            execute: async () => ({ success: true, changes: [] }),
            verifyWriteExecution: () => false,
        }),
        error => error.code === 'ai_write_evidence_missing'
            && /可验证的写操作回执/.test(error.message)
    );
});

test('AI 确认协议：executor 返回短时 token，未确认仍不执行写能力', async () => {
    const result = await executeToolCall(
        'print_rotor_drawing',
        { jobId: 'job-1' },
        { allowWrite: false, confirmationSubject: 'session-a' }
    );

    assert.equal(result.requiresConfirmation, true);
    assert.match(result.confirmation.confirmationToken, /^[A-Za-z0-9_-]{40,128}$/);
    assert.match(result.confirmation.operationId, /^[0-9a-f-]{36}$/);
    assert.equal(result.confirmation.argsHash.length, 64);
    assert.ok(Date.parse(result.confirmation.expiresAt) > Date.now());
});

test('AI 确认协议：只读能力不能签发写操作确认 token', () => {
    assert.throws(
        () => issueAiToolConfirmation({
            toolName: 'search_parts',
            args: {},
            subject: 'session-a',
        }),
        error => error.code === 'confirmation_not_allowed' && error.statusCode === 400
    );
});

test('AI 确认协议：正式确认路由只执行 token 中的服务端参数', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'api/routes/ai/chat.cjs'),
        'utf8'
    );
    const route = source.slice(
        source.indexOf("router.post('/api/ai/confirm-tool'"),
        source.indexOf('/**\n * 通用 AI 对话处理函数')
    );

    assert.match(route, /confirmation_token_required/);
    assert.match(route, /executeConfirmedAiTool/);
    assert.doesNotMatch(route, /executeToolCall/);
});
