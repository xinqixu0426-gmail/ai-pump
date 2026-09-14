const { executeToolCall } = require('../routes/ai/executor.cjs');
const {
    AiToolConfirmationError,
    beginAiToolConfirmationRevision,
    cancelAiToolConfirmationRevision,
    completeAiToolConfirmationRevision,
} = require('./aiToolConfirmation.cjs');

async function reviseAiToolConfirmation({
    confirmationToken,
    subject,
    toolName,
    args,
    execute = executeToolCall,
}) {
    const reservation = beginAiToolConfirmationRevision({
        confirmationToken,
        subject,
        expectedToolName: toolName,
    });
    try {
        const preview = await execute(reservation.toolName, args, {
            allowWrite: false,
            confirmationSubject: subject,
        });
        if (!preview?.success || !preview.requiresConfirmation || !preview.confirmation?.confirmationToken) {
            throw new AiToolConfirmationError(
                preview?.code || 'confirmation_revision_invalid',
                preview?.error || '修改后的参数未通过校验',
                422
            );
        }
        completeAiToolConfirmationRevision({ confirmationToken, subject });
        return {
            name: reservation.toolName,
            result: preview,
        };
    } catch (error) {
        try {
            cancelAiToolConfirmationRevision({ confirmationToken, subject });
        } catch {
            // 保留原始校验错误。
        }
        throw error;
    }
}

module.exports = {
    reviseAiToolConfirmation,
};
