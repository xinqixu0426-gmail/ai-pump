const express = require('express');
const { createLogger } = require('../../logger.cjs');
const authMiddleware = require('../../authMiddleware.cjs');
const { aiProviderCapabilities } = require('../../services/aiProvider.cjs');
const { runAiDispatcherV3 } = require('../../services/aiDispatcherV3.cjs');
const {
    AiToolConfirmationError,
    confirmationSubjectForRequest,
} = require('../../services/aiToolConfirmation.cjs');
const { executeConfirmedAiTool } = require('../../services/aiConfirmedToolExecution.cjs');
const { normalizeResolutionContext } = require('../../services/aiResourceResolutionV3.cjs');
const { normalizeAiTurnStateV3 } = require('../../services/aiTurnStateV3.cjs');
const { aiRuntimeTelemetry } = require('../../services/aiRuntimeTelemetry.cjs');
const { getAiHealth } = require('../../services/aiHealth.cjs');

const router = express.Router();
const aiChatLogger = createLogger('ai-chat');
const DEFAULT_AI_CHAT_TIMEOUT_MS = 180 * 1000;
const DEFAULT_SSE_HEARTBEAT_MS = 15 * 1000;

function boundedDuration(value, fallback, minimum, maximum) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(Math.trunc(parsed), minimum), maximum);
}

function aiChatTimeoutMs(env = process.env) {
    return boundedDuration(
        env.AI_CHAT_TIMEOUT_MS,
        DEFAULT_AI_CHAT_TIMEOUT_MS,
        10 * 1000,
        15 * 60 * 1000
    );
}

function sseHeartbeatMs(env = process.env) {
    return boundedDuration(
        env.AI_SSE_HEARTBEAT_MS,
        DEFAULT_SSE_HEARTBEAT_MS,
        5 * 1000,
        60 * 1000
    );
}

function requestAbortError(code, message) {
    const error = new Error(message);
    error.name = 'AbortError';
    error.code = code;
    return error;
}

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

router.get('/api/ai/health', confirmAuth, (req, res) => {
    try {
        res.json({ success: true, data: getAiHealth() });
    } catch (error) {
        res.status(500).json({
            success: false,
            code: error.code || 'AI_HEALTH_READ_FAILED',
            error: error.message,
            requestId: req.requestId || null,
        });
    }
});

async function handleAiChat(req, res, options = {}) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const startedAt = Date.now();
    const providerEvents = [];
    const controller = new AbortController();
    let settled = false;
    let clientDisconnected = false;
    const telemetry = options.telemetry || aiRuntimeTelemetry;
    const timeoutMs = options.timeoutMs || aiChatTimeoutMs(options.env);
    const timeout = setTimeout(() => {
        controller.abort(requestAbortError('AI_REQUEST_TIMEOUT', `AI 请求超过 ${timeoutMs}ms，已停止`));
    }, timeoutMs);
    timeout.unref?.();
    const abortFromClient = () => {
        if (settled || res.writableEnded) return;
        clientDisconnected = true;
        controller.abort(requestAbortError('AI_REQUEST_CANCELLED', '用户已停止本次 AI 请求'));
    };
    req.once?.('aborted', abortFromClient);
    res.once?.('close', abortFromClient);
    const heartbeat = setInterval(() => {
        if (clientDisconnected || res.writableEnded || res.destroyed) return;
        res.write(': heartbeat\n\n');
        if (typeof res.flush === 'function') res.flush();
    }, options.heartbeatMs || sseHeartbeatMs(options.env));
    heartbeat.unref?.();

    const send = (type, payload = {}) => {
        if (clientDisconnected || res.writableEnded || res.destroyed) return;
        res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
        if (typeof res.flush === 'function') res.flush();
    };
    let lastProviderKey = '';
    const onProvider = info => {
        providerEvents.push({ ...info });
        const key = `${info.provider}:${info.model}:${info.fallback ? 'fallback' : 'primary'}`;
        if (key === lastProviderKey) return;
        lastProviderKey = key;
        send('provider', info);
    };

    try {
        const result = await (options.runAiDispatcherV3 || runAiDispatcherV3)({
            messages: req.body?.messages,
            pageContext: req.body?.pageContext,
            resolutionContext: normalizeResolutionContext(req.body?.resolutionContext),
            turnState: normalizeAiTurnStateV3(req.body?.turnState),
            confirmationSubject: confirmationSubjectForRequest(req),
            stream: true,
            emit: send,
            onProvider,
            signal: controller.signal,
            requestId: req.requestId || null,
        });
        telemetry.record({
            requestId: req.requestId,
            status: 'completed',
            outcome: result?.telemetry?.outcome || 'completed',
            durationMs: Date.now() - startedAt,
            providerEvents,
        });
    } catch (error) {
        const abortCode = controller.signal.aborted
            ? controller.signal.reason?.code || error.code
            : '';
        if (abortCode === 'AI_REQUEST_CANCELLED') {
            telemetry.record({
                requestId: req.requestId,
                status: 'cancelled',
                outcome: 'cancelled',
                durationMs: Date.now() - startedAt,
                providerEvents,
                errorCode: abortCode,
            });
            return;
        }
        const errorCode = abortCode || error.code || 'ai_dispatcher_v3_error';
        telemetry.record({
            requestId: req.requestId,
            status: 'failed',
            outcome: 'failed',
            durationMs: Date.now() - startedAt,
            providerEvents,
            errorCode,
        });
        aiChatLogger.error('AI 对话失败', {
            code: errorCode,
            message: error.message,
            causeCode: error.cause?.code || error.cause?.cause?.code || null,
            provider: error.details?.provider || null,
            action: error.details?.action || null,
            requestId: req.requestId || null,
        });
        send('error', { message: error.message, code: errorCode });
    } finally {
        settled = true;
        clearTimeout(timeout);
        clearInterval(heartbeat);
        req.removeListener?.('aborted', abortFromClient);
        res.removeListener?.('close', abortFromClient);
        if (!res.writableEnded && !res.destroyed) res.end();
    }
}

router.post('/api/ai/chat', confirmAuth, handleAiChat);

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

    try {
        const receipt = await executeConfirmedAiTool({
            confirmationToken,
            subject: confirmationSubject,
            expectedToolName: toolName,
            expectedArgs: Object.hasOwn(req.body || {}, 'args') ? args : undefined,
        });
        return res.json({ success: true, data: receipt });
    } catch (error) {
        const statusCode = error instanceof AiToolConfirmationError
            ? error.statusCode
            : error.statusCode || 500;
        return res.status(statusCode).json({
            success: false,
            code: error.code || 'confirmation_execution_error',
            error: error.message,
            operationId: error.operationId || null,
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
        signal: options.signal,
        requestId: options.requestId || null,
    });
}

module.exports = {
    DEFAULT_AI_CHAT_TIMEOUT_MS,
    DEFAULT_SSE_HEARTBEAT_MS,
    aiChatTimeoutMs,
    handleAiChat,
    processAiChat,
    router,
    sseHeartbeatMs,
};
