const { executeToolCall } = require('../routes/ai/executor.cjs');
const { hasVerifiedWriteExecution } = require('./aiExecutionEvidence.cjs');
const {
    completeAiToolConfirmation,
    consumeAiToolConfirmation,
    failAiToolConfirmation,
} = require('./aiToolConfirmation.cjs');

async function executeConfirmedAiTool({
    confirmationToken,
    subject,
    expectedToolName,
    expectedArgs,
    execute = executeToolCall,
    verifyWriteExecution = hasVerifiedWriteExecution,
}) {
    let consumed = null;
    try {
        consumed = consumeAiToolConfirmation({
            confirmationToken,
            subject,
            expectedToolName,
            expectedArgs,
        });
        if (consumed.replay) {
            return { ...consumed.receipt, idempotentReplay: true };
        }

        const result = await execute(consumed.toolName, consumed.args, {
            allowWrite: true,
            operationId: consumed.operationId,
            confirmationContext: consumed.executionContext,
        });
        if (!result || result.success === false || !verifyWriteExecution(result)) {
            const executionError = new Error(
                result?.error || '正式业务 API 未返回可验证的写操作回执'
            );
            executionError.code = result?.code || 'ai_write_evidence_missing';
            executionError.statusCode = 502;
            throw executionError;
        }

        const receipt = {
            name: consumed.toolName,
            result,
            capabilityId: consumed.capabilityId,
            operationId: consumed.operationId,
            status: 'completed',
            changes: Array.isArray(result.changes) ? result.changes : [],
            warnings: Array.isArray(result.warnings) ? result.warnings : [],
            auditId: result.auditId
                ?? result.executionEvidence.receipts[0]?.auditIds?.[0]
                ?? null,
            auditIds: result.auditIds
                ?? result.executionEvidence.receipts.flatMap(item => item.auditIds || []),
            idempotentReplay: false,
            completedAt: new Date().toISOString(),
        };
        completeAiToolConfirmation({ confirmationToken, subject, receipt });
        return receipt;
    } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        if (consumed && !consumed.replay) {
            try {
                failAiToolConfirmation({ confirmationToken, subject, error: failure });
            } catch {
                // 保留原始执行错误；确认状态修复失败不能掩盖业务失败。
            }
        }
        failure.operationId ||= consumed?.operationId || null;
        throw failure;
    }
}

module.exports = {
    executeConfirmedAiTool,
};
