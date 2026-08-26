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
        if (!result || result.success === false) {
            const executionError = new Error(
                result?.error || '正式业务 API 执行失败'
            );
            executionError.code = result?.code || 'ai_write_execution_failed';
            executionError.statusCode = 502;
            throw executionError;
        }
        if (!verifyWriteExecution(result)) {
            const executionError = new Error(
                '正式业务 API 未返回可验证的写操作回执'
            );
            executionError.code = 'ai_write_evidence_missing';
            executionError.statusCode = 502;
            throw executionError;
        }

        const formalReceipts = result.executionEvidence.receipts
            .filter(item => item?.operationId && item?.capabilityId);
        const primaryFormalReceipt = formalReceipts[0] || null;
        const auditIds = [...new Set(formalReceipts
            .flatMap(item => item.auditIds || [])
            .filter(id => id !== undefined && id !== null && id !== ''))];
        const publicAuditIds = [];
        const seenAuditIds = new Set();
        for (const auditId of [
            ...(Array.isArray(result.auditIds) ? result.auditIds : []),
            result.auditId,
            ...auditIds,
        ]) {
            if (auditId === undefined || auditId === null || auditId === '') continue;
            const key = String(auditId);
            if (seenAuditIds.has(key)) continue;
            seenAuditIds.add(key);
            publicAuditIds.push(auditId);
        }
        const operationStatus = primaryFormalReceipt?.status || 'completed';
        const receipt = {
            name: consumed.toolName,
            result,
            capabilityId: consumed.capabilityId,
            operationId: primaryFormalReceipt?.operationId || consumed.operationId,
            confirmationOperationId: consumed.operationId,
            formalCapabilityIds: formalReceipts.map(item => item.capabilityId),
            formalOperationIds: formalReceipts.map(item => item.operationId),
            status: operationStatus,
            changes: Array.isArray(result.changes) ? result.changes : [],
            warnings: Array.isArray(result.warnings) ? result.warnings : [],
            auditId: result.auditId
                ?? publicAuditIds[0]
                ?? null,
            auditIds: publicAuditIds,
            idempotentReplay: formalReceipts.some(item => item.idempotentReplay),
            completedAt: operationStatus === 'completed'
                ? primaryFormalReceipt?.completedAt || new Date().toISOString()
                : null,
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
