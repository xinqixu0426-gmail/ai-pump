const express = require('express');
const { createLogger } = require('../../logger.cjs');
const authMiddleware = require('../../authMiddleware.cjs');
const { executeToolCall } = require('./executor.cjs');
const { aiProviderCapabilities } = require('../../services/aiProvider.cjs');
const { runAiDispatcherV3 } = require('../../services/aiDispatcherV3.cjs');
const {
    AiToolConfirmationError,
    completeAiToolConfirmation,
    confirmationSubjectForRequest,
    consumeAiToolConfirmation,
    failAiToolConfirmation,
} = require('../../services/aiToolConfirmation.cjs');
const { hasVerifiedWriteExecution } = require('../../services/aiExecutionEvidence.cjs');
const { normalizeResolutionContext } = require('../../services/aiResourceResolutionV3.cjs');
const { normalizeAiTurnStateV3 } = require('../../services/aiTurnStateV3.cjs');

const router = express.Router();
const aiChatLogger = createLogger('ai-chat');

function confirmAuth(req, res, next) {
    if (process.env.INTERNAL_SECRET && req.headers['x-internal-secret'] === process.env.INTERNAL_SECRET) {
        return next();
    }
    return authMiddleware(req, res, next);
}

router.get('/api/ai/capabilities', confirmAuth, (req, res) => {
    try {
        res.json({ success: true, data: aiProviderCapabilities() });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.post('/api/ai/chat', confirmAuth, async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (type, payload = {}) => {
        res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
        if (typeof res.flush === 'function') res.flush();
    };
    let lastProviderKey = '';
    const onProvider = info => {
        const key = `${info.provider}:${info.model}:${info.fallback ? 'fallback' : 'primary'}`;
        if (key === lastProviderKey) return;
        lastProviderKey = key;
        send('provider', info);
    };

    try {
        await runAiDispatcherV3({
            messages: req.body?.messages,
            pageContext: req.body?.pageContext,
            resolutionContext: normalizeResolutionContext(req.body?.resolutionContext),
            turnState: normalizeAiTurnStateV3(req.body?.turnState),
            confirmationSubject: confirmationSubjectForRequest(req),
            stream: true,
            emit: send,
            onProvider,
        });
    } catch (error) {
        aiChatLogger.error('AI 对话失败', {
            code: error.code || 'ai_dispatcher_v3_error',
            message: error.message,
            causeCode: error.cause?.code || error.cause?.cause?.code || null,
            provider: error.details?.provider || null,
            action: error.details?.action || null,
            requestId: req.requestId || null,
        });
        send('error', { message: error.message, code: error.code || 'ai_dispatcher_v3_error' });
    } finally {
        res.end();
    }
});

router.post('/api/ai/confirm-tool', confirmAuth, async (req, res) => {
    const confirmationSubject = confirmationSubjectForRequest(req);
    const { confirmationToken, toolName, args } = req.body || {};
    if (!confirmationToken) {
        return res.status(409).json({
            success: false,
            code: 'confirmation_token_required',
            error: '旧确认请求不能直接执行，请重新发起操作并核对新的确认卡片',
            requestId: req.requestId || null,
        });
    }

    let consumed = null;
    try {
        consumed = consumeAiToolConfirmation({
            confirmationToken,
            subject: confirmationSubject,
            expectedToolName: toolName,
            expectedArgs: Object.hasOwn(req.body || {}, 'args') ? args : undefined,
        });
        if (consumed.replay) {
            return res.json({
                success: true,
                data: { ...consumed.receipt, idempotentReplay: true },
            });
        }

        const result = await executeToolCall(consumed.toolName, consumed.args, {
            allowWrite: true,
            operationId: consumed.operationId,
            confirmationContext: consumed.executionContext,
        });
        if (!result || result.success === false || !hasVerifiedWriteExecution(result)) {
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
        completeAiToolConfirmation({
            confirmationToken,
            subject: confirmationSubject,
            receipt,
        });
        return res.json({ success: true, data: receipt });
    } catch (error) {
        if (consumed && !consumed.replay) {
            try {
                failAiToolConfirmation({
                    confirmationToken,
                    subject: confirmationSubject,
                    error,
                });
            } catch {
                // 保留原始执行错误。
            }
        }
        const statusCode = error instanceof AiToolConfirmationError
            ? error.statusCode
            : error.statusCode || 500;
        return res.status(statusCode).json({
            success: false,
            code: error.code || 'confirmation_execution_error',
            error: error.message,
            operationId: consumed?.operationId || null,
            requestId: req.requestId || null,
        });
    }
});

async function processAiChat(text, options = {}) {
    return runAiDispatcherV3({
        messages: [
            ...(Array.isArray(options.context) ? options.context : []),
            { role: 'user', content: text },
        ],
        promptSuffix: options.promptSuffix,
        allowWrite: Boolean(options.allowWrite),
        pageContext: options.pageContext,
        resolutionContext: options.resolutionContext,
        turnState: options.turnState,
        confirmationSubject: options.confirmationSubject || 'internal:process-ai-chat',
        fetchAiProvider: options.fetchAiProvider,
        env: options.env,
        dbAccessors: options.dbAccessors,
        stream: false,
    });
}

module.exports = { router, processAiChat };
